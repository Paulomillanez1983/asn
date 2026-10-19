/**
 * alert.mjs — chequeo en segundo plano (GitHub Actions, cada 10 min).
 * Lee los lugares del secreto PLACES (JSON) y publica en ntfy.sh cuando el
 * riesgo sube. No necesita servidor propio.
 *
 * Secretos/variables:
 *   PLACES        [{"n":"Casa","lat":-31.33,"lon":-64.256}, ...]
 *   NTFY_TOPIC    canal de ntfy (el mismo que muestra la app en Ajustes)
 *   MIN_LEVEL     2 por defecto (0..3)
 *   QUIET_HOURS   "23-7" por defecto; usar "off" para desactivar
 *   DRY_RUN       "1" para no enviar nada
 */
import fs from 'node:fs';

const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const NAMES = { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON', gem_seamless: 'GEM' };
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

function pointRisk({ rain, gust, cape, code }) {
  const a = rain < 0.5 ? 0 : rain < 2.5 ? 1 : rain < 7.6 ? 2 : 3;
  const b = gust < 50 ? 0 : gust < 70 ? 1 : gust < 90 ? 2 : 3;
  const hail = code >= 96 ? 3 : (cape >= 2500 && gust >= 80 ? 2 : (cape >= 1500 && gust >= 80 ? 1 : 0));
  return { l: Math.max(a, b, hail), rain: a >= 1, wind: b >= 1, hail: hail >= 2 };
}

function modelRisk(h, m) {
  const g = k => h[k + '_' + m] || [];
  const pr = g('precipitation'), gu = g('wind_gusts_10m'), ca = g('cape'), wc = g('weather_code');
  let acc = 0, lvl = 0, rain = false, wind = false, hail = false;
  for (let i = 0; i < Math.min(3, pr.length); i++) {
    const r = pr[i] ?? 0;
    const x = pointRisk({ rain: r, gust: gu[i] ?? 0, cape: ca[i] ?? 0, code: wc[i] ?? 0 });
    acc += r;
    lvl = Math.max(lvl, x.l);
    rain ||= x.rain; wind ||= x.wind; hail ||= x.hail;
  }
  lvl = Math.max(lvl, acc >= 50 ? 3 : acc >= 25 ? 2 : 0);
  return { m, l: lvl, rain, wind, hail };
}

async function forecast(p) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', p.lat);
  u.searchParams.set('longitude', p.lon);
  u.searchParams.set('hourly', 'precipitation,wind_gusts_10m,cape,weather_code');
  u.searchParams.set('models', MODELS.join(','));
  u.searchParams.set('forecast_hours', '4');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('wind_speed_unit', 'kmh');
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j.hourly) throw new Error('sin datos');
  return j.hourly;
}

async function notify(title, message, level) {
  if (dryRun) return console.log('[dry-run]', title, '|', message);
  const res = await fetch('https://ntfy.sh/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      title,
      message,
      priority: level >= 3 ? 5 : 4,
      tags: ['cloud_with_rain', level >= 3 ? 'rotating_light' : 'warning']
    })
  });
  if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
}

async function main() {
  if (!places.length) return console.log('Sin lugares en PLACES: nada para revisar.');
  if (!topic) return console.log('Falta NTFY_TOPIC.');
  if (isQuiet()) {
    console.log('Horario silencioso: solo se avisa nivel 3.');
  }

  for (const p of places) {
    const name = p.n || p.name || 'Lugar';
    try {
      const h = await forecast(p);
      const models = MODELS.map(m => modelRisk(h, m));
      const sorted = models.map(x => x.l).sort((a, b) => b - a);
      const level = Math.min(3, sorted[1] ?? 0); // al menos 2 modelos de acuerdo
      const votes = k => models.filter(x => x[k]).length;

      const prev = state[name]?.level ?? -1;
      const lastAt = state[name]?.at ?? 0;
      const cooling = Date.now() - lastAt < 45 * 60 * 1000;

      if (level >= minLevel && level > prev && !cooling && (!isQuiet() || level === 3)) {
        const bits = [
          votes('hail') >= 2 ? 'granizo' : '',
          votes('wind') >= 2 ? 'ráfagas fuertes' : '',
          votes('rain') >= 2 ? 'lluvia' : ''
        ].filter(Boolean).join(', ') || 'condiciones adversas';
        const detail = models.map(x => NAMES[x.m] + ':' + x.l).join(' · ');
        await notify(
          `${level === 3 ? '🔴' : '🟠'} ${LEVELS[level]} – ${name}`,
          `${bits} en las próximas 3 h (${detail}).`,
          level
        );
        console.log('Aviso enviado:', name, level);
        state[name] = { level, at: Date.now() };
      } else {
        state[name] = { level, at: lastAt };
        console.log(name, 'nivel', level, '(sin aviso)');
      }
    } catch (e) {
      console.error(name, e.message);
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

main().catch(e => { console.error(e); process.exit(1); });

