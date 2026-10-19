'use strict';

/* ============ Config ============ */
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const MODEL_NAME = { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON', gem_seamless: 'GEM' };
const LEVELS = [
  { t: 'Sin riesgo', i: '✅' },
  { t: 'Atención', i: '🟡' },
  { t: 'Alerta', i: '🟠' },
  { t: 'Peligro', i: '🔴' }
];
const KEY = 'alerta-meteo.v2';
const DEFAULT_TOPIC = 'alertameteo-cba-7q4m9k2x';

const S = {
  places: [], topic: DEFAULT_TOPIC, last: {}, feedback: [],
  data: {}, updated: 0, busy: false, view: 'home', installEvt: null, q: '', results: []
};

/* ============ Storage ============ */
function load() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { raw = {}; }
  S.places = Array.isArray(raw.places) ? raw.places : [];
  S.feedback = Array.isArray(raw.feedback) ? raw.feedback : [];
  S.last = raw.last && typeof raw.last === 'object' ? raw.last : {};
  S.topic = raw.topic || DEFAULT_TOPIC;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      places: S.places, topic: S.topic, last: S.last, feedback: S.feedback
    }));
  } catch (e) { }
}

/* ============ Helpers ============ */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const clampLevel = n => Math.max(0, Math.min(3, n | 0));

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
  const h = Math.round(m / 60);
  return 'hace ' + h + ' h';
}

function hourLabel(iso) { return iso.slice(11, 16); }

/* ============ Riesgo ============ */
/* Un modelo -> nivel 0..3 por lluvia, ráfagas y granizo en las próximas 3 h */
function riskPoint(o) {
  const rain = o.rain, gust = o.gust, cape = o.cape, code = o.code;
  const a = rain < 0.5 ? 0 : rain < 2.5 ? 1 : rain < 7.6 ? 2 : 3;
  const b = gust < 50 ? 0 : gust < 70 ? 1 : gust < 90 ? 2 : 3;
  const hail = code >= 96 ? 3 : (cape >= 2500 && gust >= 80 ? 2 : (cape >= 1500 && gust >= 80 ? 1 : 0));
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
    const x = riskPoint({ rain: r, gust: gu[i] ?? 0, cape: ca[i] ?? 0, code: wc[i] ?? 0 });
    if (i < 3) {
      acc += r;
      lvl = Math.max(lvl, x.l);
      rain = rain || x.rain; wind = wind || x.wind; hail = hail || x.hail;
    }
    hours.push({ p: r, prob: pp[i] ?? null });
  }
  lvl = Math.max(lvl, acc >= 50 ? 3 : acc >= 25 ? 2 : 0);
  return { m, l: lvl, rain, wind, hail, acc, hours };
}

/* Nivel mostrado: el que alcanzan al menos 2 de los 4 modelos */
function aggregate(H) {
  const models = MODELS.map(m => modelRisk(H, m));
  const sorted = models.map(x => x.l).sort((a, b) => b - a);
  const level = clampLevel(sorted[1] ?? sorted[0] ?? 0);
  const agree = k => models.filter(x => x[k]).length >= 2;
  const any = k => models.some(x => x[k]);
  return {
    models, level,
    rain: agree('rain'), wind: agree('wind'), hail: agree('hail'),
    signals: { rain: any('rain'), wind: any('wind'), hail: any('hail') },
    votes: { rain: models.filter(x => x.rain).length, wind: models.filter(x => x.wind).length, hail: models.filter(x => x.hail).length }
  };
}

