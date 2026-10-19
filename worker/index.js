/**
 * ASN 4.0 — Worker de Cloudflare
 * - Sirve la app estática (./public)
 * - Guarda suscripciones Web Push en KV
 * - Cron cada 10 min: calcula riesgo y envía push (sin ntfy)
 */
import { buildPushPayload } from '@block65/webcrypto-web-push';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  }
};

/* ---------------- API ---------------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function hash(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

async function api(req, env, url) {
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
      at: (prev && prev.at) || {}
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

  if (url.pathname === '/api/test' && req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.endpoint) return json({ error: 'falta endpoint' }, 400);
    const rec = await env.SUBS.get('sub:' + await hash(body.endpoint), 'json');
    if (!rec) return json({ error: 'no suscripto' }, 404);
    const r = await sendPush(env, rec.sub, '🔔 ASN 4.0', 'Prueba de aviso en tiempo real. Si lo ves, funciona.', 'test');
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
        const at = rec.at[tag] ?? 0;
        const cooling = Date.now() - at < 3 * 60 * 60 * 1000;
        const quietBlock = quietNow() && level < 3;

        if (level >= 1 && level > prev && !cooling && !quietBlock) {
          const L = LEVELS[level];
          const ph = phenomenon(pb);
          const r = await sendPush(
            env, rec.sub,
            `${L.emoji} ${L.name} · ${ph.emoji} ${ph.word} en ${tag}`,
            `${ph.word} en las próximas 3 horas. Abrí ASN para ver el detalle.`,
            tag
          );
          if (r === 'gone') { gone = true; break; }
          if (r === 'ok') rec.at[tag] = Date.now();
        }
        rec.last[tag] = level;
      } catch (e) {
        console.log('error', tag, e.message);
      }
    }

    if (gone) await env.SUBS.delete(k.name);
    else await env.SUBS.put(k.name, JSON.stringify(rec));
  }
}
