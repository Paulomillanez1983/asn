/**
 * ASN 4.0 — chequeo en segundo plano (GitHub Actions, cada 10 minutos).
 *
 * Usa el ensemble del IFS (51 escenarios) en lugar del voto "2 de 4 modelos":
 * cuenta cuántos miembros superan los umbrales en las próximas 3 horas.
 *
 * Secretos / variables:
 *   PLACES        [{"n":"Casa","lat":-31.33,"lon":-64.256}]
 *   NTFY_TOPIC    canal de ntfy (el mismo que muestra la app en Ajustes)
 *   MIN_LEVEL     2 por defecto
 *   QUIET_HOURS   "23-7" por defecto; "off" para desactivar
 *   DRY_RUN       "1" para no enviar nada
 *
 * Reglas de emisión (ver docs/INVESTIGACION.md):
 *   - avisa al subir a nivel 2 o 3
 *   - el mismo nivel no se repite antes de 3 h
 *   - baja el nivel sólo tras 2 corridas seguidas por debajo
 *   - de 23 a 7 sólo pasa el nivel 3
 */
import fs from 'node:fs';

const LEVELS = ['Sin riesgo', 'Atención', 'Alerta', 'Peligro'];
const env = process.env;
const places = JSON.parse(env.PLACES || '[]');
const topic = env.NTFY_TOPIC || '';
const minLevel = Number(env.MIN_LEVEL || 2);
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
    rain15: p(rains, 15), rain30: p(rains, 30), rain60: p(rains, 60),
    gust60: p(gusts, 60), gust80: p(gusts, 80), gust100: p(gusts, 100)
  };
}

function levelOf(pb) {
  let l = 0;
  if (pb.rain15 >= 0.30) l = Math.max(l, 1);
  if (pb.rain30 >= 0.40) l = Math.max(l, 2);
  if (pb.rain60 >= 0.50) l = Math.max(l, 3);
  if (pb.gust60 >= 0.40) l = Math.max(l, 1);
  if (pb.gust80 >= 0.40) l = Math.max(l, 2);
  if (pb.gust100 >= 0.30) l = Math.max(l, 3);
  return l;
}

function what(pb) {
  const bits = [];
  if (pb.rain30 >= 0.40 || pb.rain60 >= 0.50) bits.push('lluvia fuerte');
  else if (pb.rain15 >= 0.30) bits.push('lluvia');
  if (pb.gust80 >= 0.40 || pb.gust100 >= 0.30) bits.push('ráfagas fuertes');
  else if (pb.gust60 >= 0.40) bits.push('viento');
  return bits.join(' y ') || 'condiciones adversas';
}

async function notify(title, message, level) {
  if (dryRun) return console.log('[dry-run]', title, '|', message);
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic, title, message,
      priority: level >= 3 ? 5 : 4,
      tags: ['cloud_with_rain', level >= 3 ? 'rotating_light' : 'warning']
    })
  });
  if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
}

async function main() {
  if (!places.length) return console.log('Sin lugares en PLACES.');
  if (!topic) return console.log('Falta NTFY_TOPIC.');
  if (isQuiet()) console.log('Horario silencioso: sólo pasa nivel 3.');

  for (const p of places) {
    const name = p.n || p.name || 'Lugar';
    try {
      const pb = probabilities(await ensemble(p));
      const level = levelOf(pb);
      const prev = state[name]?.level ?? -1;
      const at = state[name]?.at ?? 0;
      const lowStreak = state[name]?.low ?? 0;

      const rising = level > prev;
      const cooling = Date.now() - at < 3 * 60 * 60 * 1000;
      const quietBlock = isQuiet() && level < 3;

      if (level >= minLevel && rising && !cooling && !quietBlock) {
        const pct = Math.round(Math.max(pb.rain15, pb.rain30, pb.rain60, pb.gust60, pb.gust80, pb.gust100) * 100);
        await notify(
          `${level === 3 ? '🔴' : '🟠'} ${LEVELS[level]} – ${name}`,
          `${what(pb)} en las próximas 3 h (${pct}% de ${pb.n} escenarios).`,
          level
        );
        state[name] = { level, at: Date.now(), low: 0 };
        console.log('Aviso enviado:', name, level);
      } else {
        // histéresis: bajar sólo después de 2 corridas por debajo
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