/* ============ Red ============ */
async function fetchPlace(p) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', p.lat);
  u.searchParams.set('longitude', p.lon);
  u.searchParams.set('hourly', 'precipitation,precipitation_probability,wind_gusts_10m,cape,weather_code');
  u.searchParams.set('models', MODELS.join(','));
  u.searchParams.set('forecast_hours', '13');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u.toString(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly || !j.hourly.time) throw new Error('sin datos');
  return j.hourly;
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
    if (!rows.length) return 'Canal: sin datos';
    const last = rows[rows.length - 1];
    const base = rows.find(x => last.t - x.t <= 1800) || rows[0];
    const d = last.v - base.v;
    const age = Math.max(0, Math.round(Date.now() / 60000 - last.t / 60));
    let out = 'Canal: ' + last.v.toFixed(0) + ' cm (' + (d >= 0 ? '+' : '') + d.toFixed(0) + ' cm/30min)';
    if (age > 35) out += ' · ⚠️ sensor sin señal';
    if (d >= 15) out += ' · ⚠️ sube rápido';
    return out;
  } catch (e) { return 'Canal: sin conexión'; }
}

/* ============ Carga ============ */
async function refresh() {
  if (S.busy) return;
  S.busy = true;
  render();
  const results = await Promise.allSettled(S.places.map(p => fetchPlace(p)));
  let ok = 0;
  S.places.forEach((p, i) => {
    const res = results[i];
    if (res.status === 'fulfilled') {
      S.data[p.id] = aggregate(res.value);
      S.data[p.id].times = res.value.time;
      ok++;
      checkAlert(p, S.data[p.id]);
    } else {
      S.data[p.id] = Object.assign(S.data[p.id] || {}, { error: res.reason && res.reason.message });
    }
  });
  S.updated = Date.now();
  S.busy = false;
  save();
  render();
  if (!ok && S.places.length) toast('No se pudo actualizar. Revisá la conexión.');
}

function checkAlert(p, agg) {
  const prev = S.last[p.id] ?? -1;
  if (agg.level >= 2 && agg.level > prev) {
    const bits = [agg.rain ? 'lluvia' : '', agg.wind ? 'ráfagas' : '', agg.hail ? 'granizo' : ''].filter(Boolean).join(', ');
    notify(LEVELS[agg.level].i + ' ' + LEVELS[agg.level].t + ' – ' + p.name, bits || 'Condiciones adversas en las próximas 3 h');
  }
  S.last[p.id] = agg.level;
}

function notify(title, body) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, {
      body, icon: 'icon-192.png', badge: 'icon-192.png',
      vibrate: [300, 100, 300], requireInteraction: true, tag: 'alerta-meteo'
    })).catch(() => { });
  } catch (e) { }
}

async function askNotify() {
  if (typeof Notification === 'undefined') { toast('Este navegador no permite avisos'); return; }
  const perm = await Notification.requestPermission();
  toast(perm === 'granted' ? 'Avisos activados' : 'Avisos bloqueados en el navegador');
  render();
}

/* ============ Vistas ============ */
function render() {
  const sub = document.getElementById('sub');
  const view = document.getElementById('view');
  if (!S.places.length) {
    sub.textContent = 'Empezá agregando un lugar';
    view.innerHTML = viewEmpty();
    return;
  }
  sub.textContent = (S.busy ? 'Actualizando…' : 'Actualizado ' + ago(S.updated));
  view.innerHTML = S.view === 'settings' ? viewSettings() : viewHome();
}

function viewEmpty() {
  return `
  <div class="empty">
    <p style="font-size:15px;color:#e8eefc;margin:0 0 6px">¿Qué lugares querés vigilar?</p>
    <p style="margin:0 0 14px">Casa, colegio, el trabajo. Te aviso si viene lluvia fuerte, ráfagas o granizo.</p>
    <button id="startAdd">➕ Agregar mi primer lugar</button>
  </div>
  ${S.results.length ? resultsHtml() : ''}
  <p class="hint" style="text-align:center;margin-top:14px">Tus lugares quedan guardados solo en este dispositivo.</p>`;
}

function viewHome() {
  const cards = S.places.map(p => cardHtml(p)).join('');
  const q = pendingQuestion();
  return (q ? q : '') + cards + tipsHtml();
}

