import {
  getJSON, esc, fmtPace, parsePace, store, repoInfo, ghToken, ghCheckAdmin, ghLoadConfig, ghSaveConfig, ghRunSync,
  toast, slugify, todayIn, fmtDate, icon, avatar, BASE, isLocal,
} from './common.js';

const root = document.getElementById('admin');
const SPORTS = [['Run', 'Chạy bộ'], ['TrailRun', 'Chạy trail'], ['VirtualRun', 'Máy chạy bộ'], ['Walk', 'Đi bộ'], ['Hike', 'Leo núi']];
const DEFAULT_RULES = { minPace: 4, maxPace: 18, sportTypes: ['Run', 'TrailRun', 'VirtualRun'], allowManual: false, minDistanceKm: 0, paceBasis: 'moving', showOtherSports: false };

const S = { cfg: null, sha: null, dirty: false, user: null, demo: false, athletes: [], tab: 'events', evIdx: 0, saved: new WeakSet(), manualId: new WeakSet() };

document.getElementById('logo-mark').innerHTML = icon.lock;
if (BASE) document.getElementById('viewSite').href = './?demo';

// ---------- path helpers ----------
const P = (...keys) => esc(JSON.stringify(keys));
function setPath(obj, keys, value) {
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
}
function readInput(el) {
  const t = el.dataset.type || 'text';
  if (t === 'bool') return el.checked;
  const v = el.value.trim();
  if (t === 'number') return v === '' ? undefined : Number(v.replace(',', '.'));
  if (t === 'pace') return v === '' ? undefined : parsePace(v);
  if (t === 'list') return v.split(',').map((s) => s.trim()).filter(Boolean);
  if (t === 'opt') return v === '' ? undefined : v;
  return el.value;
}

const cfg = () => S.cfg;
const members = () => (S.cfg.members ||= []);
const events = () => (S.cfg.events ||= []);
const groups = () => S.cfg.groups || [];
const tz = () => S.cfg.site?.timezone || 'Asia/Ho_Chi_Minh';
const joinedMap = () => new Map(S.athletes.map((a) => [String(a.id), a]));
const statusOf = (e) => { const t = todayIn(tz()); return t < e.start ? 'upcoming' : t > e.end ? 'finished' : 'ongoing'; };

function markDirty() {
  S.dirty = true;
  renderSavebar();
}

// ---------- Gate (khoá trang admin) ----------
function renderGate(res, repo) {
  const msg = {
    'bad-token': 'Token không hợp lệ hoặc đã hết hạn.',
    'no-permission': `Tài khoản <b>@${esc(res.user?.login || '')}</b> không có quyền ghi vào repo <b>${esc(repo.owner)}/${esc(repo.repo)}</b>. Chỉ người được thêm làm collaborator của repo mới quản trị được.`,
    'no-repo': `Không truy cập được repo <b>${esc(repo.owner)}/${esc(repo.repo)}</b>. Kiểm tra lại tên repo hoặc token chưa được cấp quyền cho repo này.`,
    error: `Không kết nối được GitHub: ${esc(res.error || '')}`,
  }[res.reason];
  const needRepo = !repo.owner || !repo.repo || res.reason === 'no-repo';

  root.innerHTML = `<div class="gate fade-in">
    <section class="hero">
      <div class="lock">${icon.lock}</div>
      <h1 style="font-size:26px">Khu vực Ban tổ chức</h1>
      <p class="lead" style="margin:0 auto">Chỉ những người có <b>quyền ghi vào repo GitHub</b> của giải mới đăng nhập được. Người khác mở trang này cũng không thay đổi được gì.</p>
    </section>
    <div class="card mt">
      ${msg ? `<div class="notice bad mb">${icon.alert}<span>${msg}</span></div>` : ''}
      ${needRepo ? `<div class="grid g2 mb">
        <label class="field"><span>GitHub owner</span><input id="gOwner" value="${esc(repo.owner || '')}" placeholder="ten-cong-ty"></label>
        <label class="field"><span>Repo</span><input id="gRepo" value="${esc(repo.repo || '')}" placeholder="running-tracker"></label>
      </div>` : ''}
      <label class="field"><span>GitHub token</span><input id="tok" type="password" placeholder="github_pat_…" autocomplete="off"></label>
      <button class="btn btn-primary btn-lg btn-block mt" id="tokSave">Đăng nhập</button>
      <details class="how">
        <summary>Cách lấy token (1 phút)</summary>
        <ol>
          <li>Mở <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>
          <li><b>Repository access</b> → Only select repositories → chọn repo của giải</li>
          <li><b>Permissions</b> → bấm <b>Add permissions</b>, chọn <b>Contents</b> và <b>Actions</b>, đổi cả hai thành <b>Read and write</b> (mặc định là Read-only, lưu sẽ bị lỗi 403)</li>
          <li>Bấm <b>Generate token</b>, copy và dán vào ô trên</li>
        </ol>
        <p class="hint" style="margin:0 0 14px">Muốn thêm người vào BTC: repo → Settings → Collaborators → Add people. Token chỉ lưu trong trình duyệt này.</p>
      </details>
    </div>
  </div>`;
  const submit = () => {
    const t = document.getElementById('tok').value.trim();
    if (!t) return toast('Dán token vào trước đã', 'err');
    store('gh_token', t);
    const o = document.getElementById('gOwner')?.value.trim();
    const r = document.getElementById('gRepo')?.value.trim();
    if (o && r) store('gh_repo', `${o}/${r}`);
    try { sessionStorage.clear(); } catch {}
    location.reload();
  };
  document.getElementById('tokSave').onclick = submit;
  document.getElementById('tok').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
}

