/**
 * ASN 4.0 — Worker de Cloudflare
 * - Sirve la app estática (./public)
 * - Guarda suscripciones Web Push en KV
 * - Cron cada 10 min: calcula riesgo y envía push
 */
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { CUENCAS } from './cuenca-datos.js';
import { NIVEL_CUENCA } from './nivel-datos.js';
import { etaForPlace } from './storm-eta.js';

export default {
  async fetch(request, env, ctx) {
    const res = await route(request, env, ctx);
    return harden(res);
  },

  async scheduled(event, env, ctx) {
    /* latido: deja constancia de que el cron corrió, sin depender de nada local */
    ctx.waitUntil(env.SUBS.put('hb:cron', JSON.stringify({ at: Date.now() })));
    ctx.waitUntil(runAlerts(env));
    ctx.waitUntil(vigilar(env));
    /* el acta se guarda una vez por hora, en la primera pasada */
    if (new Date().getUTCMinutes() < 10) ctx.waitUntil(guardarActa(env));
    /* una foto por hora: es la materia prima para calibrar el tiempo de
       llegada, que hoy no se puede medir porque las tablas publicas solo
       guardan una ventana movil de 57 horas. */
    ctx.waitUntil(acumular(env));
    ctx.waitUntil(acumularBrasil(env));
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
    "img-src 'self' data: blob: https://tilecache.rainviewer.com https://server.arcgisonline.com https://gibs.earthdata.nasa.gov",
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

/* Límite por instancia, en memoria: suficiente para frenar abusos y
   no gasta ni una escritura del almacenamiento. */
const rlMem = new Map();
async function limited(env, ip, bucket, limit, secs) {
  const win = Math.floor(Date.now() / (secs * 1000));
  const key = `${bucket}:${ip}:${win}`;
  const n = (rlMem.get(key) || 0) + 1;
  if (rlMem.size > 4000) rlMem.clear();
  rlMem.set(key, n);
  return n > limit;
}

/* La caché es opcional: si el almacenamiento rechaza la escritura
   (cupo diario agotado), igual respondemos con el dato en vivo. */
async function kvPut(env, key, val, opts) {
  try {
    if (opts) await env.SUBS.put(key, val, opts);
    else await env.SUBS.put(key, val);
    return true;
  } catch (e) {
    console.error('kvPut fallo', key, String(e));
    return false;
  }
}
/* ---------------- Caché HTTP ----------------
   Las respuestas caras (río, estaciones, arroyos) se guardan en la caché
   de Cloudflare y no en KV: KV tiene 1.000 escrituras por día en el plan
   gratuito y se agota con pocos usuarios. La caché no consume ese cupo. */
const CACHE_HOST = 'https://asn.cache/';

async function cGet(key, maxAgeMs) {
  try {
    const res = await caches.default.match(new Request(CACHE_HOST + key));
    if (!res) return null;
    if (maxAgeMs) {
      const at = Number(res.headers.get('x-at') || 0);
      if (!at || Date.now() - at > maxAgeMs) return null;
    }
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function cPut(key, obj, ttlSec) {
  try {
    const res = new Response(JSON.stringify(obj), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'max-age=' + (ttlSec || 600),
        'x-at': String(Date.now())
      }
    });
    await caches.default.put(new Request(CACHE_HOST + key), res);
  } catch (e) { }
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

/* ---------------- Ensemble (51 miembros) ----------------
   Es la consulta más cara y la que provocaba los 429: la app pedía una
   por cada lugar, cada vez. Se resuelve así:
   - una sola consulta por zona, redondeando a 0,1° (≈11 km, más fino que
     la grilla de 0,25° del propio modelo, así que no se pierde nada);
   - guardada 30 minutos en la caché del borde;
   - si la fuente responde 429 o falla, se devuelve el último dato bueno
     en lugar de dejar al usuario sin pronóstico. */
const ENS_TTL = 30 * 60 * 1000;

function snap10(v) {
  return (Math.round(Number(v) * 10) / 10).toFixed(1);
}

function staleCopy(res) {
  return new Response(res.body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-at': res.headers.get('x-at') || '',
      'x-stale': '1'
    }
  });
}

async function ensProxy(lat, lon) {
  const la = snap10(lat), lo = snap10(lon);
  const key = CACHE_HOST + '/ens/' + la + ',' + lo;
  const cache = caches.default;

  let prev = null;
  try { prev = await cache.match(new Request(key)); } catch (e) { prev = null; }
  if (prev) {
    const at = Number(prev.headers.get('x-at') || 0);
    if (at && Date.now() - at < ENS_TTL) return prev;
  }

  /* Open-Meteo limita por IP y la salida de Cloudflare es una IP compartida:
     cuando contesta 429 no tiene sentido volver a intentar en cada refresco
     de cada usuario. Una marca de "en pausa" corta el golpeteo 10 minutos. */
  const pauseKey = key + '/down';
  try {
    const down = await cache.match(new Request(pauseKey));
    if (down) {
      const at = Number(down.headers.get('x-at') || 0);
      if (at && Date.now() - at < 10 * 60 * 1000) {
        if (prev) return staleCopy(prev);
        return json({ error: 'ensemble en pausa' }, 503);
      }
    }
  } catch (e) { }

  const t = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  t.searchParams.set('latitude', la);
  t.searchParams.set('longitude', lo);
  t.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
  t.searchParams.set('models', 'ecmwf_ifs025');
  t.searchParams.set('forecast_hours', '4');
  t.searchParams.set('timezone', 'auto');
  t.searchParams.set('wind_speed_unit', 'kmh');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  let r = null, body = '';
  try {
    r = await fetch(t.toString(), { signal: ctl.signal, headers: { accept: 'application/json' } });
    body = await r.text();
  } catch (e) {
    clearTimeout(timer);
    try {
      await cache.put(new Request(pauseKey), new Response('1', { headers: { 'x-at': String(Date.now()) } }));
    } catch (err) { }
    return prev ? staleCopy(prev) : json({ error: 'ensemble no disponible' }, 502);
  }
  clearTimeout(timer);

  if (!r.ok) {
    /* 429 o error de la fuente: mejor el dato de hace un rato que nada */
    try {
      await cache.put(new Request(pauseKey), new Response('1', { headers: { 'x-at': String(Date.now()) } }));
    } catch (e) { }
    if (prev) return staleCopy(prev);
    return new Response(body || JSON.stringify({ error: 'ensemble HTTP ' + r.status }), {
      status: r.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  const out = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=1800',
      'x-at': String(Date.now())
    }
  });
  try {
    await cache.put(new Request(key), out.clone());
    await cache.delete(new Request(pauseKey));
  } catch (e) { }
  return out;
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
    t.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m');
    t.searchParams.set('daily', 'sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code');
    t.searchParams.set('forecast_days', '7');
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
    return await ensProxy(lat, lon);
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
    '/api/cuenca': [60, 'cuenca'],
    '/api/dictamen': [60, 'dictamen'],
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
      hydroLast: (prev && prev.hydroLast) || {},
      owner: body.owner === true ? true : body.owner === false ? false : !!(prev && prev.owner)
    };
    const guardado = await kvPut(env, key, JSON.stringify(rec));
    /* si no se guardó, no se puede prometer que los avisos van a llegar */
    return json({ ok: guardado, id, places: places.length }, guardado ? 200 : 503);
  }

  if (url.pathname === '/api/unsubscribe' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.endpoint) return json({ error: 'falta endpoint' }, 400);
    await env.SUBS.delete('sub:' + await hash(body.endpoint));
    return json({ ok: true });
  }

  /* Métricas mínimas: sin IP, sin nombre, sin coordenadas. */
  if (url.pathname === '/api/ping' && req.method === 'POST') {
    let b = null;
    try { b = await req.json(); } catch (e) { }
    if (!b) return json({ ok: false }, 400);
    const day = new Date().toISOString().slice(0, 10);
    const key = 'stats/' + day + '.json';
    let cur = { d: day, total: 0, s: 0, w: 0, prov: {}, ver: {}, plat: {} };
    try {
      const o = await env.NOWCAST.get(key);
      if (o) cur = JSON.parse(await o.text());
    } catch (e) { }
    cur.total++;
    if (b.m === 's') cur.s++; else cur.w++;
    const inc = (obj, k) => { if (!k) return; k = String(k).slice(0, 28); obj[k] = (obj[k] || 0) + 1; };
    cur.prov = cur.prov || {}; cur.ver = cur.ver || {}; cur.plat = cur.plat || {};
    inc(cur.prov, b.p); inc(cur.ver, b.v); inc(cur.plat, b.pf);
    try { await env.NOWCAST.put(key, JSON.stringify(cur)); } catch (e) { }
    return json({ ok: true });
  }

    /* Vigilancia del propio sistema: si el cron o el acumulador se detienen,
       esto lo dice sin que nadie tenga la computadora prendida. */
    if (url.pathname === '/api/health') {
      return json(await healthData(env));
    }

    /* acta de auditoría: la última guardada, o una nueva con ?run=1 */
    if (url.pathname === '/api/audit') {
      if (url.searchParams.get('run') === '1') return json(await guardarActa(env));
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const k = 'audit/' + new Date(now - i * 3600000).toISOString().slice(0, 13) + '.json';
        try {
          const o = await env.NOWCAST.get(k);
          if (o) return new Response(o.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'x-at': k } });
        } catch (e) { }
      }
      return json(await auditData(env));
    }

    /* Uso y valoraciones. Los números exactos se muestran sólo al dueño
       (clave en OWNER_KEY); el resto ve los agregados recién cuando hay
       masa crítica: 100 dispositivos y 100 valoraciones. */
    if (url.pathname === '/api/metrics') {
      let users = 0;
      try {
        let cursor = null;
        do {
          const page = await env.SUBS.list({ prefix: 'sub:', cursor });
          users += (page.keys || []).length;
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
      } catch (e) { }

      let n = 0, sum = 0, dist = [0, 0, 0, 0, 0];
      try {
        const page = await env.SUBS.list({ prefix: 'rate:' });
        for (const k of (page.keys || []).slice(0, 900)) {
          const r = await env.SUBS.get(k.name, 'json');
          if (!r || !r.stars) continue;
          n++; sum += r.stars; dist[Math.min(4, Math.max(0, r.stars - 1))]++;
        }
      } catch (e) { }

      /* dónde se usa: provincia declarada por el lugar guardado */
      const prov = {};
      try {
        const page = await env.SUBS.list({ prefix: 'use:' });
        for (const k of (page.keys || []).slice(0, 900)) {
          const u = await env.SUBS.get(k.name, 'json');
          const p = u && u.prov ? String(u.prov).slice(0, 40) : 'Sin provincia';
          prov[p] = (prov[p] || 0) + 1;
        }
      } catch (e) { }
      const provincias = Object.keys(prov)
        .map(p => ({ p, n: prov[p] }))
        .sort((a, b) => b.n - a.n);

      const avg = n ? Math.round(sum / n * 10) / 10 : null;
      const publico = { users: users >= 100 ? users : null, ratings: n >= 100 ? n : null, avg: n >= 100 ? avg : null };
      const owner = url.searchParams.get('k') && env.OWNER_KEY && url.searchParams.get('k') === env.OWNER_KEY;

      /* limpieza de las filas de prueba (no cuentan como usuarios reales) */
      if (owner && url.searchParams.get('clean') === '1') {
        for (const t of ['prueba-destino-123', 'prueba-prov-1']) {
          const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
          const id = [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
          try { await env.SUBS.delete('rate:' + id); await env.SUBS.delete('use:' + id); } catch (e) { }
        }
      }
      return json(owner ? { users, ratings: n, avg, dist, provincias, publico } : { publico });
    }

    if (url.pathname === '/api/use' && req.method === 'POST') {
      const b = await req.json().catch(() => null);
      if (!b || !b.device) return json({ error: 'falta device' }, 400);
      const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(b.device)));
      const id = [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
      try { await env.SUBS.put('use:' + id, JSON.stringify({ prov: String(b.prov || '').slice(0, 40), at: Date.now() })); } catch (e) { return json({ error: 'no se pudo guardar' }, 500); }
      return json({ ok: true });
    }

    if (url.pathname === '/api/rate' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const stars = Number(body && body.stars);
      if (!body || !body.endpoint || !(stars >= 1 && stars <= 5)) return json({ error: 'datos inválidos' }, 400);
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(body.endpoint)));
      const id = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
      try {
        await env.SUBS.put('rate:' + id, JSON.stringify({ stars: Math.round(stars), at: Date.now() }));
      } catch (e) { return json({ error: 'no se pudo guardar' }, 500); }
      return json({ ok: true });
    }

    if (url.pathname === '/api/stats') {
    const day = new Date().toISOString().slice(0, 10);
    let cur = null;
    try {
      const o = await env.NOWCAST.get('stats/' + day + '.json');
      if (o) cur = JSON.parse(await o.text());
    } catch (e) { }
    const base = cur || { d: day, total: 0, s: 0, w: 0, prov: {}, ver: {}, plat: {} };
    const days = [];
    try {
      const list = await env.NOWCAST.list({ prefix: 'stats/', limit: 60 });
      const keys = list.objects.map(o => o.key).sort().slice(-14);
      for (const k of keys) {
        const o = await env.NOWCAST.get(k);
        if (!o) continue;
        const j = JSON.parse(await o.text());
        days.push({ d: j.d, t: j.total || 0, s: j.s || 0, w: j.w || 0 });
      }
    } catch (e) { }
    return json(Object.assign({}, base, { days }));
  }

  /* Nowcast: la ingesta publica cada 10 minutos; la app solo lee. */
  if (url.pathname === '/api/nowcast') {
    if (req.method === 'GET') {
      try {
        const obj = await env.NOWCAST.get('nowcast.json');
        if (!obj) return json({ disponible: false });
        return new Response(await obj.text(), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
        });
      } catch (e) {
        return json({ disponible: false });
      }
    }
    if (req.method === 'POST') {
      if (req.headers.get('x-asn-key') !== env.NOWCAST_KEY) {
        return json({ error: 'no autorizado' }, 401);
      }
      const body = await req.text();
      if (body.length > 250000) return json({ error: 'muy grande' }, 413);
      try { JSON.parse(body); } catch (e) { return json({ error: 'json inválido' }, 400); }
      await env.NOWCAST.put('nowcast.json', body, {
        httpMetadata: { contentType: 'application/json' }
      });
      const prueba = await env.NOWCAST.get('nowcast.json');
      return json({ ok: !!prueba, bytes: body.length });
    }
  }

  if (url.pathname === '/api/rivers' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
    return json(await riversNear(env, lat, lon));
  }

  if (url.pathname === '/api/brasil' && req.method === 'GET') {
    if (!env.NOWCAST) return json({ error: 'sin almacenamiento' }, 500);
    if (url.searchParams.get('run') === '1') {
      try { await acumularBrasil(env); } catch (e) { }
    }
    if (env.SUBS) {
      const kv = await env.SUBS.get('brasil:latest', 'json');
      if (kv) return json({ ok: true, ...kv, origen: 'kv' });
    }
    const l = await env.NOWCAST.list({ prefix: 'acum/brasil/', limit: 1000 });
    const keys = (l.objects || []).map(o => o.key).sort();
    if (!keys.length) return json({ ok: false, motivo: 'sin calculo todavia' });
    const obj = await env.NOWCAST.get(keys[keys.length - 1]);
    const data = obj ? JSON.parse(await obj.text()) : null;
    return json({ ok: !!data, ...(data || {}), archivos: keys.length });
  }

  if (url.pathname === '/api/acumulado' && req.method === 'GET') {
    let corrida = null;
    if (url.searchParams.get('run') === '1') {
      try { corrida = await acumular(env); } catch (e) { corrida = { error: String(e && e.message) }; }
    }
    if (!env.NOWCAST) return json({ error: 'sin almacenamiento' }, 500);
    const l = await env.NOWCAST.list({ prefix: 'acum/v1/', limit: 1000 });
    const keys = (l.objects || []).map(o => o.key).sort();
    return json({
      corrida,
      objetos: keys.length,
      primero: keys[0] || null,
      ultimo: keys[keys.length - 1] || null,
      truncado: !!l.truncated
    });
  }

  if (url.pathname === '/api/dictamen' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
    return json(await dictamen(env, lat, lon));
  }

  if (url.pathname === '/api/cuenca' && req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return json({ error: 'faltan coordenadas' }, 400);
    return json(await cuencaFor(env, lat, lon));
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

function phenEmoji(s) {
  const t = String(s || '');
  if (/crecid|inund|agua|rio/.test(t)) return '🌊';
  if (/lluv|llovizn/.test(t)) return '🌧️';
  if (/vient|rafag/.test(t)) return '💨';
  if (/graniz/.test(t)) return '🧊';
  if (/niev/.test(t)) return '❄️';
  if (/torment|electr|ray/.test(t)) return '⛈️';
  return '⚠️';
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
  const parts = token.split('/').filter(Boolean);
  let place = null;

  /* enlace legible: /alerta/4/crecida-grave/-27.27/-58.24/casa */
  if (parts.length >= 4 && /^[0-4]$/.test(parts[0])) {
    const lat = Number(parts[2]);
    const lon = Number(parts[3]);
    if (isFinite(lat) && isFinite(lon)) {
      const phSlug = parts[1] || '';
      let nm = 'Mi lugar';
      try { nm = decodeURIComponent(parts[4] || '').replace(/-/g, ' ').trim() || 'Mi lugar'; } catch (e) { }
      nm = nm.charAt(0).toUpperCase() + nm.slice(1);
      place = {
        l: Number(parts[0]),
        p: phSlug.replace(/-/g, ' '),
        e: phenEmoji(phSlug),
        n: nm,
        a: '',
        lat: lat,
        lon: lon
      };
    }
  } else if (/^[a-z0-9]{6,10}$/i.test(token)) {
    try { place = await env.SUBS.get('sh:' + token, 'json'); } catch (e) { } /* enlaces ya compartidos */
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
        await kvPut(env, 'ina:stations:v2', JSON.stringify(list), { expirationTtl: 86400 });
      }
    } catch (e) { }
  }
  if (!list) return [];
  /* antes se exigía s.r (nombre de río): eso descartaba estaciones con serie
     de nivel pero sin el campo "rio" cargado en INA (Las Tapias, Tercero -
     Villa María, Anizacate). Ahora se filtra solo por distancia y la serie
     se verifica más adelante. */
  return list
    .map(s => ({ ...s, d: distKm(lat, lon, s.lat, s.lon) }))
    .filter(s => s.d <= 90)
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
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
  const hit = await cGet(key);
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
  if (list.length) await cPut(key, list, 604800);
  return list;
}

