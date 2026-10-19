'use strict';

/* ===================== Configuración ===================== */
const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const MODEL_NAME = { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON', gem_seamless: 'GEM' };
const KEY = 'asn.v1';
const LEGACY = ['paraguas.v1', 'alerta-meteo.v2'];
const DEFAULT_TOPIC = 'asn4-cba-7q4m9k2x';
const INTRO_KEY = 'asn.intro';
const CBA = { lat: -31.42, lon: -64.18 };

const S = {
  places: [], topic: DEFAULT_TOPIC, last: {}, feedback: [],
  data: {}, updated: 0, busy: false, view: 'home', results: [],
  askFor: null, query: '', canInstall: false, hideInstall: false, hideNotify: false
};

/* ===================== Almacenamiento ===================== */
function load() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { raw = {}; }
  if (!raw.places || !raw.places.length) {
    for (const k of LEGACY) {
      try {
        const old = JSON.parse(localStorage.getItem(k) || '{}');
        if (Array.isArray(old.places) && old.places.length) { raw = old; break; }
      } catch (e) { }
    }
  }
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

/* ===================== Utilidades ===================== */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 2800);
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
function seriesByBase(H, base) {
  return Object.keys(H)
    .filter(k => k === base || k.startsWith(base + '_'))
    .map(k => H[k]);
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
}

/* ===================== Riesgo ===================== */
function pointRisk(o) {
  const a = o.rain < 0.5 ? 0 : o.rain < 2.5 ? 1 : o.rain < 7.6 ? 2 : 3;
  const b = o.gust < 50 ? 0 : o.gust < 70 ? 1 : o.gust < 90 ? 2 : 3;
  return { l: Math.max(a, b), rain: a >= 1, wind: b >= 1 };
}

function modelRisk(H, m) {
  const g = k => H[k + '_' + m] || [];
  const pr = g('precipitation'), gu = g('wind_gusts_10m'), pp = g('precipitation_probability');
  let acc = 0, lvl = 0, rain = false, wind = false;
  const hours = [];
  for (let i = 0; i < pr.length; i++) {
    const r = pr[i] ?? 0;
    const x = pointRisk({ rain: r, gust: gu[i] ?? 0 });
    if (i < 3) {
      acc += r;
      lvl = Math.max(lvl, x.l);
      rain = rain || x.rain; wind = wind || x.wind;
    }
    hours.push({ p: r, prob: pp[i] ?? null, gust: gu[i] ?? 0 });
  }
  lvl = Math.max(lvl, acc >= 60 ? 3 : acc >= 30 ? 2 : acc >= 15 ? 1 : 0);
  return { m, l: lvl, rain, wind, acc, hours };
}

function ensembleRisk(H) {
  const ids = Object.keys(H)
    .filter(k => /^precipitation_member\d+$/.test(k))
    .map(k => k.replace('precipitation_member', ''));
  const sum3 = key => {
    const a = H[key] || [];
    return (a[0] ?? 0) + (a[1] ?? 0) + (a[2] ?? 0);
  };
  const rains = ids.map(id => sum3('precipitation_member' + id));
  const gusts = ids.map(id => {
    const arr = (H['wind_gusts_10m_member' + id] || []).slice(0, 3);
    return arr.length ? Math.max(...arr.map(v => v ?? 0)) : 0;
  });
  const p = (arr, th) => arr.length ? arr.filter(v => v >= th).length / arr.length : 0;
  return {
    n: ids.length,
    rain10: p(rains, 10), rain15: p(rains, 15), rain30: p(rains, 30), rain60: p(rains, 60),
    gust60: p(gusts, 60), gust80: p(gusts, 80), gust100: p(gusts, 100)
  };
}

function ensembleLevel(e) {
  let l = 0;
  if (e.rain15 >= 0.30) l = Math.max(l, 1);
  if (e.rain30 >= 0.40) l = Math.max(l, 2);
  if (e.rain60 >= 0.50) l = Math.max(l, 3);
  if (e.gust60 >= 0.40) l = Math.max(l, 1);
  if (e.gust80 >= 0.40) l = Math.max(l, 2);
  if (e.gust100 >= 0.30) l = Math.max(l, 3);
  return l;
}

