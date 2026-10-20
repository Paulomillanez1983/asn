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
        return await sharePage(url, env, ctx);
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
  "connect-src 'self'",
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

/* ---------------- Puente de datos ----------------
   El navegador solo habla con este dominio: así no queda a la vista de dónde
   sale cada dato. También sirve para cachear en el borde y ahorrar llamadas. */
const PROXY = new Set(['/api/wx', '/api/sun', '/api/ens', '/api/met', '/api/geo', '/api/rev', '/api/radar', '/api/wxmodel']);

async function pipeJson(target, ttl = 300, extra = {}) {
  const cache = caches.default;
  const hit = await cache.match(target);
  if (hit) return hit;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  let r = null;
  try {
    r = await fetch(target, { signal: ctl.signal, headers: { accept: 'application/json', ...extra } });
  } catch (e) {
    clearTimeout(timer);
    return json({ error: 'fuente no disponible' }, 502);
  }
  clearTimeout(timer);

  const body = await r.text();
  const res = new Response(body, {
    status: r.ok ? 200 : r.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=' + ttl
    }
  });
  if (r.ok) await cache.put(target, res.clone());
  return res;
}

async function proxy(url) {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const path = url.pathname;

  /* direcciones */
  if (path === '/api/geo') {
    const q = (url.searchParams.get('q') || '').slice(0, 120);
    const kind = url.searchParams.get('kind');
    if (!q) return json({ error: 'falta q' }, 400);

    if (kind === 'photon') {
      return pipeJson('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=8', 600);
    }
    if (kind === 'nominatim') {
      const m = q.match(/^(.*?)\s+(\d{1,5})$/);
      const t = new URL('https://nominatim.openstreetmap.org/search');
      t.searchParams.set('format', 'jsonv2');
      t.searchParams.set('addressdetails', '1');
      t.searchParams.set('limit', '6');
      t.searchParams.set('countrycodes', 'ar');
      if (m) { t.searchParams.set('street', m[1] + ' ' + m[2]); t.searchParams.set('city', 'Córdoba'); }
      else t.searchParams.set('q', q);
      return pipeJson(t.toString(), 600, { 'User-Agent': 'ASN4/1.0 (contacto: paulomillanez@gmail.com)' });
    }
    const t = new URL('https://geocoding-api.open-meteo.com/v1/search');
    t.searchParams.set('name', q);
    t.searchParams.set('count', '6');
    t.searchParams.set('language', 'es');
    t.searchParams.set('countryCode', 'AR');
    return pipeJson(t.toString(), 600);
  }

  if (path === '/api/rev') {
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
    return pipeJson('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=' +
      lat + '&lon=' + lon, 86400, { 'User-Agent': 'ASN4/1.0 (contacto: paulomillanez@gmail.com)' });
  }

  /* radar: fotogramas disponibles */
  if (path === '/api/radar') {
    return pipeJson('https://api.rainviewer.com/public/weather-maps.json', 120);
  }

  if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
  const la = String(lat), lo = String(lon);

  if (path === '/api/wx') {
    const t = new URL('https://api.open-meteo.com/v1/forecast');
    t.searchParams.set('latitude', la);
    t.searchParams.set('longitude', lo);
    t.searchParams.set('hourly', 'precipitation,precipitation_probability,wind_gusts_10m,cape,weather_code,freezing_level_height,snowfall,snow_depth,cloud_cover');
    t.searchParams.set('current', 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m');
    t.searchParams.set('daily', 'sunrise,sunset');
    t.searchParams.set('forecast_days', '2');
    t.searchParams.set('models', 'ecmwf_ifs025,gfs_seamless,icon_seamless,gem_seamless');
    t.searchParams.set('forecast_hours', '13');
    t.searchParams.set('timezone', 'auto');
    t.searchParams.set('wind_speed_unit', 'kmh');
    return pipeJson(t.toString(), 240);
  }

  if (path === '/api/sun') {
    const t = new URL('https://api.open-meteo.com/v1/forecast');
    t.searchParams.set('latitude', la);
    t.searchParams.set('longitude', lo);
    t.searchParams.set('daily', 'sunrise,sunset');
    t.searchParams.set('forecast_days', '2');
    t.searchParams.set('timezone', 'auto');
    return pipeJson(t.toString(), 1800);
  }

  if (path === '/api/ens') {
    const t = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
    t.searchParams.set('latitude', la);
    t.searchParams.set('longitude', lo);
    t.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
    t.searchParams.set('models', 'ecmwf_ifs025');
    t.searchParams.set('forecast_hours', '4');
    t.searchParams.set('timezone', 'auto');
    t.searchParams.set('wind_speed_unit', 'kmh');
    return pipeJson(t.toString(), 240);
  }

  if (path === '/api/met') {
    return pipeJson('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' +
      encodeURIComponent(la) + '&lon=' + encodeURIComponent(lo), 240,
      { 'User-Agent': 'ASN4/1.0 (contacto: paulomillanez@gmail.com)' });
  }

  /* modelo para el GIF: varias coordenadas a la vez */
  if (path === '/api/wxmodel') {
    const lats = (url.searchParams.get('lats') || '').slice(0, 200);
    const lons = (url.searchParams.get('lons') || '').slice(0, 200);
    if (!lats || !lons) return json({ error: 'faltan coordenadas' }, 400);
    const t = new URL('https://api.open-meteo.com/v1/forecast');
    t.searchParams.set('latitude', lats);
    t.searchParams.set('longitude', lons);
    t.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
    t.searchParams.set('models', 'ecmwf_ifs025');
    t.searchParams.set('forecast_hours', '8');
    t.searchParams.set('timezone', 'auto');
    t.searchParams.set('wind_speed_unit', 'kmh');
    return pipeJson(t.toString(), 240);
  }

  return json({ error: 'ruta desconocida' }, 404);
}

async function api(req, env, url) {
  const rules = {
    '/api/hydro': [60, 'hydro'],
    '/api/rivers': [30, 'rivers'],
    '/api/subscribe': [20, 'sub'],
    '/api/test': [10, 'test'],
    '/api/geo': [1200, 'geo']
  };
  const rule = rules[url.pathname];
  if (rule) {
    const ip = req.headers.get('cf-connecting-ip') || 'anon';
    if (await limited(env, ip, rule[1], rule[0], 600)) {
      return json({ error: 'demasiadas solicitudes, probá en unos minutos' }, 429);
    }
  }

  if (PROXY.has(url.pathname) && req.method === 'GET') {
    return await proxy(url);
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

  /* enlace corto para compartir (sin coordenadas visibles) */
  if (url.pathname === '/api/share' && req.method === 'POST') {
    let b = null;
    try { b = await req.json(); } catch (e) { }
    if (!b || !isFinite(Number(b.lat)) || !isFinite(Number(b.lon))) {
      return json({ error: 'datos inválidos' }, 400);
    }
    const rec = {
      n: String(b.n || 'Mi lugar').slice(0, 26),
      a: String(b.a || '').slice(0, 54),
      lat: Number(Number(b.lat).toFixed(3)),
      lon: Number(Number(b.lon).toFixed(3)),
      l: Math.max(0, Math.min(4, Number(b.l) || 0)),
      p: String(b.p || '').slice(0, 22),
      e: String(b.e || '').slice(0, 4)
    };
    const id = shortId();
    await env.SUBS.put('sh:' + id, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 120 });
    return json({ id: id });
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
      let h = null;
      try {
        const p0 = rec.places && rec.places[0];
        if (p0) h = await hydroFor(env, p0.lat, p0.lon);
      } catch (e) { }
      const L = LEVELS[(h && h.level) || 2];
      title = `${L.emoji} ${L.name} · 🌊 ${(h && h.headline) || 'Crecida cerca'}` +
        ((h && h.river) ? ' · ' + h.river : '');
      text = ((h && h.plain) || 'El agua está más alta de lo normal.') + ' ' +
        ((h && h.detail) || '') + ' ' + ((h && h.advice) || '') + ' (Prueba)';
    } else if (body.kind === 'rain') {
      title = '🟠 Alerta naranja · 🌧️ lluvia en ' + place;
      text = 'Se viene lluvia fuerte en las próximas 3 horas. Guardá lo que tengas afuera y cerrá las ventanas. (Prueba)';
    }

    const kindOut = body.kind === 'hydro' ? 'flood' : body.kind === 'rain' ? 'rain' : 'alert';
    const r = await sendPush(env, rec.sub, title, text, 'test', kindOut, body.kind ? 2 : 0);
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

/* id corto, sin caracteres que se confundan al leerlo en voz alta */
function shortId() {
  const abc = '23456789abcdefghjkmnpqrstuvwxyz';
  const b = crypto.getRandomValues(new Uint8Array(7));
  let s = '';
  for (let i = 0; i < b.length; i++) s += abc[b[i] % abc.length];
  return s;
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

async function sharePage(url, env, ctx) {
  const cache = caches.default;
  const cached = await cache.match(url.href);
  if (cached) return cached;

  const token = url.pathname.slice('/alerta/'.length);
  let place = null;
  if (/^[a-z0-9]{6,10}$/i.test(token)) {
    try { place = await env.SUBS.get('sh:' + token, 'json'); } catch (e) { }
  } else {
    place = decodeToken(token); /* enlaces viejos con datos adentro */
  }
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
  <div class="foot">ASN 4.0 · datos abiertos</div>
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

/* --- lectura del nivel MEDIDO en la estación (Prefectura / INA) --- */
const INA_A5 = 'https://alerta.ina.gob.ar/a5/obs/puntual';
const HIST_FROM = '1990-01-01';

/* datos fijos de la estación: serie, umbrales y percentiles propios */
async function inaSeries(env, st) {
  const key = `ina:ser:v3:${st.id}`;
  const hit = await env.SUBS.get(key, 'json');
  if (hit) return hit;

  let out = null;
  try {
    const r = await fetch(`${INA_A5}/series?format=json&estacion_id=${st.id}`,
      { headers: { accept: 'application/json' } });
    if (r.ok) {
      const rows = await r.json();
      const list = (rows && rows.rows) || (Array.isArray(rows) ? rows : []);
      const row = list.find(x => x && x.var && x.var.var === 'H' && x.estacion);
      if (row) {
        const e = row.estacion || {};
        out = {
          seriesId: row.id,
          name: e.nombre || st.n,
          al: e.nivel_alerta != null ? Number(e.nivel_alerta) : st.al,
          ev: e.nivel_evacuacion != null ? Number(e.nivel_evacuacion) : st.ev,
          ab: e.nivel_aguas_bajas != null ? Number(e.nivel_aguas_bajas) : null
        };
      }
    }
  } catch (e) { }
  if (!out || out.seriesId == null) return null;

  /* percentiles propios: cómo se compara este nivel con SU historia */
  try {
    const u = `${INA_A5}/observaciones?format=json&series_id=${out.seriesId}` +
      `&timestart=${HIST_FROM}&timeend=${new Date().toISOString().slice(0, 10)}`;
    const r2 = await fetch(u, { headers: { accept: 'application/json' } });
    if (r2.ok) {
      const obs = await r2.json();
      const rows = (Array.isArray(obs) ? obs : [])
        .map(o => ({ d: String(o.timestart).slice(0, 10), v: Number(o.valor) }))
        .filter(x => isFinite(x.v))
        .sort((a, b) => a.d.localeCompare(b.d));
      const vals = rows.map(x => x.v);
      if (vals.length > 500) {
        const r2d = v => Math.round(v * 100) / 100;
        out.p90 = r2d(percentile(vals, 0.90));
        out.p95 = r2d(percentile(vals, 0.95));
        out.p99 = r2d(percentile(vals, 0.99));
        out.max = r2d(Math.max(...vals));
        out.histN = vals.length;
        /* días altos (>= p95) para poder decir "no se veía desde…" */
        out.above = rows.filter(x => x.v >= out.p95).map(x => [x.d, r2d(x.v)]);
      }
    }
  } catch (e) { }

  await env.SUBS.put(key, JSON.stringify(out), { expirationTtl: 7 * 86400 });
  return out;
}

/* nivel de hoy + tendencia de los últimos días */
async function inaNow(env, seriesId) {
  const key = `ina:now:v3:${seriesId}`;
  const hit = await env.SUBS.get(key, 'json');
  if (hit && Date.now() - hit.at < 45 * 60 * 1000) return hit;

  const end = new Date();
  const start = new Date(end.getTime() - 40 * 86400000);
  const u = `${INA_A5}/observaciones?format=json&series_id=${seriesId}` +
    `&timestart=${start.toISOString().slice(0, 10)}&timeend=${end.toISOString().slice(0, 10)}`;

  let rows = null;
  try {
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const arr = await r.json();
      rows = (Array.isArray(arr) ? arr : [])
        .map(o => ({ d: o.timestart, v: Number(o.valor) }))
        .filter(x => isFinite(x.v))
        .sort((a, b) => new Date(a.d) - new Date(b.d));
    }
  } catch (e) { }
  if (!rows || !rows.length) return null;

  const last = rows[rows.length - 1];
  const back = n => rows[Math.max(0, rows.length - 1 - n)].v;
  const d1 = rows.length > 1 ? last.v - back(1) : 0;
  const d3 = rows.length > 3 ? last.v - back(3) : 0;
  const d7 = rows.length > 7 ? last.v - back(7) : 0;
  const rd = v => Math.round(v * 100) / 100;
  const slope = rows.length > 3 ? d3 / 3 : 0;

  /* ¿sube, se quedó quieto o baja? */
  const trend = slope >= 0.10 ? { key: 'sube', word: 'subiendo rápido', arrow: '⬆' }
    : slope >= 0.03 ? { key: 'sube', word: 'subiendo', arrow: '⬆' }
      : slope > -0.03 ? { key: 'estable', word: 'estable', arrow: '➡' }
        : slope > -0.10 ? { key: 'baja', word: 'bajando', arrow: '⬇' }
          : { key: 'baja', word: 'bajando rápido', arrow: '⬇' };

  /* pico de las últimas 2 semanas: sirve para decir "lo peor ya pasó" */
  const win = rows.slice(-14);
  let peak = win[0];
  win.forEach(r => { if (r.v > peak.v) peak = r; });

  const out = {
    at: Date.now(), now: rd(last.v), date: last.d,
    d1: rd(d1), d3: rd(d3), d7: rd(d7),
    slope: Math.round(slope * 1000) / 1000,
    trend,
    peak: { v: rd(peak.v), date: peak.d },
    hist: win.map(r => [String(r.d).slice(5, 10), rd(r.v)]),
    n: rows.length
  };
  await env.SUBS.put(key, JSON.stringify(out), { expirationTtl: 3600 });
  return out;
}

/* 0..4 según qué tan alto está el agua frente a los umbrales de ESA estación */
function hydroLevel(r, s) {
  if (r == null || !s) return 0;
  if (s.ev != null) {
    if (r >= s.ev + 0.5) return 4;
    if (r >= s.ev) return 3;
    if (s.al != null && r >= s.al) return 2;
    if (s.al != null && r >= s.al - 0.8) return 1;
    return 0;
  }
  if (s.al != null) {
    if (r >= s.al + 0.5) return 3;
    if (r >= s.al) return 2;
    if (r >= s.al - 0.8) return 1;
    return 0;
  }
  if (s.p99 != null && r >= s.p99) return 3;
  if (s.p95 != null && r >= s.p95) return 2;
  if (s.p90 != null && r >= s.p90) return 1;
  return 0;
}

const fmtM = v => (v == null ? '' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' m');

/* texto llano, explicativo, sin jerga */
function hydroWords(level, o) {
  const r = o.now, al = o.al, ev = o.ev;
  const T = {
    0: ['El río está bajo', 'El río está en su nivel habitual para esta época.',
      'Podés seguir con tu vida normal.'],
    1: ['El río está subiendo', 'El río viene creciendo y se está acercando al nivel de alerta.',
      'Todavía no hay que evacuar. Si vivís cerca de la costa o en zona baja, estate atento.'],
    2: ['Alerta por crecida', 'El agua llegó al nivel de alerta: ya empieza a entrar en las zonas bajas y a cortar caminos.',
      'Sacá del piso lo que puedas y tené listo lo importante por si hay que salir. Evitá la costa.'],
    3: ['Crecida: hay que salir', 'El agua llegó al nivel de evacuación: las zonas bajas se inundan.',
      'Si estás en zona baja o cerca de la costa, salí y no vuelvas hasta que el agua baje. No cruces calles anegadas.'],
    4: ['Crecida grave', 'El agua ya pasó el nivel de evacuación y la zona baja está bajo agua.',
      'Si estás en zona baja o cerca de la costa, salí ahora. No vuelvas hasta que las autoridades lo confirmen. Pedí ayuda a Defensa Civil o a emergencias.']
  };
  const [headline, line, advice] = T[level] || T[0];

  /* --- piezas sueltas, para que la interfaz las acomode y no sea un ladrillo --- */
  const measured = r != null
    ? 'Hoy el agua está en ' + fmtM(r) +
      (() => {
        const refs = [];
        if (al != null) refs.push('alerta ' + fmtM(al));
        if (ev != null) refs.push('evacuación ' + fmtM(ev));
        return refs.length ? ' (' + refs.join(' · ') + ')' : '';
      })() + '.'
    : '';

  /* ¿hacía cuánto que no había tanta agua? */
  let history = '';
  if (r != null && Array.isArray(o.above) && o.above.length) {
    const prev = o.above.filter(x => x[1] >= r && x[0] < o.today);
    if (!prev.length) {
      history = 'No se veía un nivel así en toda la serie de la estación.';
    } else {
      const yr = prev[prev.length - 1][0].slice(0, 4);
      if (Number(yr) <= new Date().getFullYear() - 3) {
        history = 'No se veía un nivel así desde ' + yr + '.';
      }
    }
  }

  /* ¿el pico ya pasó? */
  const today = String(o.today || '').slice(0, 10);
  let peakTxt = '';
  const peakAge = o.peak && o.peak.date && today
    ? (new Date(today) - new Date(String(o.peak.date).slice(0, 10))) / 86400000
    : 99;
  if (o.peak && o.peak.date && String(o.peak.date).slice(0, 10) !== today &&
      r != null && peakAge <= 7) {
    const pd = String(o.peak.date).slice(0, 10);
    const when = pd.slice(8, 10) + '/' + pd.slice(5, 7);
    /* si todavía estamos en evacuación, no se puede decir "ya pasó" */
    peakTxt = level >= 3
      ? 'El pico fue el ' + when + ' con ' + fmtM(o.peak.v) + ', pero el agua sigue muy alta.'
      : 'Lo peor ya pasó: el pico fue el ' + when + ' con ' + fmtM(o.peak.v) + '.';
  }

  /* tendencia en una línea corta */
  const sl = o.slope || 0;
  const abs = fmtM(Math.abs(sl)).replace(' m', '');
  let trendTxt = '';
  if (o.trend && o.trend.key === 'sube') {
    trendTxt = 'Está subiendo ' + abs + ' m por día' +
      (sl >= 0.15 ? '; si sigue así, en 2 días podría llegar a ' + fmtM(r + sl * 2) : '') + '.';
  } else if (o.trend && o.trend.key === 'baja') {
    trendTxt = 'Está bajando ' + abs + ' m por día.';
  } else if (o.trend) {
    trendTxt = 'Está estable, sin cambios grandes.';
  }

  const detail = [measured, history, peakTxt, trendTxt].filter(Boolean).join(' ');

  return { headline, line, advice, detail, measured, history, peakTxt, trendTxt };
}

async function hydroFor(env, lat, lon) {
  const key = `hydro:v11:${lat.toFixed(3)},${lon.toFixed(3)}`;
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
    out.river = riverPoint.name + ' (' + String(riverPoint.d).replace('.', ',') + ' km)';
  } else {
    out.river = inaName || 'Río cercano';
  }
  out.riverPoint = riverPoint ? { lat: riverPoint.lat, lon: riverPoint.lon } : null;

  /* 1º: estación con umbrales oficiales cerca. 2º: la más cercana. */
  const probe = out.stations.find(s => s.al != null && s.d <= 30) || st;

  let src = null, obs = null;
  if (probe) {
    try {
      src = await inaSeries(env, probe);
      if (src) obs = await inaNow(env, src.seriesId);
    } catch (e) { }
  }

  if (obs && obs.now != null) {
    /* ---- fuente primaria: agua medida contra los umbrales de la estación ---- */
    out.source = 'ina';
    out.station = { id: probe.id, name: probe.n, d: Math.round(probe.d * 10) / 10 };
    out.now = obs.now;
    out.date = obs.date;
    out.al = src.al != null ? src.al : null;
    out.ev = src.ev != null ? src.ev : null;
    out.ab = src.ab != null ? src.ab : null;
    out.p99 = src.p99 != null ? src.p99 : null;
    out.maxHist = src.max != null ? src.max : null;
    out.d3 = obs.d3;
    out.d7 = obs.d7;
    out.slope = obs.slope;
    out.level = hydroLevel(obs.now, src);

    const w = hydroWords(out.level, {
      now: out.now, al: out.al, ev: out.ev, slope: out.slope,
      above: src.above, today: String(obs.date).slice(0, 10),
      trend: obs.trend, peak: obs.peak
    });
    out.headline = w.headline;
    out.plain = w.line;
    out.detail = w.detail;
    out.measured = w.measured;
    out.history = w.history;
    out.peakTxt = w.peakTxt;
    out.trendTxt = w.trendTxt;
    out.advice = w.advice;
    out.levelWord = ['normal', 'alto', 'alerta', 'evacuacion', 'grave'][out.level];

    /* datos para el gráfico de la tarjeta */
    out.trend = obs.trend;
    out.peak = obs.peak;
    out.hist = obs.hist;
    out.d1 = obs.d1;
    out.d3 = obs.d3;
    out.d7 = obs.d7;
    if (out.slope >= 0.05) out.proj48 = Math.round((out.now + out.slope * 2) * 100) / 100;
    const ceiling = Math.max(
      (out.ev != null ? out.ev : (out.al != null ? out.al : out.now)) + 1,
      out.now + 0.4
    );
    out.gauge = {
      min: 0, max: Math.round(ceiling * 100) / 100,
      al: out.al, ev: out.ev, now: out.now
    };
    out.river = (src.name || probe.n) +
      (probe.d != null ? ' (' + probe.d.toFixed(1).replace('.', ',') + ' km)' : '');
  } else {
    /* ---- respaldo: modelo global GloFAS (solo si no hay lectura local) ---- */
    out.source = 'glofas';
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

    const w = hydroWords(out.level, out);
    out.headline = w.headline;
    out.plain = w.line;
    out.detail = 'Estimado con un modelo regional: no hay medición directa cerca.';
    out.advice = w.advice;
    out.levelWord = ['normal', 'alto', 'alerta', 'evacuacion', 'grave'][out.level];
  }

  out.msg = out.plain;

  await env.SUBS.put(key, JSON.stringify(out), { expirationTtl: 1800 });
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
async function sendPush(env, sub, title, body, tag, kind = 'alert', level = 0) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE
  };
  const payload = await buildPushPayload(
    { data: JSON.stringify({ title, body, tag, kind, level, url: '/' }), options: { ttl: 3600, urgency: 'high' } },
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
              tag, ph.key, level
            );
          if (r === 'gone') { gone = true; break; }
          if (r === 'ok') rec.at[tag] = Date.now();
        }
        if (p.hydro) {
          const h = await hydroFor(env, p.lat, p.lon);
          const hk = tag + ':hydro';
          const hPrev = (rec.hydroLast && rec.hydroLast[hk]) || 0;
          const hQuiet = quietNow() && h.level < 2;
          rec.hydroAt = rec.hydroAt || {};
          rec.hydroTrend = rec.hydroTrend || {};
          const hLastAt = rec.hydroAt[hk] || 0;
          const trendKey = (h.trend && h.trend.key) || '';
          const prevTrend = rec.hydroTrend[hk] || '';
          const trendChanged = trendKey && trendKey !== prevTrend;

          /* 1) sube de nivel, o sigue en rojo/morado y ya pasaron 6 h */
          const hRepeat = h.level >= 3 && Date.now() - hLastAt >= 6 * 3600 * 1000;
          if (h.level >= 1 && (h.level > hPrev || hRepeat) && !hQuiet) {
            const L = LEVELS[h.level];
            const r2 = await sendPush(
              env, rec.sub,
              `${L.emoji} ${L.name} · 🌊 ${h.headline || 'Crecida cerca'}` +
              (h.river ? ' · ' + h.river : ''),
              h.plain + ' ' + (h.detail || '') + ' ' + (h.advice || '') +
              ' Cerca de ' + tag + '.',
              'hydro-' + hk, 'flood', h.level
            );
            if (r2 === 'gone') { gone = true; break; }
            if (r2 === 'ok') rec.hydroAt[hk] = Date.now();
          }

          /* 2) el río dejó de subir: aviso de alivio, sin bajar la guardia */
          if (trendChanged && trendKey === 'baja' && h.level >= 2 &&
              prevTrend !== '' && !hQuiet) {
            const r3 = await sendPush(
              env, rec.sub,
              `🌊 El río empezó a bajar · ${h.river || 'río cercano'}`,
              `${h.trendTxt || ''} Sigue alto, pero ya no sube. ` +
              `Todavía no vuelvas si saliste. Cerca de ${tag}.`,
              'hydro-' + hk, 'flood', h.level
            );
            if (r3 === 'gone') { gone = true; break; }
          }

          /* 3) volvió a su nivel habitual */
          if (hPrev >= 1 && h.level === 0 && !quietNow()) {
            const r4 = await sendPush(
              env, rec.sub,
              `🟢 El río volvió a su nivel habitual · ${h.river || 'río cercano'}`,
              `El agua bajó y la crecida terminó. Cerca de ${tag}.`,
              'hydro-' + hk, 'flood', 0
            );
            if (r4 === 'gone') { gone = true; break; }
          }

          if (trendKey) rec.hydroTrend[hk] = trendKey;
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









