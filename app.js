'use strict';

/* ===================== Configuración ===================== */
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const MODEL_NAME = { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON', gem_seamless: 'GEM' };
const KEY = 'paraguas.v1';
const OLD_KEY = 'alerta-meteo.v2';
const DEFAULT_TOPIC = 'paraguas-cba-7q4m9k2x';

const S = {
  places: [], topic: DEFAULT_TOPIC, last: {}, feedback: [],
  data: {}, updated: 0, busy: false, view: 'home', results: [], askFor: null
};

/* ===================== Almacenamiento ===================== */
function load() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { raw = {}; }
  if (!raw.places) {
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY) || '{}');
      if (Array.isArray(old.places) && old.places.length) raw = old;
    } catch (e) { }
  }
  S.places = Array.isArray(raw.places) ? raw.places : [];
  S.feedback = Array.isArray(raw.feedback) ? raw.feedback : [];
  S.last = raw.last && typeof raw.last === 'object' ? raw.last : {};
  S.topic = raw.topic === 'alertameteo-cba-7q4m9k2x' ? DEFAULT_TOPIC : (raw.topic || DEFAULT_TOPIC);
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      places: S.places, topic: S.topic, last: S.last, feedback: S.feedback
    }));
  } catch (e) { }
}

/* ===================== Utilidades ===================== */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 2600);
}
function ago(ts) {
  if (!ts) return 'sin datos';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'recién';
  if (m === 1) return 'hace 1 min';
  if (m < 60) return 'hace ' + m + ' min';
  return 'hace ' + Math.round(m / 60) + ' h';
}
const hourLabel = iso => iso.slice(11, 16);

const WMO = [
  [0, 'despejado'], [1, 'casi despejado'], [2, 'parcialmente nublado'], [3, 'nublado'],
  [45, 'con niebla'], [48, 'con niebla helada'],
  [51, 'con llovizna'], [53, 'con llovizna'], [55, 'con llovizna fuerte'],
  [61, 'con lluvia débil'], [63, 'con lluvia'], [65, 'con lluvia fuerte'],
  [66, 'con lluvia helada'], [67, 'con lluvia helada'],
  [71, 'con nieve'], [73, 'con nieve'], [75, 'con nieve fuerte'], [77, 'con aguanieve'],
  [80, 'con chaparrones'], [81, 'con chaparrones fuertes'], [82, 'con chaparrones fuertes'],
  [85, 'con nieve'], [86, 'con nieve fuerte'],
  [95, 'con tormenta'], [96, 'con tormenta y granizo'], [99, 'con tormenta y granizo']
];
function skyText(code) {
  if (code == null) return '';
  let out = '';
  for (const [c, t] of WMO) if (code >= c) out = t;
  return out;
}

/* ===================== Riesgo ===================== */
function pointRisk(o) {
  const a = o.rain < 0.5 ? 0 : o.rain < 2.5 ? 1 : o.rain < 7.6 ? 2 : 3;
  const b = o.gust < 50 ? 0 : o.gust < 70 ? 1 : o.gust < 90 ? 2 : 3;
  const hail = o.code >= 96 ? 3 : (o.cape >= 2500 && o.gust >= 80 ? 2 : (o.cape >= 1500 && o.gust >= 80 ? 1 : 0));
  return { l: Math.max(a, b, hail), rain: a >= 1, wind: b >= 1, hail: hail >= 2 };
}

function modelRisk(H, m) {
  const g = k => H[k + '_' + m] || [];
  const pr = g('precipitation'), gu = g('wind_gusts_10m'), ca = g('cape'),
    wc = g('weather_code'), pp = g('precipitation_probability');
  let acc = 0, lvl = 0, rain = false, wind = false, hail = false;
  const hours = [];
  for (let i = 0; i < pr.length; i++) {
    const r = pr[i] ?? 0;
    const x = pointRisk({ rain: r, gust: gu[i] ?? 0, cape: ca[i] ?? 0, code: wc[i] ?? 0 });
    if (i < 3) {
      acc += r;
      lvl = Math.max(lvl, x.l);
      rain = rain || x.rain; wind = wind || x.wind; hail = hail || x.hail;
    }
    hours.push({ p: r, prob: pp[i] ?? null, gust: gu[i] ?? 0, code: wc[i] ?? 0 });
  }
  lvl = Math.max(lvl, acc >= 50 ? 3 : acc >= 25 ? 2 : 0);
  return { m, l: lvl, rain, wind, hail, acc, hours };
}

