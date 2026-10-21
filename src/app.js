'use strict';

/* ===================== Configuración ===================== */
const KINDS = [
  { id: 'casa', label: 'Casa', emoji: '🏠' },
  { id: 'trabajo', label: 'Trabajo', emoji: '💼' },
  { id: 'oficina', label: 'Oficina', emoji: '🏢' },
  { id: 'escuela', label: 'Colegio', emoji: '🏫' },
  { id: 'familia', label: 'Familia', emoji: '👨‍👩‍👧' },
  { id: 'importante', label: 'Importante', emoji: '⭐' }
];
const kindOf = p => KINDS.find(k => k.id === (p && p.kind)) || KINDS[KINDS.length - 1];

const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const MODEL_NAME = { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON', gem_seamless: 'GEM' };
const KEY = 'asn.v1';
const LEGACY = ['paraguas.v1', 'alerta-meteo.v2'];
const INTRO_KEY = 'asn.intro';
const CBA = { lat: -31.42, lon: -64.18 };

/* Escala de 5 colores (base Météo-France + nivel excepcional morado) */
const LEVELS = [
  { key: 'verde', name: 'Sin alerta', emoji: '🟢' },
  { key: 'amarilla', name: 'Alerta amarilla', emoji: '🟡' },
  { key: 'naranja', name: 'Alerta naranja', emoji: '🟠' },
  { key: 'roja', name: 'Alerta roja', emoji: '🔴' },
  { key: 'morada', name: 'Alerta morada', emoji: '🟣' }
];

const S = {
  places: [], last: {}, feedback: [],
  data: {}, updated: 0, busy: false, view: 'home', results: [],
  askFor: null, query: '', canInstall: false, hideInstall: false, hideNotify: false,
  askPlace: null, radarResult: null, learn: {}, track: {}, pushActive: false, ownerTech: false, healthBad: 0, myStars: 0, ownerKey: '', metricsPub: null, metricsOwner: null, deviceId: '', ownerOk: false, ownerForm: false,
  voice: true, sound: true, addKind: 'casa', editId: null, editKind: 'casa', rivers: {},
  geoAsked: false, travel: null, travelSkip: {}
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
  S.places = (Array.isArray(raw.places) ? raw.places : []).map(p => {
    const out = {
      id: p.id || uid(),
      label: p.label || p.name || 'Lugar',
      addr: p.addr || '',
      kind: p.kind || 'importante',
      lat: p.lat,
      lon: p.lon
    };
    if (typeof p.hydro === 'boolean') out.hydro = p.hydro;
    return out;
  });
  S.feedback = Array.isArray(raw.feedback) ? raw.feedback : [];
  S.last = raw.last && typeof raw.last === 'object' ? raw.last : {};
  S.track = raw.track && typeof raw.track === 'object' ? raw.track : {};
  S.ownerTech = !!raw.ownerTech;
  S.myStars = Number(raw.myStars) || 0;
  S.ownerKey = typeof raw.ownerKey === 'string' ? raw.ownerKey : '';
  S.deviceId = raw.deviceId || (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  S.ownerOk = !!raw.ownerOk;
  S.learn = raw.learn && typeof raw.learn === 'object' ? raw.learn : {};
  if (raw.voice === false) S.voice = false;
  if (raw.sound === false) S.sound = false;
  S.geoAsked = raw.geoAsked === true;
  S.travelSkip = (raw.travelSkip && typeof raw.travelSkip === 'object') ? raw.travelSkip : {};
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      places: S.places, last: S.last, feedback: S.feedback, learn: S.learn, track: S.track, ownerTech: S.ownerTech, myStars: S.myStars, ownerKey: S.ownerKey, deviceId: S.deviceId, ownerOk: S.ownerOk,
      voice: S.voice, sound: S.sound, geoAsked: S.geoAsked, travelSkip: S.travelSkip
    }));
  } catch (e) { }
}

/* ===================== Utilidades ===================== */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);

/* ===================== Voz ===================== */
function pickVoice() {
  try {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return vs.find(v => /es[-_]AR/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  } catch (e) { return null; }
}

/* ===================== Métricas mínimas ===================== */
function pingStats() {
  try {
    if (sessionStorage.getItem('asn.ping')) return;
    sessionStorage.setItem('asn.ping', '1');
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true;
    const p = S.places[0];
    const prov = p && p.addr ? String(p.addr).split(',').pop().trim() : null;
    const ua = navigator.userAgent;
    const pf = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'desktop';
    fetch('/api/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ m: standalone ? 's' : 'w', p: prov, v: '4.0', pf })
    }).catch(() => { });
  } catch (e) { }
}

/* ===================== Tormenta en formación ===================== */
function kmBetween(a, b, c, d) {
  const R = 6371, p = Math.PI / 180;
  const dl = (c - a) * p, dn = (d - b) * p;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingBetween(a, b, c, d) {
  const p = Math.PI / 180;
  const y = Math.sin((d - b) * p) * Math.cos(c * p);
  const x = Math.cos(a * p) * Math.sin(c * p) - Math.sin(a * p) * Math.cos(c * p) * Math.cos((d - b) * p);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angDiff(a, b) {
  return Math.abs((b - a + 540) % 360 - 180);
}

function fmtEta(min) {
  if (min == null || !isFinite(min)) return '';
  const m = Math.max(5, Math.round(min / 5) * 5);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

/* La ingesta publica cada 10 minutos. Pasados 45, el dato no se usa:
   una tormenta de hace tres cuartos de hora ya no está donde dice. */
function nowcastList() {
  const edad = S.nc && S.nc.generado ? Date.now() - new Date(S.nc.generado).getTime() : 1e12;
  if (!S.nc || !Array.isArray(S.nc.tormentas) || !isFinite(edad) || edad > 45 * 60 * 1000) return [];
  return S.nc.tormentas;
}

/* Qué pasa con la tormenta vista desde un lugar.
   Solo se usa el vector si la ingesta lo dio por coherente en 3 cuadros.
   Sin vector: se dice la distancia, nunca una hora inventada. */
function stormNow(p) {
  const list = nowcastList();
  if (!list.length || !p) return null;
  const cands = [];
  for (const s of list) {
    if (!s || !isFinite(s.lat) || !isFinite(s.lon)) continue;
    const d = kmBetween(p.lat, p.lon, s.lat, s.lon);
    if (d > 150) continue;
    const m = s.movimiento || {};
    const alta = s.confianza === 'alta' && m.kmh > 0 && m.rumbo != null;
    let off = null, eta = null;
    if (alta) {
      off = angDiff(bearingBetween(s.lat, s.lon, p.lat, p.lon), m.rumbo);
      if (off <= 45 && d > 25) {
        const proj = d * Math.cos(off * Math.PI / 180);
        if (proj > 0) eta = Math.round(proj / m.kmh * 60);
      }
    }
    /* "encima" solo si no sabemos que se aleja: una tormenta que ya pasó
       y va camino a otro lado no se anuncia como si recién se formara. */
    const encima = d <= 25 && (!alta || off == null || off <= 90);
    cands.push({ s, d: Math.round(d), eta, off, alta, encima });
  }
  if (!cands.length) return null;
  const enc = cands.filter(c => c.encima).sort((a, b) => a.d - b.d)[0];
  if (enc) return enc;
  const viene = cands.filter(c => c.eta != null && c.eta <= 180).sort((a, b) => a.eta - b.eta || a.d - b.d)[0];
  if (viene) return viene;
  return cands.sort((a, b) => a.d - b.d)[0];
}

async function loadNowcast() {
  try {
    const r = await fetch('/api/nowcast', { cache: 'no-store' });
    if (!r.ok) return;
    S.nc = await r.json();
    paintNowcast();
  } catch (e) { }
}

function paintNowcast() {
  const bar = document.getElementById('ncBar');
  if (!bar) return;
  if (!S.places.length) { bar.hidden = true; return; }
  let best = null;
  for (const p of S.places) {
    const n = stormNow(p);
    if (!n) continue;
    const score = n.encima ? n.d : n.eta != null ? 1000 + n.eta : 5000 + n.d;
    if (!best || score < best.score) best = { p, n, score };
  }
  if (!best) { bar.hidden = true; return; }
  const n = best.n;
  if (n.encima) {
    bar.innerHTML = '⛈ <span>Tormenta formándose sobre <b>' + esc(best.p.label) + '</b></span>';
  } else {
    bar.innerHTML = '⛈ <span>Tormenta a <b>' + n.d + ' km</b> de ' + esc(best.p.label) +
      (n.eta != null ? ' · llegaría en ~' + fmtEta(n.eta) : '') + '</span>';
  }
  bar.hidden = false;
}
/* ===================== Sonido de alerta ===================== */
let actx = null;
let soundUntil = 0;

function ac() {
  if (actx) return actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { actx = new AC(); } catch (e) { return null; }
  return actx;
}

/* Ningún navegador deja sonar audio hasta que la persona toca la pantalla. */
function unlockAudio() {
  const c = ac();
  if (c && c.state === 'suspended') c.resume().catch(() => { });
}

function whoop(c, out, at, len) {
  const o = c.createOscillator();
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3400;
  lp.Q.value = 6;
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(420, at);
  o.frequency.exponentialRampToValueAtTime(920, at + len * 0.45);
  o.frequency.exponentialRampToValueAtTime(470, at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.5, at + 0.035);
  g.gain.setValueAtTime(0.5, at + len * 0.72);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(lp); lp.connect(g); g.connect(out);
  o.start(at); o.stop(at + len + 0.03);
}

function tick(c, out, at) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(1560, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.3, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.075);
  o.connect(g); g.connect(out);
  o.start(at); o.stop(at + 0.09);
}

function thump(c, out, at) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(80, at);
  o.frequency.exponentialRampToValueAtTime(42, at + 0.28);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.55, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  o.connect(g); g.connect(out);
  o.start(at); o.stop(at + 0.32);
}

/* Tono propio de ASN: sirena de dos barridos, golpe grave y tres tics.
   No es una melodía: es una alarma, para que se reconozca sin mirar. */
function playAlertSound(level, force) {
  if (!force && !S.sound) return false;
  const c = ac();
  if (!c) return false;
  const now = Date.now();
  if (!force && now < soundUntil) return false;
  if (c.state === 'suspended') c.resume().catch(() => { });

  const urgent = (level || 0) >= 3;
  const t = c.currentTime + 0.03;
  const total = (urgent ? 2.75 : 2.05);

  const master = c.createGain();
  master.gain.value = 0.0001;
  try {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    master.connect(comp);
    comp.connect(c.destination);
  } catch (e) {
    master.connect(c.destination);
  }
  master.gain.exponentialRampToValueAtTime(0.9, t + 0.05);

  const n = urgent ? 3 : 2;
  for (let i = 0; i < n; i++) whoop(c, master, t + i * 0.6, 0.5);
  for (let i = 0; i < 3; i++) tick(c, master, t + (urgent ? 1.95 : 1.32) + i * 0.115);
  thump(c, master, t);

  soundUntil = now + total * 1000 + 500;
  return true;
}

function speak(text) {
  try {
    if (!('speechSynthesis' in window) || !S.voice || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-AR';
    u.rate = 1.02;
    u.pitch = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) { }
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { pickVoice(); };
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  const live = document.getElementById('live');
  if (live) live.textContent = msg;
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

/* ===================== Web Push ===================== */
let pushKey = null;
let pushSub = null;

function b64ToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...b].map(c => c.charCodeAt(0)));
}

async function loadVapid() {
  if (pushKey) return pushKey;
  try {
    const r = await fetch('/api/vapid', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    pushKey = j.key || null;
    return pushKey;
  } catch (e) { return null; }
}

async function currentPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (e) { return null; }
}

async function postSubscription(sub) {
  try {
    const r = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        places: S.places.map(p => ({ name: p.label, lat: p.lat, lon: p.lon, hydro: !!p.hydro })),
        owner: !!S.ownerTech
      })
    });
    return !!r.ok;
  } catch (e) {
    return false;
  }
}

/* Cada guardado cuesta una escritura en el servidor y ese cupo es diario:
   solo se manda si los lugares cambiaron de verdad. */
let pushSig = '';
async function syncPush() {
  if (!pushSub) return false;
  const sig = JSON.stringify(S.places.map(p => [p.id, p.label, p.lat, p.lon]));
  if (sig === pushSig) return true;
  const ok = await postSubscription(pushSub);
  if (ok) pushSig = sig;
  return ok;
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Este navegador no permite avisos en tiempo real');
    return;
  }
  if (!S.places.length) {
    toast('Primero agregá un lugar');
    openAdd();
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Permiso de avisos rechazado'); paint(); return; }
  const key = await loadVapid();
  if (!key) { toast('Los avisos necesitan la versión de Cloudflare'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    pushSub = sub;
    const okSync = await postSubscription(sub);
    if (!okSync) {
      toast('El servidor no aceptó los avisos. Probá de nuevo en un rato.');
      paint();
      return;
    }
    pushSig = JSON.stringify(S.places.map(p => [p.id, p.label, p.lat, p.lon]));
    S.pushActive = true;
    S.hideNotify = true;
    toast('Avisos en tiempo real activados');
  } catch (e) {
    toast('No pudimos activar los avisos');
  }
  paint();
}

async function disablePush() {
  try {
    const sub = pushSub || await currentPush();
    if (sub) {
      await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      });
      await sub.unsubscribe();
    }
  } catch (e) { }
  pushSub = null;
  S.pushActive = false;
  toast('Avisos desactivados');
  paint();
}

async function testPush() {
  const sub = pushSub || await currentPush();
  if (!sub) { toast('Primero activá los avisos'); return; }
  try {
    const r = await fetch('/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    const j = await r.json();
    toast(j.result === 'ok' ? 'Aviso de prueba enviado' : 'El envío falló: ' + (j.error || j.result));
  } catch (e) { toast('No pudimos enviar la prueba'); }
}

/* ===================== Riesgo ===================== */
function pointRisk(o) {
  const a = o.rain < 0.5 ? 0 : o.rain < 2.5 ? 1 : o.rain < 7.6 ? 2 : o.rain < 15 ? 3 : 4;
  const b = o.gust < 60 ? 0 : o.gust < 80 ? 1 : o.gust < 100 ? 2 : o.gust < 130 ? 3 : 4;
  return { l: Math.max(a, b), rain: a >= 1, wind: b >= 1 };
}

function modelRisk(H, m) {
  const g = k => H[k + '_' + m] || [];
  const pr = g('precipitation'), gu = g('wind_gusts_10m'), pp = g('precipitation_probability'), cc = g('cloud_cover');
  let acc = 0, lvl = 0, rain = false, wind = false, known = 0;
  const hours = [];
  for (let i = 0; i < pr.length; i++) {
    /* nulo no es cero: una hora sin dato no dice "no llueve" */
    const r = pr[i] == null ? null : pr[i];
    const gust = gu[i] == null ? null : gu[i];
    if (i < 3) {
      if (r != null) { acc += r; known++; }
      const x = pointRisk({ rain: r == null ? 0 : r, gust: gust == null ? 0 : gust });
      lvl = Math.max(lvl, x.l);
      rain = rain || x.rain; wind = wind || x.wind;
    }
    hours.push({ p: r, prob: pp[i] == null ? null : pp[i], gust, cl: cc[i] == null ? null : cc[i] });
  }
  /* la ventana de 3 h vale sólo si hay al menos una hora con dato */
  const has = known > 0;
  if (has) {
    lvl = Math.max(lvl, acc >= 100 ? 4 : acc >= 60 ? 3 : acc >= 30 ? 2 : acc >= 15 ? 1 : 0);
  } else {
    lvl = 0; rain = false; wind = false; acc = null;
  }
  const rate = Math.max(0, ...hours.slice(0, 3).map(h => (h.p == null ? 0 : h.p)));
  return { m, l: lvl, rain, wind, acc, rate, hours, has, known };
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
    rain10: p(rains, 10), rain15: p(rains, 15), rain30: p(rains, 30),
    rain60: p(rains, 60), rain100: p(rains, 100),
    gust60: p(gusts, 60), gust80: p(gusts, 80), gust100: p(gusts, 100), gust130: p(gusts, 130)
  };
}