function pendingQuestion() {
  // Pregunta de verificación empírica: si hubo señal en las últimas 3 h y no respondimos
  const now = Date.now();
  const open = S.feedback.find(f => !f.a && now - f.t < 3 * 3600 * 1000);
  if (!open) return '';
  const btns = [['Llueve', 'rain'], ['No llueve', 'no'], ['Granizo', 'hail'], ['Viento fuerte', 'wind']]
    .map(([t, v]) => `<button class="ghost" data-ans="${v}">${t}</button>`).join(' ');
  return `<div class="card l1"><div class="name">¿Está pasando? 📍 ${esc(open.name)}</div>
    <div class="what">Se esperaba algo en esta hora. Contame qué ves y afino los modelos.</div>
    <div style="margin-top:10px">${btns}</div></div>`;
}

function cardHtml(p) {
  const d = S.data[p.id];
  if (!d || d.error) {
    return `<div class="card"><div class="top"><div class="name">${esc(p.name)}</div>
      <div class="lvl">sin datos</div></div>
      <div class="what">${d ? 'No se pudo obtener el pronóstico.' : 'Cargando…'}</div></div>`;
  }
  const lv = LEVELS[d.level];
  const bits = [
    d.hail ? '🧊 <b>granizo</b>' : '',
    d.wind ? '💨 <b>ráfagas fuertes</b>' : '',
    d.rain ? '🌧️ <b>lluvia</b>' : ''
  ].filter(Boolean).join(' · ');
  const dots = d.models.map(x => `<span><i class="dot l${x.l}"></i>${MODEL_NAME[x.m]}</span>`).join('');
  const bars = barsHtml(d);
  const votes = [
    d.votes.rain ? `lluvia ${d.votes.rain}/4` : '',
    d.votes.wind ? `ráfagas ${d.votes.wind}/4` : '',
    d.votes.hail ? `granizo ${d.votes.hail}/4` : ''
  ].filter(Boolean).join(' · ');
  return `<div class="card l${d.level}" data-card="${p.id}">
    <div class="top"><div class="name">${esc(p.name)}</div>
      <div class="lvl">${lv.i} ${lv.t}</div></div>
    <div class="what">${bits || 'Sin fenómenos previstos en las próximas 3 h'}</div>
    ${votes ? `<div class="chips"><span class="chip on">${votes}</span></div>` : ''}
    <div class="dots">${dots}</div>
    ${bars}
    <div class="meta">
      <span>${p.canal ? '<span id="canal-' + p.id + '">Canal: …</span> · ' : ''}
        <a href="https://www.rainviewer.com/map.html?loc=${p.lat},${p.lon},9" target="_blank" rel="noopener">🛰️ Radar</a> ·
        <a href="https://map.blitzortung.org/#9/${p.lat}/${p.lon}" target="_blank" rel="noopener">⚡ Rayos</a></span>
      <span><button class="ghost" data-fb="${p.id}" style="padding:4px 8px;font-size:11px">¿Qué ves ahora?</button></span>
    </div>
  </div>`;
}

