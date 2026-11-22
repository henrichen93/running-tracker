// Cloudflare Worker: giữ Strava client secret + refresh token của từng thành viên.
//
// Env (wrangler secret / vars):
//   STRAVA_CLIENT_ID      (var)
//   STRAVA_CLIENT_SECRET  (secret)
//   SYNC_KEY              (secret)  - chuỗi ngẫu nhiên, GitHub Actions dùng để lấy token
//   SITE_URL              (var)     - vd: https://yourname.github.io/running-tracker/
//   STRAVA_SCOPE          (var, optional) - mặc định "read,activity:read"
//   GH_REPO               (var)     - vd: ten-ban/running-tracker
//   GH_BRANCH             (var, optional) - mặc định main
//   GH_DISPATCH_TOKEN     (secret)  - fine-grained token, chỉ cần quyền Actions: Read and write
//   Cron trigger (wrangler.toml): 0,15,30,45 * * * * -> kích hoạt GitHub Actions sync đúng giờ
//   KV binding: ATHLETES
//
// Routes:
//   GET /auth?group=Nam            -> chuyển sang trang cấp quyền Strava
//   GET /callback                  -> Strava gọi lại, lưu token, chuyển về web
//   GET /athletes   (Bearer SYNC_KEY) -> danh sách người đã kết nối
//   GET /token/:id  (Bearer SYNC_KEY) -> access token còn hạn của 1 người
//   GET|POST /webhook                 -> Strava webhook (báo có hoạt động mới)
//   POST /webhook/setup (Bearer SYNC_KEY) -> đăng ký webhook với Strava (chạy 1 lần)
//   GET /dirty      (Bearer SYNC_KEY) -> những người có hoạt động mới từ lần sync trước
//   POST /dirty/clear (Bearer SYNC_KEY) -> đánh dấu đã sync xong

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';

export default {
  // Cloudflare cron chạy đúng phút :00 :15 :30 :45 (GitHub schedule hay trễ 5-15 phút)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchSync(env, 'auto'));
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*' };
    try {
      if (url.pathname === '/auth') return auth(url, env);
      if (url.pathname === '/callback') return await callback(url, env);
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);
      if (url.pathname === '/webhook') return await webhook(req, url, env);

      if (req.headers.get('Authorization') !== `Bearer ${env.SYNC_KEY}`) {
        return json({ error: 'unauthorized' }, 401, cors);
      }
      if (url.pathname === '/athletes') return await listAthletes(env);
      if (url.pathname === '/webhook/setup' && req.method === 'POST') return await setupWebhook(url, env);
      if (url.pathname === '/dirty') return await listDirty(env);
      if (url.pathname === '/dirty/clear' && req.method === 'POST') return await clearDirty(req, env);
      const m = url.pathname.match(/^\/token\/(\d+)$/);
      if (m) return await getToken(m[1], env);
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function siteRedirect(env, hash) {
  const base = (env.SITE_URL || '/').replace(/#.*$/, '');
  return Response.redirect(base + '#' + hash, 302);
}

function auth(url, env) {
  const state = (url.searchParams.get('group') || '').slice(0, 40);
  const params = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: `${url.origin}/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: env.STRAVA_SCOPE || 'read,activity:read',
    state,
  });
  return Response.redirect(`https://www.strava.com/oauth/authorize?${params}`, 302);
}

async function callback(url, env) {
  const err = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const scope = url.searchParams.get('scope') || '';
  if (err || !code) return siteRedirect(env, `/joined?error=${encodeURIComponent(err || 'no_code')}`);
  if (!scope.includes('activity:read')) {
    return siteRedirect(env, '/joined?error=missing_scope');
  }

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return siteRedirect(env, `/joined?error=exchange_failed_${res.status}`);
  const t = await res.json();
  const a = t.athlete || {};
  const name = [a.firstname, a.lastname].filter(Boolean).join(' ').trim() || `Strava ${a.id}`;
  const meta = {
    name,
    avatar: a.profile_medium || '',
    group: (url.searchParams.get('state') || '').slice(0, 40),
    joinedAt: new Date().toISOString(),
    revoked: false,
  };
  await env.ATHLETES.put(
    `athlete:${a.id}`,
    JSON.stringify({ refresh_token: t.refresh_token, access_token: t.access_token, expires_at: t.expires_at }),
    { metadata: meta },
  );
  return siteRedirect(env, `/joined?id=${a.id}&name=${encodeURIComponent(name)}`);
}

async function listAthletes(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ATHLETES.list({ prefix: 'athlete:', cursor });
    for (const k of page.keys) out.push({ id: k.name.slice(8), ...(k.metadata || {}) });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json(out);
}

async function getToken(id, env) {
  const key = `athlete:${id}`;
  const { value, metadata } = await env.ATHLETES.getWithMetadata(key);
  if (!value) return json({ error: 'not connected' }, 404);
  const rec = JSON.parse(value);
  const now = Math.floor(Date.now() / 1000);
  if (rec.access_token && rec.expires_at > now + 600) return json({ access_token: rec.access_token });

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: rec.refresh_token,
    }),
  });
  if (res.status === 400 || res.status === 401) {
    // Người dùng đã thu hồi quyền trên Strava
    await env.ATHLETES.put(key, value, { metadata: { ...metadata, revoked: true } });
    return json({ error: 'revoked' }, 410);
  }
  if (!res.ok) return json({ error: `refresh failed ${res.status}` }, 502);
  const t = await res.json();
  await env.ATHLETES.put(
    key,
    JSON.stringify({ refresh_token: t.refresh_token, access_token: t.access_token, expires_at: t.expires_at }),
    { metadata: { ...metadata, revoked: false } },
  );
  return json({ access_token: t.access_token });
}

