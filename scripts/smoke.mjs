/* Prueba de humo contra PRODUCCIÓN.
   No mira código: mira que la app publicada responda bien en los puntos
   que ya se rompieron alguna vez. Si algo falla, sale con código 1. */

const BASE = process.env.BASE_URL || 'https://asn.asn-clima.workers.dev';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

let fails = 0;
const ok = m => console.log('  ok   ' + m);
const bad = m => { console.log('  FALLA ' + m); fails++; };

const get = async (path, ms = 20000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(BASE + path, { signal: ctl.signal, headers: { 'user-agent': 'ASN-smoke/1' } });
  } finally {
    clearTimeout(t);
  }
};

/* ---------- app ---------- */
check('la portada carga con sus etiquetas de vista previa', async () => {
  const r = await get('/');
  const html = await r.text();
  const good = r.ok && html.includes('og:image') && html.includes('Alerta Super Niño');
  good ? ok('portada 200 + og') : bad('portada ' + r.status);
});

check('el enlace para compartir resuelve la vista previa', async () => {
  const r = await get('/alerta/4/crecida-grave/-27.27/-58.24/casa?t=' + Date.now());
  const html = await r.text();
  const good = r.ok && /og:title" content="[^"]*crecida grave/i.test(html) && html.includes('/og/morada.png');
  good ? ok('enlace legible 200 + OG morada') : bad('enlace ' + r.status);
});

/* ---------- datos ---------- */
check('el pronóstico responde', async () => {
  const r = await get('/api/wx?lat=-27.27&lon=-58.24');
  const j = await r.json().catch(() => null);
  const t = j && j.current && j.current.temperature_2m;
  typeof t === 'number' ? ok('wx ' + t + '°') : bad('wx sin temperatura (' + r.status + ')');
});

/* el caso que se rompió: Itatí con crecida y la app diciendo "tranquilo" */
check('el río se lee de verdad (Itatí)', async () => {
  const r = await get('/api/hydro?lat=-27.27&lon=-58.24', 25000);
  const j = await r.json().catch(() => null);
  if (!j || j.error) return bad('hydro devolvió error: ' + (j && j.error));
  const now = Number(j.now);
  if (!Number.isFinite(now)) return bad('hydro sin nivel medido');
  if (now < 5) return bad('nivel insólito: ' + now + ' m');
  if (!(j.level >= 2)) return bad('Itatí con ' + now + ' m y nivel ' + j.level);
  ok('Itatí ' + now + ' m · nivel ' + j.level + ' · ' + j.station?.name);
});

check('los avisos tienen clave pública', async () => {
  const r = await get('/api/vapid');
  const j = await r.json().catch(() => null);
  j && j.key && j.key.length > 40 ? ok('vapid ok') : bad('vapid sin clave');
});

check('la página de apoyo carga', async () => {
  const r = await get('/apoyar.html');
  r.ok ? ok('apoyar 200') : bad('apoyar ' + r.status);
});

/* ---------- ejecución ---------- */
console.log('\nASN 4.0 · prueba de humo en ' + BASE + '\n');
for (const c of checks) {
  try {
    await c.fn();
  } catch (e) {
    bad(c.name + ': ' + (e && e.message ? e.message : e));
  }
}

if (fails) {
  console.log('\n' + fails + ' comprobación(es) fallaron.');
  console.log('Si esto pasó justo después de publicar, volvé atrás con:');
  console.log('  npx wrangler rollback\n');
  process.exit(1);
}

console.log('\nTodo en orden.\n');