function aggregate(H, ens) {
  const models = MODELS.map(m => modelRisk(H, m));
  const sorted = models.map(x => x.l).sort((a, b) => b - a);
  const detLevel = Math.min(3, Math.max(0, sorted[1] ?? sorted[0] ?? 0));
  const votes = { rain: models.filter(x => x.rain).length, wind: models.filter(x => x.wind).length };

  const capeMax = seriesByBase(H, 'cape')
    .reduce((max, s) => Math.max(max, ...s.slice(0, 3).map(v => v ?? 0)), 0);
  const fzSeries = seriesByBase(H, 'freezing_level_height');
  const freezing = fzSeries.length ? Math.max(...fzSeries[0].slice(0, 3).map(v => v ?? 0)) : 0;
  const gustMax = Math.max(0, ...models.map(m => Math.max(...m.hours.slice(0, 3).map(h => h.gust))));

  const eLevel = ens ? ensembleLevel(ens) : null;
  let level = eLevel == null ? detLevel : eLevel;
  if (eLevel != null && Math.abs(detLevel - eLevel) > 1) level = Math.min(detLevel, eLevel) + 1;

  const storm = capeMax >= 1000 && (!ens || ens.rain10 >= 0.30);
  if (storm) level = Math.max(level, 1);

  const hailPossible = capeMax >= 1500 && gustMax >= 70 && freezing >= 3000 && freezing <= 4500;

  const snowSeries = seriesByBase(H, 'snowfall');
  const snowHours = [];
  for (let i = 0; i < 13; i++) {
    snowHours.push(snowSeries.reduce((m, s) => Math.max(m, s[i] ?? 0), 0));
  }
  const snow3 = snowHours.slice(0, 3).reduce((a, b) => a + b, 0);
  if (snow3 >= 5) level = 3;
  else if (snow3 >= 2) level = Math.max(2, level);
  else if (snow3 >= 0.2) level = Math.max(1, level);

  return {
    models, level: Math.min(3, level), detLevel, eLevel, votes,
    capeMax, gustMax, freezing, storm, hailPossible, ens, snow3, snowHours
  };
}

/* ===================== Lenguaje ===================== */
function levelInfo(d) {
  if (d.snow3 >= 0.5) {
    if (d.level >= 3) return { cls: 'lv3', emoji: '❄️', title: 'Nevada fuerte', line: 'Se espera nieve acumulada en tu zona.', action: 'Evitá salir en auto. Abrigate bien.', cta: '🚨' };
    if (d.level === 2) return { cls: 'lv2', emoji: '🌨️', title: 'Puede nevar', line: 'Hay chances de nieve en las próximas 3 horas.', action: 'Si tenés que salir, hacelo con cuidado.', cta: '⚠️' };
    return { cls: 'lv1', emoji: '🌨️', title: 'Puede caer nieve', line: 'Se espera algo de nieve en las próximas 3 horas.', action: 'Abrigate y seguí el pronóstico.', cta: '☂️' };
  }
  const rain = d.votes.rain >= 2, wind = d.votes.wind >= 2;
  let what = rain ? 'lluvia' : wind ? 'ráfagas fuertes' : 'viento';
  if (d.storm) what = 'tormenta eléctrica';
  if (d.hailPossible) what = 'granizo y tormenta';

  if (d.level === 0) return { cls: 'lv0', emoji: '😌', title: 'Todo tranquilo', line: 'No se espera nada raro en las próximas 3 horas.', action: 'Buen momento para estar afuera.', cta: '✅' };
  if (d.level === 1) return { cls: 'lv1', emoji: '🌤️', title: 'Ojo con el cielo', line: 'Puede caer algo leve en las próximas 3 horas.', action: 'Si salís, llevá paraguas por las dudas.', cta: '☂️' };
  if (d.level === 2) return {
    cls: 'lv2', emoji: d.hailPossible ? '🧊' : d.storm ? '⛈️' : wind ? '💨' : '🌧️',
    title: 'Se viene ' + what, line: 'Varios escenarios coinciden para las próximas 3 horas.',
    action: 'Guardá lo que tengas afuera y cerrá las ventanas.', cta: '⚠️'
  };
  return {
    cls: 'lv3', emoji: d.hailPossible ? '🧊' : '⛈️', title: 'Peligro: ' + what,
    line: 'Se viene fuerte, con alta coincidencia entre escenarios.',
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
    if (d.snowHours && d.snowHours[i] >= 0.1) return { iso: d.times[i], label: 'Nieve' };
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

/* ===================== Red: clima ===================== */
async function fetchPlace(p) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', p.lat);
  u.searchParams.set('longitude', p.lon);
  u.searchParams.set('hourly', 'precipitation,precipitation_probability,wind_gusts_10m,cape,weather_code,freezing_level_height,snowfall,snow_depth');
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

async function fetchEnsemble(p) {
  const u = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  u.searchParams.set('latitude', p.lat);
  u.searchParams.set('longitude', p.lon);
  u.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
  u.searchParams.set('models', 'ecmwf_ifs025');
  u.searchParams.set('forecast_hours', '4');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u.toString(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly) throw new Error('sin ensemble');
  return j.hourly;
}

/* ===================== Red: direcciones ===================== */
const GEO_CACHE = new Map();
let geoAbort = null;
let nominatimLast = 0;

async function geoPhoton(term, sig) {
  const q = /c[oó]rdoba/i.test(term) ? term : term + ', Córdoba, Argentina';
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q);
  u.searchParams.set('limit', '8');
  const r = await fetch(u.toString(), { signal: sig });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.features || [])
    .filter(f => (f.properties.countrycode || '').toUpperCase() === 'AR')
    .map(f => {
      const p = f.properties;
      const street = [p.street || p.name, p.housenumber].filter(Boolean).join(' ');
      const label = (p.housenumber ? street : (p.street || p.name)) || '';
      const sub = [p.district, p.city || p.locality, p.state]
        .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      const [lon, lat] = f.geometry.coordinates;
      const kind = p.housenumber ? 'Dirección' : /city|town|village/.test(p.type || '') ? 'Ciudad' : 'Calle';
      return { label: label || sub, sub, lat: +lat, lon: +lon, kind, src: 1 };
    })
    .filter(x => x.label && x.sub);
}