// ---------- Webhook: Strava báo khi có hoạt động mới / sửa / xoá ----------
async function verifyToken(env) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('webhook:' + env.SYNC_KEY));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function webhook(req, url, env) {
  // Strava xác thực khi đăng ký subscription
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.verify_token') !== (await verifyToken(env))) return json({ error: 'bad token' }, 403);
    return json({ 'hub.challenge': url.searchParams.get('hub.challenge') });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const ev = await req.json().catch(() => null);
  if (!ev || !ev.owner_id) return json({ ok: true });
  const key = `athlete:${ev.owner_id}`;
  const { value, metadata } = await env.ATHLETES.getWithMetadata(key);
  if (!value) return json({ ok: true }); // không phải thành viên, bỏ qua

  if (ev.object_type === 'athlete' && ev.updates && String(ev.updates.authorized) === 'false') {
    await env.ATHLETES.put(key, value, { metadata: { ...metadata, revoked: true } });
  } else if (ev.object_type === 'activity') {
    await env.ATHLETES.put(`dirty:${ev.owner_id}`, String(Date.now()), { expirationTtl: 60 * 60 * 24 * 14 });
  }
  return json({ ok: true }); // Strava cần phản hồi 200 trong 2 giây
}

async function setupWebhook(url, env) {
  const base = 'https://www.strava.com/api/v3/push_subscriptions';
  const auth = `client_id=${env.STRAVA_CLIENT_ID}&client_secret=${env.STRAVA_CLIENT_SECRET}`;
  const existing = await (await fetch(`${base}?${auth}`)).json().catch(() => []);
  const callback = `${url.origin}/webhook`;
  if (Array.isArray(existing) && existing.some((s) => s.callback_url === callback)) {
    await env.ATHLETES.put('meta:webhook', '1');
    return json({ ok: true, message: 'Webhook đã được đăng ký từ trước', subscriptions: existing });
  }
  // Strava chỉ cho 1 subscription / app: xoá cái cũ trỏ sai chỗ
  for (const s of Array.isArray(existing) ? existing : []) await fetch(`${base}/${s.id}?${auth}`, { method: 'DELETE' });
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `${auth}&callback_url=${encodeURIComponent(callback)}&verify_token=${await verifyToken(env)}`,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return json({ ok: false, status: res.status, body }, 502);
  await env.ATHLETES.put('meta:webhook', '1');
  return json({ ok: true, subscription: body });
}

async function listDirty(env) {
  const webhook = (await env.ATHLETES.get('meta:webhook')) === '1';
  const items = [];
  let cursor;
  do {
    const page = await env.ATHLETES.list({ prefix: 'dirty:', cursor });
    for (const k of page.keys) items.push({ id: k.name.slice(6), ts: await env.ATHLETES.get(k.name) });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ webhook, items });
}

async function clearDirty(req, env) {
  const { items = [] } = await req.json().catch(() => ({}));
  for (const it of items) {
    const key = `dirty:${it.id}`;
    // Chỉ xoá nếu không có hoạt động mới hơn đến trong lúc đang sync
    if ((await env.ATHLETES.get(key)) === String(it.ts)) await env.ATHLETES.delete(key);
  }
  return json({ ok: true });
}

// ---------- Kích hoạt GitHub Actions ----------
async function dispatchSync(env, mode) {
  if (!env.GH_REPO || !env.GH_DISPATCH_TOKEN) return;
  const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/sync.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'running-tracker-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: env.GH_BRANCH || 'main', inputs: { mode } }),
  });
  if (!res.ok) console.error('GitHub dispatch failed', res.status, await res.text());
}
