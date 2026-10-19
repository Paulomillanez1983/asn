/**
 * ASN 4.0 — Worker de Cloudflare
 * - Sirve la app estática (./public)
 * - Guarda suscripciones Web Push en KV
 * - Cron cada 10 min: calcula riesgo y envía push
 */
import { buildPushPayload } from '@block65/webcrypto-web-push';

export default {
  async fetch(request, env, ctx) {
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
      at: (prev && prev.at) || {},
      ph: (prev && prev.ph) || {}
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
  .box{max-width:520px;width:100%;border-radius:26px;padding:28px;
    background:linear-gradient(165deg,#13202f,#0b1524);border:1px solid rgba(255,255,255,.08);
    box-shadow:0 24px 60px rgba(0,0,0,.55);text-align:center}
  .emoji{font-size:64px;line-height:1}
  h1{font-size:26px;margin:14px 0 6px;letter-spacing:-.5px}
  .place{color:#9fb2d1;font-size:14px}
  .pct{margin-top:16px;font-size:13px;color:#7d90b3}
  .cta{display:inline-block;margin-top:22px;padding:14px 22px;border-radius:14px;
    background:#2563eb;color:#fff;text-decoration:none;font-weight:650}
  .foot{margin-top:14px;font-size:11px;color:#5d6f92}
</style></head>
<body><div class="box">
  <div class="emoji">${L.emoji}${level ? '' : '😌'}</div>
  <h1>${esc(level ? L.name : 'Sin alerta')}${level ? ': ' + esc(ph.word) : ''}</h1>
  <div class="place">${esc(name)}${place.a ? ' · ' + esc(place.a) : ''}</div>
  <div class="pct">${fast ? 'Estado al momento de compartir' : 'Próximas 3 horas · ' + pct + '% de ' + n + ' escenarios'}</div>
  <a class="cta" href="/">Abrir ASN 4.0</a>
  <div class="foot">Pronóstico por conjuntos del IFS · Open-Meteo</div>
</div></body></html>`;

  const res = new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300'
    }
  });
  if (ctx) ctx.waitUntil(cache.put(url.href, res.clone()));
  return res;
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