async function geoNominatim(term, sig) {
  const wait = 1100 - (Date.now() - nominatimLast);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  nominatimLast = Date.now();
  const m = term.match(/^(.*?)\s+(\d{1,5})$/);
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('limit', '6');
  u.searchParams.set('countrycodes', 'ar');
  if (m) { u.searchParams.set('street', m[1] + ' ' + m[2]); u.searchParams.set('city', 'Córdoba'); }
  else u.searchParams.set('q', term);
  const r = await fetch(u.toString(), { signal: sig, headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map(o => {
    const a = o.address || {};
    const label = o.name || (o.display_name || '').split(',')[0];
    const sub = [a.suburb || a.neighbourhood || a.city_district, a.city || a.town || a.village, a.state]
      .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
    return { label, sub, lat: +o.lat, lon: +o.lon, kind: o.addresstype === 'road' ? 'Calle' : 'Lugar', src: 2 };
  }).filter(x => x.label);
}

async function geoOpenMeteo(term, sig) {
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.searchParams.set('name', term);
  u.searchParams.set('count', '6');
  u.searchParams.set('language', 'es');
  u.searchParams.set('countryCode', 'AR');
  const r = await fetch(u.toString(), { signal: sig });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || []).map(x => ({
    label: x.name,
    sub: [x.admin2, x.admin1].filter(Boolean).join(', '),
    lat: x.latitude, lon: x.longitude, kind: 'Ciudad', src: 3
  }));
}

function geoRank(r) {
  return r.kind === 'Dirección' ? 0 : r.kind === 'Calle' ? 1 : r.kind === 'Ciudad' ? 2 : 3;
}

function geoDedupe(list) {
  const out = [];
  list.sort((a, b) => geoRank(a) - geoRank(b));
  for (const r of list) {
    const dup = out.some(x => Math.abs(x.lat - r.lat) < 0.0006 && Math.abs(x.lon - r.lon) < 0.0006);
    if (!dup) out.push(r);
  }
  return out;
}

async function geocode(term) {
  const q = term.trim();
  if (q.length < 3) return [];
  if (GEO_CACHE.has(q)) return GEO_CACHE.get(q);
  if (geoAbort) geoAbort.abort();
  geoAbort = new AbortController();
  const sig = geoAbort.signal;
  const parts = await Promise.allSettled([
    geoPhoton(q, sig),
    geoNominatim(q, sig),
    geoOpenMeteo(q, sig)
  ]);
  const all = [];
  parts.forEach(p => { if (p.status === 'fulfilled') all.push(...p.value); });
  const out = geoDedupe(all).slice(0, 10);
  GEO_CACHE.set(q, out);
  return out;
}

/* ===================== Carga ===================== */
async function refresh() {
  if (S.busy) return;
  S.busy = true;
  paint();
  const results = await Promise.allSettled(S.places.map(async p => {
    const [det, ens] = await Promise.allSettled([fetchPlace(p), fetchEnsemble(p)]);
    if (det.status !== 'fulfilled') throw det.reason;
    return { det: det.value, ens: ens.status === 'fulfilled' ? ensembleRisk(ens.value) : null };
  }));

  let ok = 0;
  S.places.forEach((p, i) => {
    const res = results[i];
    if (res.status === 'fulfilled') {
      const agg = aggregate(res.value.det.hourly, res.value.ens);
      agg.times = res.value.det.hourly.time;
      agg.current = res.value.det.current;
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
      vibrate: [300, 100, 300], requireInteraction: true, tag: 'asn'
    })).catch(() => { });
  } catch (e) { }
}