function barsHtml(d) {
  const n = Math.min(12, d.times.length);
  let out = '<div class="bars">', meta = '<div class="barmeta">';
  for (let i = 0; i < n; i++) {
    const vals = d.models.map(m => m.hours[i] ? m.hours[i].prob : null).filter(v => v !== null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const rain = d.models.some(m => m.hours[i] && m.hours[i].p >= 0.2);
    const h = Math.max(4, Math.round(avg));
    out += `<div class="bar${rain ? ' s' : ''}" style="height:${h}%" title="${hourLabel(d.times[i])} · ${Math.round(avg)}%"></div>`;
    meta += `<div>${i % 2 === 0 ? hourLabel(d.times[i]).slice(0, 2) : ''}</div>`;
  }
  return out + '</div>' + meta + '</div>';
}

function tipsHtml() {
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  if (perm === 'granted') return '';
  return `<div class="card"><div class="name">🔔 Avisos</div>
    <div class="what">Activá las notificaciones para que te avise aunque no estés mirando.</div>
    <div style="margin-top:10px"><button id="enableNotify">Activar avisos</button></div></div>`;
}

function viewSettings() {
  const list = S.places.map(p => `<div class="res" data-del="${p.id}">
      <span>${esc(p.name)}<br><small>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}${p.canal ? ' · canal: ' + esc(p.canal) : ''}</small></span>
      <span style="color:#e74c3c;font-size:13px">Eliminar</span></div>`).join('') || '<p class="hint">Sin lugares todavía.</p>';

  const score = scoreHtml();
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  return `
  <h2>Lugares</h2>
  ${list}
  <div style="margin-top:10px"><button id="addPlace">➕ Agregar lugar</button></div>

  <h2>Avisos</h2>
  <div class="card">
    <div class="what">Permiso del navegador: <b>${perm === 'granted' ? 'activado' : perm === 'denied' ? 'bloqueado' : 'sin activar'}</b></div>
    <div style="margin-top:10px"><button id="enableNotify2">${perm === 'granted' ? 'Probar aviso' : 'Activar avisos'}</button></div>
    <label for="topic">Canal de ntfy (para avisos con la app cerrada)</label>
    <input id="topic" value="${esc(S.topic)}" autocapitalize="off" spellcheck="false">
    <p class="hint">Instalá la app <b>ntfy</b> en el celular y suscribite a este mismo canal. El repositorio ya manda los avisos cada 10 minutos.</p>
  </div>

  <h2>Precisión de los modelos</h2>
  ${score}

  <h2>Datos</h2>
  <div class="card">
    <div class="what">Tus lugares y respuestas se guardan solo en este dispositivo.</div>
    <div style="margin-top:10px"><button class="ghost" id="wipe">Borrar todo</button></div>
  </div>
  <div style="margin-top:16px"><button class="ghost" id="back">← Volver</button></div>`;
}

function scoreHtml() {
  const done = S.feedback.filter(f => f.a && f.pred);
  if (!done.length) return `<div class="card"><div class="what">Todavía no hay datos. Cuando respondas “¿Qué ves ahora?”, acá vas a ver qué modelo acierta más en tu zona.</div></div>`;
  const tot = {};
  done.forEach(f => {
    Object.keys(f.pred).forEach(m => {
      const pred = f.pred[m];
      let hit = false;
      if (f.a === 'no') hit = !pred.rain && !pred.wind && !pred.hail;
      else hit = !!pred[f.a] || (f.a === 'rain' && pred.hail) || (f.a === 'hail' && pred.rain);
      tot[m] = tot[m] || [0, 0];
      tot[m][1]++;
      if (hit) tot[m][0]++;
    });
  });
  const rows = Object.keys(tot).map(m => {
    const [hit, n] = tot[m];
    const pct = Math.round(100 * hit / n);
    return `<div class="res" style="cursor:default"><span>${MODEL_NAME[m] || m}</span><span class="pill">${hit}/${n} · ${pct}%</span></div>`;
  }).join('');
  return `<div class="card">${rows}<p class="hint">Aciertos sobre ${done.length} respuesta(s) tuyas.</p></div>`;
}

/* ============ Búsqueda de lugares ============ */
async function search(q) {
  S.q = q;
  if (q.trim().length < 3) { S.results = []; render(); return; }
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
  render();
}

function resultsHtml() {
  return `<h2>Resultados</h2>` + S.results.map((r, i) => `
    <div class="res" data-pick="${i}">
      <span>${esc(r.name)}<br><small>${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}</small></span>
      <span style="color:#8ab4ff">Agregar</span>
    </div>`).join('');
}

function addPlace(p) {
  S.places.push({ id: uid(), name: p.name, lat: p.lat, lon: p.lon, canal: '' });
  S.results = []; S.q = ''; S.view = 'home';
  save(); render(); refresh();
}

function useGPS() {
  if (!navigator.geolocation) { toast('Sin GPS en este navegador'); return; }
  toast('Buscando ubicación…');
  navigator.geolocation.getCurrentPosition(pos => {
    addPlace({ name: 'Mi ubicación', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) });
  }, () => toast('No pude obtener la ubicación'), { enableHighAccuracy: true, timeout: 12000 });
}