function aggregate(H) {
  const models = MODELS.map(m => modelRisk(H, m));
  const sorted = models.map(x => x.l).sort((a, b) => b - a);
  const level = Math.min(3, Math.max(0, sorted[1] ?? sorted[0] ?? 0));
  const votes = {
    rain: models.filter(x => x.rain).length,
    wind: models.filter(x => x.wind).length,
    hail: models.filter(x => x.hail).length
  };
  return { models, level, votes };
}

/* ===================== Lenguaje humano ===================== */
function levelInfo(d) {
  const rain = d.votes.rain >= 2, wind = d.votes.wind >= 2, hail = d.votes.hail >= 2;
  const what = hail ? 'granizo' : wind ? 'ráfagas fuertes' : rain ? 'lluvia' : 'tormenta';
  if (d.level === 0) {
    return { cls: 'lv0', emoji: '😌', title: 'Todo tranquilo', line: 'No se espera nada raro en las próximas 3 horas.', action: 'Buen momento para estar afuera.', cta: '✅' };
  }
  if (d.level === 1) {
    return { cls: 'lv1', emoji: '🌤️', title: 'Ojo con el cielo', line: 'Puede caer algo leve en las próximas 3 horas.', action: 'Si salís, llevá paraguas por las dudas.', cta: '☂️' };
  }
  if (d.level === 2) {
    return {
      cls: 'lv2', emoji: hail ? '🧊' : wind ? '💨' : '🌧️', title: 'Se viene ' + what,
      line: 'Varios modelos coinciden para las próximas 3 horas.',
      action: 'Guardá lo que tengas afuera y cerrá las ventanas.', cta: '⚠️'
    };
  }
  return {
    cls: 'lv3', emoji: hail ? '🧊' : '⛈️', title: 'Peligro: ' + what,
    line: 'Se viene fuerte, con alta coincidencia entre modelos.',
    action: 'Quedate adentro. Evitá salir en auto si no hace falta.', cta: '🚨'
  };
}

function hourSignal(d, i) {
  const hs = d.models.map(m => m.hours[i]).filter(Boolean);
  if (!hs.length) return { rain: false, gust: 0 };
  const avgP = hs.reduce((a, h) => a + (h.p || 0), 0) / hs.length;
  const probs = hs.map(h => h.prob).filter(v => v != null);
  const avgProb = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
  const gust = Math.max(...hs.map(h => h.gust || 0));
  return { rain: avgP >= 0.3 || avgProb >= 50, gust };
}

function nextEvent(d) {
  const n = Math.min(12, d.times.length);
  for (let i = 0; i < n; i++) {
    const s = hourSignal(d, i);
    if (s.rain || s.gust >= 50) {
      const both = s.rain && s.gust >= 50;
      return { iso: d.times[i], label: both ? 'Lluvia y viento' : s.rain ? 'Lluvia' : 'Viento fuerte' };
    }
  }
  return null;
}

function eventText(d) {
  const ev = nextEvent(d);
  if (!ev) return { txt: 'Sin lluvia ni viento fuerte en las próximas 12 horas', big: false };
  const mins = Math.round((new Date(ev.iso).getTime() - Date.now()) / 60000);
  if (mins <= 5) return { txt: ev.label + ' ahora mismo', big: true };
  if (mins < 60) return { txt: ev.label + ' en ' + mins + ' min', big: true };
  return { txt: ev.label + ' a las ' + hourLabel(ev.iso) + ' · en ' + Math.round(mins / 60) + ' h', big: true };
}

function anyRain(d, hours) {
  const n = Math.min(hours, d.times.length);
  for (let i = 0; i < n; i++) if (hourSignal(d, i).rain) return true;
  return false;
}
function maxGust(d, hours) {
  const n = Math.min(hours, d.times.length);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, hourSignal(d, i).gust);
  return max;
}

function quickHtml(d) {
  const calm = d.level === 0 && !anyRain(d, 6);
  const items = [
    ['☂️ Paraguas', calm ? 'no' : 'sí'],
    ['👕 Tender', calm ? 'sí' : 'no'],
    ['🚲 Bici', (d.level >= 2 || maxGust(d, 6) >= 50) ? 'no' : 'sí'],
    ['🚗 Auto afuera', (d.level >= 2 || d.votes.hail >= 2) ? 'no' : 'sí']
  ];
  return items.map(([k, v]) => `<span class="q ${v === 'sí' ? 'yes' : 'no'}">${k}: ${v}</span>`).join('');
}