function ensembleLevel(e) {
  if (e.rain100 >= 0.30 || e.gust130 >= 0.30) return 4;
  if (e.rain60 >= 0.50 || e.gust100 >= 0.30) return 3;
  if (e.rain30 >= 0.40 || e.gust80 >= 0.40) return 2;
  if (e.rain15 >= 0.30 || e.gust60 >= 0.40) return 1;
  return 0;
}

function aggregate(H, ens) {
  const models = MODELS.map(m => modelRisk(H, m));
  const usable = models.filter(x => x.has); /* sólo los modelos que realmente trajeron horas */
  /* sin modelos con datos y sin ensemble no hay pronóstico: "sin dato", no nivel 0 */
  const sinDato = usable.length === 0 && !(ens && ens.n > 0);
  const sorted = usable.map(x => x.l).sort((a, b) => b - a);
  const detLevel = Math.min(4, Math.max(0, sorted[0] ?? 0)); /* el peor modelo manda: nunca el segundo */
  const votes = { rain: models.filter(x => x.rain).length, wind: models.filter(x => x.wind).length };
  const rainRate = Math.max(0, ...models.map(m => m.rate));

  const capeMax = seriesByBase(H, 'cape')
    .reduce((max, s) => Math.max(max, ...s.slice(0, 3).map(v => v ?? 0)), 0);
  const fzSeries = seriesByBase(H, 'freezing_level_height');
  const freezing = fzSeries.length ? Math.max(...fzSeries[0].slice(0, 3).map(v => v ?? 0)) : 0;
  const gustMax = Math.max(0, ...models.map(m => Math.max(...m.hours.slice(0, 3).map(h => h.gust))));

  const eLevel = ens ? ensembleLevel(ens) : null;
  let level = eLevel == null ? detLevel : eLevel;
  /* sin modelos utilizables no se promedia contra un detLevel inventado */
  if (eLevel != null && usable.length && Math.abs(detLevel - eLevel) > 1) level = Math.min(detLevel, eLevel) + 1;
  if (sinDato) level = 0;

  /* CAPE mide inestabilidad, no lluvia. Antes, con el ensemble caído (429),
     "no hay ensemble" se tomaba como "no hay contraprueba" y un CAPE de
     1.000 bastaba para declarar alerta amarilla con el cielo despejado.
     Ahora la inestabilidad sola no alcanza: hace falta que alguien
     pronostique lluvia. */
  const rainModels = usable.filter(m => m.rain).length;
  const ensOk = !!(ens && ens.n > 0);
  const rainSeen = rainModels >= 2 || (ensOk && ens.rain10 >= 0.30);
  const storm = capeMax >= 1000 && rainSeen;
  if (storm && !sinDato) level = Math.max(level, 1);

  const hailPossible = capeMax >= 1500 && gustMax >= 70 && freezing >= 3000 &&
    freezing <= 4500 && rainSeen;

  const snowSeries = seriesByBase(H, 'snowfall');
  const snowHours = [];
  for (let i = 0; i < 13; i++) {
    snowHours.push(snowSeries.reduce((m, s) => Math.max(m, s[i] == null ? 0 : s[i]), 0));
  }
  const snow3 = snowHours.slice(0, 3).reduce((a, b) => a + b, 0);
  if (!sinDato) {
    if (snow3 >= 15) level = 4;
    else if (snow3 >= 5) level = Math.max(3, level);
    else if (snow3 >= 2) level = Math.max(2, level);
    else if (snow3 >= 0.2) level = Math.max(1, level);
  }

  return {
    models, level: Math.min(4, level), detLevel, eLevel, votes, rainRate, sinDato,
    capeMax, gustMax, freezing, storm, hailPossible, ens, snow3, snowHours,
    ensOk, rainSeen, rainModels
  };
}

/* ===================== Lenguaje ===================== */
function phenomenon(d) {
  if (d.snow3 >= 0.5) return { key: 'nieve', word: 'nieve', emoji: '❄️' };
  if (d.hailPossible) return { key: 'granizo', word: 'granizo', emoji: '🧊' };
  if (d.storm) return { key: 'tormenta', word: 'tormenta eléctrica', emoji: '⛈️' };
  const rain = d.votes.rain >= 2 || d.rainRate >= 0.2;
  if (rain) {
    if (d.rainRate >= 30) return { key: 'torrencial', word: 'lluvia torrencial', emoji: '🌊' };
    if (d.rainRate < 2) return { key: 'llovizna', word: 'llovizna', emoji: '🌦️' };
    return { key: 'lluvia', word: 'lluvia', emoji: '🌧️' };
  }
  return { key: 'viento', word: 'ráfagas', emoji: '💨' };
}

/* sirena con baliza girando, para los avisos de crecida grave */
function sirenaSvg(px) {
  const s = px || 26;
  return `<svg class="sirena" viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true" focusable="false">
    <g transform="translate(24,28) scale(1.16) translate(-24,-28)">
    <circle class="sir-halo" cx="24" cy="28" r="15"/>
    <rect x="7" y="30" width="34" height="10" rx="3" fill="#22304a"/>
    <rect x="7" y="30" width="34" height="3" rx="1.5" fill="#42587c"/>
    <path d="M11 30 C11 14 37 14 37 30 Z" fill="#D81E2C"/>
    <path d="M14 26 C15 20.5 20 17.4 24 17.2" fill="none" stroke="#FF9A90"
      stroke-opacity=".85" stroke-width="2.2" stroke-linecap="round"/>
    <g class="sir-sweep">
      <path d="M24 30 L22.3 19.1 A11 11 0 0 1 25.7 19.1 Z" fill="#FFF4F1" opacity=".66"/>
    </g>
    <rect x="17" y="40" width="14" height="3" rx="1.5" fill="#18213a"/>
    </g>
  </svg>`;
}

function levelInfo(d) {
  if (d.hydro && d.hydro.level >= 1) {
    const h = d.hydro;
    const lv = Math.max(1, Math.min(4, h.level));
    const pills = { 1: '🌊 Río alto', 2: '🌊 Alerta', 3: '🌊 Evacuación', 4: '🌊 Crecida grave' };
    /* con el río en alerta, el clima queda en segundo plano */
    const tail = lv <= 2 ? ' El clima, por ahora, tranquilo.' : '';
    return {
      cls: 'flood' + lv,
      emoji: '🌊',
      title: h.headline || (lv >= 3 ? 'Crecida grave' : lv === 2 ? 'Alerta por crecida' : 'Río alto'),
      line: (h.plain || 'El río está alto.') + tail,
      detail: h.history || '',
      action: h.advice || 'Seguí el aviso si estás cerca de la costa.',
      cta: lv >= 3 ? sirenaSvg(34) : '🌊',
      pill: pills[lv]
    };
  }

  /* sin modelos no se puede afirmar calma: la tarjeta dice "sin dato", no nivel 0 */
  if (d.sinDato) {
    return {
      cls: 'nodata', emoji: '🛰️', title: 'Sin dato',
      line: 'No llegaron datos de los modelos para tu zona.',
      action: 'Probá actualizar en unos minutos.', cta: '❔', pill: '⚪ Sin dato'
    };
  }

  const ph = phenomenon(d);
  const L = LEVELS[d.level];
  if (d.level === 0) {
    return {
      cls: 'lv0', emoji: '😌', title: 'Todo tranquilo',
      line: 'No se espera nada raro en las próximas 3 horas.',
      action: 'Buen momento para estar afuera.', cta: '✅', pill: '🟢 Sin alerta'
    };
  }
  const titles = {
    1: 'Ojo: ' + ph.word,
    2: 'Se viene ' + ph.word,
    3: 'Alerta roja: ' + ph.word,
    4: 'Alerta morada: ' + ph.word
  };
  const lines = {
    1: 'Puede pasar algo leve en las próximas 3 horas.',
    2: 'Varios escenarios coinciden para las próximas 3 horas.',
    3: 'Se viene fuerte, con alta coincidencia entre escenarios.',
    4: 'Fenómeno de intensidad excepcional previsto.'
  };
  const actions = {
    1: 'Atención, pero no es grave. Seguí el pronóstico.',
    2: 'Guardá lo que tengas afuera y cerrá las ventanas.',
    3: 'Riesgo alto. Evitá salir en auto si no hace falta y seguí las indicaciones de las autoridades.',
    4: 'Riesgo extremo. Seguí las indicaciones de las autoridades.'
  };
  return {
    cls: 'lv' + d.level, emoji: ph.emoji, title: titles[d.level],
    line: lines[d.level], action: actions[d.level],
    cta: L.emoji, pill: L.emoji + ' ' + L.name
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
  if (!d.times || !d.times.length) return null;
  const n = Math.min(12, d.times.length);
  for (let i = 0; i < n; i++) {
    if (d.snowHours && d.snowHours[i] >= 0.1) return { iso: d.times[i], label: 'Nieve' };
    const s = hourSignal(d, i);
    const g = Math.round(s.gust);
    if (s.rain && g >= 40) return { iso: d.times[i], label: 'Lluvia y ráfagas de ' + g + ' km/h' };
    if (s.rain) return { iso: d.times[i], label: 'Lluvia' };
    if (g >= 60) return { iso: d.times[i], label: 'Ráfagas fuertes de ' + g + ' km/h' };
    if (g >= 40) return { iso: d.times[i], label: 'Ráfagas moderadas de ' + g + ' km/h' };
    if (g >= 30) return { iso: d.times[i], label: 'Ráfagas leves de ' + g + ' km/h' };
  }
  return null;
}

function eventText(d) {
  if (d.partial) return { txt: 'Datos de respaldo de una segunda fuente', big: false };
  const ev = nextEvent(d);
  if (!ev) return { txt: 'Sin lluvia ni ráfagas de más de 30 km/h en las próximas 12 horas', big: false };
  const mins = Math.round((new Date(ev.iso).getTime() - Date.now()) / 60000);
  if (mins <= 5) return { txt: ev.label + ' ahora mismo', big: true };
  if (mins < 60) return { txt: ev.label + ' en ' + mins + ' min', big: true };
  return { txt: ev.label + ' a las ' + hourLabel(ev.iso) + ' · en ' + Math.round(mins / 60) + ' h', big: true };
}

function anyRain(d, hours) {
  if (!d.times || !d.times.length) return false;
  const n = Math.min(hours, d.times.length);
  for (let i = 0; i < n; i++) if (hourSignal(d, i).rain) return true;
  return false;
}
function maxGust(d, hours) {
  if (!d.times || !d.times.length) return 0;
  const n = Math.min(hours, d.times.length);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, hourSignal(d, i).gust);
  return max;
}