/* ============ Eventos ============ */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-pick],[data-del],[data-fb],[data-ans],#startAdd,#addPlace,#gear,#refresh,#back,#enableNotify,#enableNotify2,#wipe,#gps');
  if (!t) return;

  if (t.id === 'refresh') { refresh(); toast('Actualizando…'); return; }
  if (t.id === 'gear') { S.view = S.view === 'settings' ? 'home' : 'settings'; render(); return; }
  if (t.id === 'back') { S.view = 'home'; render(); return; }
  if (t.id === 'startAdd' || t.id === 'addPlace') {
    S.view = 'add'; S.results = []; render(); openAdd(); return;
  }
  if (t.id === 'gps') { useGPS(); return; }
  if (t.id === 'enableNotify' || t.id === 'enableNotify2') {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') { notify('🔔 Prueba', 'Así se van a ver los avisos'); return; }
    askNotify(); return;
  }
  if (t.id === 'wipe') {
    if (confirm('¿Borrar lugares y respuestas de este dispositivo?')) {
      localStorage.removeItem(KEY);
      S.places = []; S.feedback = []; S.last = {}; S.data = {}; S.view = 'home';
      render();
    }
    return;
  }
  if (t.hasAttribute('data-pick')) {
    addPlace(S.results[+t.getAttribute('data-pick')]);
    return;
  }
  if (t.hasAttribute('data-del')) {
    const id = t.getAttribute('data-del');
    S.places = S.places.filter(p => p.id !== id);
    delete S.data[id]; delete S.last[id];
    save(); render(); return;
  }
  if (t.hasAttribute('data-ans')) {
    const open = S.feedback.find(f => !f.a);
    if (open) { open.a = t.getAttribute('data-ans'); save(); render(); toast('¡Gracias!'); }
    return;
  }
  if (t.hasAttribute('data-fb')) {
    const id = t.getAttribute('data-fb');
    const p = S.places.find(x => x.id === id);
    const d = S.data[id];
    if (!p || !d) return;
    const pred = {};
    d.models.forEach(m => { pred[m.m] = { rain: m.rain, wind: m.wind, hail: m.hail }; });
    S.feedback.push({ p: id, name: p.name, t: Date.now(), pred });
    S.feedback = S.feedback.slice(-200);
    save(); render();
    toast('Anotado. Contame qué ves en el cuadro de arriba.');
    return;
  }
});

function openAdd() {
  document.getElementById('view').innerHTML = `
    <h2>Agregar lugar</h2>
    <div class="card">
      <label for="q">Nombre del lugar</label>
      <div class="row"><input id="q" placeholder="Ej: Villa Allende" autocomplete="off">
      <button id="gps" class="ghost" title="Usar mi ubicación">📍</button></div>
      <p class="hint">Escribí al menos 3 letras y elegí de la lista.</p>
    </div>
    <div id="res"></div>
    <div style="margin-top:16px"><button class="ghost" id="back">← Volver</button></div>`;
  const inp = document.getElementById('q');
  inp.focus();
  let timer;
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const v = inp.value;
    timer = setTimeout(async () => {
      await search(v);
      const box = document.getElementById('res');
      if (box) box.innerHTML = S.results.length ? resultsHtml() : '';
    }, 350);
  });
}

/* ============ Init ============ */
function init() {
  load();
  render();
  if (S.places.length) refresh();
  window.addEventListener('online', () => { toast('Conexión recuperada'); refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - S.updated > 5 * 60000 && S.places.length) refresh();
  });
  setInterval(() => { if (!document.hidden && S.places.length) refresh(); }, 5 * 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}

document.addEventListener('DOMContentLoaded', init);