/* ===================== Red ===================== */
async function fetchPlace(p) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', p.lat);
  u.searchParams.set('longitude', p.lon);
  u.searchParams.set('hourly', 'precipitation,precipitation_probability,wind_gusts_10m,cape,weather_code');
  u.searchParams.set('current', 'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m');
  u.searchParams.set('models', MODELS.join(','));
  u.searchParams.set('forecast_hours', '13');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u.toString(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly || !j.hourly.time) throw new Error('sin datos');
  return { hourly: j.hourly, current: j.current };
}

async function fetchCanal(topic) {
  if (!topic) return '';
  try {
    const r = await fetch('https://ntfy.sh/' + encodeURIComponent(topic) + '/json?poll=1&since=3h');
    const txt = await r.text();
    const rows = txt.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(x => x && x.event === 'message')
      .map(x => ({ t: x.time, v: parseFloat(x.message) }))
      .filter(x => !isNaN(x.v));
    if (!rows.length) return 'Canal sin datos';
    const last = rows[rows.length - 1];
    const base = rows.find(x => last.t - x.t <= 1800) || rows[0];
    const d = last.v - base.v;
    const age = Math.max(0, Math.round(Date.now() / 60000 - last.t / 60));
    return 'Canal: ' + last.v.toFixed(0) + ' cm' + (d >= 15 ? ' · sube rápido' : '') + (age > 35 ? ' · sin señal' : '');
  } catch (e) { return ''; }
}

/* ===================== Carga ===================== */
async function refresh() {
  if (S.busy) return;
  S.busy = true;
  paint();
  const results = await Promise.allSettled(S.places.map(p => fetchPlace(p)));
  let ok = 0;
  S.places.forEach((p, i) => {
    const res = results[i];
    if (res.status === 'fulfilled') {
      const agg = aggregate(res.value.hourly);
      agg.times = res.value.hourly.time;
      agg.current = res.value.current;
      S.data[p.id] = agg;
      ok++;
      checkAlert(p, agg);
    } else {
      S.data[p.id] = Object.assign(S.data[p.id] || {}, { error: true });
    }
  });
  S.updated = Date.now();
  S.busy = false;
  save();
  paint();
  if (!ok && S.places.length) toast('No pudimos actualizar. Fijate la conexión.');
}

function checkAlert(p, agg) {
  const prev = S.last[p.id] ?? -1;
  if (agg.level >= 2 && agg.level > prev) {
    const info = levelInfo(agg);
    notify(info.cta + ' ' + info.title + ' — ' + p.name, info.action);
  }
  S.last[p.id] = agg.level;
}

function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, {
      body, icon: 'icon-192.png', badge: 'icon-192.png',
      vibrate: [300, 100, 300], requireInteraction: true, tag: 'paraguas'
    })).catch(() => { });
  } catch (e) { }
}

