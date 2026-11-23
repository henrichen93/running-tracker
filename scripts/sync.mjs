#!/usr/bin/env node
// Lấy hoạt động từ Strava (qua Cloudflare Worker) và tính bảng xếp hạng.
// Node 20+, không cần cài thư viện.
//
//   node scripts/sync.mjs                # lấy dữ liệu mới + tính lại
//   node scripts/sync.mjs --full         # lấy lại toàn bộ người tham gia (bỏ qua webhook)
//   node scripts/sync.mjs --recompute    # chỉ tính lại từ cache (chỉ fetch người còn thiếu dữ liệu)
//
// Mặc định (cron 15 phút): chỉ fetch những người Strava webhook báo có hoạt động mới,
// và cứ `sync.fullRefreshHours` (mặc định 3h) thì quét lại toàn bộ một lần cho chắc.
//   node scripts/sync.mjs --root demo    # chạy trên thư mục khác (dùng cho demo)
//
// Env: SYNC_KEY (bắt buộc để fetch Strava)

import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const RECOMPUTE = args.includes('--recompute');
const FULL = args.includes('--full');
const ROOT = args.includes('--root') ? args[args.indexOf('--root') + 1] : '.';
const SYNC_KEY = process.env.SYNC_KEY || '';
const DATA = path.join(ROOT, 'data');

export const DEFAULT_RULES = {
  minPace: 4,
  maxPace: 18,
  sportTypes: ['Run', 'TrailRun', 'VirtualRun'],
  allowManual: false,
  minDistanceKm: 0,
  paceBasis: 'moving',
  showOtherSports: false,
};

// ---------- helpers ----------
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function writeJSON(file, data, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, pretty ? 2 : 0) + '\n');
}
// Chỉ ghi khi nội dung thật sự đổi (bỏ qua generatedAt) -> không commit/deploy thừa
async function writeIfChanged(file, data, pretty = false) {
  const strip = (o) => JSON.stringify({ ...o, generatedAt: undefined });
  const old = await readJSON(file, null);
  if (old && strip(old) === strip(data)) return false;
  await writeJSON(file, data, pretty);
  return true;
}
const todayIn = (tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const epoch = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);
const minStr = (a, b) => (a < b ? a : b);
const maxStr = (a, b) => (a > b ? a : b);
export const fmtPace = (p) => {
  if (p == null || !isFinite(p)) return '-';
  let m = Math.floor(p);
  let s = Math.round((p - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, '0')}`;
};
export const eventStatus = (e, today) => (today < e.start ? 'upcoming' : today > e.end ? 'finished' : 'ongoing');
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function parseDuration(v) {
  if (typeof v === 'number') return v;
  const parts = String(v || '0').split(':').map(Number);
  return parts.reduce((acc, x) => acc * 60 + (x || 0), 0);
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= addDays(last[1], 1)) last[1] = maxStr(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

// ---------- validation ----------
export function evaluate(a, rules, override) {
  const reasons = [];
  const km = (a.distance || 0) / 1000;
  const secs = rules.paceBasis === 'elapsed' ? a.elapsed_time : a.moving_time;
  const pace = km > 0 && secs > 0 ? secs / 60 / km : null; // phút / km

  if (a.source !== 'manual') {
    if (!rules.sportTypes.includes(a.sport_type)) reasons.push(`Không phải chạy bộ (${a.sport_type})`);
    if (a.manual && !rules.allowManual) reasons.push('Nhập tay trên Strava (không có GPS)');
    if (a.flagged) reasons.push('Bị Strava gắn cờ (flagged)');
  }
  if (km <= 0) reasons.push('Không có quãng đường');
  else if (pace == null) reasons.push('Không có thời gian di chuyển');
  else {
    if (pace < rules.minPace)
      reasons.push(`Pace ${fmtPace(pace)}/km nhanh hơn giới hạn ${fmtPace(rules.minPace)}/km`);
    if (pace > rules.maxPace)
      reasons.push(`Pace ${fmtPace(pace)}/km chậm hơn giới hạn ${fmtPace(rules.maxPace)}/km`);
  }
  if (rules.minDistanceKm > 0 && km > 0 && km < rules.minDistanceKm)
    reasons.push(`Quãng đường ${round(km)} km ngắn hơn tối thiểu ${rules.minDistanceKm} km`);

  let valid = reasons.length === 0;
  let overridden = null;
  if (override && (override.status === 'valid' || override.status === 'invalid')) {
    overridden = override.status;
    valid = override.status === 'valid';
    if (!valid) reasons.push(override.reason?.trim() || 'Không hợp lệ');
  }

  return {
    id: String(a.id),
    source: a.source || 'strava',
    name: a.name || '',
    type: a.sport_type || 'Run',
    date: (a.start_date_local || '').slice(0, 10),
    time: (a.start_date_local || '').slice(11, 16),
    km: round(km, 3),
    movingTime: a.moving_time || 0,
    elapsedTime: a.elapsed_time || 0,
    pace: pace == null ? null : round(pace, 3),
    elevation: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
    valid,
    reasons,
    overridden,
    overrideReason: override?.reason || '',
  };
}

// ---------- Strava fetch ----------
function trimActivity(a) {
  return {
    id: a.id,
    name: a.name,
    sport_type: a.sport_type || a.type,
    distance: a.distance,
    moving_time: a.moving_time,
    elapsed_time: a.elapsed_time,
    start_date: a.start_date,
    start_date_local: a.start_date_local,
    total_elevation_gain: a.total_elevation_gain,
    manual: !!a.manual,
    flagged: !!a.flagged,
  };
}

class RateLimited extends Error {}

async function fetchActivities(token, from, to) {
  const all = [];
  const after = epoch(from) - 86400; // buffer vì múi giờ
  const before = epoch(to) + 2 * 86400;
  for (let page = 1; page <= 20; page++) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&per_page=200&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) throw new RateLimited('Strava rate limit');
    if (!res.ok) throw new Error(`Strava ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all
    .map(trimActivity)
    .filter((a) => {
      const d = (a.start_date_local || '').slice(0, 10);
      return d >= from && d <= to;
    });
}