async function askNotify() {
  if (typeof Notification === 'undefined') { toast('Este navegador no permite avisos'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    S.hideNotify = false;
    notify('ASN 4.0 · avisos activados', 'Así te vamos a avisar.');
    toast('Listo, avisos activados');
  } else {
    toast(perm === 'denied' ? 'Quedaron bloqueados en el navegador' : 'No se activaron');
  }
  paint();
}

/* ===================== Instalación ===================== */
let deferredPrompt = null;

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try {
      const c = await deferredPrompt.userChoice;
      toast(c.outcome === 'accepted' ? 'Instalando…' : 'Cancelaste la instalación');
    } catch (e) { }
    deferredPrompt = null;
    S.canInstall = false;
    paint();
    return;
  }
  S.view = 'install';
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
  const gear = document.getElementById('gear');
  if (gear) gear.textContent = S.view === 'settings' ? '✕' : '⚙️';

  if (!S.places.length) {
    sub.textContent = 'Alerta Super Niño 4.0';
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
  sub.textContent = msg + (S.busy ? ' · actualizando' : ' · ' + ago(S.updated));

  if (S.view === 'settings') view.innerHTML = viewSettings();
  else if (S.view === 'add') { /* la vista se arma aparte */ }
  else if (S.view === 'install') view.innerHTML = viewInstall();
  else view.innerHTML = viewHome();
}

function viewEmpty() {
  const canInstall = !isStandalone();
  return `<div class="empty">
    <div class="big">🛰️</div>
    <h2>¿Dónde querés que te avise?</h2>
    <p>Casa, el colegio, el trabajo. Te digo si viene lluvia fuerte, ráfagas, granizo, nieve o tormenta eléctrica antes de que salgas.</p>
    <div class="row">
      <button id="startAdd">Buscar una dirección</button>
      <button class="ghost" id="gps">📍 Usar mi ubicación</button>
    </div>
    <p class="hint">Se guarda solo en este teléfono.</p>
  </div>
  ${canInstall ? installBanner() : ''}
  ${notifyBanner()}`;
}

function viewHome() {
  const ordered = [...S.places].sort((a, b) => (levelOf(b) - levelOf(a)) || a.name.localeCompare(b.name));
  const loading = S.busy && !Object.keys(S.data).length;
  const body = loading
    ? '<div class="skel hero-sk"></div><div class="skel hero-sk" style="height:140px"></div>'
    : ordered.map(heroHtml).join('');
  const add = `<button class="ghost" id="addPlace" style="width:100%;margin:6px 0 2px">＋ Agregar otro lugar</button>`;
  return installBanner() + notifyBanner() + body + add +
    `<div class="foot" style="margin-top:16px">Tocá “Ver detalles” si querés los datos finos.</div>`;
}

function installBanner() {
  if (isStandalone() || S.hideInstall) return '';
  return `<div class="banner">
    <div class="bi">📲</div>
    <div class="bt"><b>Instalá ASN 4.0</b><span>Queda en la pantalla de inicio y abre sin navegador.</span></div>
    <button id="installBtn">Instalar</button>
    <button class="x2" data-dismiss="install" aria-label="Ocultar">✕</button>
  </div>`;
}

function notifyBanner() {
  const p = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  if (p === 'granted' || S.hideNotify || p === 'unsupported') return '';
  if (p === 'denied') {
    return `<div class="banner warn">
      <div class="bi">🔕</div>
      <div class="bt"><b>Avisos bloqueados</b><span>Activalos desde el candado del navegador para este sitio.</span></div>
    </div>`;
  }
  return `<div class="banner warn">
    <div class="bi">🔔</div>
    <div class="bt"><b>Avisos en tiempo real</b><span>Te avisamos apenas sube el riesgo, aunque no estés mirando.</span></div>
    <button id="enableNotify">Activar</button>
    <button class="x2" data-dismiss="notify" aria-label="Ocultar">✕</button>
  </div>`;
}