function logout() {
  store('gh_token', null);
  try { sessionStorage.clear(); } catch {}
  location.reload();
}

// ---------- Save / sync ----------
function validate() {
  const errs = [];
  const ids = new Set();
  events().forEach((e, i) => {
    const label = e.name || `Giải #${i + 1}`;
    if (!e.name) errs.push(`${label}: thiếu tên`);
    if (!e.id) errs.push(`${label}: thiếu mã`);
    else if (ids.has(e.id)) errs.push(`${label}: mã "${e.id}" bị trùng`);
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) errs.push(`${label}: mã giải chỉ được có chữ thường, số và dấu gạch ngang`);
    ids.add(e.id);
    if (!e.start || !e.end) errs.push(`${label}: thiếu ngày`);
    else if (e.start > e.end) errs.push(`${label}: ngày bắt đầu sau ngày kết thúc`);
    const r = { ...DEFAULT_RULES, ...(cfg().defaultRules || {}), ...(e.rules || {}) };
    if (!(r.minPace < r.maxPace)) errs.push(`${label}: pace nhanh nhất phải nhỏ hơn pace chậm nhất`);
  });
  const sids = new Set();
  members().forEach((m) => {
    if (!/^\d+$/.test(String(m.stravaId || ''))) errs.push(`"${m.name || 'Thành viên chưa có tên'}": Strava ID phải là số`);
    else if (sids.has(String(m.stravaId))) errs.push(`Strava ID ${m.stravaId} bị trùng`);
    sids.add(String(m.stravaId));
  });
  return errs;
}

async function save() {
  const errs = validate();
  if (errs.length) return toast('Chưa lưu được:\n' + errs.slice(0, 4).join('\n'), 'err');
  if (S.demo) return toast('Đây là chế độ demo, không lưu được.', 'err');
  const btn = document.getElementById('save');
  btn.disabled = true;
  btn.textContent = 'Đang lưu…';
  try {
    S.sha = await ghSaveConfig(repoInfo(cfg()), cfg(), S.sha, 'BTC cập nhật cấu hình');
    S.dirty = false;
    events().forEach((e) => S.saved.add(e));
    toast('Đã lưu! Trang web sẽ cập nhật sau ~1–2 phút.');
    renderPanel();
  } catch (e) {
    toast(e.message.includes('409') ? 'Cấu hình vừa bị người khác sửa. Tải lại trang rồi làm lại nhé.' : e.message, 'err');
  }
  renderSavebar();
}

async function runSync(btn) {
  if (S.demo) return toast('Đây là chế độ demo.', 'err');
  btn.disabled = true;
  try {
    await ghRunSync(repoInfo(cfg()));
    toast('Đang đồng bộ Strava, mất khoảng 1–3 phút.');
  } catch (e) {
    toast(e.message, 'err');
  }
  setTimeout(() => (btn.disabled = false), 5000);
}

function renderSavebar() {
  const el = document.getElementById('savebar');
  el.classList.toggle('show', S.dirty);
  el.innerHTML = `<span class="msg"><span class="dot"></span>Có thay đổi chưa lưu</span>
    <button class="btn btn-ghost btn-sm" id="discard">Huỷ</button>
    <button class="btn btn-primary" id="save">Lưu & xuất bản</button>`;
  document.getElementById('save').onclick = save;
  document.getElementById('discard').onclick = () => { if (confirm('Bỏ hết thay đổi chưa lưu?')) { S.dirty = false; location.reload(); } };
}

// ---------- Shell ----------
function renderShell() {
  const u = S.user;
  root.innerHTML = `
    <div class="admin-head">
      <h1 class="grow">Quản trị giải chạy</h1>
      <button class="btn" id="syncBtn">${icon.refresh} Đồng bộ Strava</button>
      ${u ? `<span class="user-chip"><img src="${esc(u.avatar_url)}" alt="">${esc(u.login)}<button class="btn btn-ghost" id="logout" title="Đăng xuất">${icon.logout}</button></span>` : '<span class="chip chip-warn">Demo</span>'}
    </div>
    <div class="tabs"><div class="seg" role="tablist">
      <button data-tab="events">${icon.flag} Giải chạy</button>
      <button data-tab="members">${icon.users} Thành viên</button>
      <button data-tab="settings">${icon.settings} Cài đặt</button>
    </div></div>
    <div id="panel"></div>`;
  document.getElementById('syncBtn').onclick = (e) => runSync(e.currentTarget);
  document.getElementById('logout')?.addEventListener('click', logout);
  root.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) location.hash = b.dataset.tab;
  });
}

function renderPanel() {
  root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  const panel = document.getElementById('panel');
  panel.innerHTML = S.tab === 'members' ? membersView() : S.tab === 'settings' ? settingsView() : eventsView();
}

