
const $ = id => document.getElementById(id);
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const CENTROS = {
  'ciudad autonoma de buenos aires': [-34.6, -58.4], 'caba': [-34.6, -58.4],
  'buenos aires': [-36.0, -60.0], 'catamarca': [-27.5, -66.5], 'chaco': [-26.5, -60.5],
  'chubut': [-44.0, -68.5], 'cordoba': [-31.5, -64.5], 'corrientes': [-28.5, -58.0],
  'entre rios': [-32.0, -59.5], 'formosa': [-24.5, -60.0], 'jujuy': [-23.3, -66.0],
  'la pampa': [-37.0, -66.0], 'la rioja': [-29.5, -67.0], 'mendoza': [-34.5, -68.5],
  'misiones': [-26.5, -54.0], 'neuquen': [-38.5, -70.0], 'rio negro': [-39.5, -67.5],
  'salta': [-24.5, -65.0], 'san juan': [-31.0, -69.0], 'san luis': [-33.5, -66.0],
  'santa cruz': [-48.5, -70.0], 'santa fe': [-31.0, -61.0],
  'santiago del estero': [-27.5, -63.5], 'tierra del fuego': [-54.0, -68.0], 'tucuman': [-26.8, -65.2]
};

const filas = obj => {
  const e = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...e.map(x => x[1]));
  return e.length
    ? e.map(([k, v]) => `<tr><td>${k}<div class="mini"><i style="width:${Math.round(v / max * 100)}%"></i></div></td><td>${v}</td></tr>`).join('')
    : '<tr><td colspan="2" class="msg">sin datos todavía</td></tr>';
};

function chart(days){
  const W = 520, H = 200, pad = 26;
  const n = Math.max(days.length, 1);
  const max = Math.max(1, ...days.map(d => d.t));
  const bw = (W - pad * 2) / n;
  let s = '';
  for (let i = 0; i <= 3; i++) {
    const y = pad + (H - pad * 2) * i / 3;
    s += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#16233a"/>`;
  }
  days.forEach((d, i) => {
    const x = pad + i * bw + bw * .18;
    const w = bw * .64;
    const hInst = (d.s / max) * (H - pad * 2);
    const hWeb = (d.w / max) * (H - pad * 2);
    const yWeb = H - pad - hWeb;
    const yInst = yWeb - hInst;
    if (hWeb) s += `<rect class="bar2" x="${x}" y="${yWeb}" width="${w}" height="${hWeb}" rx="2"/>`;
    if (hInst) s += `<rect class="bar" x="${x}" y="${yInst}" width="${w}" height="${hInst}" rx="2"/>`;
    if (days.length <= 16) s += `<text class="axis" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${d.d.slice(8)}</text>`;
  });
  $('chart').innerHTML = s || '<text class="axis" x="20" y="100">sin datos</text>';
}

function mapa(prov){
  const W = 330, H = 520;
  const X = lon => ((lon + 74) / 22) * W;
  const Y = lat => ((lat + 21) / -35) * H;
  let s = '';
  for (let lon = -72; lon <= -54; lon += 6)
    s += `<line x1="${X(lon)}" y1="0" x2="${X(lon)}" y2="${H}" stroke="#13203a"/>`;
  for (let lat = -24; lat >= -54; lat -= 6)
    s += `<line x1="0" y1="${Y(lat)}" x2="${W}" y2="${Y(lat)}" stroke="#13203a"/>`;
  const items = Object.entries(prov || {}).map(([k, v]) => {
    const c = CENTROS[norm(k)];
    return c ? { v, x: X(c[1]), y: Y(c[0]), k } : null;
  }).filter(Boolean);
  const max = Math.max(1, ...items.map(i => i.v));
  for (const it of items) {
    const r = 6 + 26 * Math.sqrt(it.v / max);
    s += `<circle cx="${it.x}" cy="${it.y}" r="${r}" fill="rgba(59,130,246,.28)" stroke="#60a5fa" stroke-width="1.2"/>`;
    s += `<text class="axis" x="${it.x}" y="${it.y + 3.5}" text-anchor="middle" fill="#dbeafe" font-size="10">${it.v}</text>`;
    if (it.v === max) s += `<text class="axis" x="${it.x}" y="${it.y - r - 6}" text-anchor="middle" fill="#93c5fd">${it.k}</text>`;
  }
  if (!items.length) s += `<text class="axis" x="165" y="260" text-anchor="middle">sin datos de provincia</text>`;
  $('map').innerHTML = s;
}

async function cargar(){
  try{
    const r = await fetch('/api/stats', { cache: 'no-store' });
    const d = await r.json();
    $('total').textContent = d.total || 0;
    $('inst').textContent = d.s || 0;
    $('web').textContent = d.w || 0;
    $('dias').textContent = (d.days || []).length;
    $('sub').textContent = 'Día ' + (d.d || '—') + ' · actualiza cada minuto';
    $('prov').tBodies[0].innerHTML = filas(d.prov);
    $('plat').tBodies[0].innerHTML = filas(d.plat);
    $('ver').tBodies[0].innerHTML = filas(d.ver);
    chart(d.days || []);
    mapa(d.prov || {});
  }catch(e){
    $('sub').textContent = 'no se pudo leer /api/stats';
  }
}
cargar();
setInterval(cargar, 60000);
