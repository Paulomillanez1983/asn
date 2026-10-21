/* ASN 4.0 — animación satelital real.
   Fuente: NASA GIBS, GOES-19 ABI GeoColor, teselas PNG públicas,
   sin credenciales y con CORS. RainViewer no sirve esta zona (0 cuadros),
   así que no se usa más para el GIF. */
(function () {
  const W = 560, H = 560, Z = 7, TILE = 256, MAXF = 6, DELAY = 600;
  const COLORS = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#c084fc'];
  const LABELS = ['SIN ALERTA', 'ALERTA AMARILLA', 'ALERTA NARANJA', 'ALERTA ROJA', 'ALERTA MORADA'];
  const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
  const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/';
  const CREDIT = 'Satélite GOES-19 · NASA GIBS · color real';

  function project(lat, lon, z) {
    const n = Math.pow(2, z), world = TILE * n;
    const x = (lon + 180) / 360 * world;
    const r = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * world;
    return { x, y };
  }

  function loadImg(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('tile'));
      im.src = url;
    });
  }

  function hhmm(ms) {
    try {
      return new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(ms));
    } catch (e) { return ''; }
  }

  function ddmm(ms) {
    try {
      return new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Cordoba', day: '2-digit', month: '2-digit'
      }).format(new Date(ms));
    } catch (e) { return ''; }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function marker(ctx, place) {
    const cx = W / 2, cy = H / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    const name = place.label || 'Mi lugar';
    ctx.font = '700 15px ' + FONT;
    const w = ctx.measureText(name).width + 22;
    const bx = cx - w / 2, by = cy + 20;
    roundRect(ctx, bx, by, w, 28, 14);
    ctx.fillStyle = 'rgba(7,13,24,.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#eaf2ff';
    ctx.textAlign = 'center';
    ctx.fillText(name, cx, by + 19);
    ctx.textAlign = 'left';
  }

  function scaleBar(ctx, lat) {
    const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, Z);
    const km = 50;
    const w = Math.round(km * 1000 / mPerPx);
    const x = 24, y = H - 96;
    ctx.fillStyle = 'rgba(7,13,24,.62)';
    roundRect(ctx, x - 10, y - 20, w + 20, 40, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
    ctx.moveTo(x + w, y - 5); ctx.lineTo(x + w, y + 5);
    ctx.stroke();
    ctx.fillStyle = '#dbe6f7';
    ctx.font = '600 12px ' + FONT;
    ctx.fillText(km + ' km', x, y + 16);
  }

  function chrome(ctx, opts) {
    const { level, stamp, logo, note } = opts;
    const badge = COLORS[level] || '#fb923c';

    ctx.fillStyle = 'rgba(7,13,24,.88)';
    ctx.fillRect(0, 0, W, 76);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(0, 76, W, 1);
    if (logo) ctx.drawImage(logo, 16, 14, 46, 46);
    ctx.fillStyle = '#fff';
    ctx.font = '800 21px ' + FONT;
    ctx.fillText('ASN 4.0', 74, 36);
    ctx.fillStyle = '#9db0c9';
    ctx.font = '600 12.5px ' + FONT;
    ctx.fillText('Alerta Super Niño', 74, 56);

    ctx.font = '700 12px ' + FONT;
    const lw = ctx.measureText(LABELS[level] || 'ALERTA').width + 34;
    const lx = W - lw - 16;
    roundRect(ctx, lx, 24, lw, 28, 14);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx + 12, 38, 5, 0, Math.PI * 2);
    ctx.fillStyle = badge;
    ctx.fill();
    ctx.fillStyle = '#f2f7ff';
    ctx.fillText(LABELS[level] || 'ALERTA', lx + 23, 42);

    if (note) {
      ctx.font = '600 13px ' + FONT;
      const nw = ctx.measureText(note).width + 28;
      roundRect(ctx, (W - nw) / 2, 90, nw, 28, 14);
      ctx.fillStyle = 'rgba(7,13,24,.80)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#dbe6f7';
      ctx.textAlign = 'center';
      ctx.fillText(note, W / 2, 109);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = 'rgba(7,13,24,.88)';
    ctx.fillRect(0, H - 46, W, 46);
    ctx.fillStyle = '#c6d4ec';
    ctx.font = '700 13px ' + FONT;
    ctx.fillText(stamp, 20, H - 19);
    ctx.fillStyle = '#7d90b3';
    ctx.font = '600 9.5px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText(CREDIT, W - 18, H - 19);
    ctx.textAlign = 'left';
  }

  function encode(gif, ctx) {
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 200);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, W, H, { palette, delay: DELAY });
  }

  /* GIBS pide la hora al minuto exacto en ISO, terminada en Z */
  function iso(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':00Z';
  }

  async function build(place, level, phen, note) {
    if (typeof window.GIFEncoder !== 'function') throw new Error('codificador no disponible');

    const c = project(place.lat, place.lon, Z);
    const left = c.x - W / 2, top = c.y - H / 2;
    const x0 = Math.floor(left / TILE), y0 = Math.floor(top / TILE);
    const x1 = Math.floor((left + W) / TILE), y1 = Math.floor((top + H) / TILE);

    const coords = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) coords.push({ x, y });

    const frameAt = async (ms) => {
      const t = iso(ms);
      const imgs = await Promise.all(coords.map(p => loadImg(
        BASE + t + '/GoogleMapsCompatible_Level7/' + Z + '/' + p.y + '/' + p.x + '.png'
      ).catch(() => null)));
      return imgs.filter(Boolean).length >= Math.ceil(coords.length * 0.7) ? imgs : null;
    };

    /* se retrocede de 10 en 10 hasta juntar los cuadros que existan */
    const step = 10 * 60 * 1000;
    const base = Math.floor(Date.now() / step) * step;
    const frames = [];
    for (let i = 0; i < 15 && frames.length < MAXF; i++) {
      const ms = base - i * step;
      const imgs = await frameAt(ms);
      if (imgs) frames.push({ ms, imgs });
    }
    frames.reverse();

    const logo = await loadImg('icon-192.png').catch(() => null);
    const gif = GIFEncoder();
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    if (!frames.length) {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, W, H);
      marker(ctx, place);
      chrome(ctx, { level, logo, stamp: 'Sin imagen satelital ahora', note: note || 'La NASA no respondió' });
      encode(gif, ctx);
      gif.finish();
      return new Blob([gif.bytes()], { type: 'image/gif' });
    }

    for (const f of frames) {
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, W, H);
      coords.forEach((p, i) => {
        if (f.imgs[i]) ctx.drawImage(f.imgs[i], p.x * TILE - left, p.y * TILE - top);
      });

      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.74);
      vg.addColorStop(0, 'rgba(3,7,14,0)');
      vg.addColorStop(1, 'rgba(3,7,14,.42)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      marker(ctx, place);
      scaleBar(ctx, place.lat);
      chrome(ctx, {
        level, logo, note: note || '',
        stamp: 'Satélite ' + hhmm(f.ms) + ' · ' + ddmm(f.ms)
      });
      encode(gif, ctx);
    }

    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  window.ASNRadar = { build };
})();