/* ===================== Red: clima ===================== */
async function fetchPlace(p) {
  const r = await fetch('/api/wx?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly || !j.hourly.time) throw new Error('sin datos');
  return { hourly: j.hourly, current: j.current, daily: j.daily || null };
}

/* Hidrología: caudal (GloFAS) + estaciones INA, vía Worker */
async function fetchRivers(p) {
  try {
    const r = await fetch('/api/rivers?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) { return []; }
}

async function fetchHydro(p) {
  try {
    const r = await fetch('/api/hydro?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
    if (!r.ok) return { error: true };
    const j = await r.json();
    if (j && j.error) return { error: true };
    return j;
  } catch (e) {
    return { error: true };
  }
}

async function fetchBrasil(p) {
  /* Solo para lugares de la cuenca del Paraná: el dato es de Brasil. */
  if (!(p.lat < -26.5 && p.lon > -59)) return null;
  try {
    const r = await fetch('/api/brasil', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch (e) {
    return null;
  }
}

/* Dictamen: cada fuente vota y el motor solo concluye si coinciden. */
async function fetchDictamen(p) {
  try {
    const r = await fetch('/api/dictamen?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.error) return null;
    return j;
  } catch (e) {
    return null;
  }
}

/* Lluvia medida sobre la cuenca. No predice altura de crecida: informa
   cuánta agua cayó y cuántos pluviómetros la sostienen. */
async function fetchCuenca(p) {
  try {
    const r = await fetch('/api/cuenca?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.error) return null;
    return j;
  } catch (e) {
    return null;
  }
}

/* Amanecer y atardecer (pedido aparte, sin modelos) */
async function fetchSun(p) {
  const r = await fetch('/api/sun?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
  if (!r.ok) throw new Error('sun HTTP ' + r.status);
  const j = await r.json();
  return j.daily || null;
}

/* Segunda fuente independiente: MET Norway (sin clave, CORS abierto) */
async function fetchMetno(p) {
  const r = await fetch('/api/met?lat=' + encodeURIComponent(p.lat) + '&lon=' + encodeURIComponent(p.lon), { cache: 'no-store' });
  if (!r.ok) throw new Error('metno HTTP ' + r.status);
  const j = await r.json();
  const series = (j.properties && j.properties.timeseries) || [];
  if (!series.length) throw new Error('metno sin datos');

  const now = Date.now();
  const next = series
    .filter(s => new Date(s.time).getTime() >= now - 3600 * 1000)
    .slice(0, 3);

  let rain3 = 0, gustMs = 0, windMs = 0;
  next.forEach(s => {
    const det = s.data.instant.details || {};
    const n1 = (s.data.next_1_hours && s.data.next_1_hours.details) || {};
    rain3 += n1.precipitation_amount || 0;
    gustMs = Math.max(gustMs, det.wind_speed_of_gust || det.wind_speed || 0);
    windMs = Math.max(windMs, det.wind_speed || 0);
  });

  const gustKmh = Math.round(gustMs * 3.6);
  let level = 0;
  if (rain3 >= 60 || gustKmh >= 100) level = 3;
  else if (rain3 >= 30 || gustKmh >= 80) level = 2;
  else if (rain3 >= 15 || gustKmh >= 60) level = 1;

  return { level, rain3: +rain3.toFixed(1), gustKmh, windKmh: Math.round(windMs * 3.6) };
}

/* Una sola consulta por zona y por actualización, guardada 30 minutos.
   Antes se pedía un ensemble por cada lugar en cada refresco: eso era lo
   que hacía que la fuente contestara 429 y la app quedara sin pronóstico. */
const ENS_TTL = 30 * 60 * 1000;
const ENS_USE = 3 * 60 * 60 * 1000;   /* un ensemble de 3 h sigue sirviendo */
const ENS_CACHE = new Map();
const ENS_WAIT = new Map();

function ensKey(p) {
  /* 0,1° ≈ 11 km: más fino que la grilla de 0,25° del modelo, así que
     redondear no cambia el dato y sí evita una consulta por lugar */
  return (Math.round(Number(p.lat) * 10) / 10).toFixed(1) + ',' +
    (Math.round(Number(p.lon) * 10) / 10).toFixed(1);
}

async function fetchEnsemble(p) {
  const k = ensKey(p);
  const c = ENS_CACHE.get(k);
  const now = Date.now();
  if (c && c.hourly && now - c.hourlyAt < ENS_USE) {
    if (now - c.at < ENS_TTL) return c.hourly;      /* fresco */
    if (c.err && now - c.at < 5 * 60 * 1000) return c.hourly;  /* la fuente falló recién */
  }
  if (!c || !c.hourly) {
    if (c && c.err && now - c.at < 5 * 60 * 1000) throw c.err;
  }
  if (ENS_WAIT.has(k)) return ENS_WAIT.get(k);

  const job = (async () => {
    const r = await fetch('/api/ens?lat=' + p.lat + '&lon=' + p.lon, { cache: 'no-store' });
    if (!r.ok) {
      const err = new Error('HTTP ' + r.status);
      ENS_CACHE.set(k, { at: Date.now(), hourly: c && c.hourly, hourlyAt: c && c.hourlyAt, err });
      throw err;
    }
    const j = await r.json();
    if (!j.hourly) throw new Error('sin ensemble');
    ENS_CACHE.set(k, { at: Date.now(), hourly: j.hourly, hourlyAt: Date.now(), err: null });
    return j.hourly;
  })();

  ENS_WAIT.set(k, job);
  try { return await job; } finally { ENS_WAIT.delete(k); }
}

/* ===================== Red: direcciones ===================== */
const GEO_CACHE = new Map();
let geoAbort = null;
let nominatimLast = 0;

async function geoPhoton(term, sig) {
  const q = /c[oó]rdoba/i.test(term) ? term : term + ', Córdoba, Argentina';
  const r = await fetch('/api/geo?kind=photon&q=' + encodeURIComponent(q), { signal: sig });
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
  const r = await fetch('/api/geo?kind=nominatim&q=' + encodeURIComponent(term), { signal: sig });
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
  const r = await fetch('/api/geo?kind=om&q=' + encodeURIComponent(term), { signal: sig });
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
  const seen = new Set();
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  list.sort((a, b) => geoRank(a) - geoRank(b));
  for (const r of list) {
    const key = norm(r.label) + '|' + norm(r.sub);
    const near = out.some(x => Math.abs(x.lat - r.lat) < 0.0006 && Math.abs(x.lon - r.lon) < 0.0006);
    if (near || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
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
  loadNowcast();
  pingStats();
  const results = await Promise.allSettled(S.places.map(async p => {
    const [det, ens, met, sun, hyd, cue, bra, dic] = await Promise.allSettled([
      fetchPlace(p), fetchEnsemble(p), fetchMetno(p), fetchSun(p), fetchHydro(p), fetchCuenca(p), fetchBrasil(p), fetchDictamen(p)
    ]);
    return {
      det: det.status === 'fulfilled' ? det.value : null,
      ens: ens.status === 'fulfilled' ? ensembleRisk(ens.value) : null,
      met: met.status === 'fulfilled' ? met.value : null,
      sun: sun.status === 'fulfilled' ? sun.value : null,
      hyd: hyd.status === 'fulfilled' ? hyd.value : null,
      cue: cue.status === 'fulfilled' ? cue.value : null,
      brasil: bra.status === 'fulfilled' ? bra.value : null,
      dic: dic.status === 'fulfilled' ? dic.value : null,
      err: det.status !== 'fulfilled' ? det.reason : null
    };
  }));

  let ok = 0;
  S.places.forEach((p, i) => {
    const res = results[i];
    const r = res.status === 'fulfilled' ? res.value : null;

    if (r && r.det) {
      const agg = aggregate(r.det.hourly, r.ens);
      agg.times = r.det.hourly.time;
      agg.current = r.det.current;
      /* d.wx se leía en media app pero nunca se asignaba: por eso no había
         temperatura y el control de "está lloviendo ahora" no se ejecutaba. */
      agg.wx = { hourly: r.det.hourly, current: r.det.current, daily: r.det.daily || null };
      agg.sunrise = (r.sun && r.sun.sunrise) || (r.det.daily && r.det.daily.sunrise) || null;
      agg.sunset = (r.sun && r.sun.sunset) || (r.det.daily && r.det.daily.sunset) || null;
      agg.met = r.met;
      /* si el río no se pudo leer, se dice: nunca se muestra "tranquilo" sin dato */
      agg.hydroErr = !!(r.hyd && r.hyd.error);
      agg.hydro = r.hyd && !r.hyd.error ? r.hyd : null;
      agg.cuenca = r.cue && r.cue.ok ? r.cue : null;
      agg.dict = r.dic && r.dic.ok ? r.dic : null;
      agg.brasil = r.brasil && r.brasil.ok ? r.brasil : null;
      applyLearning(p, agg);
      S.data[p.id] = agg;
      ok++;
      trackAlert(p, agg);
      checkAlert(p, agg);
    } else if (r && r.met) {
      /* Open-Meteo caído: seguimos con MET Norway como respaldo */
      const agg = aggFromMet(r.met);
      S.data[p.id] = agg;
      ok++;
      trackAlert(p, agg);
      checkAlert(p, agg);
    } else {
      S.data[p.id] = Object.assign(S.data[p.id] || {}, { error: true });
    }
  });
  S.updated = Date.now();
  S.busy = false;
  save();
  paint();

  /* ríos con nombre cerca de cada lugar (consulta pesada, se cachea 7 días) */
  S.places.forEach(p => {
    if (S.rivers[p.id]) return;
    S.rivers[p.id] = [];
    fetchRivers(p).then(list => {
      S.rivers[p.id] = list;
      if (list.length && S.view === 'home') paint();
    });
  });
  if (!ok && S.places.length) toast('No pudimos actualizar. Fijate la conexión.');
}

/* Tarjeta mínima cuando sólo responde MET Norway */
function aggFromMet(met) {
  return {
    models: [], ens: null, level: met.level, detLevel: met.level, eLevel: null,
    votes: { rain: met.rain3 >= 15 ? 1 : 0, wind: met.gustKmh >= 60 ? 1 : 0 },
    rainRate: met.rain3 / 3, snow3: 0, snowHours: [], hailPossible: false, storm: false,
    times: null, current: null, met, partial: true
  };
}

function checkAlert(p, agg) {
  const prev = S.last[p.id];
  const prevLevel = typeof prev === 'number' ? prev : (prev && prev.level) || -1;
  const prevPh = (prev && prev.ph) || '';
  const prevAt = (prev && typeof prev === 'object' && prev.at) || 0;
  const now = Date.now();

  const ph = phenomenon(agg);
  const changed = agg.level !== prevLevel || ph.word !== prevPh;
  const repeatDue = agg.level >= 1 && now - prevAt >= 30 * 60 * 1000;

  /* Si había alerta y los datos dicen que ya no, el aviso TIENE que bajar.
     Una alerta que no puede bajar es peor que no tener alerta. Con el río
     todavía en alerta no se anuncia calma: la crecida manda. */
  const riverOn = !!(agg.hydro && agg.hydro.level >= 1);
  if (prevLevel >= 1 && agg.level === 0 && !riverOn) {
    if (agg.sinDato) {
      notify('⚪ Sin dato · retiramos el aviso en ' + p.label,
        'No llegan datos para tu zona. Retiramos el aviso anterior, pero no podemos confirmar calma.');
      speak('Retiramos el aviso en ' + p.label + '. No llegan datos, así que no podemos confirmar calma.');
    } else {
      const info = levelInfo(agg);
      notify('🟢 Sin alerta · ' + info.title + ' en ' + p.label, info.line);
      speak('Bajó la alerta en ' + p.label + '. ' + info.line);
    }
    S.last[p.id] = { level: 0, at: 0, ph: '' };
    return;
  }

  /* avisa en cada cambio de nivel o fenómeno, y repite cada 30 min si sigue */
  if (agg.level >= 1 && (changed || repeatDue)) {
    const L = LEVELS[agg.level];
    const info = levelInfo(agg);
    notify(
      `${L.emoji} ${L.name} · ${ph.emoji} ${ph.word} en ${p.label}`,
      info.action
    );
    const msg = `${L.name}. ${ph.word} en ${p.label}. ${info.action}`;
    /* suena solo cuando la alerta cambió, no al abrir la app ni en el recordatorio de los 30 min */
    const chime = prev !== undefined && changed ? playAlertSound(agg.level) : false;
    if (chime) setTimeout(() => speak(msg), 1250); /* primero la alarma, después la explicación */
    else speak(msg);
    S.last[p.id] = { level: agg.level, at: now, ph: ph.word };
  } else {
    S.last[p.id] = {
      level: agg.level,
      at: agg.level >= 1 ? prevAt : 0,
      ph: ph.word
    };
  }
}

function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    /* ícono grande en color (el logo) y chico monocromo: Android pinta el
       chico de blanco sí o sí, así que ahí va la silueta sin color */
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, {
      body, icon: 'icon-192.png', badge: 'notif-96.png',
      vibrate: [300, 100, 300], requireInteraction: true, tag: 'asn'
    })).catch(() => { });
  } catch (e) { }
}

async function askNotify() {
  return enablePush();
}

/* ===================== Instalación ===================== */
let deferredPrompt = null;

async function installApp() {
  if (deferredPrompt) {
    const p = deferredPrompt;
    deferredPrompt = null;
    S.canInstall = false;
    try {
      p.prompt(); // debe llamarse dentro del gesto del usuario
      const choice = await Promise.race([
        p.userChoice,
        new Promise(resolve => setTimeout(() => resolve(null), 1500))
      ]);
      if (!choice) {
        // el navegador no mostró el diálogo: mostramos los pasos
        S.view = 'install';
        paint();
        return;
      }
      toast(choice.outcome === 'accepted' ? 'Instalando…' : 'Cancelaste la instalación');
    } catch (e) {
      S.view = 'install';
      paint();
      return;
    }
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
  checkHealth();
  const gear = document.getElementById('gear');
  if (gear) gear.textContent = S.view === 'settings' ? '✕' : '⚙️';

  if (!S.places.length) {
    if (S.view === 'install') { view.innerHTML = viewInstall(); return; }
    sub.textContent = 'Alerta Super Niño 4.0';
    view.innerHTML = viewEmpty();
    return;
  }
  const worst = Math.max(...S.places.map(levelOf));
  const alerts = S.places.filter(p => levelOf(p) >= 1).length;
  const hydroWorst = Math.max(0, ...S.places.map(p =>
    (S.data[p.id] && S.data[p.id].hydro && S.data[p.id].hydro.level) || 0));
  /* el río sin dato no es "todo tranquilo": no se puede afirmar calma */
  const hydroUnknown = hydroWorst === 0 &&
    S.places.some(p => S.data[p.id] && S.data[p.id].hydroErr);
  /* lo mismo con el clima: sin modelos utilizables no se anuncia "todo tranquilo" */
  const weatherUnknown = S.places.some(p => S.data[p.id] && S.data[p.id].sinDato);

  let msg = worst >= 4 ? (alerts > 1 ? alerts + ' lugares en alerta morada' : 'Alerta morada en un lugar')
    : worst === 3 ? (alerts > 1 ? alerts + ' lugares en alerta roja' : 'Alerta roja en un lugar')
      : worst === 2 ? (alerts > 1 ? alerts + ' lugares en alerta naranja' : 'Alerta naranja en un lugar')
        : worst === 1 ? (alerts > 1 ? alerts + ' lugares en alerta amarilla' : 'Alerta amarilla en un lugar')
          : worst === 0 ? 'Todo tranquilo'
            : 'Actualizando…';

  if (hydroWorst >= 1 && hydroWorst >= worst) {
    msg = hydroWorst >= 4 ? 'Crecida grave'
      : hydroWorst === 3 ? 'Evacuación por crecida'
        : hydroWorst === 2 ? 'Alerta por crecida'
          : 'Río alto';
  } else if (hydroUnknown) {
    msg = 'Sin dato del río';
  } else if (weatherUnknown && worst === 0) {
    msg = 'Sin dato del clima';
  }
  /* el nombre va siempre: es la marca, y el estado se suma detrás */
  /* El estado global ya lo cuenta la franja roja de arriba. Repetirlo acá
     contradecía a la tarjeta que estabas mirando ("Crecida grave" arriba,
     "Todo tranquilo" en el lugar). El encabezado queda como marca. */
  sub.textContent = 'Alerta Super Niño 4.0 · ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + (S.busy ? ' · actualizando' : '');

  if (S.view === 'settings') view.innerHTML = viewSettings();
  else if (S.view === 'add') { /* la vista se arma aparte */ }
  else if (S.view === 'install') view.innerHTML = viewInstall();
  else { view.innerHTML = viewHome(); bindRail(); }
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
  const rank = p => Math.max(levelOf(p), (S.data[p.id] && S.data[p.id].hydro && S.data[p.id].hydro.level) || 0);
  const ordered = [...S.places].sort((a, b) =>
    (rank(b) - rank(a)) ||
    (levelOf(b) - levelOf(a)) || String(a.label || '').localeCompare(String(b.label || '')));
  const loading = S.busy && !Object.keys(S.data).length;
  let body;
  if (loading) {
    body = '<div class="skel hero-sk"></div><div class="skel hero-sk" style="height:140px"></div>';
  } else {
    body = '<div class="rail">' + ordered.map(heroHtml).join('') + '</div>' +
      (ordered.length > 1
        ? '<div class="raildots">' + ordered.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('') + '</div>'
        : '');
  }
  const add = `<button class="ghost" id="addPlace" style="width:100%;margin:6px 0 2px">＋ Agregar otro lugar</button>`;
  const foot = `<div class="foot" style="margin-top:16px">Deslizá las tarjetas para ver cada lugar.</div>`;

  const top = hydroBanner() + travelBanner();
  const promo = installBanner() + notifyBanner() + hydroAskBanner();

  /* si hay alerta, la tarjeta va primero: lo demás puede esperar */
  const alerting = ordered.some(p => rank(p) >= 2);
  return alerting
    ? top + body + promo + add + shareCard() + foot
    : top + promo + body + add + shareCard() + foot;
}

function bindRail() {
  const rail = document.querySelector('.rail');
  const dots = document.querySelectorAll('.raildots i');
  if (!rail || !dots.length) return;
  const upd = () => {
    const step = rail.clientWidth * 0.87 + 12;
    const i = Math.max(0, Math.min(dots.length - 1, Math.round(rail.scrollLeft / step)));
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
  };
  rail.addEventListener('scroll', () => {
    clearTimeout(bindRail._t);
    bindRail._t = setTimeout(upd, 70);
  });
  upd();
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
  if (S.pushActive || S.hideNotify || p === 'unsupported') return '';
  if (p === 'denied') {
    return `<div class="banner warn">
      <div class="bi">🔕</div>
      <div class="bt"><b>Avisos bloqueados</b><span>Activalos desde el candado del navegador para este sitio.</span></div>
    </div>`;
  }
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const needsInstall = ios && !isStandalone();
  return `<div class="banner warn">
    <div class="bi">🔔</div>
    <div class="bt"><b>Avisos en tiempo real</b><span>${needsInstall
      ? 'En iPhone primero agregala a inicio; después activás los avisos desde la app instalada.'
      : 'Te avisamos cada vez que cambia el riesgo, aunque no estés mirando.'}</span></div>
    <button id="${needsInstall ? 'installBtn' : 'enableNotify'}">${needsInstall ? 'Instalar' : 'Activar'}</button>
    <button class="x2" data-dismiss="notify" aria-label="Ocultar">✕</button>
  </div>`;
}

const f1 = v => (v == null ? '—' : String(v).replace('.', ','));

/* Detalle desplegable: volumen, caudal y tiempos. Todo con su origen. */
function detalleHtml(d) {
  const cu = d.cuenca;
  if (!cu || !cu.red) return '';
  /* Sin lluvia igual se muestra qué se está vigilando: si la persona no ve
     que hay algo midiendo, la app parece que no hace nada. */
  if ((cu.lluvia?.mm24h ?? 0) < 5) {
    if ((cu.red.pluviometros || 0) < 3) return '';
    const nom = (cu.cuenca && cu.cuenca.nombre) ? cu.cuenca.nombre : 'tu zona';
    return '<div style="margin:10px 0 2px;font-size:12.5px;color:#8fa3c0">' +
      'Vigilando la cuenca ' + nom + ' · sin lluvia · ' +
      cu.red.informando + ' de ' + cu.red.pluviometros + ' medidores.</div>';
  }
  if (!cu.detalle || !cu.altura) return '';
  const t = cu.detalle, a = cu.altura;
  const miles = n => Number(n).toLocaleString('es-AR');
  return '<details style="margin:10px 0 2px;font-size:12.5px;line-height:1.6;color:#9db0c9">' +
    '<summary style="cursor:pointer;color:#c9d6e6">Ver detalle</summary>' +
    '<div style="margin-top:7px">' +
    'Suba esperada: <b>' + f1(a.bajo_m) + ' a ' + f1(a.alto_m) + ' m</b> sobre el nivel normal, que es ' + f1(a.normal_m) + ' m.<br>' +
    'Volumen: ' + f1(t.volumen_hm3[0]) + ' a ' + f1(t.volumen_hm3[1]) + ' hm³.<br>' +
    'Caudal medio: ' + miles(t.caudal_ls[0]) + ' a ' + miles(t.caudal_ls[1]) + ' litros por segundo.<br>' +
    'En recorrer la cuenca: ' + t.tiempo_cuenca_h[0] + ' a ' + t.tiempo_cuenca_h[1] + ' horas. Aguas abajo: ' + t.tiempo_abajo_h[0] + ' a ' + t.tiempo_abajo_h[1] + ' horas.<br>' +
    '<span style="opacity:.72">' + a.dias_registro + ' días de registro medido. ' + a.nota + '</span>' +
    '</div></details>';
}

function brasilHtml(d) {
  const b = d.brasil;
  if (!b || b.mm30 == null) return '';
  /* Sin milímetros ni días: lo que la persona necesita saber es si va a
     llegar más agua o si esto es lo que ya venía. */
  let txt;
  if (b.mm30 < 40) {
    txt = 'En Brasil, donde nace el agua de este río, casi no llovió este mes. ' +
      'No se está sumando agua nueva: lo que ves es la que ya venía bajando.';
  } else if (b.mm30 < 110) {
    txt = 'En Brasil llovió poco este mes. No se espera que llegue más agua ' +
      'que la que ya está en camino.';
  } else {
    txt = 'En Brasil llovió mucho este mes. En los próximos días puede llegar ' +
      'más agua a esta zona.';
  }
  return '<div style="margin:10px 0 2px;font-size:12.5px;line-height:1.5;color:#c2cee0">' + txt + '</div>';
}

function votosHtml(d) {
  const g = d.dict;
  if (!g || !g.votos || !g.votos.length) return '';
  const rows = g.votos.map(v => {
    const dot = v.voto == null ? '#5b6b85' : v.voto >= 2 ? '#c9564a' : v.voto === 1 ? '#d9a441' : '#3f8f63';
    return '<div style="display:flex;gap:8px;margin:3px 0">' +
      '<span style="width:7px;height:7px;border-radius:50%;background:' + dot + ';flex:0 0 7px;margin-top:5px"></span>' +
      '<span style="flex:1">' + esc(v.fuente || '') + (v.detalle ? ' <span style="opacity:.6">· ' + esc(v.detalle) + '</span>' : '') + '</span>' +
      '</div>';
  }).join('');
  return '<details style="margin:6px 0 2px;font-size:12px;color:#9db0c9">' +
    '<summary style="cursor:pointer;color:#c9d6e6">Cómo se llegó a esto · ' + g.fuentes_validas + ' de ' + g.fuentes_totales + ' fuentes</summary>' +
    '<div style="margin-top:6px">' + rows +
    '<div style="opacity:.7;margin-top:6px">' + esc(g.nota || '') + '</div></div></details>';
}

/* ===================== Seguimiento del episodio =====================
   De dónde sale cada aviso (qué modelo marca, cuál no, cuál no tiene dato)
   se calcula y se usa del lado nuestro: no se muestra. A la persona le
   sirve saber si el aviso sigue, si va a más o si ya terminó.
   Cada refresco compara el nivel con el anterior y guarda el recorrido:
   es el registro de nuestras propias lecturas, sin inventar nada. */
function trackAlert(p, agg) {
  if (!agg) return;
  const lvl = Math.max(agg.level || 0, (agg.hydro && agg.hydro.level) || 0);
  const ph = agg.hydro && agg.hydro.level >= 1 ? 'crecida' : phenomenon(agg).word;
  const prev = S.track[p.id];

  if (lvl >= 1) {
    if (!prev || prev.level === 0) {
      S.track[p.id] = { since: Date.now(), level: lvl, peak: lvl, ph, checks: 1, at: Date.now(), hist: [lvl] };
    } else {
      prev.level = lvl;
      prev.peak = Math.max(prev.peak || lvl, lvl);
      prev.checks = (prev.checks || 0) + 1;
      prev.at = Date.now();
      prev.ph = ph;
      prev.hist = (prev.hist || []).concat([lvl]).slice(-24);
      delete prev.ended;
    }
  } else if (prev && prev.level >= 1) {
    S.track[p.id] = {
      since: prev.since, level: 0, peak: prev.peak, ph: prev.ph,
      checks: (prev.checks || 0) + 1, at: Date.now(), ended: Date.now(),
      hist: (prev.hist || []).concat([0]).slice(-24), askedAt: prev.askedAt
    };
  } else if (prev && prev.ended && Date.now() - prev.ended > 6 * 3600 * 1000) {
    delete S.track[p.id];
  }
}

function hmText(ts) {
  try {
    return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

function durText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

function trackHtml(p) {
  const t = S.track && S.track[p.id];
  if (!t) return '';
  let txt = '';
  if (t.level >= 1) {
    const desde = 'desde las ' + hmText(t.since) + ' (' + durText(Date.now() - t.since) + ')';
    const h = t.hist || [];
    if (t.peak > (h[0] == null ? t.level : h[0])) txt = 'El aviso va a más ' + desde + '.';
    else if (h.length > 1 && h[h.length - 1] < h[0]) txt = 'El aviso está bajando ' + desde + '.';
    else txt = 'El aviso sigue ' + desde + '.';
  } else if (t.ended && Date.now() - t.ended < 6 * 3600 * 1000) {
    txt = 'El aviso terminó a las ' + hmText(t.ended) +
      ', después de ' + durText((t.ended || 0) - (t.since || 0)) + '.';
  }
  if (!txt) return '';

  /* lo último que reportó la persona, si fue en este mismo episodio */
  const fb = (S.feedback || []).slice(-6).reverse()
    .find(f => f.id === p.id && f.t && Date.now() - f.t < 90 * 60 * 1000);
  const note = fb
    ? `<div style="font-size:12px;color:#8fa3c0;margin-top:4px">Tu reporte de las ${hmText(fb.t)}: ` +
      (fb.a === 'no' ? 'no estaba pasando' : fb.a === 'rain' ? 'llovía' : 'había ' +
        (fb.a === 'hail' ? 'granizo' : 'viento fuerte')) + '.</div>'
    : '';

  return `<div style="margin:8px 0 2px;font-size:12.5px;color:#9db0c9;line-height:1.5">${txt}${note}</div>`;
}

function heroHtml(p) {
  const d = S.data[p.id];
  if (!d || d.error) {
    return `<section class="hero lv0" style="opacity:.9">
      <div class="where"><span><b>${esc(p.label)}</b></span><span>${d && d.error ? 'sin datos' : 'cargando'}</span></div>
      <div class="main"><div class="emoji">⏳</div><div><div class="title">Un segundo…</div>
      <div class="line">${d && d.error ? 'No pudimos traer el pronóstico.' : 'Estamos mirando el cielo.'}</div></div></div>
    </section>`;
  }
  const hyLvl = (d.hydro && d.hydro.level) || 0;
  const info = levelInfo(d);
  /* con río cerca y sin medición no se puede decir "todo" tranquilo */
  if (!hyLvl && !d.sinDato && d.hydro && !d.hydro.now) info.title = 'Clima tranquilo';

  /* si está lloviendo ahora, la tarjeta lo dice: no se muestra calma mientras cae agua */
  if (!hyLvl && d.wx && d.wx.current) {
    const pr = Number(d.wx.current.precipitation || 0);
    const gf = Number(d.wx.current.wind_gusts_10m || 0);
    const wc = Number(d.wx.current.weather_code || 0);
    const llueve = pr >= 0.2 || (wc >= 51 && wc <= 67) || (wc >= 80 && wc <= 82) || wc >= 95;
    if (llueve) {
      info.title = pr >= 4 || wc === 65 || wc === 82 ? 'Lluvia fuerte'
        : wc >= 95 ? 'Tormenta ahora'
          : pr >= 0.2 || (wc >= 61 && wc <= 64) || wc === 81 ? 'Está lloviendo' : 'Llovizna';
      info.emoji = '🌧️';
      info.line = pr >= 0.2
        ? 'Ahora mismo en tu zona caen ' + pr.toFixed(1) + ' mm/h.'
        : 'Está lloviendo en tu zona ahora mismo.';
      info.action = 'Si tenés que salir, llevá paraguas y evitá calles anegadas.';
    } else if (gf >= 45) {
      info.title = 'Viento fuerte';
      info.emoji = '💨';
      info.line = 'Ráfagas de ' + Math.round(gf) + ' km/h ahora mismo.';
      info.action = 'Asegurá lo que pueda volar en balcones y patios.';
    }
  }

  /* Dictamen del motor: si las fuentes coinciden, manda sobre el pronóstico
     de la ciudad. Nunca sobre una alerta de río ya declarada. */
  if (!hyLvl && d.dict && (d.dict.estado === 'agua_en_camino' || d.dict.estado === 'atencion' || d.dict.estado === 'dividido')) {
    info.title = d.dict.titulo;
    info.emoji = d.dict.estado === 'agua_en_camino' ? '🌊' : d.dict.estado === 'dividido' ? '❔' : '⚠️';
    info.line = d.dict.texto;
    info.action = d.dict.estado === 'agua_en_camino'
      ? 'No cruces por donde el agua atraviesa la calle.'
      : 'Mirá el detalle antes de salir.';
  }

  /* Lluvia medida sobre la cuenca. Es medición, no pronóstico: pesa más que
     el pronóstico de la ciudad. Si la red no alcanza, se dice. */
  if (!hyLvl && d.cuenca) {
    const cu = d.cuenca;
    const red = cu.red || {};
    if (cu.altura && (cu.lluvia?.mm24h ?? 0) >= 5) {
      const a = cu.altura;
      info.title = 'Suba esperada del arroyo';
      info.emoji = '🌊';
      info.line = 'Entre ' + f1(a.bajo_m) + ' y ' + f1(a.alto_m) + ' m por encima de lo normal, que es ' +
        f1(a.normal_m) + ' m.';
      info.action = 'No cruces por donde el agua atraviesa la calle.';
    } else if (cu.estado === 'lluvia' && cu.lluvia && cu.cuenca) {
      info.title = 'Lluvia sobre la cuenca';
      info.emoji = '🌧️';
      info.line = 'Cayeron ' + (cu.lluvia.mm3h ?? 0) + ' mm en 3 h sobre ' + cu.cuenca.nombre +
        '. ' + red.informando + ' de ' + red.pluviometros + ' pluviómetros informando.';
      info.action = 'El agua ya cayó en la cuenca. No estimamos a qué altura llegará el río.';
    } else if (cu.estado === 'sin_dato' && info.emoji !== '🌧️' && (red.pluviometros || 0) >= 3) {
      info.line = 'De la cuenca tenemos poco dato: informan ' + red.informando +
        ' de ' + red.pluviometros + ' pluviómetros.';
    }
  }

  /* la línea de la tarjeta puede anunciar lluvia por la franja horaria:
     el título tiene que decir lo mismo, no "tranquilo" */
  if (!hyLvl && info.emoji !== '🌧️') {
    const ev = nextEvent(d);
    if (ev && /^Lluvia/.test(ev.label)) {
      const mins = Math.round((new Date(ev.iso).getTime() - Date.now()) / 60000);
      info.title = mins <= 15 ? 'Lluvia ahora' : 'Lluvia en camino';
      info.emoji = '🌧️';
      info.line = mins <= 15
        ? 'Está empezando a llover en tu zona.'
        : 'Se espera lluvia en unos ' + mins + ' minutos.';
      info.action = 'Si tenés que salir, llevá paraguas y evitá calles anegadas.';
    }
  }
  const effLvl = Math.max(d.level, hyLvl);   // la crecida también es una alerta
  const pill = info.pill;
  const ev = eventText(d);
  const k = kindOf(p);
  const c = d.current || {};
  const gNow = c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : null;
  const nowBits = [
    c.temperature_2m != null ? Math.round(c.temperature_2m) + '°' : '',
    skyText(c.weather_code),
    gNow != null && gNow >= 20 ? 'ráfagas ' + gNow + ' km/h' : '',
    (c.precipitation || 0) > 0 ? 'está lloviendo' : ''
  ].filter(Boolean).join(' · ');

  /* El GIF se abre con alerta, o con una tormenta a 2 h o menos.
     Si el nivel está en 0 por falta de dato, el ETA no alcanza: primero el dato. */
  const ncNow = stormNow(p);
  const etaGif = ncNow && ncNow.eta != null && ncNow.eta <= 120 && !d.sinDato;
  const gifOk = hyLvl === 0 && (d.level >= 1 || etaGif);

  const ask = S.askFor === p.id ? askHtml(p) : '';
  const askBtn = d.level >= 1
    ? `<button class="ghost" data-ask="${p.id}" style="padding:7px 10px;font-size:12px">¿Está pasando?</button>`
    : '';

  return `<section class="hero ${info.cls}${effLvl >= 1 ? ' alert' : ''}">
    <div class="where">
      <button class="plbl" data-edit="${p.id}" aria-label="Editar ${esc(p.label)}">
        <span>${k.emoji}</span><b>${esc(p.label)}</b><span class="pen">✏️</span>
      </button>
      <span style="display:flex;align-items:center;gap:7px">
        <span class="chip3h${hyLvl >= 1 ? ' hydro' : ''}">${esc(pill)}</span>
        ${effLvl >= 1 ? `<button class="iconbtn" data-share="${p.id}" aria-label="Compartir alerta" title="Compartir alerta">🔗</button>` : ''}
      </span>
    </div>
    ${p.addr ? `<div class="addr">${esc(p.addr)}</div>` : ''}
    ${!hyLvl && d.hydroErr ? `<div class="hywarn">⚠ No pudimos leer el nivel del río. ${d.sinDato ? '' : 'El clima está tranquilo; '}del río no tenemos dato ahora.</div>` : ''}
    ${!hyLvl && d.hydro && !d.hydro.now && !d.hydroErr ? `<div class="addr" style="color:#8fa3c0">${esc(d.hydro.river || 'Río cerca')} · sin medición automática</div>` : ''}
    ${!hyLvl && !d.hydroErr && !d.hydro ? `<div class="addr" style="color:#8fa3c0">Sin río ni arroyo cerca: esto es solo clima.</div>` : ''}

    <div class="main">
      <div class="emoji">${info.emoji}</div>
      <div>
        <div class="title">${info.title}</div>
        <div class="line">${info.line}</div>
        ${info.detail ? `<div class="hdetail">${esc(info.detail)}</div>` : ''}
      </div>
    </div>

    ${trackHtml(p)}

    ${detalleHtml(d)}
    ${brasilHtml(d)}
    ${votosHtml(d)}

    <div class="action"><span class="cta">${info.cta}</span><span>${info.action}</span></div>

    ${gifOk ? `<div class="links" style="margin:8px 0 0">
      <button class="ghost" data-gif="${p.id}" style="padding:7px 12px;font-size:12px">Ver radar animado</button>
    </div>` : ''}

    ${hyLvl >= 4 ? '' : tempHtml(d)}

    ${hyLvl >= 1 ? riverHtml(d.hydro) : ''}

    ${hyLvl < 3 && ev.txt && !/^Ráfagas/.test(ev.txt) ? `<div class="event ${ev.big ? 'big' : ''}">⏱ ${ev.txt}</div>` : ''}

    ${hyLvl >= 3 ? '' : windHtml(d)}

    ${hyLvl >= 3 ? '' : timelineHtml(d)}

    ${hyLvl >= 3 ? '' : tilesHtml(d)}

    ${hyLvl >= 3 ? '' : `<div class="now"></div>`}


    <details class="more">
      <summary>Ver detalles</summary>
      ${hydroHtml(d, p)}
      <div class="mrow">${d.models.map(x => `<span><i class="dot d${x.l}"></i>${MODEL_NAME[x.m]}</span>`).join('')}</div>
      ${probHtml(d)}
      ${barsHtml(d)}
      <div class="links">
        ${askBtn}
      </div>
    </details>

    ${ask}
  </section>`;
}

const MOON = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

function moonPhaseEmoji(date) {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const syn = 29.530588853;
  const days = (date.getTime() - ref) / 86400000;
  const frac = (((days % syn) + syn) % syn) / syn;
  return MOON[Math.round(frac * 8) % 8];
}

function isNightAt(d, iso) {
  if (!d.sunrise || !d.sunset) return false;
  const day = iso.slice(0, 10);
  const sr = d.sunrise.find(x => x && x.slice(0, 10) === day);
  const ss = d.sunset.find(x => x && x.slice(0, 10) === day);
  if (!sr || !ss) return false;
  return iso < sr || iso >= ss;
}

function timelineHtml(d) {
  if (!d.times || d.times.length < 2) return '';
  const n = Math.min(10, d.times.length);
  let out = '<div class="timeline">';
  for (let i = 0; i < n; i++) {
    const snow = (d.snowHours && d.snowHours[i]) || 0;
    const hs = d.models.map(m => m.hours[i]).filter(Boolean);
    const avgP = hs.length ? hs.reduce((a, h) => a + (h.p || 0), 0) / hs.length : 0;
    const probs = hs.map(h => h.prob).filter(v => v != null);
    const avgProb = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;
    const gust = Math.max(0, ...hs.map(h => h.gust || 0));
    const night = isNightAt(d, d.times[i]);
    const clouds = hs.map(h => h.cl).filter(v => v != null);
    const avgCloud = clouds.length ? clouds.reduce((a, b) => a + b, 0) / clouds.length : 0;

    let ico;
    if (snow >= 0.1) ico = '❄️';
    else if (avgP >= 2 || avgProb >= 70) ico = '🌧️';
    else if (avgP >= 0.2) ico = night ? '🌧️' : '🌦️';
    else if (gust >= 50) ico = '💨';
    else if (night) {
      if (avgCloud >= 70) ico = '☁️';
      else if (avgCloud >= 25) ico = moonPhaseEmoji(new Date(d.times[i])) + '<span class="cl">☁️</span>';
      else ico = moonPhaseEmoji(new Date(d.times[i]));
    } else {
      ico = avgCloud >= 70 ? '☁️' : avgCloud >= 25 ? '🌤️' : '☀️';
    }

    const hi = avgP >= 0.2 || gust >= 50 || snow >= 0.1;
    const hh = hourLabel(d.times[i]).slice(0, 2);
    const cond = snow >= 0.1 ? 'nieve'
      : (avgP >= 0.2 || avgProb >= 40) ? 'lluvia'
        : gust >= 50 ? 'viento fuerte'
          : avgCloud >= 70 ? 'nublado'
            : avgCloud >= 25 ? 'parcialmente nublado' : 'despejado';

    out += `<div class="tl${i === 0 ? ' cur' : ''}${hi ? ' hi' : ''}${night ? ' night' : ''}"
      role="img" aria-label="${hh} horas, ${cond}${night ? ', de noche' : ''}">
      <div class="h" aria-hidden="true">${hh}</div>
      <div class="e" aria-hidden="true">${ico}</div>
      <div class="b" aria-hidden="true"><i style="width:${Math.max(6, Math.round(avgProb))}%"></i></div>
    </div>`;
  }
  return out + '</div>';
}

/* ---- bloque de seguimiento del río: cómo viene, dónde está y qué se espera ---- */
function riverSpark(h) {
  if (!h.hist || h.hist.length < 3 || !h.gauge) return '';
  const g = h.gauge;
  /* escala propia de la serie: así se ve el cambio real de las últimas 2 semanas */
  const vals = h.hist.map(p => p[1]);
  if (g.al != null) vals.push(g.al);
  if (g.ev != null) vals.push(g.ev);
  const lo = Math.min(...vals) - 0.25;
  const hi = Math.max(...vals) + 0.25;
  const span = Math.max(0.1, hi - lo);
  const W = 300, H = 66, pad = 8;
  const y = v => {
    const t = Math.max(0, Math.min(1, (v - lo) / span));
    return H - pad - t * (H - pad * 2);
  };
  const n = h.hist.length;
  const pts = h.hist.map((p, i) =>
    ((i / (n - 1)) * (W - 6) + 3).toFixed(1) + ',' + y(p[1]).toFixed(1)
  ).join(' ');

  const dash = [];
  if (g.al != null) dash.push(`<line x1="0" x2="${W}" y1="${y(g.al).toFixed(1)}" y2="${y(g.al).toFixed(1)}" class="rth"/>`);
  if (g.ev != null) dash.push(`<line x1="0" x2="${W}" y1="${y(g.ev).toFixed(1)}" y2="${y(g.ev).toFixed(1)}" class="rth ev"/>`);

  const lastV = h.hist[n - 1][1];
  const lx = W - 3, ly = y(lastV).toFixed(1);

  return `<svg class="rspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
      role="img" aria-label="Nivel del río en los últimos ${n} días">
    ${dash.join('')}
    <polyline points="${pts}" class="rline"/>
    <circle cx="${lx}" cy="${ly}" r="3.5" class="rdot"/>
  </svg>`;
}

function riverHtml(h) {
  if (!h || !h.gauge || h.now == null) return '';
  const g = h.gauge;
  const span = Math.max(0.1, g.max - g.min);
  const pos = v => Math.max(0, Math.min(100, ((v - g.min) / span) * 100));
  const f1 = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');

  const tr = h.trend || {};
  const tcls = tr.key === 'baja' ? 'baja' : tr.key === 'estable' ? 'estable' : 'sube';
  const rate = Math.abs(h.slope || 0);
  const ttxt = tr.key === 'estable'
    ? '➡ Sin cambios'
    : (tr.arrow || '') + ' ' + f1(rate) + ' m/día';

  /* la barra: tramo habitual, tramo de alerta y tramo de evacuación */
  let zones = `<div class="rzone ok" style="width:100%"></div>`;
  if (g.al != null) {
    const pa = pos(g.al);
    const pe = g.ev != null ? pos(g.ev) : 100;
    zones = `<div class="rzone ok" style="width:${pa}%"></div>` +
      `<div class="rzone warn" style="left:${pa}%;width:${Math.max(0, pe - pa)}%"></div>` +
      (g.ev != null ? `<div class="rzone bad" style="left:${pe}%;width:${Math.max(0, 100 - pe)}%"></div>` : '');
  }

  const marks = [`<i class="rmark" style="left:${pos(g.now)}%"></i>`];
  /* leyenda en fila: nunca se pisa, aunque los umbrales estén juntos */
  const leg = [`<span><i class="lg ok"></i>normal</span>`];
  if (g.al != null) leg.push(`<span><i class="lg warn"></i>alerta ${f1(g.al)} m</span>`);
  if (g.ev != null) leg.push(`<span><i class="lg bad"></i>evacuación ${f1(g.ev)} m</span>`);

  const day = String(h.date || '').slice(8, 10);
  const mon = String(h.date || '').slice(5, 7);
  const when = day ? `Medido el ${day}/${mon}` : '';

  /* termómetro vertical: el nivel actual se ve contra los umbrales.
     Si la estación no tiene alerta o evacuación, ese tramo no se dibuja. */
  /* Sin barras ni escalas: una frase que se entiende sin saber leer un gráfico. */
  const dist = v => (v == null ? null : Math.round(Math.abs(h.now - v) * 100) / 100);
  let frase, fcolor;
  if (g.ev != null && h.now >= g.ev) {
    frase = 'Está ' + f1(dist(g.ev)) + ' m por encima del nivel de evacuación.';
    fcolor = '#e0796d';
  } else if (g.al != null && h.now >= g.al) {
    frase = 'Está ' + f1(dist(g.al)) + ' m por encima del nivel de alerta.';
    if (g.ev != null) frase += ' Faltan ' + f1(dist(g.ev)) + ' m para evacuación.';
    fcolor = '#e0b562';
  } else if (g.al != null) {
    frase = 'Está ' + f1(dist(g.al)) + ' m por debajo del nivel de alerta.';
    fcolor = '#8fd0a8';
  } else {
    frase = 'Esta estación no tiene umbral de alerta publicado.';
    fcolor = '#8ea2c0';
  }



  return `<div class="river ${tr.key || 'estable'}">
    <div class="rnow" style="font-size:46px;line-height:1;font-weight:300;color:#eaf1fb;letter-spacing:-1px">${f1(h.now)} <span style="font-size:18px">m</span></div>
    <div class="rtrend ${tcls}" style="margin-top:8px;display:inline-block">${ttxt}</div>
    <div style="margin-top:10px;font-size:13px;line-height:1.45;color:${fcolor}">${frase}</div>

    ${riverSpark(h)}
    <div class="rfoot">
      <span>Últimos ${(h.hist || []).length || 14} días</span>
      ${when ? `<span>${when}</span>` : ''}
    </div>

    ${h.proj48 != null && h.slope >= 0.15
      ? `<div class="rproj">Si sigue así, en 2 días podría llegar a ${f1(h.proj48)} m.</div>` : ''}
    ${h.peakTxt ? `<div class="rpeak">✅ ${esc(h.peakTxt)}</div>` : ''}
  </div>`;
}

function hydroHtml(d, p) {
  const rows = [];
  const h = d.hydro;
  const nearby = (p && S.rivers && S.rivers[p.id]) || [];
  if (h && h.q != null) {
    let riverName = String(h.river || '').trim();
    if ((!riverName || riverName === 'Río cercano') && nearby.length) {
      riverName = nearby[0].name + ' (' + nearby[0].d + ' km)';
    }
    if (!riverName) riverName = 'Río cercano';
    const state = ['nivel habitual', 'alto', 'alerta', 'evacuación', 'crecida grave'][Math.min(4, h.level)] || 'alto';
    const bits = [];
    if (h.now != null) bits.push('nivel medido ' + String(h.now).replace('.', ',') + ' m');
    if (h.al != null) bits.push('alerta ' + String(h.al).replace('.', ',') + ' m');
    if (h.ev != null) bits.push('evacuación ' + String(h.ev).replace('.', ',') + ' m');
    if (h.station && h.station.name) bits.push('estación ' + h.station.name);
    const meta = bits.length ? ' · ' + bits.join(' · ') : '';
    const rainTxt = h.rain48 >= 1 ? ` · lluvia de las últimas 48 h: ${h.rain48} mm` : '';
    rows.push(`<div class="prob hydro">🌊 <b>${esc(riverName)}</b> · ${esc(state)}${esc(meta)}${rainTxt}</div>`);
  }
  const rivers = (p && S.rivers && S.rivers[p.id]) || [];
  if (rivers.length) {
    const list = rivers.slice(0, 3).map(r => `${esc(r.name)} · ${r.d} km`).join(' · ');
    rows.push(`<div class="prob">🏞️ Ríos cerca: ${list}</div>`);
  }
  return rows.join('');
}

/* ===================== Detección de viaje ===================== */
function haversineKm(a, b, c, d) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(c - a), dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function getPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 }
    );
  });
}

async function reverseName(lat, lon) {
  try {
    const r = await fetch('/api/rev?lat=' + lat + '&lon=' + lon, { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    const a = j.address || {};
    return a.city || a.town || a.village || a.suburb || a.county || j.name || '';
  } catch (e) { return ''; }
}

async function checkTravel() {
  if (!S.places.length) return;
  const pos = await getPosition();
  if (!pos) return;

  const nearest = S.places
    .map(p => ({ p, d: haversineKm(pos.lat, pos.lon, p.lat, p.lon) }))
    .sort((a, b) => a.d - b.d)[0];

  if (nearest && nearest.d < 12) {
    if (S.travel) { S.travel = null; paint(); }
    return;
  }

  const cell = pos.lat.toFixed(1) + ',' + pos.lon.toFixed(1);
  if (S.travelSkip[cell] && Date.now() - S.travelSkip[cell] < 12 * 3600 * 1000) return;

  const name = await reverseName(pos.lat, pos.lon);
  S.travel = { lat: pos.lat, lon: pos.lon, name, dist: nearest ? Math.round(nearest.d) : null, cell };
  paint();
}

function openMenu() {
  const el = document.getElementById('menuSheet');
  if (!el) return;
  el.hidden = false;
  updateGeoBtn();
}

/* El encabezado queda fuera del contenedor que escucha los clics, asi que
   el boton nunca recibia el evento. Listener directo. */
document.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('#menu') : null;
  if (b) { openMenu(); }
}, true);

/* Las filas de la hoja no reciben el clic por el ruteo general; se
   despachan aca, en captura, con la misma logica del router. */
document.addEventListener('click', ev => {
  const hoja = ev.target && ev.target.closest ? ev.target.closest('#menuSheet') : null;
  if (!hoja) return;
  if (ev.target.closest('[data-close],#menuClose,.sheet-close,.x')) { closeMenu(); return; }
  const fila = ev.target.closest('[data-k]');
  if (!fila) return;
  const k = fila.getAttribute('data-k');
  if (k === 'support') { location.href = '/apoyar.html#donar'; return; }
  if (k === 'tutorial') { closeMenu(); openSheet(); return; }
  if (k === 'settings') { closeMenu(); S.view = 'settings'; paint(); return; }
  if (k === 'share') { closeMenu(); if (typeof shareApp === 'function') shareApp(); return; }
}, true);

function closeMenu() {
  const el = document.getElementById('menuSheet');
  if (el) el.hidden = true;
}

function updateGeoBtn() {
  const b = document.getElementById('geoBtn');
  if (!b) return;
  b.textContent = S.geoAsked ? 'Revisar mi zona ahora' : 'Activar ubicación';
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(r => {
      if (r.state === 'granted') b.textContent = 'Revisar mi zona ahora';
      else if (r.state === 'denied') b.textContent = 'Ubicación bloqueada en el navegador';
    }).catch(() => { });
  }
}

function geoAskBanner() {
  if (S.geoAsked || !('geolocation' in navigator) || !S.places.length) return '';
  return `<div class="banner">
    <div class="bi">📍</div>
    <div class="bt"><b>¿Te avisamos si te movés de zona?</b><span>Con permiso de ubicación detectamos si estás en otro lugar y te ofrecemos seguirlo.</span></div>
    <button data-geo="on">Permitir</button>
    <button class="x2" data-geo="off" aria-label="No">✕</button>
  </div>`;
}

function travelBanner() {
  const t = S.travel;
  if (!t) return '';
  const label = t.name || 'esta zona';
  return `<div class="banner">
    <div class="bi">📍</div>
    <div class="bt"><b>Estás en ${esc(label)}</b><span>${t.dist ? 'A ' + t.dist + ' km de tus lugares. ' : ''}Si seguís esta zona, te avisamos de lluvias, ráfagas y crecidas de acá.</span></div>
    <button data-travel="add">Seguir</button>
    <button class="x2" data-travel="skip" aria-label="Ahora no">✕</button>
  </div>`;
}

function hydroBanner() {
  /* el lugar con la situación de agua más grave */
  const cands = S.places
    .filter(x => S.data[x.id] && S.data[x.id].hydro && S.data[x.id].hydro.level >= 1)
    .sort((a, b) => S.data[b.id].hydro.level - S.data[a.id].hydro.level);
  const p = cands[0];
  if (!p) return '';

  const h = S.data[p.id].hydro;
  const lv = Math.max(1, Math.min(4, h.level));
  const tone = lv >= 4 ? 'floodb4' : lv === 3 ? 'floodb3' : lv === 2 ? 'floodb2' : 'floodb1';
  const title = (h.headline || 'Crecida cerca') + ' · ' + p.label;
  /* en el banner va lo justo: dónde y cuánto. El resto está en la tarjeta. */
  const first = h.measured || String(h.detail || '').split('. ')[0];
  const sub = [h.river, first].filter(Boolean).join(' · ');

  return `<div class="banner ${tone}">
    <div class="bi">${lv >= 3 ? sirenaSvg(40) : '🌊'}</div>
    <div class="bt"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
  </div>`;
}

function hydroAskBanner() {
  /* si ya hay una crecida en curso, no preguntamos: mostramos el aviso */
  if (hydroBanner()) return '';
  const p = S.places.find(x => x.hydro === undefined);
  if (!p) return '';
  return `<div class="banner">
    <div class="bi">🌊</div>
    <div class="bt"><b>¿Avisos de crecidas cerca de ${esc(p.label)}?</b><span>Te avisamos si el río sube más de lo normal.</span></div>
    <button data-hydro="yes" data-place="${p.id}">Sí</button>
    <button class="x2" data-hydro="no" data-place="${p.id}" aria-label="No">✕</button>
  </div>`;
}

const WX_EMOJI = c => c <= 1 ? '☀️' : c === 2 ? '🌤️' : c === 3 ? '☁️'
  : (c === 45 || c === 48) ? '🌫️' : (c >= 51 && c <= 57) ? '🌦️'
    : (c >= 61 && c <= 67) ? '🌧️' : (c >= 71 && c <= 77) ? '🌨️'
      : (c >= 80 && c <= 82) ? '🌦️' : (c >= 85 && c <= 86) ? '🌨️'
        : c >= 95 ? '⛈️' : '🌡️';

const DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/* Temperatura actual y extendido, en una sola franja compacta.
   Antes la tarjeta se estiraba con bloques separados; acá va todo junto. */
function tempHtml(d) {
  const c = d.wx && d.wx.current;
  if (!c || c.temperature_2m == null) return '';
  const t = Math.round(c.temperature_2m);
  const st = c.apparent_temperature == null ? null : Math.round(c.apparent_temperature);
  const dl = d.wx.daily;
  /* cuando se piden varios modelos, Open-Meteo devuelve las variables con
     sufijo (_ecmwf_ifs025, _gfs_seamless...). Hay que resolverlo o queda NaN. */
  const pick = (o, base) => {
    if (!o) return null;
    if (o[base]) return o[base];
    const k = Object.keys(o).find(x => x.indexOf(base + '_') === 0);
    return k ? o[k] : null;
  };
  const dMax = pick(dl, 'temperature_2m_max');
  const dMin = pick(dl, 'temperature_2m_min');
  const dCode = pick(dl, 'weather_code');
  const dias = [];
  if (dl && dl.time && dMax && dMin) {
    for (let i = 0; i < Math.min(7, dl.time.length); i++) {
      const f = new Date(dl.time[i] + 'T12:00:00');
      const mx = Math.round(dMax[i]);
      const mn = Math.round(dMin[i]);
      const ico = WX_EMOJI(Number(dCode ? dCode[i] : 0));
      dias.push('<div style="flex:1;text-align:center;min-width:0">' +
        '<div style="font-size:10px;color:#8ea2c0;margin-bottom:2px">' + (i === 0 ? 'Hoy' : DIA[f.getDay()]) + '</div>' +
        '<div style="font-size:15px;line-height:1.1">' + ico + '</div>' +
        '<div style="font-size:11.5px;color:#e6edf7;margin-top:1px">' + mx + '°</div>' +
        '<div style="font-size:10px;color:#7d90b3">' + mn + '°</div></div>');
    }
  }
  const hoyMax = dMax ? Math.round(dMax[0]) : null;
  const hoyMin = dMin ? Math.round(dMin[0]) : null;
  return '<div style="margin:12px 0 4px">' +
    '<div style="display:flex;align-items:flex-end;gap:12px">' +
    '<div style="font-size:40px;line-height:.95;font-weight:300;color:#eaf1fb">' + t + '°</div>' +
    '<div style="font-size:11.5px;color:#8ea2c0;line-height:1.5;padding-bottom:3px">' +
    (st != null ? 'Se siente ' + st + '°<br>' : '') +
    (hoyMax != null ? 'Hoy ' + hoyMax + '° / ' + hoyMin + '°' : '') +
    '</div></div>' +
    (dias.length > 2 ? '<div style="display:flex;gap:4px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.07)">' +
      dias.join('') + '</div>' : '') +
    '</div>';
}

function windHtml(d) {
  const nowG = Math.round((d.current && d.current.wind_gusts_10m) || 0);
  const max12 = Math.round(maxGust(d, 12));
  const pct = Math.max(2, Math.min(100, Math.round(nowG / 130 * 100)));
  const tone = nowG >= 100 ? 'bad' : nowG >= 60 ? 'strong' : nowG >= 40 ? 'mid' : 'ok';
  return `<div class="wind ${tone}">
    <div class="wtop"><span>💨 Ráfagas ahora</span><b>${nowG} km/h</b></div>
    <div class="wbar"><i style="width:${pct}%"></i>
      <u style="left:31%"></u><u style="left:46%"></u><u style="left:77%"></u>
    </div>
    <div class="wleg"><span>leve</span><span>moderado</span><span>fuerte</span></div>
    <div class="wfoot">Máximo en 12 h: <b>${max12} km/h</b></div>
  </div>`;
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
  const out = [];

  if (d.ens) {
    const pc = v => Math.round(v * 100) + '%';
    const bits = [
      'lluvia ≥15 mm <b>' + pc(d.ens.rain15) + '</b>',
      'ráfagas ≥60 km/h <b>' + pc(d.ens.gust60) + '</b>'
    ];
    if (d.hailPossible) bits.push('<b>posible granizo</b>');
    if (d.snow3 >= 0.2) bits.push('nieve <b>' + d.snow3.toFixed(1) + ' cm</b>');
    const g12 = Math.round(maxGust(d, 12));
    if (g12 >= 25) bits.push('ráfagas hasta <b>' + g12 + ' km/h</b>');
    const bestLine = d.best
      ? `<br>Fuente que más acierta acá: <b>${MODEL_NAME[d.best.src] || 'el ensemble'}</b> (${d.best.h}/${d.best.n})`
      : '';
    out.push(`<div class="prob">${d.ens.n} de 51 escenarios: ${bits.join(' · ')}${bestLine}</div>`);
  }

  if (d.met) {
    const gap = Math.abs(d.met.level - d.level);
    out.push(`<div class="prob">Control externo: nivel ${d.met.level} · lluvia ${d.met.rain3} mm · ráfagas ${d.met.gustKmh} km/h${gap >= 2 ? ' · <b>discrepa con Open-Meteo</b>' : ''}</div>`);
  }

  return out.join('');
}

function barsHtml(d) {
  if (!d.times || d.times.length < 2) return '';
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
  return out + '</div>' + meta + '</div>';
}

function askHtml(p) {
  const opts = [['Sí, llueve', 'rain'], ['No, nada', 'no'], ['Cae granizo', 'hail'], ['Viento fuerte', 'wind']];
  return `<div class="ask">
    <div class="q-t">¿Qué está pasando ahora en ${esc(p.label)}?</div>
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

function learnHtml() {
  const names = { lluvia: 'lluvia', viento: 'viento', granizo: 'granizo', calma: 'calma' };
  const rows = [];
  S.places.forEach(p => {
    Object.keys(S.learn[p.id] || {}).forEach(ph => {
      const b = bestSource(p.id, ph);
      if (!b) return;
      rows.push(`<div class="row"><div class="grow"><b>${esc(p.label)} · ${names[ph] || ph}</b><small>${MODEL_NAME[b.src] || 'ensemble'} · ${b.h} de ${b.n}</small></div></div>`);
    });
  });
  return rows.join('');
}

function viewSettings() {
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const rows = S.places.map(p => `<div class="row">
      <div class="grow"><b>${kindOf(p).emoji} ${esc(p.label)}</b><small>${esc(p.addr || (p.lat.toFixed(3) + ', ' + p.lon.toFixed(3)))}</small></div>
      <button class="ghost" data-edit="${p.id}" style="padding:8px 12px;font-size:13px">Editar</button>
      <button class="del" data-del="${p.id}">Quitar</button>
    </div>`).join('') || `<p class="hint">Todavía no agregaste lugares.</p>`;

  const done = S.feedback.filter(f => f.a && f.pred);
  const tot = {};
  done.forEach(f => Object.keys(f.pred).forEach(m => {
    const pr = f.pred[m];
    const hit = f.a === 'no' ? (!pr.rain && !pr.wind && !pr.hail && !pr.gust)
      : f.a === 'gust' ? !!pr.gust
        : !!pr[f.a] || (f.a === 'rain' && pr.hail) || (f.a === 'hail' && pr.rain);
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
    <div class="row"><div class="grow"><b>Voz</b><small>Lee las alertas en voz alta</small></div>
      <button class="ghost" id="toggleVoice" style="padding:8px 12px;font-size:13px">${S.voice ? 'Desactivar' : 'Activar'}</button></div>
    <div class="row"><div class="grow"><b>Sonido de alerta</b><small>${S.sound ? 'Tono propio cuando cambia una alerta' : 'Apagado'}</small></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="ghost" id="testSound" style="padding:8px 12px;font-size:13px">Probar</button>
        <button class="ghost" id="toggleSound" style="padding:8px 12px;font-size:13px">${S.sound ? 'Desactivar' : 'Activar'}</button>
      </div></div>
    <div class="row"><div class="grow"><b>Avisos en tiempo real</b><small>${S.pushActive ? 'Activados en este dispositivo' : perm === 'denied' ? 'Bloqueados por el navegador' : 'Sin activar'}</small></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${S.pushActive
      ? '<button class="ghost" id="testPush" style="padding:8px 12px;font-size:13px">Probar</button><button class="ghost" id="disablePush" style="padding:8px 12px;font-size:13px">Desactivar</button>'
      : '<button class="ghost" id="enableNotify" style="padding:8px 12px;font-size:13px">Activar</button>'}
      </div></div>
    <p class="hint">${S.pushActive
      ? 'Llegan aunque la app esté cerrada. No hace falta instalar nada más.'
      : (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !isStandalone())
        ? 'En iPhone los avisos solo funcionan con ASN instalada: Compartir → “Agregar a pantalla de inicio”, y activalos desde ahí.'
        : 'Se activan con un toque y funcionan con la app cerrada. Si el navegador ya bloqueó el permiso, abrilo desde el candado de la barra de direcciones.'}</p>
    <div class="row"><div class="grow"><b>Avisos técnicos</b><small>${S.ownerTech ? 'Solo este teléfono recibe un aviso si el sistema deja de actualizar' : 'Para enterarte si el sistema se detiene, sin depender de ninguna computadora'}</small></div>
      <button class="ghost" id="toggleOwner" style="padding:8px 12px;font-size:13px">${S.ownerTech ? 'Desactivar' : 'Activar'}</button>
    </div>
    <div class="row"><div class="grow"><b>¿Cómo te resulta ASN?</b><small>${S.myStars ? 'Gracias: ' + S.myStars + ' de 5' : 'Tocá una estrella'}</small></div>
      <div>${[1, 2, 3, 4, 5].map(n => '<button class="ghost" data-rate="' + n + '" style="padding:6px 9px;margin-left:3px;font-size:15px;' + (S.myStars >= n ? 'color:#fbbf24' : 'opacity:.45') + '">★</button>').join('')}</div>
    </div>
    ${S.ownerOk
      ? '<div class="row"><div class="grow"><b>Uso de la app</b><small>Usuarios: ' +
        (S.metricsOwner ? S.metricsOwner.users : '—') + ' · Valoraciones: ' +
        (S.metricsOwner ? S.metricsOwner.ratings : '—') +
        (S.metricsOwner && S.metricsOwner.avg ? ' · Media ' + S.metricsOwner.avg : '') +
        '</small></div><button class="ghost" id="ownerOut" style="padding:8px 12px;font-size:13px">Ocultar</button></div>'
      : S.ownerForm
        ? '<div class="row"><div class="grow"><b>Clave del dueño</b></div>' +
          '<input id="ownerKey" type="password" placeholder="clave" style="width:120px;padding:8px;border-radius:10px;border:1px solid #2a3a52;background:#0d1726;color:#dbe6f7;font-size:12px">' +
          '<button class="ghost" id="saveOwner" style="padding:8px 12px;font-size:13px">Ver</button></div>'
        : '<div class="row"><div class="grow"><small><a href="#" id="ownerAsk" style="color:#7d90b3;text-decoration:none">Soy el dueño</a></small></div></div>'}
    ${publicLine()}
    ${provinciasHtml()}
  </div>

  <div class="sec">Qué fuente acierta más acá</div>
  <div class="card">
    ${learnHtml() || scoreRows || `<p>Cuando respondas “¿Qué estás viendo?”, acá vas a ver qué fuente le pega más en tu zona.</p>`}
    <p class="hint">Con 5 reportes y 70 % de acierto, esa fuente puede subir el nivel de la tarjeta cuando marca algo más grave que el resto.</p>
  </div>

  <div class="sec">Escala de alertas</div>
  <div class="card list">
    ${LEVELS.map((L, i) => `<div class="row"><div class="grow"><b>${L.emoji} ${L.name}</b><small>${[
      'Sin fenómenos previstos.',
      'Puede pasar algo, no es grave.',
      'Conviene prepararse y guardar cosas.',
      'Riesgo alto.',
      'Excepcional: riesgo extremo.'
    ][i]}</small></div></div>`).join('')}
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

const INTRO_SCRIPT = 'ASN cuatro punto cero usa cinco colores. ' +
  'Verde: no hay alerta, está todo tranquilo. ' +
  'Amarilla: puede pasar algo, atención, no es grave. ' +
  'Naranja: se viene lluvia, granizo o ráfagas fuertes. Guardá lo que tengas afuera. ' +
  'Roja: riesgo alto, evitá salir en auto y seguí las indicaciones de las autoridades. ' +
  'Morada: fenómeno excepcional, riesgo extremo. ' +
  'Cada aviso lleva el icono del fenómeno: lluvia, llovizna, lluvia torrencial, granizo, ráfagas, tormenta eléctrica o nieve.';

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
  const action = lvl >= 3 ? 'Riesgo alto. Evitá salir en auto si no hace falta.'
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
  const askedNumber = /\d{1,5}\s*$/.test(S.query.trim());
  const hasExact = S.results.some(r => r.kind === 'Dirección');
  const note = (askedNumber && !hasExact)
    ? '<p class="hint">Esa altura no está cargada en el mapa. Elegí la calle: la tomamos como referencia del barrio.</p>'
    : '';
  box.innerHTML = note + S.results.map((r, i) => `<div class="res" data-pick="${i}">
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


/* Enlace que se lee solo: /alerta/4/crecida-grave/-27.27/-58.24/casa
   Sin guardar nada: no gasta escrituras y se puede tipear a mano. */
function slug(s, max) {
  const t = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t.slice(0, max || 18) || 'lugar';
}

function shareUrl(o) {
  const lat = Number(o.lat).toFixed(2);
  const lon = Number(o.lon).toFixed(2);
  return location.origin + '/alerta/' + o.l + '/' + slug(o.p) + '/' + lat + '/' + lon + '/' + slug(o.n, 20);
}

async function sharePlace(id) {
  const p = S.places.find(x => x.id === id);
  if (!p) return;
  const d0 = S.data[p.id];
  const hyLvl = (d0 && d0.hydro && d0.hydro.level) || 0;
  const lvl = Math.max((d0 && d0.level) || 0, hyLvl);

  if (!d0 || lvl < 1) {
    toast('El enlace se comparte desde alerta amarilla');
    return;
  }

  const ph = hyLvl >= 1
    ? { word: d0.hydro.headline || 'crecida', emoji: '🌊' }
    : phenomenon(d0);

  const url = shareUrl({
    n: p.label, a: p.addr, lat: p.lat, lon: p.lon,
    l: lvl, p: ph.word, e: ph.emoji
  });
  const text = `${LEVELS[lvl].name} · ${ph.word} en ${p.label}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'ASN 4.0', text, url });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch (e) { }
  toast(copied ? 'Enlace copiado para compartir' : 'Copiá este enlace: ' + url);
}

/* ===================== GIF de radar ===================== */
let gifBlob = null;
let gifUrl = null;
let gifPlaceId = null;

function openGif(id) {
  const p = S.places.find(x => x.id === id);
  const d = S.data[id];
  if (!p || !d) return;
  const n = stormNow(p);
  const etaOk = n && n.eta != null && n.eta <= 120 && !d.sinDato;
  if (d.level < 1 && !etaOk) {
    toast('El radar animado aparece cuando hay alerta o una tormenta a menos de 2 h');
    return;
  }

  gifPlaceId = id;
  gifBlob = null;
  document.getElementById('gifPlace').textContent = kindOf(p).emoji + ' ' + p.label;
  const img = document.getElementById('gifImg');
  img.hidden = true;
  img.removeAttribute('src');
  const spin = document.getElementById('gifSpin');
  spin.hidden = false;
  spin.textContent = 'Generando GIF…';
  document.getElementById('gifShare').disabled = true;
  document.getElementById('gifSave').disabled = true;
  document.getElementById('gifSheet').hidden = false;
  buildGif(p, d, n);
}

async function buildGif(p, d, n) {
  const spin = document.getElementById('gifSpin');
  const note = n && n.eta != null && n.eta <= 120
    ? 'Tormenta a ' + n.d + ' km · llegaría en ~' + fmtEta(n.eta)
    : '';
  try {
    const blob = await ASNRadar.build(p, d.level, phenomenon(d).word, note);
    gifBlob = blob;
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    gifUrl = URL.createObjectURL(blob);
    const img = document.getElementById('gifImg');
    img.src = gifUrl;
    img.hidden = false;
    spin.hidden = true;
    document.getElementById('gifShare').disabled = false;
    document.getElementById('gifSave').disabled = false;
  } catch (e) {
    spin.textContent = 'No pudimos generar el GIF. Probá otra vez en un rato.';
  }
}

async function shareGif() {
  if (!gifBlob) return;
  const p = S.places.find(x => x.id === gifPlaceId);
  const d = S.data[gifPlaceId];
  const file = new File([gifBlob], 'asn-radar.gif', { type: 'image/gif' });
  const text = d ? `${LEVELS[d.level].name} · ${phenomenon(d).word} en ${p.label}` : 'ASN 4.0';
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ASN 4.0', text });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  saveGif();
}

function saveGif() {
  if (!gifUrl) return;
  const a = document.createElement('a');
  a.href = gifUrl;
  a.download = 'asn-radar.gif';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('GIF descargado');
}

function addPlace(r) {
  if (S.places.length >= 6) { toast('Máximo 6 lugares'); return; }
  const dup = S.places.find(x => Math.abs(x.lat - r.lat) < 0.005 && Math.abs(x.lon - r.lon) < 0.005);
  if (dup) { toast('Ese lugar ya está en la lista'); return; }
  const k = KINDS.find(x => x.id === S.addKind) || KINDS[0];
  S.places.push({
    id: uid(), label: k.label, kind: k.id,
    addr: r.addr || [r.label, r.sub].filter(Boolean).join(', ') || r.name || '',
    lat: +r.lat, lon: +r.lon
  });
  S.results = []; S.query = ''; S.view = 'home';
  save(); paint(); refresh();
  syncPush();
}

/* ===================== Editar un lugar ===================== */
function openEdit(id) {
  const p = S.places.find(x => x.id === id);
  if (!p) return;
  S.editId = p.id;
  S.editKind = p.kind || 'casa';
  document.getElementById('editAddr').textContent =
    p.addr || (p.lat.toFixed(3) + ', ' + p.lon.toFixed(3));
  document.getElementById('editName').value = p.label || '';
  paintEditKinds();
  document.getElementById('editSheet').hidden = false;
}

function paintEditKinds() {
  const box = document.getElementById('editKinds');
  if (!box) return;
  box.innerHTML = KINDS.map(k =>
    `<button data-ekind="${k.id}" class="${S.editKind === k.id ? 'on' : ''}">${k.emoji} ${k.label}</button>`
  ).join('');
}

function closeEdit() {
  const el = document.getElementById('editSheet');
  if (el) el.hidden = true;
}

function saveEdit() {
  const p = S.places.find(x => x.id === S.editId);
  if (!p) { closeEdit(); return; }
  const k = KINDS.find(x => x.id === S.editKind) || KINDS[0];
  const nm = (document.getElementById('editName').value || '').trim().slice(0, 22);
  p.kind = k.id;
  p.label = nm || k.label;
  save();
  paint();
  closeEdit();
  toast('Lugar actualizado');
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

/* ===================== Pregunta en pantalla + radar ===================== */
const ASK_KEY = 'asn.askedAt';

function quietHours() {
  const h = new Date().getHours();
  return h >= 23 || h < 7;
}

/* El pop-up ya no pregunta porque pasaron seis horas: pregunta cuando hay
   una alerta que lleva un rato y todavía no consultamos en ese episodio.
   En rojo o morado no se pregunta: se actúa. */
function askTarget() {
  const now = Date.now();
  let best = null;
  S.places.forEach(p => {
    const d = S.data[p.id];
    if (!d || d.error) return;
    const lvl = d.level || 0;
    if (lvl < 1 || lvl >= 3) return;
    const t = S.track[p.id] || {};
    if (t.askedAt && t.since && t.askedAt >= t.since) return;   /* ya preguntamos en este episodio */
    if (now - (t.since || now) < 8 * 60 * 1000) return;         /* recién empieza: esperar */
    if (d.sinDato) return;                                      /* sin dato no hay nada que confirmar */
    if (!best || lvl > best.lvl) best = { p, d, lvl, t };
  });
  return best;
}

function openAsk(target) {
  const tg = target || askTarget();
  if (!tg) return false;
  const p = tg.p, d = tg.d;
  S.askPlace = p.id;

  const el = document.getElementById('askSheet');
  if (!el) return false;
  const t = S.track[p.id] || {};
  const ph = phenomenon(d);

  const title = document.getElementById('askTitle');
  if (title) title.textContent = LEVELS[tg.lvl].name + ' por ' + ph.word;

  const lead = document.getElementById('askPlace');
  if (lead) {
    lead.innerHTML = kindOf(p).emoji + ' ' + esc(p.label) +
      (t.since ? ' · desde las ' + hmText(t.since) : '') +
      '<br><span style="font-size:12.5px;color:#8fa3c0">¿Qué estás viendo? Con esto sabemos si el aviso se está cumpliendo o ya pasó.</span>';
  }

  const res = document.getElementById('askResult');
  if (res) { res.hidden = true; res.innerHTML = ''; }
  el.querySelectorAll('[data-askans]').forEach(b => {
    b.classList.remove('picked');
    b.style.background = '';
  });
  el.hidden = false;

  /* queda marcado el episodio: no se vuelve a preguntar por lo mismo */
  if (S.track[p.id]) { S.track[p.id].askedAt = Date.now(); save(); }
  return true;
}

function closeAsk(mark) {
  const el = document.getElementById('askSheet');
  if (el) el.hidden = true;
  if (mark) { try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch (e) { } }
}

let healthAt = 0;
/* estado del sistema, leído por el teléfono: cubre el caso en que el cron
   entero se detenga y no pueda avisar de sí mismo */
async function checkHealth() {
  if (Date.now() - healthAt < 30 * 60 * 1000) return;
  healthAt = Date.now();
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    const antes = S.healthBad;
    S.healthBad = j && j.ok === false ? Math.round(j.acumMin || 0) : 0;
    loadMetrics(); pingUse();
    if (S.healthBad && S.healthBad !== antes) {
      toast('Los datos no se actualizan desde hace ' + S.healthBad + ' min');
    }
  } catch (e) { }
}

async function postRating(n) {
  const dev = (pushSub && pushSub.endpoint) || S.deviceId;
  if (!dev) { toast('No se pudo identificar el teléfono'); return; }
  S.myStars = n;
  save();
  paint();
  try {
    const r = await fetch('/api/rate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: dev, stars: n })
    });
    toast(r.ok ? 'Gracias por valorar' : 'No se pudo guardar');
  } catch (e) { toast('No se pudo guardar'); }
  loadMetrics(true);
}

let metricsAt = 0;
/* uso y valoraciones: exactos sólo con la clave del dueño; el resto,
   agregados públicos recién cuando hay masa crítica */
async function loadMetrics(force) {
  if (!force && Date.now() - metricsAt < 30 * 60 * 1000) return;
  metricsAt = Date.now();
  try {
    const q = S.ownerKey ? '?k=' + encodeURIComponent(S.ownerKey) : '';
    const r = await fetch('/api/metrics' + q, { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    S.metricsPub = j.publico || null;
    S.metricsOwner = j.users != null ? j : null;
    paint();
    return j;
  } catch (e) { return null; }
}

/* prueba social: sólo aparece cuando hay masa crítica */
function publicLine() {
  const p = S.metricsPub;
  if (!p) return '';
  const a = p.users ? 'La usan ' + p.users + ' personas' : '';
  const b = p.ratings ? '★ ' + p.avg + ' con ' + p.ratings + ' valoraciones' : '';
  const t = [a, b].filter(Boolean).join(' · ');
  if (!t) return '';
  return '<div class="row"><div class="grow"><small>' + t + '</small></div></div>';
}

/* dónde se usa, en barras: sólo lo ve el dueño */
function provinciasHtml() {
  const m = S.metricsOwner;
  if (!S.ownerOk || !m || !m.provincias || !m.provincias.length) return '';
  const list = m.provincias.slice(0, 6);
  const max = list[0].n || 1;
  const rows = list.map(x => {
    const w = Math.round(x.n / max * 100);
    return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">' +
      '<span style="flex:0 0 100px;font-size:12px;color:#c6d4ec">' + esc(x.p) + '</span>' +
      '<span style="flex:1;height:8px;background:rgba(255,255,255,.07);border-radius:4px;overflow:hidden">' +
      '<span style="display:block;height:8px;width:' + w + '%;background:#4c8ede"></span></span>' +
      '<span style="flex:0 0 20px;text-align:right;font-size:12px;color:#9db0c9">' + x.n + '</span></div>';
  }).join('');
  return '<div class="row" style="display:block"><small style="color:#9db0c9">Dónde se usa</small>' +
    '<div style="margin-top:6px">' + rows + '</div></div>';
}

function provinceOf(p) {
  const a = (p && p.addr) || '';
  const parts = a.split(',').map(x => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : 'Sin provincia';
}

let useAt = 0;
/* dónde se usa: se manda una vez cada 6 h, con la provincia del lugar guardado */
async function pingUse() {
  if (!S.deviceId || !S.places.length) return;
  if (Date.now() - useAt < 6 * 3600 * 1000) return;
  useAt = Date.now();
  try {
    await fetch('/api/use', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: S.deviceId, prov: provinceOf(S.places.find(x => ((x.addr || '').split(',').length > 1)) || S.places[0]) })
    });
  } catch (e) { }
}

function maybeOpenAsk() {
  if (quietHours() || document.hidden) return;
  let last = 0;
  try { last = Number(localStorage.getItem(ASK_KEY) || 0); } catch (e) { }
  if (Date.now() - last < 45 * 60 * 1000) return;
  const sheet = document.getElementById('askSheet');
  if (sheet && !sheet.hidden) return;
  const tutorial = document.getElementById('sheet');
  if (tutorial && !tutorial.hidden) return;
  const target = askTarget();
  if (!target) return;
  openAsk(target);
}

/* Una respuesta del pop-up tiene que contestar SIEMPRE, aunque falle algo
   del registro o del radar. Si el radar no contesta, la hoja se cierra sola
   igual: antes quedaba abierta y parecía que el botón no funcionaba. */
const ASK_LABEL = {
  rain: 'Llueve', no: 'No está pasando', hail: 'Cae piedra',
  gust: 'Hay ráfagas', wind: 'Viento fuerte'
};

function answerAsk(a, btn) {
  const p = S.places.find(x => x.id === S.askPlace) || null;
  const res = document.getElementById('askResult');

  if (btn) {
    btn.classList.add('picked');
    btn.style.background = '#1f3350';
  }
  if (res) {
    res.hidden = false;
    res.innerHTML = '<b>Anotado: ' + (ASK_LABEL[a] || 'recibido') + '.</b><br>Revisando el radar de tu zona…';
  }

  /* La hoja se cierra ANTES de cualquier trabajo: si algo tarda o falla,
     la pantalla nunca queda tapada y la app sigue respondiendo. */
  closeAsk(true);
  toast('Anotado: ' + (ASK_LABEL[a] || 'recibido') + '. Gracias');

  if (!p) return;

  try { recordFeedback(p, a); } catch (e) { }
  try { evaluateReport(p, a); } catch (e) { }

  radarCheck(p).then(r => {
    try {
      if (a === 'rain') learnAdd(p.id, 'lluvia', 'radar', r === 'rain');
      if (a === 'no') learnAdd(p.id, 'calma', 'radar', r === 'clear');
      const fb = S.feedback[S.feedback.length - 1];
      if (fb && !fb.radar) { fb.radar = r; save(); }
    } catch (e) { }
  }).catch(() => { });

  /* relee los datos con el reporte ya incorporado, sin bloquear nada */
  setTimeout(() => { try { refresh(); } catch (e) { } }, 1500);
}

/* Cruza el reporte del usuario con el radar de RainViewer (tiles con CORS) */
async function radarCheck(p) {
  try {
    const meta = await fetch('/api/radar', { cache: 'no-store' }).then(r => r.json());
    const past = meta && meta.radar && meta.radar.past;
    if (!past || !past.length) return 'unknown';
    const frame = past[past.length - 1];
    const z = 8, n = Math.pow(2, z);
    const latRad = p.lat * Math.PI / 180;
    const fx = (p.lon + 180) / 360 * n;
    const fy = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    const url = meta.host + frame.path + '/256/' + z + '/' + x + '/' + y + '/2/1_1.png';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = Math.round((fx - x) * 256), py = Math.round((fy - y) * 256);
    const x0 = Math.max(0, px - 5), y0 = Math.max(0, py - 5);
    const w = Math.min(11, 256 - x0), h = Math.min(11, 256 - y0);
    const data = ctx.getImageData(x0, y0, w, h).data;
    let hits = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 40) hits++;
    return hits > 3 ? 'rain' : 'clear';
  } catch (e) {
    return 'unknown';
  }
}

function radarText(a, r) {
  if (r === 'unknown') return 'No pudimos revisar el radar en este momento.';
  if (r === 'rain') {
    return a === 'no'
      ? 'El radar <b>sí ve lluvia cerca</b>: puede ser un chaparrón puntual o estar pasando a unos kilómetros.'
      : 'El radar <b>también ve lluvia cerca</b> de tu zona.';
  }
  return a === 'rain'
    ? 'El radar <b>no ve lluvia</b> justo ahora: puede ser lluvia muy local o poca cobertura del radar.'
    : 'El radar <b>no ve lluvia</b> en tu zona en este momento.';
}

/* ===================== Aprendizaje con los reportes ===================== */
function learnAdd(placeId, ph, src, hit) {
  const L = S.learn[placeId] = S.learn[placeId] || {};
  const P = L[ph] = L[ph] || {};
  const b = P[src] = P[src] || { h: 0, n: 0 };
  b.n++;
  if (hit) b.h++;
}

function bestSource(placeId, ph) {
  const bucket = ((S.learn[placeId] || {})[ph]) || {};
  const rows = Object.keys(bucket)
    .map(src => ({ src, h: bucket[src].h, n: bucket[src].n, rate: bucket[src].n ? bucket[src].h / bucket[src].n : 0 }))
    .filter(r => r.n >= 3);
  rows.sort((a, b) => b.rate - a.rate || b.n - a.n);
  return rows[0] || null;
}

function evaluateReport(p, a) {
  const d = S.data[p.id];
  if (!d) return;
  const ph = a === 'hail' ? 'granizo' : (a === 'gust' || a === 'wind') ? 'viento' : a === 'rain' ? 'lluvia' : 'calma';
  d.models.forEach(m => {
    const pred = {
      lluvia: m.rain,
      viento: m.wind || m.hours.slice(0, 3).some(h => h.gust >= 40),
      granizo: false
    };
    const hit = a === 'no' ? (!pred.lluvia && !pred.viento) : !!pred[ph];
    learnAdd(p.id, ph, m.m, hit);
  });
  if (d.ens) {
    const pred = { lluvia: d.ens.rain15 >= 0.30, viento: d.ens.gust60 >= 0.40, granizo: false };
    learnAdd(p.id, ph, 'ens', a === 'no' ? (!pred.lluvia && !pred.viento) : !!pred[ph]);
  }
  save();
}

/* Si una fuente viene acertando en esta zona y marca más grave, subimos un nivel */
function applyLearning(p, agg) {
  const ph = phenomenon(agg).key;
  const best = bestSource(p.id, ph);
  agg.best = best;
  if (best && best.n >= 5 && best.rate >= 0.70) {
    const m = agg.models.find(x => x.m === best.src);
    if (m && m.l > agg.level) {
      agg.level = Math.min(4, m.l);
      agg.boostedBy = best.src;
    }
  }
}

function recordFeedback(p, a) {
  const d = S.data[p.id];
  if (!d) return;
  const pred = {};
  (Array.isArray(d.models) ? d.models : []).forEach(m => {
    const hrs = Array.isArray(m.hours) ? m.hours : [];
    pred[m.m] = {
      rain: m.rain, wind: m.wind, hail: false,
      gust: hrs.slice(0, 3).some(h => h.gust >= 40)
    };
  });
  S.feedback.push({ id: p.id, p: p.label, t: Date.now(), a, pred, level: d.level, radar: null });
  S.feedback = S.feedback.slice(-200);
  save();
}

/* ===================== Compartir la app ===================== */
async function shareApp() {
  const url = location.origin + '/';
  const text = 'ASN 4.0 te avisa antes de salir: lluvia fuerte, ráfagas, granizo y crecida del río en tus lugares. Gratis, sin publicidad y sin instalar nada.';

  try {
    if (navigator.share) {
      await navigator.share({ title: 'ASN 4.0', text: text, url: url });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(text + ' ' + url);
    toast('Enlace copiado. Pegalo donde quieras.');
  } catch (e) {
    toast('Compartí este enlace: ' + url);
  }
}

function shareCard() {
  return `<div class="share">
    <div class="sh-tx">
      <b>La seguridad la hacemos entre todos</b>
      <span>Pasale ASN 4.0 a tu familia. Cuanta más gente lo usa y reporta lo que ve, mejor responde en tu zona.</span>
    </div>
    <button class="sh-go" id="shareApp">Compartir</button>
  </div>`;
}

/* ===================== Invitación a apoyar ===================== */
const SUPPORT_KEY = 'asn.support';
const SUPPORT_DAYS = 14;

function supportSeen() {
  try {
    const last = Number(localStorage.getItem(SUPPORT_KEY) || 0);
    return Date.now() - last < SUPPORT_DAYS * 86400000;
  } catch (e) { return false; }
}

function supportClose() {
  const w = document.getElementById('supportSheet');
  if (w) w.hidden = true;
  const bar = document.getElementById('supportBar');
  if (bar) bar.hidden = true;
  document.body.classList.remove('has-bar');
  try { localStorage.setItem(SUPPORT_KEY, String(Date.now())); } catch (e) { }
}

/* Los botones de la hoja de apoyo no tienen id: el ruteo general resuelve
   al contenedor y el clic no llegaba a supportClose. Listener propio. */
document.addEventListener('click', ev => {
  const b = ev.target && ev.target.closest
    ? ev.target.closest('#supportSheet [data-closesupport],#supportBar [data-closesupport]')
    : null;
  if (b) supportClose();
}, true);

/* el peor nivel que hay en pantalla, sea de clima o de río */
function worstLevel() {
  let w = 0;
  S.places.forEach(p => {
    const d = S.data[p.id];
    if (!d) return;
    w = Math.max(w, d.level || 0, (d.hydro && d.hydro.level) || 0);
  });
  return w;
}

function supportPopup() {
  const w = document.getElementById('supportSheet');
  if (!w || !w.hidden || supportSeen()) return;

  /* sin lugares todavía: primero que aprenda a usar la app */
  if (!S.places.length) return;

  /* nunca encima de una alerta, ni tapando otra hoja abierta */
  const alerting = S.places.some(p => {
    const d = S.data[p.id];
    if (!d) return false;
    return (d.level || 0) >= 2 || (d.hydro && d.hydro.level >= 1);
  });
  if (alerting) return;
  if (document.querySelector('.sheet-wrap:not([hidden])')) return;

  w.hidden = false;
  const go = document.getElementById('supportGo');
  if (go) go.focus();
}

/* Regla de producto: desde nivel 2 (clima o río) no se pide dinero.
   Ni hoja completa ni barra chica: primero la alerta. */
function hideSupport() {
  const bar = document.getElementById('supportBar');
  if (bar) bar.hidden = true;
  const sheet = document.getElementById('supportSheet');
  if (sheet) sheet.hidden = true;
  document.body.classList.remove('has-bar');
}

/* Decide cómo invitar según lo que esté pasando:
   sin alerta → hoja completa. Con amarilla (nivel 1) → barra chica al pie.
   Desde nivel 2 no se pide nada. */
function supportInvite() {
  if (supportSeen() || !S.places.length) return;
  if (document.querySelector('.sheet-wrap:not([hidden])')) return;

  /* el nivel ya calculado de cada lugar (clima + río), sin pedir nada a la red */
  const w = worstLevel();
  if (w >= 2) { hideSupport(); return; }

  if (w >= 1) {
    const bar = document.getElementById('supportBar');
    if (!bar) return;
    bar.hidden = false;
    document.body.classList.add('has-bar');
    return;
  }

  supportPopup();
}

/* ===================== Eventos ===================== */
/* La hoja de consulta escucha en captura: si otra capa corta el evento,
   el botón igual responde. */
(function () {
  const sh = document.getElementById('askSheet');
  if (!sh) return;
  sh.addEventListener('click', ev => {
    const b = ev.target.closest ? ev.target.closest('[data-askans]') : null;
    if (!b) return;
    ev.preventDefault();
    ev.stopPropagation();
    answerAsk(b.getAttribute('data-askans'), b);
  }, true);
})();

document.addEventListener('click', ev => {
  /* Esta linea se perdio al borrar el boton del radar: sin ella, t no
     existia y NINGUN clic de la app funcionaba. */
  /* la lista tiene que incluir TODOS los atributos accionables: si falta uno,
     closest() devuelve el contenedor con id y el botón no hace nada */
  const t = ev.target.closest ? ev.target.closest('[id],[data-k],[data-close],[data-closeask],[data-closeedit],[data-closegif],[data-edit],[data-ekind],[data-askans],[data-rate],[data-dismiss],[data-share],[data-geo],[data-travel],[data-gif]') : null;
  if (!t) return;

  if (t.id === 'shareApp') { shareApp(); return; }
  if (t.hasAttribute('data-edit')) { openEdit(t.getAttribute('data-edit')); return; }
  if (t.hasAttribute('data-closeedit')) { closeEdit(); return; }
  if (t.hasAttribute('data-ekind')) { S.editKind = t.getAttribute('data-ekind'); paintEditKinds(); return; }
  if (t.id === 'editSave') { saveEdit(); return; }
  if (t.hasAttribute('data-closesupport')) { supportClose(); return; }
  if (t.id === 'supportGo') { supportClose(); return; }
  if (t.hasAttribute('data-closeask')) { closeAsk(true); return; }
  if (t.hasAttribute('data-rate')) {
    postRating(Number(t.getAttribute('data-rate')));
    return;
  }

  if (t.id === 'ownerAsk') { S.ownerForm = true; paint(); return; }

  if (t.id === 'ownerOut') {
    S.ownerOk = false; S.ownerForm = false; S.ownerKey = '';
    save(); paint();
    return;
  }

  if (t.id === 'saveOwner') {
    const inp = document.getElementById('ownerKey');
    S.ownerKey = inp ? inp.value.trim() : '';
    save();
    loadMetrics(true).then(j => {
      S.ownerOk = !!(j && j.users != null);
      S.ownerForm = !S.ownerOk;
      if (!S.ownerOk) toast('Esa clave no es válida');
      save();
      paint();
    });
    return;
  }

  if (t.id === 'toggleOwner') {
    if (!S.pushActive) { toast('Activá primero los avisos en tiempo real'); return; }
    S.ownerTech = !S.ownerTech;
    save();
    postSubscription(pushSub).then(ok => {
      toast(!ok ? 'No se pudo guardar' : S.ownerTech ? 'Avisos técnicos activados en este teléfono' : 'Avisos técnicos desactivados');
    });
    paint();
    return;
  }

  if (t.hasAttribute('data-askans')) {
    answerAsk(t.getAttribute('data-askans'), t);
    return;
  }

  if (t.hasAttribute('data-dismiss')) {
    const kind = t.getAttribute('data-dismiss');
    if (kind === 'install') S.hideInstall = true;
    if (kind === 'notify') S.hideNotify = true;
    paint();
    return;
  }
  if (t.hasAttribute('data-share')) { sharePlace(t.getAttribute('data-share')); return; }
  if (t.hasAttribute('data-gif')) { openGif(t.getAttribute('data-gif')); return; }
  if (t.hasAttribute('data-closegif')) { document.getElementById('gifSheet').hidden = true; return; }
  if (t.id === 'gifShare') { shareGif(); return; }
  if (t.id === 'gifSave') { saveGif(); return; }
  if (t.hasAttribute('data-geo')) {
    const on = t.getAttribute('data-geo') === 'on';
    S.geoAsked = true;
    save();
    if (on) {
      getPosition().then(pos => {
        paint();
        if (pos) checkTravel();
      });
    } else {
      paint();
    }
    return;
  }
  if (t.hasAttribute('data-travel')) {
    if (t.getAttribute('data-travel') === 'add' && S.travel) {
      const tr = S.travel;
      S.addKind = 'importante';
      addPlace({ label: tr.name || 'Estoy acá', addr: tr.name || '', lat: tr.lat, lon: tr.lon });
      S.travel = null;
      save(); paint();
      toast('Lugar agregado');
    } else if (S.travel) {
      S.travelSkip[S.travel.cell] = Date.now();
      S.travel = null;
      save(); paint();
    }
    return;
  }
  if (t.hasAttribute('data-hydro')) {
    const p = S.places.find(x => x.id === t.getAttribute('data-place'));
    if (p) {
      p.hydro = t.getAttribute('data-hydro') === 'yes';
      save(); paint(); syncPush();
      toast(p.hydro ? 'Avisos de crecidas activados' : 'Sin avisos de crecidas');
    }
    return;
  }
  if (t.hasAttribute('data-kind')) {
    S.addKind = t.getAttribute('data-kind');
    document.querySelectorAll('#kinds button').forEach(b => b.classList.toggle('on', b.dataset.kind === S.addKind));
    return;
  }
  if (t.id === 'speakIntro') { speak(INTRO_SCRIPT); return; }
  if (t.id === 'toggleVoice') {
    S.voice = !S.voice;
    if (!S.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
    save(); paint();
    toast(S.voice ? 'Voz activada' : 'Voz desactivada');
    return;
  }
  if (t.id === 'toggleSound') {
    S.sound = !S.sound;
    save(); paint();
    if (S.sound) playAlertSound(3, true);
    toast(S.sound ? 'Sonido activado' : 'Sonido desactivado');
    return;
  }
  if (t.id === 'testSound') {
    unlockAudio();
    const ok = playAlertSound(3, true);
    toast(ok ? 'Así suena la alarma' : 'Este navegador no puede reproducir sonido');
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
  if (t.id === 'menu') { openMenu(); return; }
  if (t.hasAttribute('data-closemenu')) { closeMenu(); return; }
  if (t.hasAttribute('data-open')) {
    const k = t.getAttribute('data-open');
    closeMenu();
    if (k === 'share') { shareApp(); return; }
    if (k === 'support') { location.href = '/apoyar.html#donar'; return; }
    if (k === 'tutorial') { openSheet(); return; }
    if (k === 'settings') { S.view = 'settings'; paint(); return; }
    return;
  }
  if (t.id === 'geoBtn') {
    S.geoAsked = true;
    save();
    getPosition().then(pos => {
      updateGeoBtn();
      if (pos) {
        closeMenu();
        checkTravel();
        toast('Ubicación tomada');
      } else {
        toast('No pudimos obtener la ubicación');
      }
    });
    return;
  }
  if (t.id === 'back') { S.view = 'home'; paint(); return; }
  if (t.id === 'startAdd' || t.id === 'addPlace') { openAdd(); return; }
  if (t.id === 'gps') { useGPS(); return; }
  if (t.id === 'enableNotify') { askNotify(); return; }
  if (t.id === 'testPush') { testPush(); return; }
  if (t.id === 'disablePush') { disablePush(); return; }
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
    save(); paint(); syncPush(); return;
  }
  if (t.hasAttribute('data-ask')) {
    const id = t.getAttribute('data-ask');
    S.askFor = S.askFor === id ? null : id;
    paint(); return;
  }
  if (t.hasAttribute('data-ans')) {
    const id = t.getAttribute('data-place');
    const p = S.places.find(x => x.id === id);
    if (p) { recordFeedback(p, t.getAttribute('data-ans')); evaluateReport(p, t.getAttribute('data-ans')); }
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
      <div class="lbl" style="margin-bottom:8px">¿Qué es este lugar?</div>
      <div class="kinds" id="kinds">
        ${KINDS.map(k => `<button data-kind="${k.id}" class="${S.addKind === k.id ? 'on' : ''}">${k.emoji} ${k.label}</button>`).join('')}
      </div>
      <input id="q" placeholder="Calle y número, barrio o ciudad" autocomplete="off" autocapitalize="words" style="margin-top:12px">
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

  /* a los 10 s, invitación a apoyar (nunca si hay alerta) */
  setTimeout(supportInvite, 10000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'speak' && e.data.text) speak(e.data.text);
      if (e.data && e.data.type === 'alert-sound') playAlertSound(e.data.level || 3);
    });
  }

  (async () => {
    await loadVapid();
    const sub = await currentPush();
    if (sub) {
      pushSub = sub;
      S.pushActive = true;
      await postSubscription(sub);
      paint();
    }
  })();

  try {
    const q = new URLSearchParams(location.search).get('speak');
    if (q) setTimeout(() => speak(q), 900);
  } catch (e) { }

  let seen = false;
  try { seen = !!localStorage.getItem(INTRO_KEY); } catch (e) { }
  if (!seen) setTimeout(openSheet, 2500);

  /* a los 20 s pregunta qué está pasando; reintenta cada 15 s si aún no hay datos */
  setTimeout(() => {
    maybeOpenAsk();
    setInterval(maybeOpenAsk, 15000);
  }, 20000);

  if (S.geoAsked && navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' })
      .then(r => { if (r.state === 'granted') setTimeout(checkTravel, 4000); })
      .catch(() => { });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.geoAsked) checkTravel();
  });

  window.__asnBooted = true;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const ed = document.getElementById('editSheet');
  if (ed && !ed.hidden) { closeEdit(); return; }
  const w = document.getElementById('supportSheet');
  if (w && !w.hidden) supportClose();
});

/* el audio se habilita con el primer toque: es la regla de todos los navegadores */
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, unlockAudio, { once: true, passive: true }));

document.addEventListener('DOMContentLoaded', init);