const sec = (ic, title, desc, body) => `<section class="card sec">
  <div class="sec-head"><div class="ic">${ic}</div><div><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ''}</div></div>
  <div class="sec-body">${body}</div></section>`;

// ---------- Events ----------
// Giống scripts/sync.mjs: người tham gia gốc trước khi BTC thêm/bớt
function baseParticipants(e) {
  if (Array.isArray(e.participants)) return e.participants.map(String);
  if (e.participants === 'all') {
    const ids = members().map((m) => String(m.stravaId));
    if (cfg().autoAddJoined !== false) S.athletes.filter((a) => !a.revoked).forEach((a) => ids.push(String(a.id)));
    return [...new Set(ids)];
  }
  return S.athletes.filter((a) => !a.revoked && (a.events || []).includes(e.id)).map((a) => String(a.id));
}
function newEvent() {
  const today = todayIn(tz());
  const end = new Date(Date.parse(today) + 29 * 86400e3).toISOString().slice(0, 10);
  const targets = Object.fromEntries(groups().map((g) => [g, 50]));
  if (!groups().length) targets.default = 50;
  return { id: '', name: '', description: '', start: today, end, targets, rules: {}, participants: 'joined', addedParticipants: [], removedParticipants: [], targetOverrides: {}, overrides: {}, manualActivities: [] };
}

function eventsView() {
  const evs = events();
  if (S.evIdx >= evs.length) S.evIdx = Math.max(0, evs.length - 1);
  const e = evs[S.evIdx];
  const st = { ongoing: '<span class="chip chip-ok" style="padding:1px 8px">Đang diễn ra</span>', upcoming: '<span class="chip chip-brand" style="padding:1px 8px">Sắp tới</span>', finished: '<span class="chip" style="padding:1px 8px">Đã xong</span>' };
  return `<div class="layout fade-in">
    <div class="ev-list">
      <button class="btn btn-primary" data-action="ev-new">${icon.plus} Tạo giải mới</button>
      ${evs.map((x, i) => `<button class="ev-item ${i === S.evIdx ? 'on' : ''}" data-action="ev-pick" data-i="${i}">
        <b>${esc(x.name || '(chưa đặt tên)')}</b>
        <div class="small muted">${x.start && x.end ? st[statusOf(x)] : ''} ${fmtDate(x.start)} – ${fmtDate(x.end)}</div></button>`).join('')}
    </div>
    <div>${e ? eventEditor(e, S.evIdx) : `<div class="card empty"><div class="icon">${icon.flag}</div><h2>Chưa có giải nào</h2><p>Bấm "Tạo giải mới" để bắt đầu.</p></div>`}</div>
  </div>`;
}

