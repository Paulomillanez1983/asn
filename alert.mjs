/**
 * ASN 4.0 — chequeo en segundo plano (GitHub Actions, cada 10 minutos).
 *
 * Escala de 5 colores: verde, amarilla, naranja, roja y morada.
 * Base: Météo-France (vert/jaune/orange/rouge) + nivel excepcional violeta.
 * Decide con el ensemble del IFS (hasta 51 escenarios) en las próximas 3 h.
 *
 * Secretos / variables:
 *   PLACES        [{"n":"Casa","lat":-31.33,"lon":-64.256}]
 *   NTFY_TOPIC    canal de ntfy (el mismo que muestra la app en Ajustes)
 *   MIN_LEVEL     1 por defecto (avisa desde amarilla)
 *   QUIET_HOURS   "23-7" por defecto; "off" para desactivar
 *   DRY_RUN       "1" para no enviar nada
 *
 * Reglas: mismo nivel no se repite antes de 3 h; baja sólo tras 2 corridas
 * por debajo; de 23 a 7 sólo pasan roja y morada.
 */
import fs from 'node:fs';

const LEVELS = [
  { name: 'Sin alerta', emoji: '🟢' },
  { name: 'Alerta amarilla', emoji: '🟡' },
  { name: 'Alerta naranja', emoji: '🟠' },
  { name: 'Alerta roja', emoji: '🔴' },
  { name: 'Alerta morada', emoji: '🟣' }
];

const env = process.env;
const places = JSON.parse(env.PLACES || '[]');
const topic = env.NTFY_TOPIC || '';
const minLevel = Number(env.MIN_LEVEL || 1);
const dryRun = env.DRY_RUN === '1';
const quiet = env.QUIET_HOURS === 'off' ? null : (env.QUIET_HOURS || '23-7').split('-').map(Number);

const STATE_FILE = 'state.json';
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};

function localHour() {
  return Number(new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Cordoba', hour: 'numeric', hour12: false
  }).format(new Date()));
}
function isQuiet() {
  if (!quiet) return false;
  const [from, to] = quiet;
  const h = localHour();
  return from <= to ? (h >= from && h < to) : (h >= from || h < to);
}

async function ensemble(place) {
  const u = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  u.searchParams.set('latitude', place.lat);
  u.searchParams.set('longitude', place.lon);
  u.searchParams.set('hourly', 'precipitation,wind_gusts_10m');
  u.searchParams.set('models', 'ecmwf_ifs025');
  u.searchParams.set('forecast_hours', '4');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
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
    gust60: p(gusts, 60), gust80: p(gusts, 80), gust100: p(gusts, 100), gust130: p(gusts, 130),
    maxRate: rains.length ? Math.max(...rains) : 0
  };
}

function levelOf(pb) {
  if (pb.rain100 >= 0.30 || pb.gust130 >= 0.30) return 4;
  if (pb.rain60 >= 0.50 || pb.gust100 >= 0.30) return 3;
  if (pb.rain30 >= 0.40 || pb.gust80 >= 0.40) return 2;
  if (pb.rain15 >= 0.30 || pb.gust60 >= 0.40) return 1;
  return 0;
}

function phenomenon(pb) {
  const rain = pb.rain15 >= 0.30;
  const wind = pb.gust60 >= 0.40;
  if (rain && pb.rain60 >= 0.50) return { key: 'torrencial', word: 'lluvia torrencial', emoji: '🌊' };
  if (rain && wind) return { key: 'lluvia', word: 'lluvia y ráfagas', emoji: '🌧️' };
  if (rain) return { key: 'lluvia', word: 'lluvia', emoji: '🌧️' };
  if (pb.gust80 >= 0.40) return { key: 'viento', word: 'ráfagas fuertes', emoji: '💨' };
  return { key: 'viento', word: 'ráfagas', emoji: '💨' };
}

async function notify(title, message, level, ph) {
  if (dryRun) return console.log('[dry-run]', title, '|', message);
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic, title, message,
      priority: level >= 3 ? 5 : level >= 2 ? 4 : 3,
      tags: [ph.key === 'torrencial' ? 'ocean' : ph.key === 'viento' ? 'dash' : 'cloud_with_rain']
    })
  });
  if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
}

async function main() {
  if (!places.length) return console.log('Sin lugares en PLACES.');
  if (!topic) return console.log('Falta NTFY_TOPIC.');
  if (isQuiet()) console.log('Horario silencioso: sólo pasan roja y morada.');

  for (const p of places) {
    const name = p.n || p.name || 'Lugar';
    try {
      const pb = probabilities(await ensemble(p));
      const level = levelOf(pb);
      const ph = phenomenon(pb);
      const prev = state[name]?.level ?? -1;
      const at = state[name]?.at ?? 0;
      const lowStreak = state[name]?.low ?? 0;

      const rising = level > prev;
      const cooling = Date.now() - at < 3 * 60 * 60 * 1000;
      const quietBlock = isQuiet() && level < 3;

      if (level >= minLevel && rising && !cooling && !quietBlock) {
        const pct = Math.round(Math.max(pb.rain15, pb.rain30, pb.rain60, pb.rain100, pb.gust60, pb.gust80, pb.gust100, pb.gust130) * 100);
        const L = LEVELS[level];
        await notify(
          `${L.emoji} ${L.name} · ${ph.emoji} ${ph.word} en ${name}`,
          `${ph.word} en las próximas 3 h (${pct}% de ${pb.n} escenarios).`,
          level, ph
        );
        state[name] = { level, at: Date.now(), low: 0 };
        console.log('Aviso enviado:', name, level, L.name);
      } else {
        const nextLow = level < (prev < 0 ? 0 : prev) ? lowStreak + 1 : 0;
        const newLevel = nextLow >= 2 ? level : Math.max(level, prev < 0 ? level : prev);
        state[name] = { level: newLevel, at, low: nextLow };
        console.log(name, 'nivel', level, '(sin aviso)');
      }
    } catch (e) {
      console.error(name, e.message);
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

main().catch(e => { console.error(e); process.exit(1); });