/* --- lectura del nivel MEDIDO en la estación (Prefectura / INA) --- */
const INA_A5 = 'https://alerta.ina.gob.ar/a5/obs/puntual';
const HIST_FROM = '1990-01-01';

/* datos fijos de la estación: serie, umbrales y percentiles propios */
async function inaSeries(env, st) {
  const key = `ina:ser:v3:${st.id}`;
  /* la serie histórica es cara (trae años de datos) y cambia poco:
     se guarda en KV, que es global, para que ningún nodo la vuelva a pedir.
     Una escritura por estación cada 7 días no mueve la aguja. */
  let hit = null;
  try { hit = await env.SUBS.get(key, 'json'); } catch (e) { }
  if (!hit) hit = await cGet(key);
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
      if (vals.length >= 120) {
        const r2d = v => Math.round(v * 100) / 100;
        out.p90 = r2d(percentile(vals, 0.90));
        out.p95 = r2d(percentile(vals, 0.95));
        out.p99 = r2d(percentile(vals, 0.99));
        /* Math.max(...vals) revienta la pila con series de decenas de miles
           de lecturas: el error se tragaba el try y la estación quedaba sin
           percentiles, que luego se leía como "río bajo". */
        out.max = r2d(vals.reduce((a, b) => (b > a ? b : a), -Infinity));
        out.histN = vals.length;
        out.thin = vals.length < 365;
        /* días altos (>= p95) para poder decir "no se veía desde…" */
        out.above = rows.filter(x => x.v >= out.p95).map(x => [x.d, r2d(x.v)]);
      }
    }
  } catch (e) { }

  await cPut(key, out, 7 * 86400);
  await kvPut(env, key, JSON.stringify(out), { expirationTtl: 7 * 86400 });
  return out;
}

