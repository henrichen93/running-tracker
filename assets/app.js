import {
  getJSON, esc, fmtPace, fmtKm, fmtDuration, fmtDate, fmtDateShort, daysBetween, STATUS_LABEL,
  avatar, ring, icon, ghToken, repoInfo, ghCheckAdmin, ghLoadConfig, ghSaveConfig, toast, BASE,
} from './common.js';

const app = document.getElementById('app');
let config = null;
const eventCache = new Map();
const ui = { group: 'all', q: '', sort: 'validKm', showInvalid: true };

async function loadEvent(id) {
  if (!eventCache.has(id)) eventCache.set(id, getJSON(`data/events/${id}.json`, null));
  return eventCache.get(id);
}

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

const bar = (pct, cls = '') =>
  `<div class="bar ${cls} ${pct >= 100 ? 'done' : ''}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;

function statusChip(s) {
  if (s === 'ongoing') return `<span class="chip chip-ok live"><span class="dot"></span>${STATUS_LABEL[s]}</span>`;
  if (s === 'upcoming') return `<span class="chip chip-brand">${STATUS_LABEL[s]}</span>`;
  return `<span class="chip">${STATUS_LABEL[s]}</span>`;
}
function heroStatusChip(s) {
  return `<span class="chip chip-glass ${s === 'ongoing' ? 'live' : ''}">${s === 'ongoing' ? '<span class="dot" style="color:#4ade80"></span>' : ''}${STATUS_LABEL[s]}</span>`;
}

const MONTHS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];

// ---------------- Home ----------------
async function renderHome() {
  setNav('home');
  const index = await getJSON('data/index.json', { events: [] });
  const order = { ongoing: 0, upcoming: 1, finished: 2 };
  const events = [...index.events].sort((a, b) => order[a.status] - order[b.status] || (a.start < b.start ? 1 : -1));

  const card = (e, featured = false) => `
    <a class="card event-card ${featured ? 'featured' : ''}" href="#/e/${encodeURIComponent(e.id)}">
      <div class="top">
        <div class="row">${statusChip(e.status)}<span class="muted small">${fmtDate(e.start)} – ${fmtDate(e.end)}</span></div>
        <h3>${esc(e.name)}</h3>
        ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
      </div>
      <div class="meta">
        <div><b>${fmtKm(e.totalKm, 0)}</b>km</div>
        <div><b>${e.participants}</b>vận động viên</div>
        <div><b>${e.completed}</b>hoàn thành</div>
      </div>
    </a>`;

  const ongoing = events.filter((e) => e.status === 'ongoing');
  const rest = events.filter((e) => e.status !== 'ongoing');
  const totalKm = events.reduce((s, e) => s + e.totalKm, 0);

  app.innerHTML = `<div class="fade-in">
    <section class="hero">
      <span class="chip chip-glass">${icon.run} ${events.length} giải chạy</span>
      <h1>${esc(config.site?.title || 'Giải chạy')}</h1>
      <p class="lead">${esc(config.site?.subtitle || '')}</p>
      ${totalKm > 0 ? `<div class="hero-stats" style="grid-template-columns:repeat(2,1fr);max-width:420px">
        <div class="hero-stat"><div class="k">Tổng km đã chạy</div><div class="v">${fmtKm(totalKm, 0)}<small>km</small></div></div>
        <div class="hero-stat"><div class="k">Đang diễn ra</div><div class="v">${ongoing.length}<small>giải</small></div></div>
      </div>` : ''}
    </section>
    ${!events.length ? `<div class="card empty mt"><div class="icon">${icon.flag}</div><h2>Chưa có giải chạy nào</h2><p>Ban tổ chức sẽ sớm mở giải.</p></div>` : ''}
    ${ongoing.length ? `<div class="section-title"><h2>Đang diễn ra</h2></div><div class="events">${ongoing.map((e) => card(e)).join('')}</div>` : ''}
    ${rest.length ? `<div class="section-title"><h2>${ongoing.length ? 'Các giải khác' : 'Giải chạy'}</h2></div><div class="events">${rest.map((e) => card(e)).join('')}</div>` : ''}
  </div>`;
}

// ---------------- Event leaderboard ----------------
async function renderEvent(id) {
  setNav('home');
  const data = await loadEvent(id);
  if (!data) {
    app.innerHTML = `<a class="back" href="#/">${icon.back} Tất cả giải</a><div class="card empty"><div class="icon">${icon.flag}</div><h2>Không tìm thấy giải</h2><p>Có thể dữ liệu chưa được đồng bộ.</p></div>`;
    return;
  }
  const e = data.event;
  const total = daysBetween(e.start, e.end) + 1;
  const passed = Math.max(0, Math.min(total, daysBetween(e.start, data.today) + 1));
  const daysLeft = total - passed;
  const groups = [...new Set(data.athletes.map((a) => a.group).filter(Boolean))];
  const targets = Object.entries(e.targets || {}).filter(([k]) => k !== 'default' || !groups.length);

  app.innerHTML = `<div class="fade-in">
    <a class="back" href="#/">${icon.back} Tất cả giải</a>
    <section class="hero">
      <div class="row">${heroStatusChip(e.status)}<span class="chip chip-glass">${icon.calendar} ${fmtDate(e.start)} – ${fmtDate(e.end)}</span></div>
      <h1>${esc(e.name)}</h1>
      ${e.description ? `<p class="lead">${esc(e.description)}</p>` : ''}
      ${e.status !== 'finished' && config.strava?.workerUrl ? `<div class="row mt"><a class="btn btn-strava" href="#/join/${encodeURIComponent(e.id)}">${icon.strava} Tham gia giải này</a></div>` : ''}
      <div class="hero-stats">
        <div class="hero-stat"><div class="k">Tổng quãng đường</div><div class="v">${fmtKm(e.totalKm, 1)}<small>km</small></div></div>
        <div class="hero-stat"><div class="k">Vận động viên</div><div class="v">${e.participants}</div></div>
        <div class="hero-stat"><div class="k">Hoàn thành</div><div class="v">${e.completed}<small>/ ${e.participants}</small></div></div>
        <div class="hero-stat"><div class="k">${e.status === 'ongoing' ? `Còn ${daysLeft} ngày` : e.status === 'upcoming' ? `Bắt đầu sau ${daysBetween(data.today, e.start)} ngày` : 'Đã kết thúc'}</div>
          <div class="v">${passed}<small>/ ${total} ngày</small></div>
          <div class="bar" style="background:rgba(255,255,255,.15);box-shadow:none;height:4px;margin-top:8px"><i style="width:${(passed / total) * 100}%"></i></div></div>
      </div>
    </section>
    <div class="rules">
      ${targets.map(([k, v]) => `<span class="chip chip-brand">${icon.target} ${k === 'default' ? 'Mục tiêu' : esc(k)}: ${v} km</span>`).join('')}
      <span class="chip">${icon.timer} Pace hợp lệ ${fmtPace(e.rules.minPace)} – ${fmtPace(e.rules.maxPace)} /km</span>
      <span class="chip">${icon.shoe} ${e.rules.sportTypes.map(esc).join(', ')}</span>
      ${e.rules.minDistanceKm ? `<span class="chip">${icon.route} Tối thiểu ${e.rules.minDistanceKm} km/lần</span>` : ''}
    </div>
    <div id="podium"></div>
    <div class="section-title"><h2>Bảng xếp hạng</h2><span class="grow"></span><span class="muted small" title="Tự động đồng bộ mỗi 15 phút (:00, :15, :30, :45)">⟳ 15 phút/lần · mới nhất ${new Date(data.generatedAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span></div>
    <div class="toolbar">
      ${groups.length > 1 ? `<div class="seg" id="groups">
        <button data-g="all" class="${ui.group === 'all' ? 'on' : ''}">Tất cả</button>
        ${groups.map((g) => `<button data-g="${esc(g)}" class="${ui.group === g ? 'on' : ''}">${esc(g)}</button>`).join('')}
      </div>` : ''}
      <label class="search">${icon.search}<input type="search" id="q" placeholder="Tìm tên…" value="${esc(ui.q)}" aria-label="Tìm tên"></label>
      <label class="select">${icon.sort}<select id="sort" aria-label="Sắp xếp">
        <option value="validKm">Nhiều km nhất</option>
        <option value="percent">% hoàn thành</option>
        <option value="validCount">Chạy nhiều lần nhất</option>
        <option value="avgPace">Pace nhanh nhất</option>
        <option value="name">Tên A → Z</option>
      </select></label>
    </div>
    <div class="lb" id="rows"></div>
  </div>`;
  document.getElementById('sort').value = ui.sort;

  const draw = () => {
    const q = ui.q.trim().toLowerCase();
    const inGroup = data.athletes.filter((a) => ui.group === 'all' || a.group === ui.group);
    // Podium: top 3 của nhóm đang chọn
    const top = [...inGroup].sort((a, b) => b.validKm - a.validKm).filter((a) => a.validKm > 0).slice(0, 3);
    document.getElementById('podium').innerHTML = top.length >= 3 ? `<div class="podium">
      ${[1, 0, 2].map((i) => {
        const a = top[i];
        return `<a class="pod pod-${i + 1}" href="#/e/${encodeURIComponent(id)}/u/${a.id}">
          <span class="medal">${i + 1}</span>
          ${avatar(a, i === 0 ? 64 : 52)}
          <div class="name">${esc(a.name)}</div>
          <div class="km">${fmtKm(a.validKm, 1)}<small> km</small></div>
          <div class="sub">${a.percent != null ? Math.round(a.percent) + '% mục tiêu' : esc(a.group)}</div>
        </a>`;
      }).join('')}
    </div>` : '';

    let rows = inGroup.filter((a) => !q || a.name.toLowerCase().includes(q));
    const k = ui.sort;
    rows = [...rows].sort((a, b) => {
      if (k === 'name') return a.name.localeCompare(b.name, 'vi');
      if (k === 'avgPace') return (a.avgPace ?? 1e9) - (b.avgPace ?? 1e9);
      return (b[k] ?? -1) - (a[k] ?? -1) || b.validKm - a.validKm;
    });
    // Hạng hiển thị theo nhóm đang lọc
    const rankMap = new Map([...inGroup].sort((a, b) => b.validKm - a.validKm).map((a, i) => [a.id, i + 1]));

    document.getElementById('rows').innerHTML = rows.length
      ? rows.map((a) => {
        const rank = rankMap.get(a.id);
        const medal = rank <= 3 && a.validKm > 0;
        return `<a class="lb-row" href="#/e/${encodeURIComponent(id)}/u/${a.id}">
          <div class="lb-rank ${medal ? 'r' + rank : ''}">${rank}</div>
          <div class="lb-person">${avatar(a, 42)}<div style="min-width:0">
            <div class="lb-name">${esc(a.name)}${a.completed ? ' 🏅' : ''}</div>
            <div class="lb-sub">
              ${a.group ? `<span>${esc(a.group)}</span><span class="sep"></span>` : ''}
              <span>${a.validCount} lần</span>
              ${a.avgPace ? `<span class="sep"></span><span>${fmtPace(a.avgPace)}/km</span>` : ''}
              ${a.invalidCount ? `<span class="chip chip-bad" style="padding:1px 8px;font-size:11.5px">${a.invalidCount} không hợp lệ</span>` : ''}
              ${!a.connected ? '<span class="chip chip-warn" style="padding:1px 8px;font-size:11.5px">Chưa kết nối Strava</span>' : ''}
              ${a.syncError && a.connected ? `<span class="chip chip-bad" style="padding:1px 8px;font-size:11.5px" title="${esc(a.syncError)}">Lỗi đồng bộ</span>` : ''}
            </div>
          </div></div>
          <div class="lb-progress">${a.percent == null ? '<span class="muted small">Chưa đặt mục tiêu</span>' : `${bar(a.percent)}<span class="lb-pct ${a.completed ? 'done' : ''}">${Math.round(a.percent)}%</span>`}</div>
          <div class="lb-km"><b>${fmtKm(a.validKm, 1)}</b><span>/ ${a.target || '–'} km</span></div>
        </a>`;
      }).join('')
      : `<div class="card empty"><p>Không có ai phù hợp.</p></div>`;
  };
  draw();

  document.getElementById('q').addEventListener('input', (ev) => { ui.q = ev.target.value; draw(); });
  document.getElementById('sort').addEventListener('change', (ev) => { ui.sort = ev.target.value; draw(); });
  document.getElementById('groups')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    ui.group = b.dataset.g;
    document.querySelectorAll('#groups button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
}

// ---------------- Athlete detail ----------------
function dailyChart(e, today, activities) {
  const days = [];
  for (let d = e.start; d <= e.end; d = new Date(Date.parse(d) + 86400e3).toISOString().slice(0, 10)) days.push(d);
  if (!days.length || days.length > 400) return '';
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  activities.filter((a) => a.valid && perDay[a.date] != null).forEach((a) => (perDay[a.date] += a.km));
  const max = Math.max(1, ...Object.values(perDay));
  const mid = days[Math.floor(days.length / 2)];
  return `<div class="chart" role="img" aria-label="Km hợp lệ theo ngày">
      ${days.map((d) => {
        const v = perDay[d];
        const cls = d > today ? 'future' : v ? '' : 'zero';
        return `<div class="col ${cls}" data-tip="${fmtDateShort(d)}: ${fmtKm(v, 2)} km"><i style="height:${(v / max) * 100}%"></i></div>`;
      }).join('')}
    </div>
    <div class="chart-x"><span>${fmtDateShort(days[0])}</span><span>${fmtDateShort(mid)}</span><span>${fmtDateShort(days[days.length - 1])}</span></div>`;
}

async function renderAthlete(eventId, athleteId) {
  setNav('home');
  const data = await loadEvent(eventId);
  const a = data?.athletes.find((x) => x.id === athleteId);
  if (!a) {
    app.innerHTML = `<a class="back" href="#/e/${encodeURIComponent(eventId)}">${icon.back} Bảng xếp hạng</a><div class="card empty"><h2>Không tìm thấy vận động viên</h2></div>`;
    return;
  }
  const e = data.event;
  const total = daysBetween(e.start, e.end) + 1;
  const passed = Math.max(0, Math.min(total, daysBetween(e.start, data.today) + 1));
  const ideal = a.target ? (a.target * passed) / total : 0;
  const diff = a.validKm - ideal;

  let paceNote = '';
  if (a.completed) paceNote = `<div class="pace-note ahead">🏅 Đã hoàn thành mục tiêu!</div>`;
  else if (a.target && e.status === 'ongoing') {
    const perDay = (a.target - a.validKm) / Math.max(1, total - passed + 1);
    paceNote = diff >= 0
      ? `<div class="pace-note ahead">▲ Vượt tiến độ ${fmtKm(diff, 1)} km</div>`
      : `<div class="pace-note behind">▼ Chậm tiến độ ${fmtKm(-diff, 1)} km · cần ~${fmtKm(perDay, 1)} km/ngày</div>`;
  } else if (a.target && e.status === 'finished') {
    paceNote = `<div class="pace-note behind">Thiếu ${fmtKm(a.target - a.validKm, 1)} km</div>`;
  }

  app.innerHTML = `<div class="fade-in">
    <a class="back" href="#/e/${encodeURIComponent(eventId)}">${icon.back} ${esc(e.name)}</a>
    <section class="hero">
      <div class="profile">
        ${avatar(a, 76)}
        <div style="min-width:0">
          <h1>${esc(a.name)}</h1>
          <div class="row">
            <span class="chip chip-glass">${icon.trophy} Hạng ${a.rank}</span>
            ${a.group ? `<span class="chip chip-glass">${esc(a.group)}</span>` : ''}
            ${a.connected
              ? `<a class="chip chip-glass" style="text-decoration:none" href="https://www.strava.com/athletes/${esc(a.id)}" target="_blank" rel="noopener">${icon.strava} Strava</a>`
              : '<span class="chip chip-warn">Chưa kết nối Strava</span>'}
          </div>
          <div class="km-big"><b>${fmtKm(a.validKm, 2)}</b> / ${a.target || '–'} km</div>
          ${paceNote}
        </div>
        ${ring(a.percent, 132, 12, 'mục tiêu')}
      </div>
    </section>
    ${a.syncError ? `<div class="notice bad mt">${icon.alert}<span>${esc(a.syncError)}. Dữ liệu có thể chưa cập nhật, nhờ bạn kết nối lại Strava ở trang <a href="#/join">Tham gia</a>.</span></div>` : ''}
    <div class="stats mt">
      <div class="stat"><div class="k">${icon.run} Lần chạy hợp lệ</div><div class="v">${a.validCount}</div></div>
      <div class="stat"><div class="k">${icon.timer} Pace trung bình</div><div class="v">${fmtPace(a.avgPace)}<small>/km</small></div></div>
      <div class="stat"><div class="k">${icon.route} Dài nhất</div><div class="v">${fmtKm(a.longestKm, 2)}<small>km</small></div></div>
      <div class="stat ${a.invalidCount ? 'bad' : ''}"><div class="k">${icon.alert} Không hợp lệ</div><div class="v">${a.invalidCount}<small>${fmtKm(a.invalidKm, 1)} km</small></div></div>
    </div>
    <div class="card mt">
      <div class="card-head"><h3>Km hợp lệ theo ngày</h3><span class="grow"></span><span class="muted small">${a.activeDays} ngày có chạy</span></div>
      ${dailyChart(e, data.today, a.activities)}
    </div>
    <div class="section-title">
      <h2>Hoạt động</h2><span class="chip">${a.activities.length}</span><span class="grow"></span>
      ${a.invalidCount ? `<label class="switch"><input type="checkbox" id="showInvalid" ${ui.showInvalid ? 'checked' : ''}> Hiện không hợp lệ</label>` : ''}
    </div>
    <div class="acts" id="acts"></div>
    <div id="adminNote"></div>
  </div>`;

  let isAdmin = false;
  const draw = () => {
    const list = a.activities.filter((x) => ui.showInvalid || x.valid);
    document.getElementById('acts').innerHTML = list.length ? list.map((x) => {
      const [, mm, dd] = x.date.split('-');
      const paceBad = x.pace != null && (x.pace < e.rules.minPace || x.pace > e.rules.maxPace);
      const adminBtn = !isAdmin || x.source !== 'strava' ? ''
        : x.overridden ? `<button class="btn btn-sm" data-act="clear" data-id="${esc(x.id)}">Bỏ quyết định</button>`
        : x.valid ? `<button class="btn btn-sm btn-danger" data-act="invalid" data-id="${esc(x.id)}">Loại</button>`
        : `<button class="btn btn-sm" data-act="valid" data-id="${esc(x.id)}">Duyệt hợp lệ</button>`;
      return `<div class="act ${x.valid ? '' : 'invalid'}">
        <div class="act-date"><b>${dd}</b><span>${MONTHS[Number(mm) - 1]}</span></div>
        <div class="act-main" style="min-width:0">
          ${x.source === 'strava'
            ? `<a class="act-name" href="https://www.strava.com/activities/${esc(x.id)}" target="_blank" rel="noopener"><span>${esc(x.name)}</span>${icon.ext}</a>`
            : `<span class="act-name"><span>${esc(x.name)}</span></span>`}
          <div class="act-meta">${esc(x.type)} · ${x.time || ''} · ${fmtDuration(x.movingTime)}${x.elevation ? ` · ↑${x.elevation} m` : ''}${x.source === 'manual' ? ' · BTC bổ sung' : ''}</div>
          ${!x.valid && x.reasons.length ? `<div class="act-reasons">${x.reasons.map((r) => `<span class="chip chip-bad">${icon.alert} ${esc(r)}</span>`).join('')}</div>` : ''}
          ${x.overridden === 'valid' ? `<div class="act-reasons"><span class="chip chip-ok">${icon.check} BTC duyệt hợp lệ${x.overrideReason ? ': ' + esc(x.overrideReason) : ''}</span></div>` : ''}
        </div>
        <div class="act-stats">
          <div><b>${fmtKm(x.km, 2)}</b><span>km</span></div>
          <div><b class="${paceBad ? 'pace-bad' : ''}">${fmtPace(x.pace)}</b><span>/km</span></div>
        </div>
        <div class="act-side">${adminBtn}</div>
      </div>`;
    }).join('')
      : `<div class="card empty"><div class="icon">${icon.run}</div><p>Chưa có hoạt động nào trong thời gian giải.</p></div>`;
  };
  draw();
  document.getElementById('showInvalid')?.addEventListener('change', (ev) => { ui.showInvalid = ev.target.checked; draw(); });

  // Nút Duyệt/Loại chỉ hiện với admin đã xác thực quyền ghi repo
  if (ghToken()) {
    const repo = repoInfo(config);
    const res = await ghCheckAdmin(repo);
    if (res.ok) {
      isAdmin = true;
      draw();
      document.getElementById('adminNote').innerHTML = `<div class="notice info mt small">${icon.lock}<span>Đang đăng nhập admin <b>${esc(res.user.login)}</b>: bấm <b>Loại</b> / <b>Duyệt hợp lệ</b> ở từng hoạt động. Thay đổi hiển thị sau khi đồng bộ xong (~1–2 phút).</span></div>`;
      document.getElementById('acts').addEventListener('click', async (ev) => {
        const b = ev.target.closest('button[data-act]');
        if (!b) return;
        const act = b.dataset.act;
        let reason = '';
        if (act !== 'clear') {
          reason = prompt(act === 'invalid' ? 'Lý do loại hoạt động này?' : 'Lý do duyệt (không bắt buộc)?', '');
          if (reason === null) return;
        }
        b.disabled = true;
        try {
          const { config: cfg, sha } = await ghLoadConfig(repo);
          const ev2 = cfg.events.find((x) => x.id === eventId);
          ev2.overrides = ev2.overrides || {};
          if (act === 'clear') delete ev2.overrides[b.dataset.id];
          else ev2.overrides[b.dataset.id] = { status: act, reason };
          await ghSaveConfig(repo, cfg, sha, `${act === 'clear' ? 'Bỏ quyết định' : act === 'valid' ? 'Duyệt' : 'Loại'} hoạt động ${b.dataset.id} (${a.name})`);
          toast('Đã lưu. Bảng xếp hạng sẽ cập nhật sau ~1–2 phút.');
          b.textContent = 'Đã lưu ✓';
        } catch (err) {
          toast(err.message, 'err');
          b.disabled = false;
        }
      });
    }
  }
}

// ---------------- Join ----------------
async function renderJoin(preselect) {
  setNav('join');
  const workerUrl = (config.strava?.workerUrl || '').replace(/\/+$/, '');
  const groups = config.groups || [];
  const index = await getJSON('data/index.json', { events: [] });
  const open = index.events.filter((e) => e.status !== 'finished').sort((a, b) => (a.start < b.start ? -1 : 1));
  const chosen = open.find((e) => e.id === preselect) ? preselect : open[0]?.id;

  app.innerHTML = `<div class="join fade-in">
    <section class="hero">
      <div class="big-icon">${icon.run}</div>
      <h1 style="font-size:28px">Tham gia giải chạy</h1>
      <p class="lead" style="margin:0 auto">Chọn giải và kết nối Strava. Buổi chạy trong thời gian giải sẽ tự động được tính.</p>
    </section>
    <div class="card mt">
      ${!workerUrl ? `<div class="notice">${icon.alert}<span>Ban tổ chức chưa cấu hình kết nối Strava. Vui lòng quay lại sau.</span></div>`
      : !open.length ? `<div class="notice">${icon.alert}<span>Hiện chưa có giải nào mở đăng ký.</span></div>` : `
      <div class="mb"><div class="pick-label">Giải bạn muốn tham gia</div>
        <div class="event-pick">${open.map((e) => `<label>
          <input type="radio" name="event" value="${esc(e.id)}" ${e.id === chosen ? 'checked' : ''}>
          <span class="ep-main"><b>${esc(e.name)}</b><span class="muted small">${fmtDate(e.start)} – ${fmtDate(e.end)} · ${e.participants} người</span></span>
          ${statusChip(e.status)}
        </label>`).join('')}</div></div>
      ${groups.length ? `<div class="mb"><div class="pick-label">Bạn thuộc nhóm</div>
        <div class="group-pick">${groups.map((g, i) => `<label><input type="radio" name="group" value="${esc(g)}" ${i === 0 ? 'checked' : ''}>${esc(g)}</label>`).join('')}</div></div>` : ''}
      <ol class="steps mt">
        <li><span>Bấm nút bên dưới và đăng nhập Strava</span></li>
        <li><span>Giữ nguyên dấu tick <b>"View data about your activities"</b> rồi bấm <b>Authorize</b>. Nếu đã kết nối từ giải trước, Strava sẽ tự chuyển về luôn.</span></li>
        <li><span>Xong! Mỗi buổi chạy trong thời gian giải sẽ lên bảng xếp hạng sau khoảng 15 phút</span></li>
      </ol>
      <button class="btn btn-strava btn-lg btn-block mt-lg" id="connect">${icon.strava} Tham gia bằng Strava</button>
      <p class="small muted mt" style="margin-bottom:0">🔒 Chỉ đọc hoạt động, không đăng bài hay thay đổi gì trên Strava. Hoạt động để chế độ "Chỉ mình tôi" sẽ không được tính.
      Muốn ngừng kết nối: Strava → Settings → My Apps → Revoke Access.</p>`}
    </div>
  </div>`;
  document.getElementById('connect')?.addEventListener('click', () => {
    const g = document.querySelector('input[name="group"]:checked')?.value || '';
    const ev = document.querySelector('input[name="event"]:checked')?.value || '';
    location.href = `${workerUrl}/auth?group=${encodeURIComponent(g)}&event=${encodeURIComponent(ev)}`;
  });
}

function renderJoined(params) {
  setNav('join');
  const err = params.get('error');
  const messages = {
    access_denied: 'Bạn đã bấm từ chối cấp quyền.',
    missing_scope: 'Bạn cần giữ dấu tick "View data about your activities" để tham gia.',
  };
  app.innerHTML = `<div class="join fade-in"><div class="card" style="text-align:center;padding:40px 24px">
    ${err
      ? `<div class="empty" style="padding:0"><div class="icon" style="background:var(--bad-soft);color:var(--bad)">${icon.alert}</div>
         <h2>Chưa kết nối được</h2><p>${esc(messages[err] || 'Lỗi: ' + err)}</p>
         <a class="btn btn-primary btn-lg" href="#/join">Thử lại</a></div>`
      : `<div style="font-size:56px;line-height:1">🎉</div>
         <h2 style="margin-top:12px">Kết nối thành công!</h2>
         <p>Chào <b>${esc(params.get('name') || '')}</b>, bạn đã sẵn sàng tham gia.</p>
         <p class="muted small">Từ giờ mỗi buổi chạy sẽ tự lên bảng xếp hạng sau khoảng 15 phút.</p>
         <a class="btn btn-primary btn-lg mt" href="#/${params.get('event') ? 'e/' + encodeURIComponent(params.get('event')) : ''}">Xem bảng xếp hạng</a>`}
  </div></div>`;
}

// ---------------- Router ----------------
async function route() {
  const [pathPart, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'e' && parts[2] === 'u') await renderAthlete(parts[1], parts[3]);
    else if (parts[0] === 'e') await renderEvent(parts[1]);
    else if (parts[0] === 'join') await renderJoin(parts[1]);
    else if (parts[0] === 'joined') renderJoined(new URLSearchParams(query));
    else await renderHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="card empty"><h2>Có lỗi khi tải dữ liệu</h2><p>${esc(err.message)}</p></div>`;
  }
}

async function init() {
  config = await getJSON('config.json', { site: {} });
  const title = config.site?.title || 'Giải chạy';
  document.title = title;
  document.getElementById('site-title').textContent = title;
  document.getElementById('logo-mark').innerHTML = icon.run;
  window.addEventListener('hashchange', route);
  route();
}
init();
