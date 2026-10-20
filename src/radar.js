/* ASN 4.0 — GIF animado: radar si hay eco, pronóstico del modelo si no */
(function () {
  const W = 560, H = 560, Z = 7, TILE = 256, FRAMES = 6, DELAY = 550;
  const COLORS = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#c084fc'];
  const LABELS = ['SIN ALERTA', 'ALERTA AMARILLA', 'ALERTA NARANJA', 'ALERTA ROJA', 'ALERTA MORADA'];
  const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

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

  function hhmm(unix) {
    try {
      return new Intl.DateTimeFormat('es-AR', {
        timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(unix * 1000));
    } catch (e) { return ''; }
  }

  function frame(ctx, opts) {
    const { level, place, sub, stamp, foot } = opts;
    const badge = COLORS[level] || '#fb923c';

    const halo = ctx.createRadialGradient(W / 2, H / 2, 6, W / 2, H / 2, 120);
    halo.addColorStop(0, 'rgba(255,255,255,.16)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 26, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(7,13,24,.74)';
    ctx.fillRect(0, 0, W, 92);

    ctx.fillStyle = badge;
    ctx.beginPath();
    ctx.arc(30, 32, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '700 21px ' + FONT;
    ctx.fillText(LABELS[level] || 'ALERTA', 48, 39);

    ctx.fillStyle = '#c6d4ec';
    ctx.font = '600 17px ' + FONT;
    ctx.fillText(sub.length > 44 ? sub.slice(0, 43) + '…' : sub, 24, 70);

    ctx.fillStyle = 'rgba(7,13,24,.74)';
    ctx.fillRect(0, H - 46, W, 46);
    ctx.fillStyle = '#9fb2d1';
    ctx.font = '600 15px ' + FONT;
    ctx.fillText(stamp, 24, H - 18);
    ctx.fillStyle = '#7d90b3';
    ctx.font = '600 14px ' + FONT;
    ctx.fillText(foot, W - 250, H - 18);
  }

  function encode(gif, ctx) {
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 128);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, W, H, { palette, delay: DELAY });
  }

  async function radarTiles(meta, path, left, top, x0, y0, x1, y1) {
    const cols = x1 - x0 + 1;
    const list = await Promise.all(
      Array.from({ length: cols * (y1 - y0 + 1) }, (_, k) => {
        const x = x0 + (k % cols), y = y0 + Math.floor(k / cols);
        return loadImg(`${meta.host}${path}/256/${Z}/${x}/${y}/2/1_1.png`)
          .then(img => ({ img, x, y }))
          .catch(() => null);
      })
    );
    return { list, cols };
  }

  async function build(place, level, phen) {
    if (typeof window.GIFEncoder !== 'function') throw new Error('codificador no disponible');

    const meta = await fetch('/api/radar', { cache: 'no-store' })
      .then(r => r.json());
    const frames = ((meta.radar && meta.radar.past) || []).slice(-FRAMES);
    if (!frames.length) return buildModel(place, level, phen);

    const c = project(place.lat, place.lon, Z);
    const left = c.x - W / 2, top = c.y - H / 2;
    const x0 = Math.floor(left / TILE), y0 = Math.floor(top / TILE);
    const x1 = Math.floor((left + W) / TILE), y1 = Math.floor((top + H) / TILE);

    /* ¿hay eco? se decide con el primer cuadro */
    const probe = await radarTiles(meta, frames[0].path, left, top, x0, y0, x1, y1);
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = W; probeCanvas.height = H;
    const pctx = probeCanvas.getContext('2d', { willReadFrequently: true });
    probe.list.forEach(it => { if (it) pctx.drawImage(it.img, it.x * TILE - left, it.y * TILE - top); });
    const px = pctx.getImageData(0, 0, W, H).data;
    let hits = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 12) hits++;

    if (hits < 500) {
      try {
        return await buildSatellite(place, level, phen);
      } catch (e) {
        return buildModel(place, level, phen, 'sin eco de radar');
      }
    }

    const gif = GIFEncoder();
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    for (const f of frames) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1a2b');
      bg.addColorStop(1, '#070d18');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const layer = document.createElement('canvas');
      layer.width = W; layer.height = H;
      const lctx = layer.getContext('2d');
      lctx.globalAlpha = 0.9;
      const t = await radarTiles(meta, f.path, left, top, x0, y0, x1, y1);
      t.list.forEach(it => { if (it) lctx.drawImage(it.img, it.x * TILE - left, it.y * TILE - top); });
      ctx.drawImage(layer, 0, 0);

      frame(ctx, {
        level, place,
        sub: (place.label || 'Mi lugar') + (place.addr ? ' · ' + place.addr : ''),
        stamp: 'ASN 4.0 · radar ' + hhmm(f.time),
        foot: 'ASN 4.0 · radar'
      });
      encode(gif, ctx);
    }

    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  function gibsUrl(time, x, y) {
    return 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/' +
      time + '/GoogleMapsCompatible_Level7/' + Z + '/' + y + '/' + x + '.png';
  }

  async function latestGibsTime(x, y) {
    const now = Date.now();
    for (let k = 1; k <= 14; k++) {
      const d = new Date(now - k * 10 * 60 * 1000);
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10, 0, 0);
      const iso = d.toISOString().replace('.000Z', 'Z');
      try {
        const r = await fetch(gibsUrl(iso, x, y), { method: 'GET' });
        if (r.ok) return iso;
      } catch (e) { }
    }
    return null;
  }

  async function buildSatellite(place, level, phen) {
    const c = project(place.lat, place.lon, Z);
    const left = c.x - W / 2, top = c.y - H / 2;
    const x0 = Math.floor(left / TILE), y0 = Math.floor(top / TILE);
    const x1 = Math.floor((left + W) / TILE), y1 = Math.floor((top + H) / TILE);
    const cx = Math.floor(c.x / TILE), cy = Math.floor(c.y / TILE);

    const latest = await latestGibsTime(cx, cy);
    if (!latest) throw new Error('satélite no disponible');

    const base = new Date(latest).getTime();
    const times = [];
    for (let i = FRAMES - 1; i >= 0; i--) {
      times.push(new Date(base - i * 10 * 60 * 1000).toISOString().replace('.000Z', 'Z'));
    }

    const gif = GIFEncoder();
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    let prev = null;
    let prevTime = null;
    for (const time of times) {
      const jobs = [];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          jobs.push(loadImg(gibsUrl(time, x, y)).then(img => ({ img, x, y })).catch(() => null));
        }
      }
      const loaded = await Promise.all(jobs);
      const ok = loaded.filter(Boolean);

      let stampTime = time;
      if (!ok.length && prev) {
        ctx.drawImage(prev, 0, 0);
        stampTime = prevTime || time;
      } else {
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0a1626');
        bg.addColorStop(1, '#060c16');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        loaded.forEach(it => { if (it) ctx.drawImage(it.img, it.x * TILE - left, it.y * TILE - top); });
        if (ok.length) {
          prev = document.createElement('canvas');
          prev.width = W;
          prev.height = H;
          prev.getContext('2d').drawImage(cv, 0, 0);
          prevTime = time;
        }
      }

      frame(ctx, {
        level, place,
        sub: (place.label || 'Mi lugar') + (place.addr ? ' · ' + place.addr : ''),
        stamp: 'ASN 4.0 · satélite ' + stampTime.slice(11, 16) + ' UTC',
        foot: 'ASN 4.0 · satélite'
      });
      encode(gif, ctx);
    }

    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  async function buildModel(place, level, phen, reason) {
    const STEP = 0.25, N = 5;
    const lats = [], lons = [];
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        lats.push((place.lat + i * STEP).toFixed(3));
        lons.push((place.lon + j * STEP).toFixed(3));
      }
    }

    const u = '/api/wxmodel?lats=' + encodeURIComponent(lats.join(',')) +
      '&lons=' + encodeURIComponent(lons.join(','));
    const raw = await fetch(u, { cache: 'no-store' }).then(r => r.json());
    const pts = Array.isArray(raw) ? raw : [raw];
    if (!pts.length || !pts[0].hourly) throw new Error('sin grilla del modelo');

    const times = pts[0].hourly.time || [];
    const cos = Math.cos(place.lat * Math.PI / 180);
    const pxPerDeg = W; /* 1° de ancho */

    const gif = GIFEncoder();
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    for (let h = 0; h < Math.min(6, times.length); h++) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0b1a2b');
      bg.addColorStop(1, '#070d18');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      pts.forEach((pt, idx) => {
        const i = Math.floor(idx / N) - 2;
        const j = (idx % N) - 2;
        const mm = (pt.hourly.precipitation || [])[h] || 0;
        if (mm < 0.1) return;

        const dx = j * STEP * pxPerDeg * cos;
        const dy = -i * STEP * pxPerDeg;
        const rgb = mm < 0.5 ? '56,189,248' : mm < 2 ? '59,130,246' : mm < 5 ? '99,102,241' : '168,85,247';
        const rad = 86;
        const g = ctx.createRadialGradient(W / 2 + dx, H / 2 + dy, 4, W / 2 + dx, H / 2 + dy, rad);
        g.addColorStop(0, 'rgba(' + rgb + ',.72)');
        g.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(W / 2 + dx, H / 2 + dy, rad, 0, Math.PI * 2);
        ctx.fill();
      });

      frame(ctx, {
        level, place,
        sub: (place.label || 'Mi lugar') + (place.addr ? ' · ' + place.addr : ''),
        stamp: 'ASN 4.0 · pronóstico ' + String(times[h] || '').slice(11, 16),
        foot: 'ASN 4.0 · modelo'
      });

      ctx.fillStyle = 'rgba(7,13,24,.6)';
      ctx.fillRect(0, 96, W, 26);
      ctx.fillStyle = '#9fb2d1';
      ctx.font = '600 13px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(reason || 'campo de lluvia del modelo', W / 2, 114);
      ctx.textAlign = 'left';

      encode(gif, ctx);
    }

    gif.finish();
    return new Blob([gif.bytes()], { type: 'image/gif' });
  }

  window.ASNRadar = { build };
})();