async function askNotify() {
  if (typeof Notification === 'undefined') { toast('Este navegador no permite avisos'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { notify('☂️ Avisos activados', 'Así te vamos a avisar.'); toast('Listo, avisos activados'); }
  else toast('Los avisos quedaron bloqueados');
  paint();
}

/* ===================== Vistas ===================== */
function levelOf(p) {
  const d = S.data[p.id];
  return d && !d.error ? d.level : -1;
}

function paint() {
  const sub = document.getElementById('sub');
  const view = document.getElementById('view');
  if (!S.places.length) {
    sub.textContent = 'Tu pronóstico, sin vueltas';
    view.innerHTML = viewEmpty();
    return;
  }
  const worst = Math.max(...S.places.map(levelOf));
  const alerts = S.places.filter(p => levelOf(p) >= 2).length;
  const msg = worst >= 3 ? (alerts > 1 ? alerts + ' lugares en peligro' : 'Peligro en un lugar')
    : worst === 2 ? (alerts > 1 ? alerts + ' lugares en alerta' : 'Un lugar en alerta')
      : worst === 1 ? 'Ojo con el cielo'
        : worst === 0 ? 'Todo tranquilo'
          : 'Actualizando…';
  sub.textContent = msg + (S.busy ? '' : ' · ' + ago(S.updated));
  view.innerHTML = S.view === 'settings' ? viewSettings() : viewHome();
}

function viewEmpty() {
  return `<div class="empty">
    <div class="big">☂️</div>
    <h2>¿Dónde querés que te avise?</h2>
    <p>Casa, el colegio, el trabajo. Te digo si viene lluvia fuerte, ráfagas o granizo antes de que salgas.</p>
    <button id="startAdd">Agregar un lugar</button>
    <p class="hint">Se guarda solo en este teléfono.</p>
  </div>`;
}

function viewHome() {
  const ordered = [...S.places].sort((a, b) => (levelOf(b) - levelOf(a)) || a.name.localeCompare(b.name));
  return ordered.map(heroHtml).join('') + `<div class="foot" style="margin-top:14px">Tocá “Ver detalles” si querés los datos finos.</div>`;
}

function heroHtml(p) {
  const d = S.data[p.id];
  if (!d || d.error) {
    return `<section class="hero lv0" style="opacity:.85">
      <div class="where"><span><b>${esc(p.name)}</b></span><span>cargando</span></div>
      <div class="main"><div class="emoji">⏳</div><div><div class="title">Un segundo…</div>
      <div class="line">${d && d.error ? 'No pudimos traer el pronóstico de este lugar.' : 'Estamos mirando el cielo.'}</div></div></div>
    </section>`;
  }
  const info = levelInfo(d);
  const ev = eventText(d);
  const c = d.current || {};
  const nowBits = [
    c.temperature_2m != null ? Math.round(c.temperature_2m) + '°' : '',
    skyText(c.weather_code),
    (c.precipitation || 0) > 0 ? 'está lloviendo' : ''
  ].filter(Boolean).join(' · ');

  const ask = S.askFor === p.id ? askHtml(p) : '';
  const askBtn = d.level >= 1
    ? `<button class="ghost" data-ask="${p.id}" style="padding:6px 10px;font-size:12px">¿Está pasando?</button>`
    : '';

  return `<section class="hero ${info.cls}">
    <div class="where"><span>📍 <b>${esc(p.name)}</b></span><span>próximas 3 h</span></div>

    <div class="main">
      <div class="emoji">${info.emoji}</div>
      <div>
        <div class="title">${info.title}</div>
        <div class="line">${info.line}</div>
      </div>
    </div>

    <div class="action"><span class="cta">${info.cta}</span><span>${info.action}</span></div>

    <div class="event ${ev.big ? 'big' : ''}">⏱ ${ev.txt}</div>

    <div class="quick">${quickHtml(d)}</div>

    ${nowBits ? `<div class="now">Ahora <b>${nowBits}</b></div>` : ''}

    <details class="more">
      <summary>Ver detalles</summary>
      <div class="mrow">${d.models.map(x => `<span><i class="dot d${x.l}"></i>${MODEL_NAME[x.m]}</span>`).join('')}</div>
      ${barsHtml(d)}
      <div class="links">
        <a href="https://www.rainviewer.com/map.html?loc=${p.lat},${p.lon},9" target="_blank" rel="noopener">🛰️ Ver radar</a>
        <a href="https://map.blitzortung.org/#9/${p.lat}/${p.lon}" target="_blank" rel="noopener">⚡ Ver rayos</a>
        ${askBtn}
      </div>
    </details>

    ${ask}
  </section>`;
}

function barsHtml(d) {
  const n = Math.min(12, d.times.length);
  let maxProb = 0;
  const values = [];
  for (let i = 0; i < n; i++) {
    const probs = d.models.map(m => m.hours[i] ? m.hours[i].prob : null).filter(v => v != null);
    const avg = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
    values.push({ avg, rain: d.models.some(m => m.hours[i] && m.hours[i].p >= 0.2) });
    maxProb = Math.max(maxProb, avg);
  }
  if (maxProb < 3) return `<div class="barlabel">Sin lluvia prevista en las próximas 12 horas.</div>`;

  let out = '<div class="barlabel">Probabilidad de lluvia · 12 h</div><div class="bars">';
  let meta = '<div class="barmeta">';
  values.forEach((v, i) => {
    out += `<div class="bar${v.rain ? ' s' : ''}" style="height:${Math.max(6, Math.round(v.avg))}%" title="${Math.round(v.avg)}%"></div>`;
    meta += `<div>${i % 2 === 0 ? hourLabel(d.times[i]).slice(0, 2) : ''}</div>`;
  });
  return out + '</div>' + meta + '</div></div>';
}

function askHtml(p) {
  const opts = [['Sí, llueve', 'rain'], ['No, nada', 'no'], ['Cae granizo', 'hail'], ['Viento fuerte', 'wind']];
  return `<div class="ask">
    <div class="q-t">¿Qué está pasando ahora en ${esc(p.name)}?</div>
    <div class="btns">${opts.map(([t, v]) => `<button data-ans="${v}" data-place="${p.id}">${t}</button>`).join('')}</div>
  </div>`;
}

function viewSettings() {
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const rows = S.places.map(p => `<div class="row">
      <div class="grow"><b>${esc(p.name)}</b><small>${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}</small></div>
      <button class="del" data-del="${p.id}">Quitar</button>
    </div>`).join('') || `<p class="hint">Todavía no agregaste lugares.</p>`;

  const done = S.feedback.filter(f => f.a && f.pred);
  const tot = {};
  done.forEach(f => Object.keys(f.pred).forEach(m => {
    const pr = f.pred[m];
    let hit = f.a === 'no' ? (!pr.rain && !pr.wind && !pr.hail) : !!pr[f.a] || (f.a === 'rain' && pr.hail) || (f.a === 'hail' && pr.rain);
    tot[m] = tot[m] || [0, 0];
    tot[m][1]++; if (hit) tot[m][0]++;
  }));
  const scoreRows = Object.keys(tot).map(m => {
    const [h, n] = tot[m];
    return `<div class="row"><div class="grow"><b>${MODEL_NAME[m] || m}</b></div><small>${h} de ${n}</small></div>`;
  }).join('');

  return `
  <div class="sec">Tus lugares</div>
  <div class="card list">${rows}</div>
  <button id="addPlace" class="ghost" style="width:100%">＋ Agregar otro lugar</button>

  <div class="sec">Avisos</div>
  <div class="card">
    <h3>${perm === 'granted' ? 'Avisos activados' : 'Avisos en este teléfono'}</h3>
    <p>${perm === 'granted'
      ? 'Cuando el riesgo sube, te llega una notificación.'
      : 'Activalos para enterarte sin abrir la app.'}</p>
    <div style="margin-top:12px">
      <button id="enableNotify">${perm === 'granted' ? 'Probar un aviso' : 'Activar avisos'}</button>
    </div>
    <p class="hint">Con la app cerrada los avisos llegan por <b>ntfy</b>: instalá esa app y suscribite al canal de abajo. Es gratis y sin cuenta.</p>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input value="${esc(S.topic)}" readonly style="font-size:13px">
      <button class="ghost" id="copyTopic">Copiar</button>
    </div>
  </div>

  <div class="sec">Qué modelo acierta más acá</div>
  <div class="card">
    ${scoreRows || `<p>Cuando respondas “¿Está pasando?”, acá vas a ver qué modelo le pega más en tu zona.</p>`}
  </div>

  <div class="sec">Datos</div>
  <div class="card">
    <p>Los lugares y tus respuestas quedan en este teléfono.</p>
    <div style="margin-top:12px"><button class="ghost" id="wipe">Borrar todo</button></div>
  </div>
  <div style="margin-top:18px"><button class="ghost" id="back" style="width:100%">← Volver</button></div>`;
}

/* ===================== Buscar lugares ===================== */
async function search(q) {
  if (q.trim().length < 3) { S.results = []; renderResults(); return; }
  try {
    const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
    u.searchParams.set('name', q.trim());
    u.searchParams.set('count', '6');
    u.searchParams.set('language', 'es');
    u.searchParams.set('countryCode', 'AR');
    const r = await fetch(u.toString());
    const j = await r.json();
    S.results = (j.results || []).map(x => ({
      name: x.name + (x.admin2 && x.admin2 !== x.name ? ', ' + x.admin2 : ''),
      lat: x.latitude, lon: x.longitude
    }));
  } catch (e) { S.results = []; }
  renderResults();
}

function renderResults() {
  const box = document.getElementById('res');
  if (!box) return;
  box.innerHTML = S.results.map((r, i) => `<div class="res" data-pick="${i}">
      <span>${esc(r.name)}<br><small>${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</small></span>
      <span style="color:#93c5fd;font-size:13px">Elegir</span>
    </div>`).join('');
}

function addPlace(p) {
  if (S.places.length >= 6) { toast('Máximo 6 lugares'); return; }
  const dup = S.places.find(x => x.name.toLowerCase() === p.name.toLowerCase() ||
    (Math.abs(x.lat - p.lat) < 0.005 && Math.abs(x.lon - p.lon) < 0.005));
  if (dup) { toast('Ese lugar ya está en la lista'); return; }
  S.places.push({ id: uid(), name: p.name, lat: p.lat, lon: p.lon });
  S.results = []; S.view = 'home';
  save(); paint(); refresh();
}

function useGPS() {
  if (!navigator.geolocation) { toast('Este navegador no da la ubicación'); return; }
  toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    pos => addPlace({ name: 'Mi ubicación', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) }),
    () => toast('No pudimos obtener la ubicación'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

/* ===================== Eventos ===================== */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-pick],[data-del],[data-ask],[data-ans],#startAdd,#addPlace,#gear,#refresh,#back,#enableNotify,#wipe,#gps,#copyTopic');
  if (!t) return;

  if (t.id === 'refresh') { refresh(); toast('Actualizando…'); return; }
  if (t.id === 'gear') { S.view = S.view === 'settings' ? 'home' : 'settings'; paint(); return; }
  if (t.id === 'back') { S.view = 'home'; paint(); return; }
  if (t.id === 'startAdd' || t.id === 'addPlace') { openAdd(); return; }
  if (t.id === 'gps') { useGPS(); return; }
  if (t.id === 'enableNotify') { askNotify(); return; }
  if (t.id === 'copyTopic') {
    navigator.clipboard.writeText(S.topic).then(() => toast('Canal copiado'), () => toast('No se pudo copiar'));
    return;
  }
  if (t.id === 'wipe') {
    if (confirm('¿Borrar tus lugares y respuestas de este teléfono?')) {
      localStorage.removeItem(KEY);
      S.places = []; S.feedback = []; S.last = {}; S.data = {}; S.view = 'home';
      paint();
    }
    return;
  }
  if (t.hasAttribute('data-pick')) { addPlace(S.results[+t.getAttribute('data-pick')]); return; }
  if (t.hasAttribute('data-del')) {
    const id = t.getAttribute('data-del');
    S.places = S.places.filter(p => p.id !== id);
    delete S.data[id]; delete S.last[id];
    save(); paint(); return;
  }
  if (t.hasAttribute('data-ask')) {
    const id = t.getAttribute('data-ask');
    S.askFor = S.askFor === id ? null : id;
    paint(); return;
  }
  if (t.hasAttribute('data-ans')) {
    const id = t.getAttribute('data-place');
    const p = S.places.find(x => x.id === id);
    const d = S.data[id];
    if (p && d) {
      const pred = {};
      d.models.forEach(m => { pred[m.m] = { rain: m.rain, wind: m.wind, hail: m.hail }; });
      S.feedback.push({ p: p.name, t: Date.now(), a: t.getAttribute('data-ans'), pred });
      S.feedback = S.feedback.slice(-200);
      save();
    }
    S.askFor = null;
    paint();
    toast('Anotado. Gracias');
    return;
  }
});

function openAdd() {
  S.view = 'add';
  document.getElementById('view').innerHTML = `
    <div class="sec">Agregar lugar</div>
    <div class="card">
      <input id="q" placeholder="Escribí un barrio o ciudad" autocomplete="off">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="ghost" id="gps" style="flex:1">📍 Usar mi ubicación</button>
      </div>
      <p class="hint">Buscá al menos 3 letras y elegí de la lista.</p>
    </div>
    <div id="res"></div>
    <div style="margin-top:16px"><button class="ghost" id="back" style="width:100%">← Volver</button></div>`;
  const inp = document.getElementById('q');
  inp.focus();
  let timer;
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const v = inp.value;
    timer = setTimeout(() => search(v), 350);
  });
}

/* ===================== Inicio ===================== */
function init() {
  load();
  paint();
  if (S.places.length) refresh();
  window.addEventListener('online', () => { toast('Volvió la conexión'); refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - S.updated > 5 * 60000 && S.places.length) refresh();
  });
  setInterval(() => { if (!document.hidden && S.places.length) refresh(); }, 5 * 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}

document.addEventListener('DOMContentLoaded', init);
