// Tiện ích dùng chung cho trang public và trang admin.

export const BASE = new URLSearchParams(location.search).has('demo') ? 'demo/' : '';

export async function getJSON(p, fallback) {
  try {
    const r = await fetch(`${BASE}${p}?t=${Date.now()}`);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtPace(p) {
  if (p == null || !isFinite(p)) return '–';
  let m = Math.floor(p);
  let s = Math.round((p - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function parsePace(str) {
  const s = String(str).trim().replace(',', '.');
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(Number);
    return m + (sec || 0) / 60;
  }
  return Number(s);
}

export const fmtKm = (n, d = 1) =>
  (n ?? 0).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });

export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '–');
export const fmtDateShort = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '');

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
}

export const STATUS_LABEL = { upcoming: 'Sắp diễn ra', ongoing: 'Đang diễn ra', finished: 'Đã kết thúc' };

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const PALETTE = [
  ['#ff7a45', '#ff4d1f'], ['#5b8cff', '#3a5bff'], ['#22c38e', '#0f9b6c'], ['#b06bff', '#7c3aed'],
  ['#ff6b9a', '#e0306a'], ['#20b5d6', '#0e86a8'], ['#f5a524', '#d97706'], ['#6b7cff', '#4f46e5'],
];
function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function avatar(a, size = 40) {
  const st = `width:${size}px;height:${size}px`;
  if (a.avatar && /^https?:/.test(a.avatar) && !a.avatar.includes('avatar/athlete/large')) {
    return `<img class="avatar" src="${esc(a.avatar)}" alt="" style="${st}" loading="lazy" referrerpolicy="no-referrer">`;
  }
  const [c1, c2] = PALETTE[hash(a.id || a.name) % PALETTE.length];
  return `<span class="avatar avatar-fallback" style="${st};--a1:${c1};--a2:${c2};font-size:${Math.round(size * 0.36)}px">${esc(initials(a.name))}</span>`;
}

export function ring(pct, size = 120, stroke = 10, label = '') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct || 0));
  return `<div class="ring ${pct >= 100 ? 'done' : ''}" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#ff5a1f"/></linearGradient></defs>
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}"/>
    </svg>
    <div class="label"><div><b>${pct == null ? '–' : Math.round(pct) + '%'}</b><br><span>${esc(label)}</span></div></div>
  </div>`;
}

// Lucide-style icons (inline SVG, stroke = currentColor)
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  run: I('<circle cx="13" cy="4" r="2"/><path d="m8 21 3-6 3 2v5"/><path d="M6 12l3-4 4 1 3 4h3"/><path d="m11 15 2-6"/>'),
  back: I('<path d="m15 18-6-6 6-6"/>'),
  sort: I('<path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h5"/><path d="M17 10v10"/><path d="m14 17 3 3 3-3"/>'),
  search: I('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  target: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  timer: I('<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>'),
  shoe: I('<path d="M4 16v-4l4-6 3 1-1 3 4 2 6 1a2 2 0 0 1 2 2v1H4z"/><path d="M4 19h18"/>'),
  flag: I('<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>'),
  users: I('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21a7 7 0 0 0-4-6.3"/>'),
  trophy: I('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/>'),
  route: I('<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/>'),
  alert: I('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  check: I('<path d="M20 6 9 17l-5-5"/>'),
  ext: I('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  calendar: I('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  zap: I('<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  trash: I('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  copy: I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  strava: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.4 17.9 13.3 13.7h-3.1l5.2 10.3 5.2-10.3h-3.1zM10.2 0 3 14.1h4.3l2.9-5.6 2.9 5.6h4.2z"/></svg>',
};

export const isLocal = () => ['localhost', '127.0.0.1', ''].includes(location.hostname);

export function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------- localStorage (an toàn) ----------
export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

// ---------- GitHub API (cho admin) ----------
export function repoInfo(config) {
  const g = config.github || {};
  let owner = g.owner;
  let repo = g.repo;
  if (!owner && location.hostname.endsWith('.github.io')) owner = location.hostname.split('.')[0];
  if (!repo && location.hostname.endsWith('.github.io')) {
    const first = location.pathname.split('/').filter(Boolean)[0];
    repo = first && !first.endsWith('.html') ? first : `${owner}.github.io`;
  }
  const saved = (store('gh_repo') || '').split('/');
  owner = owner || saved[0] || '';
  repo = repo || saved[1] || '';
  return { owner, repo, branch: g.branch || 'main' };
}

// Kiểm tra token hiện tại có quyền ghi vào repo không (chỉ người có quyền ghi mới là admin)
export async function ghCheckAdmin(repo) {
  if (!ghToken() || !repo.owner || !repo.repo) return { ok: false, reason: 'no-token' };
  const cacheKey = `gh_admin:${repo.owner}/${repo.repo}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (cached && cached.token === ghToken().slice(-8)) return cached.result;
  } catch {}
  let result;
  try {
    const [user, r] = await Promise.all([gh('/user'), gh(`/repos/${repo.owner}/${repo.repo}`)]);
    const p = r.permissions || {};
    result = p.push || p.admin || p.maintain
      ? { ok: true, user }
      : { ok: false, reason: 'no-permission', user };
  } catch (e) {
    result = { ok: false, reason: e.message.includes('401') ? 'bad-token' : e.message.includes('404') ? 'no-repo' : 'error', error: e.message };
  }
  if (result.reason !== 'error') try { sessionStorage.setItem(cacheKey, JSON.stringify({ token: ghToken().slice(-8), result })); } catch {}
  return result;
}

export const ghToken = () => store('gh_token') || '';

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${ghToken()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (r.status === 403) {
      // Fine-grained token thiếu quyền: GitHub cho biết quyền cần có qua header này
      const need = r.headers.get('x-accepted-github-permissions') || '';
      const names = { contents: 'Contents', actions: 'Actions', metadata: 'Metadata' };
      const missing = need.split(/[;,]/).map((s) => s.trim().split('=')).filter(([k]) => names[k])
        .map(([k, v]) => `${names[k]}: ${v === 'write' ? 'Read and write' : 'Read'}`);
      throw new Error(`GitHub 403: token thiếu quyền ${missing.length ? missing.join(', ') : 'ghi vào repo'}. ` +
        'Tạo lại token với Contents: Read and write + Actions: Read and write, rồi Đăng xuất và đăng nhập lại.');
    }
    throw new Error(`GitHub ${r.status}: ${body.message || r.statusText}`);
  }
  return r.status === 204 ? null : r.json();
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function ghLoadConfig(repo) {
  const res = await gh(`/repos/${repo.owner}/${repo.repo}/contents/config.json?ref=${repo.branch}`);
  return { config: JSON.parse(b64decode(res.content)), sha: res.sha };
}

export async function ghSaveConfig(repo, config, sha, message) {
  const res = await gh(`/repos/${repo.owner}/${repo.repo}/contents/config.json`, {
    method: 'PUT',
    body: JSON.stringify({
      message: message || 'Cập nhật cấu hình giải chạy',
      content: b64encode(JSON.stringify(config, null, 2) + '\n'),
      sha,
      branch: repo.branch,
    }),
  });
  return res.content.sha;
}

export async function ghRunSync(repo) {
  await gh(`/repos/${repo.owner}/${repo.repo}/actions/workflows/sync.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: repo.branch }),
  });
}

export async function ghWhoAmI() {
  return gh('/user');
}

export function toast(msg, type = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast show ${type}`;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = 'toast'), type === 'err' ? 6000 : 3000);
}
