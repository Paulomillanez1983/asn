/**
 * ASN 4.0 — Worker de Cloudflare
 * - Sirve la app estática (./public)
 * - Guarda suscripciones Web Push en KV
 * - Cron cada 10 min: calcula riesgo y envía push
 */
import { buildPushPayload } from '@block65/webcrypto-web-push';

export default {
  async fetch(request, env, ctx) {
    const res = await route(request, env, ctx);
    return harden(res);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  }
};

async function route(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/alerta/')) {
      try {
        return await sharePage(url, ctx);
      } catch (e) {
        return new Response('No pudimos generar la vista previa.', { status: 500 });
      }
    }
    if (url.pathname === '/og.png' || url.pathname.startsWith('/og/')) {
      const res = await env.ASSETS.fetch(request);
      if (!res.ok) return res;
      const h = new Headers(res.headers);
      h.set('cache-control', 'public, max-age=31536000, immutable');
      return new Response(res.body, { status: 200, headers: h });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
}

/* ---------------- API ---------------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tilecache.rainviewer.com https://gibs.earthdata.nasa.gov",
  "connect-src 'self' https://api.open-meteo.com https://ensemble-api.open-meteo.com https://flood-api.open-meteo.com https://api.met.no https://photon.komoot.io https://nominatim.openstreetmap.org https://api.rainviewer.com https://gibs.earthdata.nasa.gov",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self'"
].join('; ');

function harden(res) {
  const h = new Headers(res.headers);
  h.set('content-security-policy', CSP);
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'geolocation=(self), notifications=(self), camera=(), microphone=()');
  h.set('x-frame-options', 'DENY');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function limited(env, ip, bucket, limit, secs) {
  const win = Math.floor(Date.now() / (secs * 1000));
  const key = `rl:${bucket}:${ip}:${win}`;
  const n = Number((await env.SUBS.get(key)) || 0) + 1;
  await env.SUBS.put(key, String(n), { expirationTtl: secs + 30 });
  return n > limit;
}

async function hash(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function api(req, env, url) {
  const rules = {
    '/api/hydro': [60, 'hydro'],
    '/api/rivers': [30, 'rivers'],
    '/api/subscribe': [20, 'sub'],
    '/api/test': [10, 'test']
  };
  const rule = rules[url.pathname];
  if (rule) {
    const ip = req.headers.get('cf-connecting-ip') || 'anon';
    if (await limited(env, ip, rule[1], rule[0], 600)) {
      return json({ error: 'demasiadas solicitudes, probá en unos minutos' }, 429);
    }
  }

  if (url.pathname === '/api/vapid' && req.method === 'GET') {
    return json({ key: env.VAPID_PUBLIC });
  }

  if (url.pathname === '/api/subscribe' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    const sub = body && body.subscription;
    if (!sub || !sub.endpoint) return json({ error: 'falta subscription' }, 400);
    const places = Array.isArray(body.places) ? body.places.slice(0, 6) : [];
    const id = await hash(sub.endpoint);
    const key = 'sub:' + id;
    const prev = await env.SUBS.get(key, 'json');
    const rec = {
      sub: { endpoint: sub.endpoint, expirationTime: null, keys: sub.keys },
      places,
      last: (prev && prev.last) || {},
      at: (prev && prev.at) || {},
      ph: (prev && prev.ph) || {},
      hydroLast: (prev && prev.hydroLast) || {}
    };
    await env.SUBS.put(key, JSON.stringify(rec));
    return json({ ok: true, id, places: places.length });
  }

  if (url.pathname === '/api/unsubscribe' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.endpoint) return json({ error: 'falta endpoint' }, 400);
    await env.SUBS.delete('sub:' + await hash(body.endpoint));
    return json({ ok: true });
  }

  if (url.pathname === '/api/rivers' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
    return json(await riversNear(env, lat, lon));
  }

  if (url.pathname === '/api/hydro' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
    return json(await hydroFor(env, lat, lon));
  }

  if (url.pathname === '/api/test' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.endpoint) return json({ error: 'falta endpoint' }, 400);
    const rec = await env.SUBS.get('sub:' + await hash(body.endpoint), 'json');
    if (!rec) return json({ error: 'no suscripto' }, 404);

    const place = (rec.places && rec.places[0] && rec.places[0].name) || 'tu zona';
    let title = '🔔 ASN 4.0';
    let text = 'Prueba de aviso en tiempo real. Si lo ves, funciona.';

    if (body.kind === 'hydro') {
      title = '🌊 El río está creciendo · Paraná (0.3 km)';
      text = 'El río está más alto que casi todos los días de los últimos 3 meses. ' +
        'Si estás cerca de la costa o en zona baja, evitá el lugar y seguí el aviso. ' +
        'Cerca de ' + place + '. (Prueba)';
    } else if (body.kind === 'rain') {
      title = '🟠 Alerta naranja · 🌧️ lluvia en ' + place;
      text = 'Se viene lluvia fuerte en las próximas 3 horas. Guardá lo que tengas afuera y cerrá las ventanas. (Prueba)';
    }

    const r = await sendPush(env, rec.sub, title, text, 'test');
    return json({ result: r });
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const endpoint = url.searchParams.get('endpoint');
    if (!endpoint) return json({ error: 'falta endpoint' }, 400);
    const rec = await env.SUBS.get('sub:' + await hash(endpoint), 'json');
    return json({ subscribed: !!rec, places: rec ? rec.places.length : 0, last: rec ? rec.last : {} });
  }

  return json({ error: 'ruta desconocida' }, 404);
}

/* ---------------- Enlace compartible con OG ---------------- */
const LEVEL_SLUG = ['verde', 'amarilla', 'naranja', 'roja', 'morada'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function decodeToken(t) {
  try {
    const pad = '='.repeat((4 - (t.length % 4)) % 4);
    const bin = atob((t + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    if (!o || typeof o.lat !== 'number' || typeof o.lon !== 'number') return null;
    return o;
  } catch (e) {
    return null;
  }
}

async function sharePage(url, ctx) {
  const cache = caches.default;
  const cached = await cache.match(url.href);
  if (cached) return cached;

  const token = url.pathname.slice('/alerta/'.length);
  const place = decodeToken(token);
  if (!place) return new Response('Enlace inválido', { status: 404 });

  /* si el token trae el estado (links nuevos) responde al instante, sin API */
  const fast = typeof place.l === 'number';

  let level = fast ? Math.max(0, Math.min(4, place.l)) : 0;
  let ph = fast
    ? { word: place.p || 'sin alerta', emoji: place.e || '🟢' }
    : { word: 'sin alerta', emoji: '🟢' };
  let pct = 0;
  let n = 0;

  if (!fast) {
    try {
      const pb = probabilities(await Promise.race([
        forecast(place),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))
      ]));
      level = levelOf(pb);
      ph = phenomenon(pb);
      n = pb.n;
      pct = Math.round(Math.max(
        pb.rain15, pb.rain30, pb.rain60, pb.rain100,
        pb.gust60, pb.gust80, pb.gust100, pb.gust130
      ) * 100);
    } catch (e) { }
  }

  const L = LEVELS[level];
  const name = place.n || 'Mi lugar';
  const title = level
    ? `${L.emoji} ${L.name} · ${ph.emoji} ${ph.word} en ${name}`
    : `🟢 Sin alerta en ${name}`;
  const desc = fast
    ? `${place.a ? place.a + ' · ' : ''}${L.name}${place.p ? ' por ' + place.p : ''} al momento de compartir. Abrí ASN 4.0 para el detalle.`
    : `${place.a ? place.a + ' · ' : ''}Próximas 3 h: ${pct}% de ${n} escenarios. Abrí ASN 4.0 para el detalle.`;
  const img = `${url.origin}/og/${LEVEL_SLUG[level]}.png`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ASN 4.0 — Alerta Super Niño">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.href)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:secure_url" content="${esc(img)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta name="twitter:image:alt" content="${esc(title)}">
<link rel="image_src" href="${esc(img)}">
<meta name="theme-color" content="#070d18">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:grid;place-items:center;padding:24px;
    font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f3f7ff;
    background:radial-gradient(900px 520px at 85% -10%,#16294a,transparent 60%),#070d18}
  .box{display:block;max-width:520px;width:100%;border-radius:26px;padding:28px;
    background:linear-gradient(165deg,#13202f,#0b1524);border:1px solid rgba(255,255,255,.08);
    box-shadow:0 24px 60px rgba(0,0,0,.55);text-align:center;
    text-decoration:none;color:inherit}
  .auto{margin-top:12px;font-size:12px;color:#6f83a6}
  .emoji{font-size:64px;line-height:1}
  h1{font-size:26px;margin:14px 0 6px;letter-spacing:-.5px}
  .place{color:#9fb2d1;font-size:14px}
  .pct{margin-top:16px;font-size:13px;color:#7d90b3}
  .cta{display:inline-block;margin-top:22px;padding:14px 22px;border-radius:14px;
    background:#2563eb;color:#fff;text-decoration:none;font-weight:650}
  .foot{margin-top:14px;font-size:11px;color:#5d6f92}
</style></head>
<body><a class="box" href="/">
  <div class="emoji">${L.emoji}${level ? '' : '😌'}</div>
  <h1>${esc(level ? L.name : 'Sin alerta')}${level ? ': ' + esc(ph.word) : ''}</h1>
  <div class="place">${esc(name)}${place.a ? ' · ' + esc(place.a) : ''}</div>
  <div class="pct">${fast ? 'Estado al momento de compartir' : 'Próximas 3 horas · ' + pct + '% de ' + n + ' escenarios'}</div>
  <span class="cta">Abrir ASN 4.0</span>
  <div class="foot">Pronóstico por conjuntos del IFS · Open-Meteo</div>
  <div class="auto">Abriendo ASN 4.0…</div>
</a>
<script>setTimeout(function(){location.replace('/')},3000)</script>
</body></html>`;

  const res = new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300'
    }
  });
  if (ctx) ctx.waitUntil(cache.put(url.href, res.clone()));
  return res;
}

/* ---------------- Hidrología: GloFAS + INA ---------------- */
const INA_STATIONS = 'https://alerta.ina.gob.ar/a5/obs/puntual/estaciones?format=json';

function distKm(a, b, c, d) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(c - a), dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function inaNear(env, lat, lon) {
  let list = await env.SUBS.get('ina:stations:v2', 'json');
  if (!list) {
    try {
      const r = await fetch(INA_STATIONS, { headers: { accept: 'application/json' } });
      if (r.ok) {
        const all = await r.json();
        list = all.map(s => ({
          id: s.id, n: (s.nombre || '').trim(), r: s.rio ? String(s.rio).trim() : null, p: s.provincia,
          lat: s.geom && s.geom.coordinates ? s.geom.coordinates[1] : null,
          lon: s.geom && s.geom.coordinates ? s.geom.coordinates[0] : null,
          al: s.nivel_alerta, ev: s.nivel_evacuacion
        })).filter(s => s.lat != null && s.lon != null);
        await env.SUBS.put('ina:stations:v2', JSON.stringify(list), { expirationTtl: 86400 });
      }
    } catch (e) { }
  }
  if (!list) return [];
  return list
    .map(s => ({ ...s, d: distKm(lat, lon, s.lat, s.lon) }))
    .filter(s => s.d <= 80 && s.r)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
}

async function overpassJson(q) {
  const bases = [
    'https://overpass.kumi.systems/api/interpreter?data=',
    'https://overpass-api.de/api/interpreter?data='
  ];
  for (const base of bases) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 18000);
      const r = await fetch(base + encodeURIComponent(q), {
        signal: ctl.signal,
        headers: { 'User-Agent': 'ASN4/1.0 (contacto: paulomillanez@gmail.com)', accept: 'application/json' }
      });
      clearTimeout(t);
      if (r.ok) return await r.json();
    } catch (e) { }
  }
  return null;
}

async function riversNear(env, lat, lon) {
  const key = `rivers:v3:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = await env.SUBS.get(key, 'json');
  if (hit) return hit;

  const dLat = 0.06, dLon = 0.07;
  const viewbox = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map(v => v.toFixed(4)).join(',');
  const terms = ['arroyo', 'rio', 'canal'];
  const seen = new Map();

  for (const term of terms) {
    try {
      const u = 'https://nominatim.openstreetmap.org/search?q=' + term +
        '&format=jsonv2&viewbox=' + viewbox + '&bounded=1&limit=10&accept-language=es';
      const r = await fetch(u, {
        headers: { 'User-Agent': 'ASN4/1.0 (contacto: paulomillanez@gmail.com)', accept: 'application/json' }
      });
      if (r.ok) {
        const j = await r.json();
        for (const x of j) {
          const n = (x.name || (x.display_name || '').split(',')[0] || '').trim();
          if (!n) continue;
          const d = Math.round(distKm(lat, lon, +x.lat, +x.lon) * 10) / 10;
          if (d > 6) continue;
          const k = n.toLowerCase();
          if (!seen.has(k) || seen.get(k).d > d) {
            seen.set(k, { name: n, kind: x.type || 'curso', lat: +x.lat, lon: +x.lon, d });
          }
        }
      }
    } catch (e) { }
    await new Promise(r => setTimeout(r, 1100)); // política de uso de Nominatim
  }

  const list = [...seen.values()].sort((a, b) => a.d - b.d).slice(0, 6);
  if (list.length) await env.SUBS.put(key, JSON.stringify(list), { expirationTtl: 604800 });
  return list;
}

async function hydroFor(env, lat, lon) {
  const key = `hydro:v6:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = await env.SUBS.get(key, 'json');
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit;

  const out = { at: Date.now(), level: 0, q: null, p90: null, p95: null, rain48: 0, stations: [], river: null, msg: '' };

  let riverPoint = null;
  try {
    const cachedRivers = await env.SUBS.get(`rivers:v3:${lat.toFixed(2)},${lon.toFixed(2)}`, 'json');
    if (cachedRivers && cachedRivers.length) riverPoint = cachedRivers[0];
  } catch (e) { }

  const qLat = riverPoint ? riverPoint.lat : lat;
  const qLon = riverPoint ? riverPoint.lon : lon;

  try {
    const u = `https://flood-api.open-meteo.com/v1/flood?latitude=${qLat}&longitude=${qLon}` +
      '&daily=river_discharge&past_days=92&forecast_days=3';
    const j = await (await fetch(u)).json();
    const arr = (j.daily && j.daily.river_discharge) || [];
    const past = arr.slice(0, 92).filter(v => v != null);
    const q = arr[92] != null ? arr[92] : (past.length ? past[past.length - 1] : null);
    out.q = q;
    out.p90 = percentile(past, 0.9);
    out.p95 = percentile(past, 0.95);
  } catch (e) { }

  try {
    const pts = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.3, 0.3], [-0.3, -0.3]];
    const lats = pts.map(p => (lat + p[0]).toFixed(3)).join(',');
    const lons = pts.map(p => (lon + p[1]).toFixed(3)).join(',');
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
      '&daily=precipitation_sum&past_days=2&forecast_days=1&timezone=auto';
    const j = await (await fetch(u)).json();
    const list = Array.isArray(j) ? j : [j];
    out.rain48 = Math.round(Math.max(0, ...list.map(x => {
      const s = (x.daily && x.daily.precipitation_sum) || [];
      return (s[0] || 0) + (s[1] || 0);
    })));
  } catch (e) { }

  try { out.stations = await inaNear(env, lat, lon); } catch (e) { }
  const st = out.stations[0];
  const inaName = st && st.r ? (String(st.r).toUpperCase().startsWith('PARANA') ? 'Paraná' : st.r) : null;

  if (inaName && st.d != null && (!riverPoint || st.d <= riverPoint.d)) {
    out.river = inaName + ' (' + st.d.toFixed(1) + ' km)';
  } else if (riverPoint) {
    out.river = riverPoint.name + ' (' + riverPoint.d + ' km)';
  } else {
    out.river = inaName || 'Río cercano';
  }
  out.riverPoint = riverPoint ? { lat: riverPoint.lat, lon: riverPoint.lon } : null;

  const q = out.q, p90 = out.p90 || 0, p95 = out.p95 || 0;
  const ratio95 = (q != null && p95) ? q / p95 : 0;
  let score = 0;
  if (q != null && p90 && q >= p90) score += 1;
  if (ratio95 >= 1.15) score += 2;
  if (ratio95 >= 1.35) score += 1;
  if (out.rain48 >= 25) score += 1;
  if (q != null && p90 && q >= p90 * 1.5 && out.rain48 >= 15) score += 1;
  out.level = score >= 3 ? 2 : score >= 2 ? 1 : 0;
  out.ratio95 = Math.round(ratio95 * 100) / 100;

  out.levelWord = out.level === 0 ? 'normal' : out.level === 1 ? 'alto' : 'crecida';

  out.plain = out.level === 0
    ? 'El río está en su nivel habitual.'
    : out.level === 1
      ? 'El río viene creciendo y está por encima de lo habitual.'
      : 'El río está más alto que casi todos los días de los últimos 3 meses.';

  out.advice = out.level === 0
    ? ''
    : out.level === 1
      ? 'Todavía no es una crecida, pero conviene estar atento si estás cerca de la costa.'
      : 'Si estás cerca de la costa o en zona baja, evitá el lugar y seguí el aviso.';

  out.msg = out.plain;

  await env.SUBS.put(key, JSON.stringify(out), { expirationTtl: 3600 });
  return out;
}

/* ---------------- Pronóstico ---------------- */
async function forecast(place) {
  const u = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  u.searchParams.set('latitude', place.lat);
  u.searchParams.set('longitude', place.lon);
  u.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
  u.searchParams.set('models', 'ecmwf_ifs025');
  u.searchParams.set('forecast_hours', '4');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('open-meteo HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly) throw new Error('sin datos');
  return j.hourly;
}

function probabilities(H) {
  const ids = Object.keys(H)
    .filter(k => /^precipitation_member\d+$/.test(k))
    .map(k => k.replace('precipitation_member', ''));
  const sum3 = key => {
    const a = H[key] || [];
    return (a[0] ?? 0) + (a[1] ?? 0) + (a[2] ?? 0);
  };
  const rains = ids.map(id => sum3('precipitation_member' + id));
  const gusts = ids.map(id => {
    const a = (H['wind_gusts_10m_member' + id] || []).slice(0, 3);
    return a.length ? Math.max(...a.map(v => v ?? 0)) : 0;
  });
  const p = (arr, th) => arr.length ? arr.filter(v => v >= th).length / arr.length : 0;
  return {
    n: ids.length,
    rain15: p(rains, 15), rain30: p(rains, 30), rain60: p(rains, 60), rain100: p(rains, 100),
    gust60: p(gusts, 60), gust80: p(gusts, 80), gust100: p(gusts, 100), gust130: p(gusts, 130)
  };
}

function levelOf(pb) {
  if (pb.rain100 >= 0.30 || pb.gust130 >= 0.30) return 4;
  if (pb.rain60 >= 0.50 || pb.gust100 >= 0.30) return 3;
  if (pb.rain30 >= 0.40 || pb.gust80 >= 0.40) return 2;
  if (pb.rain15 >= 0.30 || pb.gust60 >= 0.40) return 1;
  return 0;
}

const LEVELS = [
  { name: 'Sin alerta', emoji: '🟢' },
  { name: 'Alerta amarilla', emoji: '🟡' },
  { name: 'Alerta naranja', emoji: '🟠' },
  { name: 'Alerta roja', emoji: '🔴' },
  { name: 'Alerta morada', emoji: '🟣' }
];

function phenomenon(pb) {
  const rain = pb.rain15 >= 0.30;
  const wind = pb.gust60 >= 0.40;
  if (rain && pb.rain60 >= 0.50) return { word: 'lluvia torrencial', emoji: '🌊' };
  if (rain && wind) return { word: 'lluvia y ráfagas', emoji: '🌧️' };
  if (rain) return { word: 'lluvia', emoji: '🌧️' };
  if (pb.gust80 >= 0.40) return { word: 'ráfagas fuertes', emoji: '💨' };
  return { word: 'ráfagas', emoji: '💨' };
}

function quietNow() {
  const h = Number(new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba', hour: 'numeric', hour12: false
  }).format(new Date()));
  return h >= 23 || h < 7;
}

/* ---------------- Push ---------------- */
async function sendPush(env, sub, title, body, tag) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE
  };
  const payload = await buildPushPayload(
    { data: JSON.stringify({ title, body, tag, url: '/' }), options: { ttl: 3600, urgency: 'high' } },
    sub,
    vapid
  );
  const res = await fetch(sub.endpoint, payload);
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) return 'error:' + res.status;
  return 'ok';
}

async function runAlerts(env) {
  const list = await env.SUBS.list({ prefix: 'sub:' });
  for (const k of list.keys) {
    const rec = await env.SUBS.get(k.name, 'json');
    if (!rec || !rec.sub || !Array.isArray(rec.places)) continue;
    let gone = false;

    for (const p of rec.places) {
      const tag = p.name || (p.lat + ',' + p.lon);
      try {
        const pb = probabilities(await forecast(p));
        const level = levelOf(pb);
        const prev = rec.last[tag] ?? -1;
        const prevPh = (rec.ph && rec.ph[tag]) || '';
        const at = rec.at[tag] ?? 0;
        const ph = phenomenon(pb);
        const quietBlock = quietNow() && level < 3;

        const changed = level !== prev || ph.word !== prevPh;
        const repeatMin = Number(env.REPEAT_MIN || 30);
        const repeatDue = level >= 1 && Date.now() - at >= repeatMin * 60 * 1000;
        const recovered = prev >= 1 && level === 0;
        const should = (level >= 1 && (changed || repeatDue)) || recovered;

        if (should && !quietBlock) {
          const r = recovered
            ? await sendPush(env, rec.sub, `🟢 Sin alerta en ${tag}`, 'Bajó la alerta. Podés seguir con normalidad.', tag)
            : await sendPush(
              env, rec.sub,
              `${LEVELS[level].emoji} ${LEVELS[level].name} · ${ph.emoji} ${ph.word} en ${tag}`,
              `${ph.word} en las próximas 3 horas. Abrí ASN para ver el detalle.`,
              tag
            );
          if (r === 'gone') { gone = true; break; }
          if (r === 'ok') rec.at[tag] = Date.now();
        }
        if (p.hydro) {
          const h = await hydroFor(env, p.lat, p.lon);
          const hk = tag + ':hydro';
          const hPrev = (rec.hydroLast && rec.hydroLast[hk]) || 0;
          const hQuiet = quietNow() && h.level < 2;
          if (h.level >= 1 && h.level > hPrev && !hQuiet) {
            const r2 = await sendPush(
              env, rec.sub,
              '🌊 ' + (h.level >= 2 ? 'El río está creciendo' : 'El río está alto') +
              ' · ' + (h.river || 'río cercano'),
              h.plain + ' ' + (h.advice || '') + ' Cerca de ' + tag + '.',
              'hydro-' + hk
            );
            if (r2 === 'gone') { gone = true; break; }
          }
          rec.hydroLast = rec.hydroLast || {};
          rec.hydroLast[hk] = h.level;
        }

        rec.last[tag] = level;
        rec.ph = rec.ph || {};
        rec.ph[tag] = ph.word;
      } catch (e) {
        console.log('error', tag, e.message);
      }
    }

    if (gone) await env.SUBS.delete(k.name);
    else await env.SUBS.put(k.name, JSON.stringify(rec));
  }
}