function heroHtml(p) {
  const d = S.data[p.id];
  if (!d || d.error) {
    return `<section class="hero lv0" style="opacity:.9">
      <div class="where"><span><b>${esc(p.name)}</b></span><span>${d && d.error ? 'sin datos' : 'cargando'}</span></div>
      <div class="main"><div class="emoji">⏳</div><div><div class="title">Un segundo…</div>
      <div class="line">${d && d.error ? 'No pudimos traer el pronóstico.' : 'Estamos mirando el cielo.'}</div></div></div>
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
    ? `<button class="ghost" data-ask="${p.id}" style="padding:7px 10px;font-size:12px">¿Está pasando?</button>`
    : '';

  return `<section class="hero ${info.cls}">
    <div class="where"><span>📍 <b>${esc(p.name)}</b></span><span class="chip3h">próximas 3 h</span></div>

    <div class="main">
      <div class="emoji">${info.emoji}</div>
      <div>
        <div class="title">${info.title}</div>
        <div class="line">${info.line}</div>
      </div>
    </div>

    <div class="action"><span class="cta">${info.cta}</span><span>${info.action}</span></div>

    <div class="event ${ev.big ? 'big' : ''}">⏱ ${ev.txt}</div>

    ${timelineHtml(d)}

    ${tilesHtml(d)}

    <div class="now">
      <span>Ahora <b>${nowBits || '—'}</b></span>
      <span style="font-size:11.5px;color:#7d90b3">${d.ens ? d.ens.n + ' escenarios' : ''}</span>
    </div>

    <details class="more">
      <summary>Ver detalles</summary>
      <div class="mrow">${d.models.map(x => `<span><i class="dot d${x.l}"></i>${MODEL_NAME[x.m]}</span>`).join('')}</div>
      ${probHtml(d)}
      ${barsHtml(d)}
      <div class="links">
        <a href="https://www.rainviewer.com/map.html?loc=${p.lat},${p.lon},9" target="_blank" rel="noopener">🛰️ Radar</a>
        <a href="https://map.blitzortung.org/#9/${p.lat}/${p.lon}" target="_blank" rel="noopener">⚡ Rayos</a>
        ${askBtn}
      </div>
    </details>

    ${ask}
  </section>`;
}

function timelineHtml(d) {
  const n = Math.min(10, d.times.length);
  let out = '<div class="timeline">';
  for (let i = 0; i < n; i++) {
    const snow = (d.snowHours && d.snowHours[i]) || 0;
    const hs = d.models.map(m => m.hours[i]).filter(Boolean);
    const avgP = hs.length ? hs.reduce((a, h) => a + (h.p || 0), 0) / hs.length : 0;
    const probs = hs.map(h => h.prob).filter(v => v != null);
    const avgProb = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
    const gust = Math.max(0, ...hs.map(h => h.gust || 0));
    let ico = '☀️';
    if (snow >= 0.1) ico = '❄️';
    else if (avgP >= 2 || avgProb >= 70) ico = '🌧️';
    else if (avgP >= 0.2 || avgProb >= 40) ico = '🌦️';
    else if (gust >= 50) ico = '💨';
    else if (avgProb >= 15) ico = '🌤️';
    const hi = avgP >= 0.2 || gust >= 50 || snow >= 0.1;
    out += `<div class="tl${i === 0 ? ' now' : ''}${hi ? ' hi' : ''}">
      <div class="h">${hourLabel(d.times[i]).slice(0, 2)}</div>
      <div class="e">${ico}</div>
      <div class="b"><i style="width:${Math.max(6, Math.round(avgProb))}%"></i></div>
    </div>`;
  }
  return out + '</div>';
}

function tilesHtml(d) {
  const calm = d.level === 0 && !anyRain(d, 6);
  const bici = !(d.level >= 2 || maxGust(d, 6) >= 50);
  const auto = !(d.level >= 2 || d.hailPossible);
  const items = [
    ['☂️', 'Paraguas', calm ? 'No hace falta' : 'Llevalo', !calm],
    ['👕', 'Tender', calm ? 'Sí, dale' : 'Mejor no', calm],
    ['🚲', 'Bici', bici ? 'Sí' : 'Mejor no', bici],
    ['🚗', 'Auto afuera', auto ? 'Sí' : 'Guardalo', auto]
  ];
  return '<div class="grid2">' + items.map(([i, t, v, ok]) =>
    `<div class="tile ${ok ? 'yes' : 'no'}"><span class="ti">${i}</span><div><div class="tt">${t}</div><div class="tv">${v}</div></div></div>`
  ).join('') + '</div>';
}

function probHtml(d) {
  if (!d.ens) return '';
  const pc = v => Math.round(v * 100) + '%';
  const bits = [
    'lluvia ≥15 mm <b>' + pc(d.ens.rain15) + '</b>',
    'ráfagas ≥60 km/h <b>' + pc(d.ens.gust60) + '</b>'
  ];
  if (d.hailPossible) bits.push('<b>posible granizo</b>');
  if (d.snow3 >= 0.2) bits.push('nieve <b>' + d.snow3.toFixed(1) + ' cm</b>');
  return `<div class="prob">${d.ens.n} de 51 escenarios: ${bits.join(' · ')}</div>`;
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

function viewInstall() {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const steps = ios
    ? [`Abrí esta página en <b>Safari</b>.`, `Tocá el botón <b>Compartir</b> (el cuadrado con la flecha).`, `Elegí <b>“Agregar a pantalla de inicio”</b>.`, `Confirmá con <b>Agregar</b>.`]
    : [`Abrí el menú del navegador (los <b>tres puntos</b> arriba a la derecha).`, `Tocá <b>“Instalar app”</b> o <b>“Agregar a pantalla principal”</b>.`, `Confirmá con <b>Instalar</b>.`];
  return `<div class="sec">Instalar ASN 4.0</div>
    <div class="card">
      <h3>${deferredPrompt ? 'Un toque y listo' : 'Son tres pasos'}</h3>
      <p>Instalada abre a pantalla completa, sin barra del navegador, y recibe avisos.</p>
      <div style="margin-top:10px">
        <ol style="margin:0;padding-left:18px;color:#c6d4ec;font-size:14px;line-height:1.9">
          ${steps.map(s => `<li>${s}</li>`).join('')}
        </ol>
      </div>
      ${deferredPrompt ? '<div style="margin-top:14px"><button id="installBtn" style="width:100%">Instalar ahora</button></div>' : ''}
    </div>
    <div style="margin-top:16px"><button class="ghost" id="back" style="width:100%">← Volver</button></div>`;
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
    const hit = f.a === 'no' ? (!pr.rain && !pr.wind && !pr.hail) : !!pr[f.a] || (f.a === 'rain' && pr.hail) || (f.a === 'hail' && pr.rain);
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

  <div class="sec">App</div>
  <div class="card list">
    <div class="row"><div class="grow"><b>Instalar en el teléfono</b><small>${isStandalone() ? 'Ya instalada' : 'Pantalla completa y avisos'}</small></div>
      ${isStandalone() ? '<span style="color:#34d399;font-size:13px">✓</span>' : '<button class="ghost" id="installBtn" style="padding:8px 12px;font-size:13px">Instalar</button>'}</div>
    <div class="row"><div class="grow"><b>Avisos</b><small>${perm === 'granted' ? 'Activados' : perm === 'denied' ? 'Bloqueados por el navegador' : 'Sin activar'}</small></div>
      ${perm === 'granted' ? '<button class="ghost" id="enableNotify" style="padding:8px 12px;font-size:13px">Probar</button>' : '<button class="ghost" id="enableNotify" style="padding:8px 12px;font-size:13px">Activar</button>'}</div>
    <div class="row"><div class="grow"><b>Avisos con la app cerrada</b><small>Canal de ntfy</small></div></div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <input value="${esc(S.topic)}" readonly style="font-size:12.5px">
      <button class="ghost" id="copyTopic" style="padding:10px 13px;font-size:13px">Copiar</button>
    </div>
    <p class="hint">Instalá la app <b>ntfy</b> en el celular y suscribite a este canal: así llegan los avisos aunque ASN esté cerrada.</p>
  </div>

  <div class="sec">Qué modelo acierta más acá</div>
  <div class="card">
    ${scoreRows || `<p>Cuando respondas “¿Está pasando?”, acá vas a ver qué modelo le pega más en tu zona.</p>`}
  </div>

  <div class="sec">ASN 4.0</div>
  <div class="card">
    <p>Monitor de inteligencia: hasta 51 escenarios del modelo europeo, cuatro modelos de control y tus reportes.</p>
    <div style="margin-top:12px"><button class="ghost" id="reopenIntro">Ver el tutorial otra vez</button></div>
  </div>

  <div class="sec">Datos</div>
  <div class="card">
    <p>Los lugares y tus respuestas quedan en este teléfono.</p>
    <div style="margin-top:12px"><button class="ghost" id="wipe">Borrar todo</button></div>
  </div>
  <div style="margin-top:18px"><button class="ghost" id="back" style="width:100%">← Volver</button></div>`;
}

/* ===================== Tutorial ===================== */
const DEMO_WIND = { leve: 1, moderado: 2, fuerte: 3 };
const DEMO_PHEN = {
  lluvia: { t2: 'Se viene lluvia', t3: 'Peligro: lluvia fuerte', e: '🌧️', bump: 0 },
  tormenta: { t2: 'Se viene tormenta', t3: 'Peligro: tormenta fuerte', e: '⛈️', bump: 0 },
  granizo: { t2: 'Puede caer granizo', t3: 'Peligro: granizo', e: '🧊', bump: 1 },
  nieve: { t2: 'Puede caer nieve', t3: 'Peligro: nieve', e: '❄️', bump: 0 },
  electrico: { t2: 'Tormenta eléctrica', t3: 'Peligro: tormenta eléctrica', e: '⚡', bump: 1 },
  rayos: { t2: 'Rayos cerca', t3: 'Peligro: rayos frecuentes', e: '🌩️', bump: 1 },
  'electrico-total': { t2: 'Tormenta eléctrica severa', t3: 'Peligro: tormenta severa', e: '🌪️', bump: 1 }
};
const demo = { wind: 'moderado', phen: 'lluvia' };

function openSheet() {
  const el = document.getElementById('sheet');
  if (!el) return;
  el.hidden = false;
  renderDemo();
}
function closeSheet() {
  const el = document.getElementById('sheet');
  if (!el) return;
  el.hidden = true;
  try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { }
}

function renderDemo() {
  const box = document.getElementById('demoPrev');
  if (!box) return;
  const base = DEMO_WIND[demo.wind];
  const ph = DEMO_PHEN[demo.phen];
  const lvl = Math.min(3, base + ph.bump);
  const title = lvl >= 3 ? ph.t3 : lvl === 2 ? ph.t2 : lvl === 1 ? 'Ojo con el cielo' : 'Todo tranquilo';
  const emoji = lvl <= 1 ? (lvl === 0 ? '😌' : '🌤️') : ph.e;
  const line = lvl >= 2 ? 'Varios escenarios coinciden para las próximas 3 horas.'
    : lvl === 1 ? 'Puede caer algo leve en las próximas 3 horas.'
      : 'No se espera nada raro en las próximas 3 horas.';
  const action = lvl >= 3 ? 'Quedate adentro. Evitá salir en auto si no hace falta.'
    : lvl === 2 ? 'Guardá lo que tengas afuera y cerrá las ventanas.'
      : lvl === 1 ? 'Si salís, llevá paraguas por las dudas.'
        : 'Buen momento para estar afuera.';
  const cta = ['✅', '☂️', '⚠️', '🚨'][lvl];

  box.innerHTML = `<section class="hero lv${lvl}">
    <div class="where"><span>📍 <b>Así se vería</b></span><span class="chip3h">ejemplo</span></div>
    <div class="main"><div class="emoji">${emoji}</div>
      <div><div class="title">${title}</div><div class="line">${line}</div></div></div>
    <div class="action"><span class="cta">${cta}</span><span>${action}</span></div>
  </section>`;

  document.querySelectorAll('#segWind button').forEach(b => b.classList.toggle('on', b.dataset.wind === demo.wind));
  document.querySelectorAll('#phenList button').forEach(b => b.classList.toggle('on', b.dataset.phen === demo.phen));
}

/* ===================== Buscar ===================== */
function renderResults() {
  const box = document.getElementById('res');
  if (!box) return;
  if (S.loadingGeo) {
    box.innerHTML = '<div class="skel" style="height:64px;margin-top:8px"></div><div class="skel" style="height:64px;margin-top:8px"></div>';
    return;
  }
  if (!S.results.length) {
    box.innerHTML = S.query.trim().length >= 3
      ? '<p class="hint">Sin resultados. Probá con “calle y número, ciudad”.</p>' : '';
    return;
  }
  box.innerHTML = S.results.map((r, i) => `<div class="res" data-pick="${i}">
      <span><b style="font-weight:600">${esc(r.label)}</b><small>${esc(r.sub || '')}</small></span>
      <span class="add">${esc(r.kind)}</span>
    </div>`).join('');
}

let geoDebounce = null;
async function onSearchInput(v) {
  S.query = v;
  clearTimeout(geoDebounce);
  if (v.trim().length < 3) { S.results = []; renderResults(); return; }
  S.loadingGeo = true;
  renderResults();
  geoDebounce = setTimeout(async () => {
    const q = v.trim();
    const res = await geocode(q).catch(() => []);
    if (S.query.trim() !== q) return;
    S.loadingGeo = false;
    S.results = res;
    renderResults();
  }, 420);
}

function addPlace(p) {
  if (S.places.length >= 6) { toast('Máximo 6 lugares'); return; }
  const dup = S.places.find(x => Math.abs(x.lat - p.lat) < 0.005 && Math.abs(x.lon - p.lon) < 0.005);
  if (dup) { toast('Ese lugar ya está en la lista'); return; }
  S.places.push({ id: uid(), name: p.label || p.name, lat: +p.lat, lon: +p.lon });
  S.results = []; S.query = ''; S.view = 'home';
  save(); paint(); refresh();
}

function useGPS() {
  if (!navigator.geolocation) { toast('Este navegador no da la ubicación'); return; }
  toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    pos => addPlace({ label: 'Mi ubicación', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) }),
    () => toast('No pudimos obtener la ubicación'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

/* ===================== Eventos ===================== */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-pick],[data-del],[data-ask],[data-ans],[data-close],[data-wind],[data-phen],[data-dismiss],#startAdd,#addPlace,#gear,#refresh,#back,#enableNotify,#wipe,#gps,#copyTopic,#reopenIntro,#startBtn,#installBtn');
  if (!t) return;

  if (t.hasAttribute('data-dismiss')) {
    const kind = t.getAttribute('data-dismiss');
    if (kind === 'install') S.hideInstall = true;
    if (kind === 'notify') S.hideNotify = true;
    paint();
    return;
  }
  if (t.hasAttribute('data-close')) { closeSheet(); return; }
  if (t.id === 'startBtn') { closeSheet(); return; }
  if (t.hasAttribute('data-wind')) { demo.wind = t.getAttribute('data-wind'); renderDemo(); return; }
  if (t.hasAttribute('data-phen')) { demo.phen = t.getAttribute('data-phen'); renderDemo(); return; }
  if (t.id === 'reopenIntro') { openSheet(); return; }
  if (t.id === 'installBtn') { installApp(); return; }

  if (t.id === 'refresh') {
    const b = document.getElementById('refresh');
    b.classList.add('busy');
    refresh().then(() => b.classList.remove('busy'));
    toast('Actualizando…');
    return;
  }
  if (t.id === 'gear') {
    S.view = S.view === 'settings' ? 'home' : 'settings';
    paint();
    if (S.view === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
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
  if (t.hasAttribute('data-pick')) {
    const r = S.results[+t.getAttribute('data-pick')];
    if (r) addPlace(r);
    return;
  }
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
      d.models.forEach(m => { pred[m.m] = { rain: m.rain, wind: m.wind, hail: false }; });
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
  S.query = ''; S.results = [];
  document.getElementById('view').innerHTML = `
    <div class="sec">Agregar lugar</div>
    <div class="card">
      <input id="q" placeholder="Calle y número, barrio o ciudad" autocomplete="off" autocapitalize="words">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="ghost" id="gps" style="flex:1">📍 Usar mi ubicación</button>
      </div>
      <p class="hint">Ej: “Pozo de la Loma 6028”, “Av. Colón 1000”, “Villa Allende”.</p>
    </div>
    <div id="res"></div>
    <div style="margin-top:16px"><button class="ghost" id="back" style="width:100%">← Volver</button></div>`;
  const inp = document.getElementById('q');
  inp.focus();
  inp.addEventListener('input', () => onSearchInput(inp.value));
}

/* ===================== Inicio ===================== */
function init() {
  load();
  paint();
  if (S.places.length) refresh();

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    S.canInstall = true;
    paint();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    S.canInstall = false;
    toast('ASN 4.0 instalada');
    paint();
  });

  window.addEventListener('online', () => { toast('Volvió la conexión'); refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - S.updated > 5 * 60000 && S.places.length) refresh();
  });
  setInterval(() => { if (!document.hidden && S.places.length) refresh(); }, 5 * 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

  let seen = false;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch (e) { }
  if (!seen) setTimeout(openSheet, 2500);
}

document.addEventListener('DOMContentLoaded', init);