/* nivel de hoy + tendencia de los últimos días */
async function inaNow(env, seriesId) {
  const key = `ina:now:v3:${seriesId}`;
  const hit = await cGet(key, 45 * 60 * 1000);
  if (hit) return hit;

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

  /* cuántas horas pasaron desde la última lectura: una medición vieja no es
     una medición de hoy y no puede sostener un "está bajo". */
  const ageH = Math.max(0, (Date.now() - new Date(last.d).getTime()) / 3600000);

  const out = {
    at: Date.now(), now: rd(last.v), date: last.d,
    ageH: Math.round(ageH * 10) / 10,
    d1: rd(d1), d3: rd(d3), d7: rd(d7),
    slope: Math.round(slope * 1000) / 1000,
    trend,
    peak: { v: rd(peak.v), date: peak.d },
    hist: win.map(r => [String(r.d).slice(5, 10), rd(r.v)]),
    n: rows.length
  };
  await cPut(key, out, 3600);
  return out;
}

/* 0..4 según qué tan alto está el agua frente a los umbrales de ESA estación.
   Devuelve null cuando no hay referencia: sin umbrales ni percentiles no se
   puede afirmar que el río esté bajo. */
function hydroLevel(r, s) {
  if (r == null || !s) return null;
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
  if (s.p95 == null && s.p90 == null) return null;
  return 0;
}

const fmtM = v => (v == null ? '' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' m');