function eventEditor(e, i) {
  const defaults = { ...DEFAULT_RULES, ...(cfg().defaultRules || {}) };
  const r = e.rules || {};
  const eff = { ...defaults, ...r };
  const locked = S.saved.has(e);
  const mode = e.participants === 'all' ? 'all' : 'joined';
  const base = new Set(baseParticipants(e));
  const added = new Set((e.addedParticipants || []).map(String));
  const removed = new Set((e.removedParticipants || []).map(String));
  const isIn = (id) => (base.has(id) || added.has(id)) && !removed.has(id);
  const jm = joinedMap();
  const pool = [...members()];
  if (cfg().autoAddJoined !== false) {
    for (const a of S.athletes) if (!a.revoked && !pool.some((m) => String(m.stravaId) === String(a.id))) pool.push({ stravaId: a.id, name: a.name, group: a.group, auto: true });
  }
  const tgKeys = groups().length ? groups() : ['default'];
  const overrides = Object.entries(e.overrides || {});
  const mas = e.manualActivities || [];

  return `<div class="fade-in">
    <div class="ed-head">
      <h2>${esc(e.name || 'Giải mới')}</h2>
      ${locked ? `<a class="btn btn-sm" href="./${BASE ? '?demo' : ''}#/e/${encodeURIComponent(e.id)}" target="_blank">Xem ↗</a>` : ''}
      <button class="btn btn-sm" data-action="ev-dup">${icon.copy} Nhân bản</button>
      <button class="btn btn-sm btn-danger" data-action="ev-del">${icon.trash} Xoá</button>
    </div>

    ${sec(icon.calendar, 'Thông tin giải', '', `
      <div class="grid g2">
        <label class="field"><span>Tên giải *</span><input data-path='${P('events', i, 'name')}' data-autoid="1" value="${esc(e.name)}" placeholder="VD: Chạy vì sức khoẻ tháng 12"></label>
        <label class="field"><span>Mã giải (dùng trong link)</span><input data-path='${P('events', i, 'id')}' data-eventid="1" value="${esc(e.id)}" placeholder="vd: giai-chay-thang-12" autocapitalize="off" spellcheck="false">
          <div class="hint">${locked ? '⚠️ Đổi mã sẽ đổi link của giải, link cũ đã gửi đi sẽ không mở được nữa.' : 'Tự tạo từ tên giải, có thể sửa. Chỉ dùng chữ thường, số và dấu gạch ngang.'}</div></label>
        <label class="field"><span>Ngày bắt đầu *</span><input type="date" data-path='${P('events', i, 'start')}' value="${esc(e.start)}"></label>
        <label class="field"><span>Ngày kết thúc *</span><input type="date" data-path='${P('events', i, 'end')}' value="${esc(e.end)}"></label>
      </div>
      <label class="field mt"><span>Mô tả</span><input data-path='${P('events', i, 'description')}' value="${esc(e.description || '')}" placeholder="Không bắt buộc"></label>`)}

    ${sec(icon.target, 'Mục tiêu km', 'Mỗi nhóm một mức. Thêm nhóm khác (U40, 40+…) ở tab Cài đặt.', `
      <div class="grid g4">
        ${tgKeys.map((g) => `<label class="field"><span>${g === 'default' ? 'Mục tiêu' : esc(g)}</span>
          <input type="number" inputmode="decimal" min="0" step="0.1" data-type="number" data-path='${P('events', i, 'targets', g)}' value="${e.targets?.[g] ?? ''}" placeholder="km"></label>`).join('')}
      </div>`)}

    ${sec(icon.timer, 'Quy tắc hợp lệ', 'Hoạt động vi phạm sẽ bị tô đỏ và ghi rõ lý do. Để trống thì dùng giá trị mặc định.', `
      <div class="grid g3">
        <label class="field"><span>Pace nhanh nhất</span><input inputmode="decimal" data-type="pace" data-path='${P('events', i, 'rules', 'minPace')}' value="${r.minPace != null ? fmtPace(r.minPace) : ''}" placeholder="${fmtPace(defaults.minPace)} /km"></label>
        <label class="field"><span>Pace chậm nhất</span><input inputmode="decimal" data-type="pace" data-path='${P('events', i, 'rules', 'maxPace')}' value="${r.maxPace != null ? fmtPace(r.maxPace) : ''}" placeholder="${fmtPace(defaults.maxPace)} /km"></label>
        <label class="field"><span>Tối thiểu mỗi lần</span><input type="number" inputmode="decimal" min="0" step="0.1" data-type="number" data-path='${P('events', i, 'rules', 'minDistanceKm')}' value="${r.minDistanceKm ?? ''}" placeholder="${defaults.minDistanceKm || 0} km"></label>
      </div>
      <div class="field mt"><span class="small" style="font-weight:600;color:var(--ink-2);display:block;margin-bottom:8px">Môn được tính</span>
        <div class="checks">${SPORTS.map(([s, l]) => `<label><input type="checkbox" data-sports='${P('events', i, 'rules', 'sportTypes')}' value="${s}" ${eff.sportTypes.includes(s) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <label class="opt mt"><input type="checkbox" data-type="bool" data-path='${P('events', i, 'rules', 'allowManual')}' ${eff.allowManual ? 'checked' : ''}>
        <div><b>Chấp nhận hoạt động nhập tay trên Strava</b><span>Không có GPS nên dễ gian lận. Mặc định: không chấp nhận.</span></div></label>`)}

    ${(() => {
      const rows = [...pool].sort((a, b) => isIn(String(b.stravaId)) - isIn(String(a.stravaId)) || String(a.name).localeCompare(String(b.name), 'vi'));
      const count = pool.filter((m) => isIn(String(m.stravaId))).length;
      const joinLink = new URL(`./${BASE ? '?demo' : ''}#/join/${encodeURIComponent(e.id)}`, location.href).href;
      return sec(icon.users, `Người tham gia (${count})`, 'Tick để thêm người vào giải này, bỏ tick để loại khỏi giải.', `
      <label class="opt"><input type="radio" name="pmode" data-action="pmode" value="joined" ${mode === 'joined' ? 'checked' : ''}>
        <div><b>Chỉ người bấm tham gia giải này</b><span>Khuyên dùng. Gửi link mời bên dưới, ai bấm tham gia thì được tính.</span></div></label>
      <label class="opt"><input type="radio" name="pmode" data-action="pmode" value="all" ${mode === 'all' ? 'checked' : ''}>
        <div><b>Tất cả thành viên</b><span>Mọi người đã kết nối Strava đều được tính, không cần bấm tham gia.</span></div></label>
      ${locked && mode === 'joined' ? `<div class="row mt"><input readonly value="${esc(joinLink)}" id="evJoin${i}" style="flex:1;min-width:200px">
        <button class="btn" data-action="copy-evjoin" data-target="evJoin${i}">${icon.copy} Copy link mời</button></div>` : ''}
      ${!locked && mode === 'joined' ? '<p class="hint">Lưu giải xong sẽ có link mời riêng cho giải này.</p>' : ''}
      ${pool.length ? `<div class="rt-wrap scroll-y mt"><table class="rt">
        <thead><tr><th>Tham gia</th><th>Tên</th><th>Nhóm</th><th>Nguồn</th><th>Strava</th><th>Mục tiêu riêng</th></tr></thead>
        <tbody>${rows.map((m) => {
          const id = String(m.stravaId);
          const on = isIn(id);
          const def = e.targets?.[m.group] ?? e.targets?.default ?? '';
          const src = removed.has(id) ? '<span class="chip chip-bad">BTC loại</span>'
            : added.has(id) && !base.has(id) ? '<span class="chip chip-brand">BTC thêm</span>'
            : base.has(id) ? (mode === 'all' ? '<span class="chip">Tất cả</span>' : '<span class="chip chip-ok">Tự tham gia</span>') : '<span class="muted">–</span>';
          return `<tr style="${on ? '' : 'opacity:.6'}">
            <td data-label="Tham gia"><input type="checkbox" data-pick="${esc(id)}" ${on ? 'checked' : ''} style="flex:none"></td>
            <td data-label="Tên"><b>${esc(m.name)}</b></td>
            <td data-label="Nhóm">${esc(m.group || '–')}</td>
            <td data-label="Nguồn">${src}</td>
            <td data-label="Strava">${jm.has(id) && !jm.get(id).revoked ? '<span class="chip chip-ok">Đã kết nối</span>' : '<span class="chip chip-warn">Chưa kết nối</span>'}</td>
            <td data-label="Mục tiêu riêng" style="width:150px"><input type="number" inputmode="decimal" min="0" step="0.1" data-type="number" data-path='${P('events', i, 'targetOverrides', id)}' value="${e.targetOverrides?.[id] ?? ''}" placeholder="${def} km"></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted small mt">Chưa có ai kết nối Strava.</p>'}`);
    })()}

    ${sec(icon.plus, 'Km bổ sung thủ công', 'Cho người quên bật Strava, chạy giải offline… Vẫn áp dụng quy tắc pace.', `
      ${mas.length ? `<div class="rt-wrap"><table class="rt">
        <thead><tr><th>Người</th><th>Ngày</th><th>Km</th><th>Thời gian</th><th>Ghi chú</th><th></th></tr></thead>
        <tbody>${mas.map((ma, k) => `<tr>
          <td data-label="Người"><select data-path='${P('events', i, 'manualActivities', k, 'athleteId')}'>
            <option value="">Chọn người…</option>${pool.map((m) => `<option value="${esc(m.stravaId)}" ${String(ma.athleteId) === String(m.stravaId) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></td>
          <td data-label="Ngày"><input type="date" data-path='${P('events', i, 'manualActivities', k, 'date')}' value="${esc(ma.date || '')}"></td>
          <td data-label="Km" style="width:100px"><input type="number" inputmode="decimal" step="0.01" min="0" data-type="number" data-path='${P('events', i, 'manualActivities', k, 'distanceKm')}' value="${ma.distanceKm ?? ''}"></td>
          <td data-label="Thời gian" style="width:120px"><input data-path='${P('events', i, 'manualActivities', k, 'movingTime')}' value="${esc(ma.movingTime || '')}" placeholder="0:45:00"></td>
          <td data-label="Ghi chú"><input data-path='${P('events', i, 'manualActivities', k, 'name')}' value="${esc(ma.name || '')}" placeholder="VD: HCMC Marathon"></td>
          <td class="actions"><button class="btn btn-sm btn-danger" data-action="ma-del" data-k="${k}" aria-label="Xoá">${icon.trash}</button></td>
        </tr>`).join('')}</tbody></table></div>` : ''}
      <button class="btn btn-sm ${mas.length ? 'mt' : ''}" data-action="ma-add">${icon.plus} Thêm hoạt động</button>`)}

    ${sec(icon.check, `Duyệt / loại thủ công (${overrides.length})`, 'Mẹo: mở trang chi tiết của từng người trên web, mỗi hoạt động có sẵn nút Duyệt / Loại.', overrides.length ? `
      <div class="rt-wrap"><table class="rt"><thead><tr><th>Hoạt động</th><th>Quyết định</th><th>Lý do</th><th></th></tr></thead><tbody>
        ${overrides.map(([aid, o]) => `<tr><td data-label="Hoạt động"><a href="https://www.strava.com/activities/${esc(aid)}" target="_blank" rel="noopener">#${esc(aid)}</a></td>
          <td data-label="Quyết định">${o.status === 'valid' ? '<span class="chip chip-ok">Duyệt hợp lệ</span>' : '<span class="chip chip-bad">Loại</span>'}</td>
          <td data-label="Lý do">${esc(o.reason || '–')}</td><td class="actions"><button class="btn btn-sm" data-action="ov-del" data-aid="${esc(aid)}">Bỏ</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small" style="margin:0">Chưa có.</p>')}
  </div>`;
}

// ---------- Members ----------
function membersView() {
  const jm = joinedMap();
  const ms = members();
  const inList = new Set(ms.map((m) => String(m.stravaId)));
  const notIn = S.athletes.filter((a) => !inList.has(String(a.id)));
  const joinUrl = new URL(`./${BASE ? '?demo' : ''}#/join`, location.href).href;
  const auto = cfg().autoAddJoined !== false;
  return `<div class="fade-in">
    ${sec(icon.strava, 'Mời mọi người tham gia', 'Gửi link vào group chat công ty. Mỗi người chọn giải muốn tham gia, chọn nhóm rồi kết nối Strava. Mỗi giải cũng có link mời riêng trong tab Giải chạy.', `
      <div class="row"><input readonly value="${esc(joinUrl)}" id="joinUrl" style="flex:1;min-width:200px"><button class="btn btn-primary" data-action="copy-join">${icon.copy} Copy link</button></div>`)}

    ${notIn.length ? sec(icon.check, `Đã kết nối Strava (${notIn.length})`, auto ? 'Những người này đã được tính điểm. Bấm "Thêm" nếu muốn sửa tên hoặc nhóm của họ.' : 'Bấm "Thêm" để đưa họ vào giải.', `
      <div class="rt-wrap"><table class="rt"><thead><tr><th>Tên Strava</th><th>Strava ID</th><th>Nhóm</th><th>Kết nối lúc</th><th></th></tr></thead><tbody>
      ${notIn.map((a) => `<tr><td data-label="Tên"><b>${esc(a.name)}</b> ${a.revoked ? '<span class="chip chip-bad">Đã thu hồi</span>' : ''}</td><td data-label="Strava ID">${esc(a.id)}</td><td data-label="Nhóm">${esc(a.group || '–')}</td>
        <td data-label="Kết nối" class="small muted">${a.joinedAt ? new Date(a.joinedAt).toLocaleDateString('vi-VN') : ''}</td>
        <td class="actions"><button class="btn btn-sm" data-action="m-addjoined" data-id="${esc(a.id)}">${icon.plus} Thêm</button></td></tr>`).join('')}
      </tbody></table></div>
      <button class="btn btn-sm mt" data-action="m-addalljoined">Thêm tất cả</button>`) : ''}

    ${sec(icon.users, `Danh sách thành viên (${ms.length})`, 'Strava ID là dãy số trong link hồ sơ: strava.com/athletes/<b>12345678</b>. Người “Chưa kết nối” vẫn phải tự bấm link Tham gia một lần (Strava bắt buộc).', `
      <div class="row mb"><button class="btn btn-sm" data-action="m-add">${icon.plus} Thêm 1 người</button>
        <button class="btn btn-sm" data-action="m-bulk">Dán danh sách từ Excel</button></div>
      <div id="bulk"></div>
      ${ms.length ? `<div class="rt-wrap"><table class="rt">
        <thead><tr><th>Họ tên</th><th>Strava ID</th><th>Nhóm</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${ms.map((m, k) => {
          const j = jm.get(String(m.stravaId));
          return `<tr>
            <td data-label="Họ tên"><input data-path='${P('members', k, 'name')}' value="${esc(m.name || '')}" placeholder="Họ tên"></td>
            <td data-label="Strava ID" style="width:150px"><input data-path='${P('members', k, 'stravaId')}' value="${esc(m.stravaId || '')}" placeholder="12345678" inputmode="numeric"></td>
            <td data-label="Nhóm" style="width:140px"><select data-path='${P('members', k, 'group')}'><option value="">–</option>${groups().map((g) => `<option ${m.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></td>
            <td data-label="Strava">${j ? (j.revoked ? '<span class="chip chip-bad">Đã thu hồi</span>' : '<span class="chip chip-ok">Đã kết nối</span>') : '<span class="chip chip-warn">Chưa kết nối</span>'}</td>
            <td class="actions"><button class="btn btn-sm btn-danger" data-action="m-del" data-k="${k}" aria-label="Xoá">${icon.trash}</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted small" style="margin:0">Chưa có ai.</p>'}`)}
  </div>`;
}

// ---------- Settings ----------
function settingsView() {
  const c = cfg();
  const d = { ...DEFAULT_RULES, ...(c.defaultRules || {}) };
  const repo = repoInfo(c);
  return `<div class="fade-in">
    ${sec(icon.flag, 'Trang web', '', `
      <div class="grid g2">
        <label class="field"><span>Tiêu đề</span><input data-path='${P('site', 'title')}' value="${esc(c.site?.title || '')}"></label>
        <label class="field"><span>Khẩu hiệu</span><input data-path='${P('site', 'subtitle')}' value="${esc(c.site?.subtitle || '')}"></label>
        <label class="field"><span>Nhóm (phân cách bằng dấu phẩy)</span><input data-type="list" data-path='${P('groups')}' data-rerender="1" value="${esc(groups().join(', '))}">
          <div class="hint">VD: Nam, Nữ hoặc Nam U40, Nam 40+, Nữ. Mỗi nhóm có mục tiêu km riêng.</div></label>
        <label class="field"><span>Múi giờ</span><input data-path='${P('site', 'timezone')}' value="${esc(c.site?.timezone || 'Asia/Ho_Chi_Minh')}"></label>
      </div>`)}
    ${sec(icon.timer, 'Quy tắc mặc định', 'Áp dụng cho mọi giải, trừ khi giải đó đặt riêng.', `
      <div class="grid g3">
        <label class="field"><span>Pace nhanh nhất</span><input inputmode="decimal" data-type="pace" data-path='${P('defaultRules', 'minPace')}' value="${fmtPace(d.minPace)}"></label>
        <label class="field"><span>Pace chậm nhất</span><input inputmode="decimal" data-type="pace" data-path='${P('defaultRules', 'maxPace')}' value="${fmtPace(d.maxPace)}"></label>
        <label class="field"><span>Tối thiểu mỗi lần (km)</span><input type="number" inputmode="decimal" step="0.1" min="0" data-type="number" data-path='${P('defaultRules', 'minDistanceKm')}' value="${d.minDistanceKm}"></label>
      </div>
      <label class="field mt"><span>Tính pace theo</span><select data-path='${P('defaultRules', 'paceBasis')}'>
        <option value="moving" ${d.paceBasis === 'moving' ? 'selected' : ''}>Thời gian di chuyển (khuyên dùng)</option>
        <option value="elapsed" ${d.paceBasis === 'elapsed' ? 'selected' : ''}>Tổng thời gian kể cả lúc dừng</option></select></label>
      <div class="field mt"><span class="small" style="font-weight:600;color:var(--ink-2);display:block;margin-bottom:8px">Môn được tính</span>
        <div class="checks">${SPORTS.map(([s, l]) => `<label><input type="checkbox" data-sports='${P('defaultRules', 'sportTypes')}' value="${s}" ${d.sportTypes.includes(s) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <label class="opt mt"><input type="checkbox" data-type="bool" data-path='${P('defaultRules', 'allowManual')}' ${d.allowManual ? 'checked' : ''}>
        <div><b>Chấp nhận hoạt động nhập tay trên Strava</b><span>Không có GPS.</span></div></label>
      <label class="opt"><input type="checkbox" data-type="bool" data-path='${P('defaultRules', 'showOtherSports')}' ${d.showOtherSports ? 'checked' : ''}>
        <div><b>Hiện cả môn khác (đạp xe, bơi…)</b><span>Hiển thị dưới dạng không hợp lệ. Mặc định ẩn cho gọn.</span></div></label>`)}
    ${sec(icon.strava, 'Kết nối Strava', '', `
      <label class="field"><span>Cloudflare Worker URL</span><input data-path='${P('strava', 'workerUrl')}' value="${esc(c.strava?.workerUrl || '')}" placeholder="https://running-tracker-strava.xxx.workers.dev"></label>
      <label class="opt mt"><input type="checkbox" data-type="bool" data-path='${P('autoAddJoined')}' ${c.autoAddJoined !== false ? 'checked' : ''}>
        <div><b>Tự động thêm người vừa kết nối Strava</b><span>Tắt nếu bạn muốn tự duyệt từng người.</span></div></label>`)}
    ${sec(icon.lock, 'Repo GitHub', 'Ai có quyền ghi vào repo này thì là Ban tổ chức. Thêm/bớt người ở repo → Settings → Collaborators.', `
      <div class="grid g3">
        <label class="field"><span>Owner</span><input data-type="opt" data-path='${P('github', 'owner')}' value="${esc(c.github?.owner || '')}" placeholder="${esc(repo.owner || '')}"></label>
        <label class="field"><span>Repo</span><input data-type="opt" data-path='${P('github', 'repo')}' value="${esc(c.github?.repo || '')}" placeholder="${esc(repo.repo || '')}"></label>
        <label class="field"><span>Branch</span><input data-path='${P('github', 'branch')}' value="${esc(c.github?.branch || 'main')}"></label>
      </div>`)}
  </div>`;
}

// ---------- Event delegation ----------
function applyInput(el) {
  setPath(cfg(), JSON.parse(el.dataset.path), readInput(el));
  if (el.dataset.autoid) {
    const e = events()[S.evIdx];
    if (!S.saved.has(e) && !S.manualId.has(e)) {
      e.id = slugify(e.name);
      const idInput = root.querySelector(`[data-path='${JSON.stringify(['events', S.evIdx, 'id'])}']`);
      if (idInput) idInput.value = e.id;
    }
    const item = root.querySelector(`.ev-item[data-i="${S.evIdx}"] b`);
    if (item) item.textContent = e.name || '(chưa đặt tên)';
  }
  markDirty();
}

function onInput(ev) {
  const el = ev.target;
  if (el.dataset.eventid) S.manualId.add(events()[S.evIdx]);
  if (el.dataset.path && el.tagName !== 'SELECT' && el.type !== 'checkbox' && !el.dataset.rerender) applyInput(el);
}

function onChange(ev) {
  const el = ev.target;
  if (el.dataset.eventid) {
    const e = events()[S.evIdx];
    const v = slugify(el.value);
    el.value = v;
    e.id = v;
    S.manualId.add(e);
    markDirty();
    return;
  }
  if (el.dataset.sports) {
    const all = [...root.querySelectorAll(`[data-sports='${el.dataset.sports}']`)].filter((x) => x.checked).map((x) => x.value);
    setPath(cfg(), JSON.parse(el.dataset.sports), all);
    markDirty();
  } else if (el.dataset.pick) {
    const e = events()[S.evIdx];
    const id = el.dataset.pick;
    const base = new Set(baseParticipants(e));
    const added = new Set((e.addedParticipants || []).map(String));
    const removed = new Set((e.removedParticipants || []).map(String));
    if (el.checked) { removed.delete(id); if (!base.has(id)) added.add(id); }
    else { added.delete(id); if (base.has(id)) removed.add(id); }
    e.addedParticipants = [...added];
    e.removedParticipants = [...removed];
    markDirty();
    renderPanel();
  } else if (el.dataset.action === 'pmode') {
    const e = events()[S.evIdx];
    e.participants = el.value === 'all' ? 'all' : 'joined';
    markDirty();
    renderPanel();
  } else if (el.dataset.path && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.dataset.rerender)) {
    applyInput(el);
    if (el.dataset.rerender) renderPanel();
  }
}

function onClick(ev) {
  const b = ev.target.closest('[data-action]');
  if (!b || b.type === 'radio') return;
  const a = b.dataset.action;
  const e = events()[S.evIdx];
  const jm = joinedMap();
  const addMember = (id) => {
    const j = jm.get(String(id));
    if (!members().some((m) => String(m.stravaId) === String(id))) members().push({ name: j?.name || '', stravaId: String(id), group: j?.group || groups()[0] || '' });
  };
  switch (a) {
    case 'ev-new': events().push(newEvent()); S.evIdx = events().length - 1; break;
    case 'ev-pick': S.evIdx = Number(b.dataset.i); renderPanel(); return;
    case 'ev-dup': {
      const copy = JSON.parse(JSON.stringify(e));
      copy.name = e.name + ' (bản sao)';
      copy.id = slugify(copy.name);
      copy.overrides = {};
      copy.manualActivities = [];
      copy.addedParticipants = [];
      copy.removedParticipants = [];
      events().push(copy);
      S.evIdx = events().length - 1;
      break;
    }
    case 'ev-del':
      if (!confirm(`Xoá giải "${e.name}"? Bảng xếp hạng của giải này cũng sẽ bị gỡ khỏi web.`)) return;
      events().splice(S.evIdx, 1);
      S.evIdx = 0;
      break;
    case 'ma-add': (e.manualActivities ||= []).push({ athleteId: '', date: todayIn(tz()), distanceKm: '', movingTime: '', name: '' }); break;
    case 'ma-del': e.manualActivities.splice(Number(b.dataset.k), 1); break;
    case 'ov-del': delete e.overrides[b.dataset.aid]; break;
    case 'm-add': members().push({ name: '', stravaId: '', group: groups()[0] || '' }); break;
    case 'm-del': members().splice(Number(b.dataset.k), 1); break;
    case 'm-addjoined': addMember(b.dataset.id); break;
    case 'm-addalljoined': S.athletes.filter((x) => !x.revoked).forEach((x) => addMember(x.id)); break;
    case 'copy-join': navigator.clipboard?.writeText(document.getElementById('joinUrl').value); toast('Đã copy link'); return;
    case 'copy-evjoin': navigator.clipboard?.writeText(document.getElementById(b.dataset.target).value); toast('Đã copy link mời'); return;
    case 'm-bulk':
      document.getElementById('bulk').innerHTML = `<div class="mb">
        <label class="field"><span>Mỗi dòng một người: Họ tên, Strava ID, Nhóm</span>
        <textarea id="bulkText" rows="6" placeholder="Nguyễn Văn A, 12345678, Nam&#10;Trần Thị B, 87654321, Nữ"></textarea></label>
        <button class="btn btn-primary btn-sm mt" data-action="m-bulk-apply">Thêm vào danh sách</button></div>`;
      return;
    case 'm-bulk-apply': {
      const lines = document.getElementById('bulkText').value.split('\n').map((l) => l.split(/\t|,|;/).map((s) => s.trim())).filter((p) => p[0]);
      let n = 0;
      for (const [name, id, group] of lines) {
        const sid = (id || '').replace(/\D/g, '');
        if (!sid) continue;
        const ex = members().find((m) => String(m.stravaId) === sid);
        const g = groups().find((x) => x.toLowerCase() === (group || '').toLowerCase()) || group || '';
        if (ex) Object.assign(ex, { name, group: g || ex.group });
        else members().push({ name, stravaId: sid, group: g });
        n++;
      }
      toast(`Đã thêm/cập nhật ${n} người`);
      break;
    }
    default: return;
  }
  markDirty();
  renderPanel();
}

// ---------- Boot ----------
async function boot() {
  const local = await getJSON('config.json', {});
  S.demo = Boolean(BASE) && isLocal();
  if (S.demo) {
    S.cfg = local;
  } else {
    const repo = repoInfo(local);
    const res = await ghCheckAdmin(repo);
    if (!res.ok) return renderGate(res, repo);
    S.user = res.user;
    try {
      const r = await ghLoadConfig(repo);
      S.cfg = r.config;
      S.sha = r.sha;
    } catch (e) {
      root.innerHTML = `<div class="card empty mt"><h2>Không đọc được cấu hình</h2><p>${esc(e.message)}</p></div>`;
      return;
    }
  }
  S.athletes = await getJSON('data/athletes.json', []);
  events().forEach((e) => S.saved.add(e));

  renderShell();
  renderSavebar();
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  const setTab = () => {
    const t = location.hash.replace('#', '');
    S.tab = ['events', 'members', 'settings'].includes(t) ? t : 'events';
    renderPanel();
  };
  window.addEventListener('hashchange', setTab);
  window.addEventListener('beforeunload', (ev) => { if (S.dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  setTab();
}
boot();