// ---------- main ----------
async function main() {
  const config = await readJSON(path.join(ROOT, 'config.json'), null);
  if (!config) throw new Error(`Không đọc được ${ROOT}/config.json`);
  const tz = config.site?.timezone || 'Asia/Ho_Chi_Minh';
  const today = todayIn(tz);
  const workerUrl = (config.strava?.workerUrl || '').replace(/\/+$/, '');
  const canFetch = Boolean(workerUrl && SYNC_KEY);
  if (!canFetch) console.log('⚠️  Chưa có strava.workerUrl hoặc SYNC_KEY -> chỉ tính lại từ dữ liệu sẵn có.');

  const worker = async (p) => {
    const r = await fetch(workerUrl + p, { headers: { Authorization: `Bearer ${SYNC_KEY}` } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(body.error || `Worker ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return body;
  };

  // 1. Danh sách người đã kết nối Strava
  let joined = await readJSON(path.join(DATA, 'athletes.json'), []);
  if (canFetch) {
    try {
      joined = (await worker('/athletes')).map((a) => ({
        id: String(a.id),
        name: a.name,
        avatar: a.avatar || '',
        group: a.group || '',
        joinedAt: a.joinedAt || '',
        revoked: !!a.revoked,
        events: Array.isArray(a.events) ? a.events : [],
      }));
      await writeIfChanged(path.join(DATA, 'athletes.json'), joined, true);
    } catch (e) {
      console.error('❌ Không gọi được Worker /athletes:', e.message);
    }
  }
  const joinedMap = new Map(joined.map((a) => [a.id, a]));

  // 2. Thành viên
  const members = (config.members || []).map((m) => ({ ...m, id: String(m.stravaId ?? m.id ?? '') })).filter((m) => m.id);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  if (config.autoAddJoined !== false) {
    for (const j of joined) {
      if (!memberMap.has(j.id) && !j.revoked) {
        const m = { id: j.id, stravaId: j.id, name: j.name, group: j.group, auto: true };
        members.push(m);
        memberMap.set(j.id, m);
      }
    }
  }

  // 3. Giải chạy & người tham gia
  const events = (config.events || []).filter((e) => e.id && e.start && e.end);
  // Người tham gia mỗi giải:
  //   "joined" (mặc định): chỉ người tự bấm Tham gia giải đó
  //   "all": tất cả thành viên
  //   [ids]: danh sách cố định (kiểu cũ)
  // + addedParticipants (BTC thêm tay) − removedParticipants (BTC loại khỏi giải)
  const participantsOf = (e) => {
    let base;
    if (Array.isArray(e.participants)) base = e.participants.map(String);
    else if (e.participants === 'all') base = members.map((m) => m.id);
    else base = joined.filter((j) => !j.revoked && (j.events || []).includes(e.id)).map((j) => j.id);
    const removed = new Set((e.removedParticipants || []).map(String));
    return [...new Set([...base, ...(e.addedParticipants || []).map(String)])].filter((id) => !removed.has(id));
  };
  const athleteEvents = new Map();
  for (const e of events) {
    for (const id of participantsOf(e)) {
      if (!athleteEvents.has(id)) athleteEvents.set(id, []);
      athleteEvents.get(id).push(e);
    }
  }

  // 4. Fetch Strava
  const refreshDays = config.sync?.refreshDays ?? 3;
  const statePath = path.join(DATA, 'sync-state.json');
  const state = await readJSON(statePath, { lastFull: null, errors: {} });
  state.errors ||= {};
  const syncErrors = state.errors;

  // Ai cần fetch? Full: tất cả giải đang chạy. Incremental: chỉ người webhook báo có thay đổi.
  let doFull = FULL;
  const dirty = new Map();
  if (canFetch && !RECOMPUTE && !FULL) {
    const fullEveryMs = (config.sync?.fullRefreshHours ?? 3) * 3600e3;
    if (!state.lastFull || Date.now() - Date.parse(state.lastFull) >= fullEveryMs) doFull = true;
    try {
      const d = await worker('/dirty');
      if (!d.webhook) {
        doFull = true;
        console.warn('⚠️  Chưa đăng ký Strava webhook -> phải quét toàn bộ mỗi lần (dễ chạm giới hạn Strava). Xem README.');
      }
      for (const it of d.items || []) dirty.set(String(it.id), it.ts);
    } catch (e) {
      console.warn('⚠️  Không đọc được /dirty từ Worker:', e.message);
      doFull = true;
    }
  }
  console.log(`🔎 Chế độ: ${RECOMPUTE ? 'tính lại' : doFull ? 'quét toàn bộ' : `chỉ người có thay đổi (${dirty.size})`}`);

  const pending = new Set(); // dirty chưa xử lý được (lỗi / rate limit) -> giữ lại cho lần sau
  let rateLimited = false;
  let fetchedCount = 0;
  for (const [id, evs] of athleteEvents) {
    const j = joinedMap.get(id);
    if (!j || j.revoked) continue;
    const cacheFile = path.join(DATA, 'activities', `${id}.json`);
    const cache = await readJSON(cacheFile, { covered: [], activities: [] });

    const ranges = [];
    for (const e of evs) {
      if (e.start > today) continue;
      const to = minStr(e.end, today);
      const covered = cache.covered.some((r) => r[0] <= e.start && r[1] >= to);
      const active = e.end >= addDays(today, -refreshDays);
      if (!covered || (active && (doFull || dirty.has(id)))) ranges.push([e.start, to]);
    }
    if (!ranges.length || !canFetch) continue;
    if (rateLimited) { pending.add(id); continue; }
    const from = ranges.reduce((a, r) => minStr(a, r[0]), ranges[0][0]);
    const to = ranges.reduce((a, r) => maxStr(a, r[1]), ranges[0][1]);

    try {
      const { access_token } = await worker(`/token/${id}`);
      const acts = await fetchActivities(access_token, from, to);
      const keep = cache.activities.filter((a) => {
        const d = (a.start_date_local || '').slice(0, 10);
        return d < from || d > to;
      });
      cache.activities = [...keep, ...acts].sort((a, b) => (a.start_date_local < b.start_date_local ? -1 : 1));
      cache.covered = mergeRanges([...cache.covered, [from, to]]);
      delete cache.updatedAt;
      await writeIfChanged(cacheFile, cache);
      delete syncErrors[id];
      fetchedCount++;
      console.log(`✅ ${j.name} (${id}): ${acts.length} hoạt động ${from} → ${to}`);
    } catch (e) {
      pending.add(id);
      if (e instanceof RateLimited) {
        rateLimited = true;
        console.warn('⏳ Chạm giới hạn Strava, phần còn lại sẽ lấy ở lần sync sau.');
      } else {
        syncErrors[id] = e.status === 410 ? 'Đã thu hồi quyền Strava' : e.message;
        console.warn(`⚠️  ${j.name} (${id}): ${e.message}`);
      }
    }
  }

  // Báo Worker đã xử lý xong những người có thay đổi
  const done = [...dirty].filter(([id]) => !pending.has(id)).map(([id, ts]) => ({ id, ts }));
  if (done.length && canFetch) {
    try {
      await fetch(workerUrl + '/dirty/clear', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SYNC_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: done }),
      });
    } catch (e) {
      console.warn('⚠️  Không xoá được dirty:', e.message);
    }
  }
  if (doFull && !rateLimited) state.lastFull = new Date().toISOString();
  await writeIfChanged(statePath, state, true);

  // 5. Tính bảng xếp hạng
  const generatedAt = new Date().toISOString();
  const index = [];
  await fs.mkdir(path.join(DATA, 'events'), { recursive: true });

  for (const e of events) {
    const rules = { ...DEFAULT_RULES, ...(config.defaultRules || {}), ...(e.rules || {}) };
    const overrides = e.overrides || {};
    const rows = [];
    for (const id of participantsOf(e)) {
      const m = memberMap.get(id) || { id, name: joinedMap.get(id)?.name || `Strava ${id}`, group: '' };
      const j = joinedMap.get(id);
      const cache = await readJSON(path.join(DATA, 'activities', `${id}.json`), { activities: [] });

      const raw = cache.activities.filter((a) => {
        const d = (a.start_date_local || '').slice(0, 10);
        if (d < e.start || d > e.end) return false;
        if (!rules.showOtherSports && !rules.sportTypes.includes(a.sport_type)) return false;
        return true;
      });
      (e.manualActivities || []).forEach((ma, i) => {
        if (String(ma.athleteId) !== id) return;
        const secs = parseDuration(ma.movingTime);
        raw.push({
          id: `m${i}`,
          source: 'manual',
          name: ma.name || 'Bổ sung bởi BTC',
          sport_type: 'Run',
          distance: Number(ma.distanceKm || 0) * 1000,
          moving_time: secs,
          elapsed_time: secs,
          start_date_local: `${ma.date}T${ma.time || '00:00'}:00`,
        });
      });

      const activities = raw
        .map((a) => evaluate(a, rules, overrides[String(a.id)]))
        .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
      const valid = activities.filter((a) => a.valid);
      const validKm = valid.reduce((s, a) => s + a.km, 0);
      const invalidKm = activities.filter((a) => !a.valid).reduce((s, a) => s + a.km, 0);
      const validSecs = valid.reduce((s, a) => s + (rules.paceBasis === 'elapsed' ? a.elapsedTime : a.movingTime), 0);
      const target = Number(e.targetOverrides?.[id] ?? e.targets?.[m.group] ?? e.targets?.default ?? 0);

      rows.push({
        id,
        name: m.name || `Strava ${id}`,
        group: m.group || '',
        avatar: j?.avatar || '',
        connected: Boolean(j && !j.revoked),
        syncError: syncErrors[id] || (j?.revoked ? 'Đã thu hồi quyền Strava' : ''),
        target,
        validKm: round(validKm),
        invalidKm: round(invalidKm),
        percent: target > 0 ? round((validKm / target) * 100, 1) : null,
        completed: target > 0 && validKm >= target,
        validCount: valid.length,
        invalidCount: activities.length - valid.length,
        avgPace: validKm > 0 ? round(validSecs / 60 / validKm, 3) : null,
        longestKm: round(Math.max(0, ...valid.map((a) => a.km))),
        activeDays: new Set(valid.map((a) => a.date)).size,
        lastActivity: activities[0]?.date || null,
        activities,
      });
    }
    rows.sort((a, b) => b.validKm - a.validKm || a.name.localeCompare(b.name));
    rows.forEach((r, i) => (r.rank = i + 1));

    const status = eventStatus(e, today);
    const summary = {
      id: e.id,
      name: e.name,
      description: e.description || '',
      start: e.start,
      end: e.end,
      status,
      participants: rows.length,
      totalKm: round(rows.reduce((s, r) => s + r.validKm, 0), 1),
      completed: rows.filter((r) => r.completed).length,
      activities: rows.reduce((s, r) => s + r.validCount, 0),
    };
    index.push(summary);
    await writeIfChanged(path.join(DATA, 'events', `${e.id}.json`), {
      generatedAt,
      today,
      event: { ...summary, targets: e.targets || {}, rules },
      athletes: rows,
    });
  }

  // Xoá file của giải đã bị xoá khỏi config
  for (const f of await fs.readdir(path.join(DATA, 'events'))) {
    if (f.endsWith('.json') && !events.some((e) => `${e.id}.json` === f)) await fs.rm(path.join(DATA, 'events', f));
  }

  await writeIfChanged(path.join(DATA, 'index.json'), { generatedAt, today, events: index }, true);
  console.log(`🏁 Xong: ${events.length} giải, ${members.length} thành viên, fetch ${fetchedCount} người.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