/* texto llano, explicativo, sin jerga */
function hydroWords(level, o) {
  const r = o.now, al = o.al, ev = o.ev;
  /* sin medición no se afirma calma: "nivel habitual" sería una invención */
  if (r == null) return ['Sin dato del río', 'No hay una medición disponible para este río en este momento.', 'No lo damos por tranquilo: si estás cerca del agua, mirá cómo está.'];
  const T = {
    0: ['El río está bajo', 'El río está en su nivel habitual para esta época.',
      'Podés seguir con tu vida normal.'],
    1: ['El río está subiendo', 'El río viene creciendo y se está acercando al nivel de alerta.',
       'Si vivís cerca de la costa o en zona baja, estate atento y seguí las indicaciones de Defensa Civil.'],
    2: ['Alerta por crecida', 'El agua llegó al nivel de alerta: ya empieza a entrar en las zonas bajas y a cortar caminos.',
       'Tené a mano lo importante y evitá la costa. Seguí las indicaciones de Defensa Civil.'],
    3: ['Crecida: el agua llegó al nivel de evacuación', 'El agua llegó al nivel de evacuación: las zonas bajas se inundan.',
       'Si estás en zona baja o cerca de la costa, tomá precauciones y seguí las indicaciones de Defensa Civil. Evitá cruzar calles anegadas.'],
    4: ['Crecida grave', 'El agua ya pasó el nivel de evacuación y la zona baja está bajo agua.',
       'Si estás en zona baja o cerca de la costa, buscá un lugar seguro y seguí las indicaciones de Defensa Civil. Evitá cruzar calles anegadas.']
  };
  const [headline, line, advice] = T[level] || T[0];

  /* --- piezas sueltas, para que la interfaz las acomode y no sea un ladrillo --- */
  const measured = r != null
    ? (r < 0
      ? 'Hoy el agua está ' + fmtM(Math.abs(r)) + ' por debajo del cero de la escala, que es habitual en esta estación'
      : 'Hoy el agua está en ' + fmtM(r)) +
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
  const key = `hydro:v12:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = await cGet(key, 30 * 60 * 1000);
  if (hit) return hit;

  const out = { at: Date.now(), level: 0, q: null, p90: null, p95: null, rain48: 0, stations: [], river: null, msg: '' };

  let riverPoint = null;
  try {
    const cachedRivers = await cGet(`rivers:v3:${lat.toFixed(2)},${lon.toFixed(2)}`);
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
    /* estos percentiles son de CAUDAL (m³/s), no de altura del agua.
       Antes se guardaban en p90/p95 y se mezclaban con los de nivel. */
    out.q90 = percentile(past, 0.9);
    out.q95 = percentile(past, 0.95);
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

  /* Se prueban varias estaciones cercanas hasta dar con una que tenga serie
     de nivel con datos. Antes se elegía una sola y, si no servía, se caía al
     modelo global aunque hubiera un río medido a pocos kilómetros. */
  let probe = null, src = null, obs = null, bestScore = null;
  for (const cand of out.stations.slice(0, 6)) {
    try {
      const s2 = await inaSeries(env, cand);
      if (!s2) continue;
      const o2 = await inaNow(env, s2.seriesId);
      if (!o2 || o2.now == null) continue;
      /* no alcanza con que exista una serie: Villa María tiene una vieja que
         terminó en 2022 y otra al lado que llega a hoy. Se prefiere la
         lectura fresca, después la que tiene historial, después la más cerca. */
      const score = (o2.ageH != null && o2.ageH <= 24 ? 0 : 1000) +
        (s2.histN != null && s2.histN >= 120 ? 0 : 100) + cand.d;
      if (bestScore == null || score < bestScore) {
        bestScore = score; probe = cand; src = s2; obs = o2;
      }
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
    out.p90 = src.p90 != null ? src.p90 : null;
    out.p95 = src.p95 != null ? src.p95 : null;
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

    /* Sin umbrales de referencia, o con una lectura vieja, no se puede decir
       que el río esté bajo. La falta de dato no se traduce en calma. */
    const stale = obs.ageH != null && obs.ageH > 24;
    if (out.level == null || stale) {
      out.stale = !!stale;
      const d0 = String(obs.date).slice(0, 10).split('-');
      out.headline = stale ? 'Sin dato actualizado del río' : 'Sin dato suficiente del río';
      out.plain = stale
        ? 'La última medición de esta estación es del ' + d0[2] + '/' + d0[1] + '.'
        : 'Hay una lectura, pero la estación no tiene historial suficiente para compararla.';
      out.detail = 'No convertimos la falta de referencia en tranquilidad.';
      out.advice = 'Si estás cerca del agua, mirá cómo está y no cruces zonas anegadas.';
      out.levelWord = 'sin_dato';
      out.level = null;
    }

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
    const q = out.q, p90 = out.q90 || 0, p95 = out.q95 || 0;
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
    /* sin estación y sin caudal modelado no se puede afirmar "bajo" */
    if (out.now == null) {
      w.headline = 'Sin dato del río';
      w.line = 'No hay medición disponible para este río en este momento.';
    }
    out.headline = w.headline;
    out.plain = w.line;
    out.detail = 'Estimado con un modelo regional: no hay medición directa cerca.';
    out.advice = w.advice;
    out.levelWord = ['normal', 'alto', 'alerta', 'evacuacion', 'grave'][out.level];
  }

  out.msg = out.plain;

  await cPut(key, out, 1800);
  return out;
}

/* ---------------- Pronóstico ---------------- */
async function forecast(env, place) {
  /* misma zona, misma consulta: el cron atiende varios suscriptores y no
     tiene por qué pedir el mismo ensemble una vez por cada uno */
  const la = snap10(place.lat), lo = snap10(place.lon);
  const ckey = 'fc/' + la + ',' + lo;
  const hit = await cGet(ckey, 20 * 60 * 1000);
  if (hit && hit.hourly) return hit.hourly;

  const u = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  u.searchParams.set('latitude', la);
  u.searchParams.set('longitude', lo);
  u.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
  u.searchParams.set('models', 'ecmwf_ifs025');
  u.searchParams.set('forecast_hours', '4');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('open-meteo HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly) throw new Error('sin datos');
  await cPut(ckey, { hourly: j.hourly }, 1800);
  return j.hourly;
}

function probabilities(H) {
  const ids = Object.keys(H)
    .filter(k => /^precipitation_member\d+$/.test(k))
    .map(k => k.replace('precipitation_member', ''));
  /* Un miembro sin dato no es un miembro con cero lluvia: si se contara
     como cero, un ensemble incompleto diría "calma" sin respaldo. */
  const sum3 = key => {
    const a = H[key] || [];
    let s = 0, any = false;
    for (let i = 0; i < 3; i++) {
      const v = a[i];
      if (v != null) { s += v; any = true; }
    }
    return any ? s : null;
  };
  const rawRains = ids.map(id => sum3('precipitation_member' + id));
  const known = rawRains.filter(v => v != null).length;
  const rains = rawRains.filter(v => v != null);
  const gusts = ids.map(id => {
    const a = (H['wind_gusts_10m_member' + id] || []).slice(0, 3).filter(v => v != null);
    return a.length ? Math.max(...a) : null;
  }).filter(v => v != null);
  const p = (arr, th) => arr.length ? arr.filter(v => v >= th).length / arr.length : 0;
  return {
    n: ids.length, known,
    /* conteos internos por umbral: no se muestran al usuario */
    n15: rains.filter(v => v >= 15).length,
    n30: rains.filter(v => v >= 30).length,
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

function durText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

function quietNow() {
  const h = Number(new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba', hour: 'numeric', hour12: false
  }).format(new Date()));
  return h >= 23 || h < 7;
}

/* ---------------- Push ---------------- */
function horaReporte() {
  /* misma hora que muestra el encabezado de la app */
  return new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
}

async function sendPush(env, sub, title, body, tag, kind = 'alert', level = 0) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE
  };
  const payload = await buildPushPayload(
    { data: JSON.stringify({ title, body: body + ' \u00b7 ' + horaReporte(), tag, kind, level, icon: '/icon-192.png', badge: '/notif-96.png', url: '/' }), options: { ttl: 3600, urgency: 'high' } },
    sub,
    vapid
  );
  const res = await fetch(sub.endpoint, payload);
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) return 'error:' + res.status;
  return 'ok';
}

/* ---------------- Vigilancia del sistema ----------------
   No depende de ninguna computadora: lo corre el mismo cron de Cloudflare y
   avisa por push sólo a los teléfonos marcados como "avisos técnicos". */
async function healthData(env) {
  const now = Date.now();
  let hb = null, hba = null;
  try { hb = await env.SUBS.get('hb:cron', 'json'); } catch (e) { hb = null; }
  try { hba = await env.SUBS.get('hb:acum', 'json'); } catch (e) { hba = null; }
  const cronMin = hb && hb.at ? Math.round((now - hb.at) / 60000) : null;

  let acumMin = null, acumKey = null;
  for (let i = 0; i < 4 && acumMin == null; i++) {
    const k = 'acum/v1/' + new Date(now - i * 3600000).toISOString().slice(0, 13) + '.json';
    try {
      const o = await env.NOWCAST.head(k);
      if (o && o.uploaded) { acumKey = k; acumMin = Math.round((now - o.uploaded.getTime()) / 60000); }
    } catch (e) { }
  }
  /* si R2 no contesta, el latido del acumulador dice lo mismo */
  if (acumMin == null && hba && hba.at) {
    acumMin = Math.round((now - hba.at) / 60000);
    acumKey = hba.key || null;
  }

  const cronOk = cronMin == null ? null : cronMin <= 25;
  const acumOk = acumMin != null && acumMin <= 100;
  return {
    ok: acumOk && (cronOk === null ? true : cronOk),
    cronOk, acumOk, cronMin, acumMin, acumKey,
    cron: hb && hb.at ? new Date(hb.at).toISOString() : null
  };
}

async function pushOwner(env, title, body) {
  let cursor = null, enviados = 0;
  do {
    let page = null;
    try { page = await env.SUBS.list({ prefix: 'sub:', cursor }); } catch (e) { break; }
    for (const k of page.keys || []) {
      let rec = null;
      try { rec = await env.SUBS.get(k.name, 'json'); } catch (e) { rec = null; }
      if (!rec || !rec.owner || !rec.sub) continue;
      const r = await sendPush(env, rec.sub, title, body, 'sistema');
      if (r === 'ok') enviados++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return enviados;
}

async function vigilar(env) {
  const h = await healthData(env);
  let st = null;
  try { st = await env.SUBS.get('tech:state', 'json'); } catch (e) { st = null; }
  const now = Date.now();

  if (!h.ok) {
    /* un aviso cada 6 h como máximo, para no volverse molesto */
    if (!(st && st.failing && st.at && now - st.at < 6 * 3600 * 1000)) {
      const cuanto = h.acumMin == null ? 'un rato' : h.acumMin + ' minutos';
      await pushOwner(env, '⚙️ ASN · algo dejó de actualizar',
        `Los datos no se están guardando desde hace ${cuanto}. Las alertas pueden estar viejas.`);
      try { await env.SUBS.put('tech:state', JSON.stringify({ failing: true, at: now })); } catch (e) { }
    }
  } else if (st && st.failing) {
    await pushOwner(env, '⚙️ ASN · volvió a la normalidad',
      'Los datos se están actualizando otra vez.');
    try { await env.SUBS.put('tech:state', JSON.stringify({ failing: false, at: now })); } catch (e) { }
  }
}

/* ---------------- Acta de auditoría ----------------
   No decide alertas: deja constancia, hora por hora, de qué respondió cada
   fuente, con qué antigüedad, y si el sistema es coherente consigo mismo.
   Veredicto por fuente: confirmado / sin dato / contradicho. */
async function auditData(env) {
  const now = Date.now();
  const fuentes = [];

  const h = await healthData(env);
  fuentes.push({
    fuente: 'cron',
    estado: h.cronOk === false ? 'contradicho' : h.cronOk === null ? 'sin_dato' : 'confirmado',
    edad_min: h.cronMin,
    detalle: h.cron || 'sin latido'
  });
  fuentes.push({
    fuente: 'acumulador_lluvia',
    estado: h.acumOk ? 'confirmado' : 'contradicho',
    edad_min: h.acumMin,
    detalle: h.acumKey || 'sin objeto en R2'
  });

  const punto = { lat: -31.42, lon: -64.19 };
  try {
    const hourly = await forecast(env, punto);
    const pb = probabilities(hourly);
    fuentes.push({
      fuente: 'ensemble_ecmwf',
      estado: pb.known ? 'confirmado' : 'sin_dato',
      edad_min: 0,
      detalle: pb.known
        ? pb.known + ' miembros · ' + Math.round(pb.rain15 * 100) + '% ve más de 15 mm en 3 h'
        : 'sin miembros con dato'
    });
  } catch (e) {
    fuentes.push({ fuente: 'ensemble_ecmwf', estado: 'sin_dato', edad_min: null, detalle: 'HTTP ' + (e.message || 'error') });
  }

  try {
    const hy = await hydroFor(env, punto.lat, punto.lon);
    /* un nivel de decenas de metros en Córdoba es imposible: si aparece, la
       estación emparejada no corresponde a la zona y no se puede dar por bueno */
    const absurdo = hy && hy.now != null && hy.now > 10;
    fuentes.push({
      fuente: 'nivel_rio',
      estado: !hy || hy.now == null ? 'sin_dato' : absurdo ? 'contradicho' : 'confirmado',
      edad_min: null,
      detalle: hy && hy.now != null
        ? (hy.river || 'estación') + ' · ' + hy.now.toFixed(2) + ' m' +
          (absurdo ? ' · fuera de rango para esta zona' : '')
        : 'sin lectura'
    });
  } catch (e) {
    fuentes.push({ fuente: 'nivel_rio', estado: 'sin_dato', edad_min: null, detalle: 'falló la consulta' });
  }

  /* coherencia interna: si el cron late pero el acumulador no, algo se rompió */
  const cronOk = fuentes.find(f => f.fuente === 'cron').estado;
  const acumOk = fuentes.find(f => f.fuente === 'acumulador_lluvia').estado;
  const cruces = [{
    cruce: 'cron vs acumulador',
    resultado: cronOk === 'confirmado' && acumOk !== 'confirmado' ? 'contradicho' : 'coherente',
    nota: cronOk === 'confirmado' && acumOk !== 'confirmado'
      ? 'el ciclo corre pero no guarda'
      : 'sin contradicción'
  }];

  const contradichas = fuentes.filter(f => f.estado === 'contradicho').length +
    cruces.filter(c => c.resultado === 'contradicho').length;

  return {
    hora: new Date(now).toISOString().slice(0, 13) + ':00Z',
    ok: contradichas === 0 && fuentes.every(f => f.estado !== 'sin_dato'),
    contradichas,
    fuentes, cruces
  };
}

async function guardarActa(env) {
  try {
    const a = await auditData(env);
    const k = 'audit/' + a.hora.slice(0, 13) + '.json';
    await env.NOWCAST.put(k, JSON.stringify(a), { httpMetadata: { contentType: 'application/json' } });
    return a;
  } catch (e) { return null; }
}

async function runAlerts(env) {
  /* el nowcast se lee una sola vez por corrida: si está viejo, no se usa */
  let nc = null, ncOk = false;
  try {
    const o = await env.NOWCAST.get('nowcast.json');
    if (o) {
      nc = JSON.parse(await o.text());
      ncOk = !!(nc.generado && Date.now() - Date.parse(nc.generado) < 30 * 60 * 1000);
    }
  } catch (e) { nc = null; }
  const list = await env.SUBS.list({ prefix: 'sub:' });
  for (const k of list.keys) {
    const raw = await env.SUBS.get(k.name);
    let rec = null;
    try { rec = raw ? JSON.parse(raw) : null; } catch (e) { rec = null; }
    if (!rec || !rec.sub || !Array.isArray(rec.places)) continue;
    let gone = false;

    for (const p of rec.places) {
      const tag = p.name || (p.lat + ',' + p.lon);
      try {
        const pb = probabilities(await forecast(env, p));
        /* Sin miembros con dato no hay dictamen del clima: ni alerta
           inventada ni un "bajó la alerta" falso. Se deja el último estado
           conocido y se sigue con el río, que se mide aparte. */
        if (pb.known) {
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

          rec.since = rec.since || {};
          if (level >= 1 && prev < 1) rec.since[tag] = Date.now();
          const since = rec.since[tag] || 0;
          /* el aviso habla de lo que va a pasar, no de cómo lo calculamos */
          const sigue = level >= 1 && since && Date.now() - since > 10 * 60000
            ? ' Sigue desde hace ' + durText(Date.now() - since) + '.'
            : '';

          if (should && !quietBlock) {
            const r = recovered
              ? await sendPush(env, rec.sub, `🟢 Sin alerta en ${tag}`,
                'Bajó la alerta: el pronóstico ya no muestra lluvia ni viento fuerte. Podés seguir con normalidad.', tag)
              : await sendPush(
                env, rec.sub,
                `${LEVELS[level].emoji} ${LEVELS[level].name} · ${ph.emoji} ${ph.word} en ${tag}`,
                `${ph.word} en las próximas 3 horas.${sigue} Abrí ASN para ver el detalle.`,
                tag, ph.key, level
              );
            if (r === 'gone') { gone = true; break; }
            if (r === 'ok') rec.at[tag] = Date.now();
          }
          if (recovered) delete rec.since[tag];
          rec.last = rec.last || {};
          rec.ph = rec.ph || {};
          rec.last[tag] = level;
          rec.ph[tag] = ph.word;
        }
        /* Se consulta el rio para cualquier lugar, no solo los marcados: si no,
           una crecida real puede no avisar nunca. Cacheado 30 min. */
        let h = null;
        try { h = await env.SUBS.get('nh:' + tag, 'json'); } catch (e) { h = null; }
        if (!h || Date.now() - (h.at || 0) > 30 * 60 * 1000) {
          try {
            h = await hydroFor(env, p.lat, p.lon);
            if (h) { h.at = Date.now(); await env.SUBS.put('nh:' + tag, JSON.stringify(h), { expirationTtl: 3600 }); }
          } catch (e) { h = null; }
        }
        if (h && h.level != null) {
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
              `Seguí las indicaciones de Defensa Civil. Cerca de ${tag}.`,
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

        /* 4) tormenta en camino: solo con confianza alta y dato fresco.
           La ETA se calcula para ESTE lugar. Antes se tomaba m.llega[0],
           que es la primera ciudad de una lista fija y podía ser otra. */
        if (ncOk && Array.isArray(nc.tormentas)) {
          for (const s of nc.tormentas) {
            const near = etaForPlace(p, s);
            if (!near || near.overhead) continue;
            const dkm = near.km;
            const sk = 'st:' + Math.round(s.lat * 10) + ',' + Math.round(s.lon * 10);
            rec.storm = rec.storm || {};
            if (Date.now() - (rec.storm[sk] || 0) < 60 * 60 * 1000) continue;
            const r5 = await sendPush(
              env, rec.sub,
              `⛈ Tormenta a ${dkm} km de ${tag}`,
              `Llega en unos ${near.etaMin} minutos. Guardá lo que esté afuera.`,
              'storm-' + sk, 'storm', 2
            );
            if (r5 === 'gone') { gone = true; break; }
            if (r5 === 'ok') rec.storm[sk] = Date.now();
          }
          if (gone) break;
        }

      } catch (e) {
        console.log('error', tag, e.message);
      }
    }

    /* El cron corre cada 10 minutos: escribir el estado de cada suscriptor
       en cada vuelta gastaba 144 escrituras por día por persona y agotaba
       el cupo con siete usuarios. Ahora solo se escribe si algo cambió. */
    const out = JSON.stringify(rec);
    if (gone) await env.SUBS.delete(k.name);
    else if (out !== raw) await kvPut(env, k.name, out);
  }
}










/* ---------------- Tarjeta de cuenca ----------------
   Cinco señales medidas. Tres estados. Ninguna predicción de altura.
   Si no alcanza el dato, se dice: no se da la cuenca por tranquila. */
const ARCGIS_EST = 'https://services1.arcgis.com/atxllciEI8CHWvwW/arcgis/rest/services/Estaciones_ultimamedicion_Publico/FeatureServer/0/query';
const CAMPOS_CUENCA = 'Codigo,Nombre,PropietarioEstacion,Latitud,Longitud,Lluvia_mm_1hs,Lluvia_mm_3hs,Lluvia_mm_6hs,Lluvia_mm_24hs,Lluvia_mm_7dias,Nivel_m,Nivel,Precipitacion,UltimaActualizacion,HorasSinRegistro,UnidadGestionHidrico';

function puntoEnAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const xi = anillo[i][0], yi = anillo[i][1];
    const xj = anillo[j][0], yj = anillo[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function cuencaDePunto(lon, lat) {
  for (const c of CUENCAS) {
    for (const anillo of c.r) if (puntoEnAnillo(lon, lat, anillo)) return c;
  }
  /* Un punto puede caer justo sobre el borde del polígono (Córdoba centro
     queda exactamente en el límite este). Se prueba el entorno inmediato
     antes de decir que no hay cuenca: 0,02° son unos 2 km. */
  for (const d of [0.02, 0.04]) {
    for (const [dx, dy] of [[0, d], [0, -d], [d, 0], [-d, 0], [d, d], [-d, -d], [d, -d], [-d, d]]) {
      for (const c of CUENCAS) {
        for (const anillo of c.r) {
          if (puntoEnAnillo(lon + dx, lat + dy, anillo)) return c;
        }
      }
    }
  }
  return null;
}

const aNum = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const promedio = a => {
  const v = a.filter(x => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};
const unDecimal = v => (v == null ? null : Math.round(v * 10) / 10);

async function cuencaFor(env, lat, lon) {
  const c = cuencaDePunto(lon, lat);
  if (!c) {
    return {
      ok: false, estado: 'sin_cuenca',
      texto: {
        titulo: 'Fuera de una cuenca trazada',
        cuerpo: 'Todavía no tenemos las cuencas dibujadas para este punto. No damos información de río acá.'
      }
    };
  }

  /* El servicio rechaza consultas por punto + distancia ("SRID is not valid"),
     pero acepta envelope. Se pide el rectángulo que contiene la cuenca y
     después se filtra por polígono, que es lo que realmente importa. */
  let xmin = 180, xmax = -180, ymin = 90, ymax = -90;
  for (const anillo of c.r) {
    for (const [x, y] of anillo) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  const u = new URL(ARCGIS_EST);
  u.searchParams.set('where', '1=1');
  u.searchParams.set('geometry', JSON.stringify({
    xmin, ymin, xmax, ymax, spatialReference: { wkid: 4326 }
  }));
  u.searchParams.set('geometryType', 'esriGeometryEnvelope');
  u.searchParams.set('inSR', '4326');
  u.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  u.searchParams.set('outFields', CAMPOS_CUENCA);
  u.searchParams.set('returnGeometry', 'false');
  u.searchParams.set('resultRecordCount', '1000');
  u.searchParams.set('f', 'json');

  let filas = [];
  let fuenteOk = true;
  let errorFuente = null;
  try {
    const r = await fetch(u.toString(), { cf: { cacheTtl: 240, cacheEverything: true } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'error del servicio');
    filas = (j.features || []).map(f => f.attributes);
  } catch (e) {
    fuenteOk = false;
    errorFuente = String((e && e.message) || e);
  }

  /* solo las que caen dentro del polígono de ESTA cuenca */
  const dentro = fuenteOk
    ? filas.filter(a => c.r.some(anillo => puntoEnAnillo(aNum(a.Longitud), aNum(a.Latitud), anillo)))
    : [];

  const pluv = dentro.filter(a => a.Precipitacion === 'SI');
  /* "informando" exige dato fresco. Si no, una estación que dejó de reportar
     hace días seguiría contando con su último valor y la cobertura mentiría. */
  const informan = pluv.filter(a =>
    aNum(a.Lluvia_mm_24hs) != null && (aNum(a.HorasSinRegistro) ?? 99) <= 3);
  const cobertura = pluv.length ? informan.length / pluv.length : 0;

  const mm1 = promedio(informan.map(a => aNum(a.Lluvia_mm_1hs)));
  const mm3 = promedio(informan.map(a => aNum(a.Lluvia_mm_3hs)));
  const mm6 = promedio(informan.map(a => aNum(a.Lluvia_mm_6hs)));
  const mm24 = promedio(informan.map(a => aNum(a.Lluvia_mm_24hs)));
  const mm7 = promedio(informan.map(a => aNum(a.Lluvia_mm_7dias)));
  const max1 = informan.length
    ? Math.max(...informan.map(a => aNum(a.Lluvia_mm_1hs) ?? 0))
    : null;

  /* nivel: solo estaciones con nivel y dato fresco */
  const nivelSt = dentro
    .filter(a => a.Nivel === 'SI' && aNum(a.Nivel_m) != null && (aNum(a.HorasSinRegistro) ?? 99) <= 6)
    .sort((x, y) => (aNum(x.HorasSinRegistro) ?? 99) - (aNum(y.HorasSinRegistro) ?? 99));
  const nivel = nivelSt.length
    ? {
      estacion: String(nivelSt[0].Nombre || '').trim(),
      m: unDecimal(aNum(nivelSt[0].Nivel_m)),
      horasSinRegistro: aNum(nivelSt[0].HorasSinRegistro)
    }
    : null;

  const edades = dentro.map(a => aNum(a.UltimaActualizacion)).filter(x => x != null && x > 0);
  const edadMin = edades.length ? Math.round((Date.now() - Math.max(...edades)) / 60000) : null;

  let estado;
  if (!fuenteOk || cobertura < 0.5) estado = 'sin_dato';
  else if ((mm1 != null && mm1 >= 4) || (mm3 != null && mm3 >= 10)) estado = 'lluvia';
  else estado = 'normal';

  const n = informan.length, t = pluv.length;

  /* Subida esperada y detalle. El rango sale del registro medido de la cuenca;
     el volumen y el caudal, del coeficiente de escorrentía sobre el área.
     Sin lluvia no se anuncia subida. */
  const nd = NIVEL_CUENCA[String(c.id)];
  let altura = null, detalle = null;
  if (nd) {
    const p24 = mm24 ?? 0;
    let bajo, alto;
    if (p24 < 5) { bajo = 0; alto = nd.rise_min_m; }
    else if (p24 < 20) { bajo = 0.05; alto = nd.rise_min_m; }
    else { bajo = nd.rise_min_m; alto = nd.rise_max_m; }
    altura = {
      normal_m: nd.normal_m,
      bajo_m: unDecimal(bajo),
      alto_m: unDecimal(alto),
      dias_registro: nd.dias,
      nota: nd.nota
    };
    const vb = nd.c_bajo * p24 * nd.area_km2 / 1000;
    const va = nd.c_alto * p24 * nd.area_km2 / 1000;
    detalle = {
      volumen_hm3: [unDecimal(vb), unDecimal(va)],
      caudal_ls: [Math.round(vb * 1e6 / 86400), Math.round(va * 1e6 / 86400)],
      tiempo_cuenca_h: [3, 5],
      tiempo_abajo_h: [12, 24],
      metodo: 'Coeficiente de escorrentía 0,169 a 0,510 sobre 531,7 km²'
    };
  }
  const texto = estado === 'sin_dato'
    ? {
      titulo: 'Sin dato suficiente',
      cuerpo: fuenteOk
        ? 'Informan ' + n + ' de ' + t + ' pluviómetros de esta cuenca.'
        : 'No pudimos leer la red de pluviómetros.',
      pie: 'No damos la cuenca por tranquila. Si estás cerca de un arroyo, mirá cómo está.'
    }
    : estado === 'lluvia'
      ? {
        titulo: 'Está lloviendo sobre la cuenca',
        cuerpo: 'Cayeron ' + (unDecimal(mm3) ?? 0) + ' mm en 3 horas y ' + (unDecimal(mm24) ?? 0) + ' mm en 24 horas.',
        pie: 'El agua ya cayó en la cuenca. No estimamos a qué altura llegará el río.'
      }
      : {
        titulo: 'Sin lluvia significativa',
        cuerpo: 'En 3 horas cayeron ' + (unDecimal(mm3) ?? 0) + ' mm sobre la cuenca.',
        pie: 'Es lo medido por los pluviómetros, no un pronóstico.'
      };

  return {
    ok: true,
    estado,
    cuenca: { nombre: c.n, areaKm2: c.area },
    lluvia: {
      mm1h: unDecimal(mm1), mm3h: unDecimal(mm3), mm6h: unDecimal(mm6),
      mm24h: unDecimal(mm24), mm7d: unDecimal(mm7), max1h: unDecimal(max1)
    },
    red: { pluviometros: t, informando: n, cobertura: Math.round(cobertura * 100) },
    nivel,
    altura,
    detalle,
    edadMin,
    motivo: fuenteOk ? null : (errorFuente || 'fuente no disponible'),
    texto,
    trazabilidad: [
      { fuente: 'Pluviómetros SGA / INA-CIRSA / APRHI (ArcGIS provincial)', estaciones: t, informando: n },
      { fuente: 'Nivel hidrométrico del mismo servicio', estaciones: nivelSt.length },
      { leidoHaceMin: edadMin }
    ]
  };
}

/* ---------------- Acumulador horario ----------------
   Las tablas publicas de nivel horario guardan solo una ventana movil de 57
   horas. Sin archivo propio no hay forma de calibrar cuanto tarda el agua en
   llegar. Esto guarda una foto por hora en R2: un objeto por hora, sin
   reescrituras, para que no haya conflictos entre ejecuciones. */
const ARCGIS_VIVO = 'https://services1.arcgis.com/atxllciEI8CHWvwW/arcgis/rest/services/Estaciones_ultimamedicion_Publico/FeatureServer/0/query';

/* Lluvia de la cuenca alta del Paraná (Brasil). Se calcula una vez por hora
   en el cron, no en la tarjeta: cuatro consultas seguidas colgaban la app. */
const PTS_BRASIL = [[-20.5, -51.5], [-22.5, -52.9], [-24, -54.2], [-25.5, -54.6]];

async function acumularBrasil(env) {
  if (!env.NOWCAST) return null;
  const hora = new Date().toISOString().slice(0, 13);
  const key = 'acum/brasil/' + hora + '.json';
  const ya = await env.NOWCAST.head(key);
  if (ya) {
    /* si ya existe, igual hay que dejarla en KV: si no, la lectura
       vuelve al listado de R2 y tarda decenas de segundos. */
    try {
      const o = await env.NOWCAST.get(key);
      if (o && env.SUBS) await env.SUBS.put('brasil:latest', await o.text(), { expirationTtl: 604800 });
    } catch (e) { }
    return { hora, existia: true };
  }

  const fin = new Date().toISOString().slice(0, 10);
  const ini = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  let acc = 0, n = 0;
  for (const [la, lo] of PTS_BRASIL) {
    try {
      const u = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + la +
        '&longitude=' + lo + '&start_date=' + ini + '&end_date=' + fin +
        '&daily=precipitation_sum&timezone=America/Sao_Paulo';
      const r = await fetch(u, { cf: { cacheTtl: 43200, cacheEverything: true } });
      const j = await r.json();
      const v = ((j.daily || {}).precipitation_sum || []).filter(x => x != null);
      if (v.length) { acc += v.reduce((a, b) => a + b, 0) / v.length; n++; }
    } catch (e) { }
  }
  if (n < 3) return { hora, error: 'pocos puntos' };

  const payload = {
    hora,
    mm30: Math.round(acc / n),
    puntos: n,
    desde: ini,
    hasta: fin,
    rezago_dias: 5,
    correlacion: 0.55,
    nota: 'Lluvia de la cuenca alta del Paraná. El nivel de Itatí responde en unos 5 días.'
  };
  await env.NOWCAST.put(key, JSON.stringify(payload), { httpMetadata: { contentType: 'application/json' } });
  if (env.SUBS) await env.SUBS.put('brasil:latest', JSON.stringify(payload), { expirationTtl: 604800 });
  return { hora, mm30: payload.mm30 };
}

async function acumular(env) {
  if (!env.NOWCAST) return null;
  const hora = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const key = 'acum/v1/' + hora + '.json';

  const ya = await env.NOWCAST.head(key);
  if (ya) return { hora, existia: true };

  const u = new URL(ARCGIS_VIVO);
  u.searchParams.set('where', '1=1');
  u.searchParams.set('outFields', 'Codigo,Lluvia_mm_1hs,Lluvia_mm_24hs,Nivel_m,HorasSinRegistro');
  u.searchParams.set('returnGeometry', 'false');
  u.searchParams.set('resultRecordCount', '2000');
  u.searchParams.set('f', 'json');

  const r = await fetch(u.toString(), { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) return { hora, error: 'HTTP ' + r.status };
  const j = await r.json();
  if (j.error) return { hora, error: j.error.message || 'error del servicio' };

  const d = [];
  for (const f of (j.features || [])) {
    const a = f.attributes;
    const ll = a.Lluvia_mm_1hs == null ? null : Math.round(a.Lluvia_mm_1hs * 10) / 10;
    const ni = a.Nivel_m == null ? null : Math.round(a.Nivel_m * 100) / 100;
    if (ll == null && ni == null) continue;
    d.push([String(a.Codigo), ll, ni]);
  }

  await env.NOWCAST.put(key, JSON.stringify({ hora, n: d.length, d }), {
    httpMetadata: { contentType: 'application/json' }
  });
  /* latido pegado al trabajo real: si la foto se guardó, esto se escribe */
  try { await env.SUBS.put('hb:acum', JSON.stringify({ at: Date.now(), key })); } catch (e) { }
  return { hora, n: d.length };
}

/* ---------------- Motor de dictamen ----------------
   Cada fuente responde la misma pregunta por separado: "¿viene agua?".
   El dictamen solo se emite si hay suficientes fuentes válidas y coinciden.
   Si no coinciden, se devuelve "señales divididas", no un promedio.
   Cada voto queda listado para que se pueda auditar de dónde salió. */
async function dictamen(env, lat, lon) {
  const [cue, hyd] = await Promise.all([
    cuencaFor(env, lat, lon).catch(() => null),
    hydroFor(env, lat, lon).catch(() => null)
  ]);

  const votos = [];

  /* 1. Lluvia medida por pluviómetros sobre la cuenca */
  if (cue && cue.ok && cue.red && (cue.red.cobertura || 0) >= 50) {
    const mm = cue.lluvia.mm24h ?? 0;
    votos.push({
      fuente: 'Lluvia medida en la cuenca',
      valor: mm,
      unidad: 'mm/24h',
      voto: mm >= 20 ? 2 : mm >= 5 ? 1 : 0,
      detalle: cue.red.informando + ' de ' + cue.red.pluviometros + ' pluviómetros'
    });
  } else {
    votos.push({ fuente: 'Lluvia medida en la cuenca', voto: null, detalle: 'sin cobertura suficiente' });
  }

  /* 2. Nivel del río medido */
  if (hyd && hyd.level != null) {
    votos.push({
      fuente: 'Nivel del río',
      valor: hyd.now,
      unidad: 'm',
      voto: hyd.level >= 2 ? 2 : hyd.level >= 1 ? 1 : 0,
      detalle: hyd.river || 'estación cercana'
    });
  } else {
    votos.push({ fuente: 'Nivel del río', voto: null, detalle: 'sin medición' });
  }

  /* 3. Suba esperada por el modelo de escorrentía */
  if (cue && cue.ok && cue.altura) {
    votos.push({
      fuente: 'Suba esperada (escorrentía)',
      valor: cue.altura.alto_m,
      unidad: 'm',
      voto: (cue.lluvia.mm24h ?? 0) >= 20 ? 2 : (cue.lluvia.mm24h ?? 0) >= 5 ? 1 : 0,
      detalle: 'rango ' + cue.altura.bajo_m + ' a ' + cue.altura.alto_m + ' m'
    });
  } else {
    votos.push({ fuente: 'Suba esperada (escorrentía)', voto: null, detalle: 'sin registro para esta cuenca' });
  }

  /* 4. Estado del suelo */
  if (cue && cue.ok && cue.lluvia) {
    const mm7 = cue.lluvia.mm7d ?? 0;
    votos.push({
      fuente: 'Suelo cargado',
      valor: mm7,
      unidad: 'mm/7d',
      voto: mm7 >= 80 ? 2 : mm7 >= 40 ? 1 : 0,
      detalle: 'acumulado de la semana'
    });
  } else {
    votos.push({ fuente: 'Suelo cargado', voto: null, detalle: 'sin dato' });
  }

  const validos = votos.filter(v => v.voto != null);
  const altos = validos.filter(v => v.voto >= 2).length;
  const medios = validos.filter(v => v.voto === 1).length;
  const acuerdo = validos.length ? Math.round(((altos + medios) * 100) / validos.length) : 0;

  let estado, titulo, texto;
  /* Una medición directa por encima del umbral de evacuación no se somete a
     consenso: es un hecho medido. Si esperamos a que las demás fuentes
     tengan dato, el motor calla justo cuando más importa. */
  const medicionCritica = hyd && hyd.level != null && hyd.level >= 3;
  if (medicionCritica) {
    estado = 'agua_en_camino';
    titulo = 'Viene agua';
    texto = 'El nivel medido superó el umbral de alerta de esa estación. No hace falta consenso: es medición directa.';
  } else if (validos.length < 2) {
    estado = 'sin_dictamen';
    titulo = 'Sin dictamen';
    texto = 'No hay suficientes fuentes válidas para pronunciarse. No se da por tranquilo.';
  } else if (altos >= Math.ceil(validos.length * 0.75)) {
    estado = 'agua_en_camino';
    titulo = 'Viene agua';
    texto = altos + ' de ' + validos.length + ' fuentes coinciden en señal alta.';
  } else if (altos + medios === 0) {
    estado = 'sin_senal';
    titulo = 'Sin señal de agua';
    texto = 'Las ' + validos.length + ' fuentes válidas coinciden en que no hay agua en camino.';
  } else if (acuerdo >= 75) {
    estado = 'atencion';
    titulo = 'Conviene mirar';
    texto = 'Hay señales parciales: ' + (altos + medios) + ' de ' + validos.length + ' fuentes.';
  } else {
    estado = 'dividido';
    titulo = 'Señales divididas';
    texto = 'Las fuentes no coinciden. No se emite un dictamen único.';
  }

  return {
    ok: true,
    estado, titulo, texto,
    acuerdo,
    fuentes_validas: validos.length,
    fuentes_totales: votos.length,
    votos,
    nota: 'El acuerdo entre fuentes no las vuelve independientes: comparten los mismos datos de base.'
  };
}





