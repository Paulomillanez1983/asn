import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('asn.intro', '1'); } catch (e) { }
  });

  // sin red externa: los tests controlan los datos con seed()
  await page.route('**/*', route => {
    const u = route.request().url();
    const path = new URL(u).pathname;
    if (path === '/api/share') return route.continue(); // sí queremos probar el enlace corto
    if (
      u.includes('open-meteo.com') || u.includes('api.met.no') ||
      u.includes('nominatim.openstreetmap.org') || u.includes('photon.komoot.io') ||
      /\/api\//.test(path)
    ) return route.abort();
    return route.continue();
  });
});

async function seed(page, level = 0) {
  await page.waitForTimeout(700); // deja que el refresh abortado se asiente
  await page.evaluate((lvl) => {
    refresh = async () => { }; // evita que el fetch real pise los datos sembrados
    const times = Array.from({ length: 12 }, (_, i) => `2026-10-19T${String(12 + i).padStart(2, '0')}:00`);
    const hours = times.map(() => ({ p: 0, prob: 5, gust: 30, cl: 40 }));
    const models = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'].map(m => ({
      m, l: lvl, rain: lvl >= 1, wind: false, hail: false, acc: 0, rate: 0, hours
    }));
    const mk = (id, label) => ({
      id, label, addr: 'Test 123', kind: 'casa', lat: -31.29, lon: -64.3,
      d: {
        level: lvl,
        votes: { rain: lvl >= 1 ? 4 : 0, wind: 0 },
        ens: { n: 50, rain15: 0.5, gust60: 0.1 },
        models, times,
        current: { temperature_2m: 18, wind_gusts_10m: 30, weather_code: 1, precipitation: 0 },
        snowHours: times.map(() => 0), snow3: 0, hailPossible: false, storm: false,
        rainRate: 0, gustMax: 30,
        sunrise: ['2026-10-19T06:33'], sunset: ['2026-10-19T19:31']
      }
    });
    const a = mk('t1', 'Casa'), b = mk('t2', 'Trabajo');
    S.places = [a, b].map(x => ({ id: x.id, label: x.label, addr: x.addr, kind: x.kind, lat: x.lat, lon: x.lon }));
    S.data = { t1: a.d, t2: b.d };
    S.busy = false;
    S.view = 'home';
    S.places.forEach(p => { S.rivers[p.id] = []; });
    paint();
  }, level);
}

test('carga con encabezado y sin errores de página', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/ASN 4\.0/);
  await expect(page.locator('header')).toContainText('ASN 4.0');
  await expect(page.locator('#view')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('el menú explica para qué sirve compartir la ubicación', async ({ page }) => {
  await page.goto('/');
  await page.locator('#menu').click();
  await expect(page.locator('#menuSheet')).toBeVisible();
  await expect(page.locator('#menuSheet')).toContainText('No guardamos un historial');
  await expect(page.locator('#menuSheet')).toContainText('Apoyar el proyecto');
  await page.locator('#menuSheet .x').click();
  await expect(page.locator('#menuSheet')).toBeHidden();
});

test('el rail contiene las dos tarjetas y ninguna queda fuera', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await expect(page.locator('.rail .hero')).toHaveCount(2);
  await expect(page.locator('main > .hero')).toHaveCount(0);
  await expect(page.locator('.raildots i')).toHaveCount(2);
});

test('horas alineadas y sin sol después del atardecer', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  const tops = await page.$$eval('.tl .h', els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  expect(tops.length).toBeGreaterThan(5);
  expect(new Set(tops).size).toBe(1);

  const night = await page.$$eval('.tl.night .e', els => els.map(e => e.textContent.trim()));
  expect(night.length).toBeGreaterThan(0);
  for (const txt of night) expect(txt).not.toContain('☀️');
});

test('compartir se oculta sin alerta y aparece desde amarilla', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await expect(page.locator('[data-share]')).toHaveCount(0);

  await seed(page, 1);
  await expect(page.locator('[data-share]')).toHaveCount(2);
});

test('la página de apoyo tiene los dos medios de pago', async ({ request }) => {
  const res = await request.get('/apoyar.html');
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain('link.mercadopago.com.ar/asn40');
  expect(html).toContain('github.com/sponsors/Paulomillanez1983');
});

test('el enlace de alerta genera OG con zona y color', async ({ request }) => {
  const token = Buffer.from(JSON.stringify({
    n: 'Casa', a: 'Villa Allende', lat: -31.294, lon: -64.298, l: 2, p: 'lluvia', e: '🌧️'
  }), 'utf8').toString('base64url');

  const res = await request.get('/alerta/' + token);
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toMatch(/og:title" content="[^"]*Casa/);
  expect(html).toContain('/og/naranja.png');
  expect(html).toContain('location.replace');
});

test('la respuesta trae cabeceras de seguridad', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
});







const HIST = [
  ['10-06', 5.00], ['10-07', 5.08], ['10-08', 5.29], ['10-09', 5.52],
  ['10-10', 5.68], ['10-11', 5.82], ['10-12', 5.96], ['10-13', 5.98],
  ['10-14', 6.28], ['10-15', 6.68], ['10-16', 7.30], ['10-17', 7.78],
  ['10-18', 8.06], ['10-19', 8.17]
];

const HYDRO_ITATI = {
  level: 4, source: 'ina', now: 8.17, al: 6.8, ev: 7.5, p99: 7.64,
  date: '2026-10-19T03:00:00.000Z',
  rain48: 0, river: 'Itatí (0,5 km)', station: { id: 17, name: 'Itatí', d: 0.5 },
  headline: 'Crecida grave',
  plain: 'El agua ya pasó el nivel de evacuación y la zona baja está bajo agua.',
  history: 'No se veía un nivel así desde 1998.',
  advice: 'Si estás en zona baja o cerca de la costa, buscá un lugar seguro y seguí las indicaciones de Defensa Civil.',
  slope: 0.29, proj48: 8.75,
  trend: { key: 'sube', word: 'subiendo rápido', arrow: '⬆' },
  peak: { v: 8.17, date: '2026-10-19T03:00:00.000Z' },
  hist: HIST,
  gauge: { min: 0, max: 8.5, al: 6.8, ev: 7.5, now: 8.17 },
  detail: 'Hoy el agua está en 8,17 m (alerta 6,80 m · evacuación 7,50 m).'
};

test('la crecida en nivel 4 pinta la tarjeta y no dice "todo tranquilo"', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate((h) => {
    S.data.t1.hydro = h;
    paint();
  }, HYDRO_ITATI);

  // el encabezado es la marca; el estado global lo cuenta la franja de arriba.
  // Antes decía "Crecida grave" acá y contradecía la tarjeta que estabas mirando.
  await expect(page.locator('#sub')).toContainText('Alerta Super Niño 4.0');
  await expect(page.locator('.banner').first()).toContainText('Crecida grave');

  const card = page.locator('.hero.flood4');
  await expect(card).toHaveCount(1);

  // mismo color que la escala del clima (morado) pero con el ícono de agua
  await expect(card.locator('.title')).toHaveText('Crecida grave');
  await expect(card.locator('.chip3h')).toContainText('Crecida grave');
  await expect(card).not.toContainText('Todo tranquilo');
  await expect(card).not.toContainText('Buen momento para estar afuera');
  await expect(card).toContainText('seguí las indicaciones de Defensa Civil');
  // la app informa y no decide por la persona: no ordena salir ni quedarse
  await expect(card).not.toContainText('salí ahora');
  await expect(card).not.toContainText('hay que salir');
  await expect(card.locator('.hdetail')).toContainText('desde 1998');

  // bloque de seguimiento: nivel, tendencia, escala y serie histórica
  const river = card.locator('.river');
  await expect(river).toBeVisible();
  await expect(river).toContainText('8,17 m');
  await expect(river.locator('.rtrend')).toContainText('0,29 m/día');
  // el marcador horizontal se reemplazó por el termómetro vertical
  await expect(river.locator('.rtrend')).toBeVisible();
  await expect(river.locator('.rproj')).toContainText('8,75');
  await expect(river.locator('.rspark polyline')).toHaveCount(1);
  // la leyenda de colores se reemplazó por una frase en palabras
  await expect(river).toContainText('nivel de evacuación');

  // y el banner de arriba también
  await expect(page.getByText('Crecida grave · Casa')).toBeVisible();
});

test('cuando el río empieza a bajar lo dice, y marca el pico ya pasado', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate((h) => {
    const hist = h.hist.map((p, i) => i >= h.hist.length - 2 ? [p[0], i === h.hist.length - 1 ? 7.90 : 8.06] : p);
    S.data.t1.hydro = {
      ...h, level: 2, now: 7.90, slope: -0.12, proj48: undefined,
      headline: 'Alerta por crecida',
      plain: 'El agua llegó al nivel de alerta: ya empieza a entrar en las zonas bajas y a cortar caminos.',
      history: '',
      trend: { key: 'baja', word: 'bajando', arrow: '⬇' },
      peak: { v: 8.20, date: '2026-10-18T03:00:00.000Z' },
      peakTxt: 'Lo peor ya pasó: el pico fue el 18/10 con 8,20 m.',
      hist,
      gauge: { ...h.gauge, now: 7.90 }
    };
    paint();
  }, HYDRO_ITATI);

  const river = page.locator('.hero.flood2 .river');
  await expect(river.locator('.rtrend')).toContainText('0,12 m/día');
  await expect(river.locator('.rtrend')).toHaveClass(/baja/);
  await expect(river.locator('.rpeak')).toContainText('Lo peor ya pasó');
  await expect(river.locator('.rproj')).toHaveCount(0);
});

test('con el río en alerta el clima tranquilo se aclara, no se esconde', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate((h) => {
    S.data.t1.hydro = { ...h, level: 2, headline: 'Alerta por crecida',
      plain: 'El agua llegó al nivel de alerta: ya empieza a entrar en las zonas bajas y a cortar caminos.' };
    paint();
  }, HYDRO_ITATI);

  const card = page.locator('.hero.flood2');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.title')).toHaveText('Alerta por crecida');
  await expect(card).toContainText('El clima, por ahora, tranquilo');
});


test('la invitación a apoyar aparece sola, pero nunca sobre una alerta', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  // aparece cuando no hay nada urgente
  await page.evaluate(() => {
    localStorage.removeItem('asn.support');
    document.querySelectorAll('.sheet-wrap').forEach(w => { w.hidden = true; });
    supportPopup();
  });
  const sheet = page.locator('#supportSheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Esto se sostiene entre todos');

  // se cierra y no vuelve por dos semanas
  await sheet.getByText('Ahora no').click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('asn.support'))).toBeTruthy();

  // con una alerta activa no se muestra
  await page.evaluate(() => {
    localStorage.removeItem('asn.support');
    S.data.t1.level = 4;
    paint();
    supportPopup();
  });
  await expect(sheet).toBeHidden();
});

test('con alerta amarilla la invitación pasa a barra chica, y desde nivel 2 no aparece', async ({ page }) => {
  await page.goto('/');
  await seed(page, 1);

  await page.evaluate(() => {
    localStorage.removeItem('asn.support');
    document.querySelectorAll('.sheet-wrap').forEach(w => { w.hidden = true; });
    supportInvite();
  });
  await expect(page.locator('#supportBar')).toBeVisible();
  await expect(page.locator('#supportSheet')).toBeHidden();

  // regla de producto: desde nivel 2 (clima o río) no se pide nada
  await page.evaluate(() => {
    localStorage.removeItem('asn.support');
    S.data.t1.level = 2;
    paint();
    supportInvite();
  });
  await expect(page.locator('#supportBar')).toBeHidden();
  await expect(page.locator('#supportSheet')).toBeHidden();

  // en evacuación tampoco
  await page.evaluate(() => {
    localStorage.removeItem('asn.support');
    const bar = document.getElementById('supportBar'); if (bar) bar.hidden = true;
    S.data.t1.level = 4;
    paint();
    supportInvite();
  });
  await expect(page.locator('#supportBar')).toBeHidden();
  await expect(page.locator('#supportSheet')).toBeHidden();
});

test('la tarjeta para compartir usa el menú del teléfono', async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = null;
    try { navigator.share = async (d) => { window.__shared = d; }; } catch (e) {}
  });
  await page.goto('/');
  await seed(page, 0);

  await expect(page.locator('.share')).toContainText('La seguridad la hacemos entre todos');
  await page.locator('#shareApp').click();

  const shared = await page.evaluate(() => window.__shared);
  expect(shared).not.toBeNull();
  expect(shared.url).toContain('asn.asn-clima.workers.dev');
  expect(shared.text).toContain('ASN 4.0');
});

test('el enlace para compartir se lee solo y resuelve el lugar', async ({ request }) => {
  const res = await request.get('/alerta/4/crecida-grave/-27.27/-58.24/casa?t=' + Date.now()); // evita la vista previa cacheada
  expect(res.ok()).toBeTruthy();
  const html = await res.text();
  expect(html).toContain('Casa');
  expect(html).toContain('crecida grave');
  expect(html).toContain('/og/morada.png');
  expect(html.length).toBeGreaterThan(500);
});

test('el botón de compartir de una tarjeta arma un enlace legible', async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = null;
    try { navigator.share = async d => { window.__shared = d; }; } catch (e) {}
  });
  await page.goto('/');
  await seed(page, 2);

  await page.locator('[data-share="t1"]').click();
  await page.waitForTimeout(1500); // la CSP no permite usar waitForFunction

  const s = await page.evaluate(() => window.__shared);
  expect(s.url).toMatch(/^https:\/\/[^/]+\/alerta\/2\/[a-z-]+\/-31\.29\/-64\.30\/casa$/);
  expect(s.url.length).toBeLessThan(90);

  const r = await page.request.get(s.url);
  expect(r.ok()).toBeTruthy();
});

test('se puede renombrar un lugar y cambiarle el tipo', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  const name = page.locator('.plbl').first();
  await expect(name).toContainText('Casa');
  await name.click();

  const sheet = page.locator('#editSheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#editName')).toHaveValue('Casa');
  await expect(page.locator('#editKinds button')).toHaveCount(6);
  await expect(sheet).toContainText('Oficina');
  await expect(sheet).toContainText('Colegio');

  await page.locator('[data-ekind="escuela"]').click();
  await page.locator('#editName').fill('Colegio de los chicos');
  await page.locator('#editSave').click();

  await expect(sheet).toBeHidden();
  await expect(page.locator('.plbl').first()).toContainText('Colegio de los chicos');
  await expect(page.locator('.plbl').first()).toContainText('🏫');

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('asn.v1')));
  expect(saved.places[0].label).toBe('Colegio de los chicos');
  expect(saved.places[0].kind).toBe('escuela');
});

test('sin nombre propio el lugar toma el nombre del tipo', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  await page.locator('.plbl').first().click();
  await page.locator('#editName').fill('   ');
  await page.locator('[data-ekind="trabajo"]').click();
  await page.locator('#editSave').click();

  await expect(page.locator('.plbl').first()).toContainText('Trabajo');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('asn.v1')));
  expect(saved.places[0].label).toBe('Trabajo');
});

test('ajustes ofrece editar el lugar', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate(() => { S.view = 'settings'; paint(); });

  await page.locator('[data-edit]').first().click();
  await expect(page.locator('#editSheet')).toBeVisible();
});

test('el sonido de alerta suena al probarlo y se recuerda si está apagado', async ({ page }) => {
  await page.addInitScript(() => {
    window.__beeps = 0;
    const noop = () => { };
    window.AudioContext = function () {
      return {
        currentTime: 0, state: 'running', destination: {},
        resume: () => Promise.resolve(),
        createGain: () => ({ gain: { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }),
        createOscillator: () => ({
          type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop },
          connect: noop, start: () => { window.__beeps++; }, stop: noop
        }),
        createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: noop }),
        createDynamicsCompressor: () => ({
          threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
          attack: { value: 0 }, release: { value: 0 }, connect: noop
        })
      };
    };
  });

  await page.goto('/');
  await seed(page, 0);
  await page.evaluate(() => { S.view = 'settings'; paint(); });

  await expect(page.locator('.row', { hasText: 'Sonido de alerta' })).toContainText('Tono propio');

  await page.locator('#testSound').click();
  await expect.poll(() => page.evaluate(() => window.__beeps)).toBeGreaterThan(4);

  await page.locator('#toggleSound').click();
  await expect(page.locator('#toggleSound')).toHaveText('Activar');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('asn.v1')).sound)).toBe(false);

  await page.locator('#toggleSound').click();
  await expect(page.locator('#toggleSound')).toHaveText('Desactivar');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('asn.v1')).sound)).toBe(true);
});

test('sin modelos utilizables la tarjeta dice "sin dato" y no "tranquilo"', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  // ensemble vacío: Open-Meteo no devolvió ninguna serie por modelo (ni member*)
  const agg = await page.evaluate(() => {
    const a = aggregate({ time: ['2026-10-19T12:00'] }, null);
    return { sinDato: !!a.sinDato, level: a.level };
  });
  expect(agg.sinDato).toBe(true);
  expect(agg.level).toBe(0);

  await page.evaluate(() => {
    const a = aggregate({ time: ['2026-10-19T12:00'] }, null);
    a.times = ['2026-10-19T12:00', '2026-10-19T13:00'];
    a.current = { temperature_2m: 18, wind_gusts_10m: 10, weather_code: 0, precipitation: 0 };
    S.data.t1 = a;
    paint();
  });

  const card = page.locator('.hero.nodata');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.title')).toHaveText('Sin dato');
  await expect(card).not.toContainText('ranquilo');
  await expect(card).not.toContainText('Buen momento para estar afuera');
  await expect(page.locator('#sub')).not.toContainText('Todo tranquilo');
});

test('cuando los datos dicen despejado, la alerta baja y se avisa', async ({ page }) => {
  await page.addInitScript(() => {
    window.__notifs = [];
    try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch (e) { }
    try {
      ServiceWorkerRegistration.prototype.showNotification = function (t, o) {
        window.__notifs.push({ title: t, body: (o && o.body) || '', icon: (o && o.icon) || '', badge: (o && o.badge) || '' });
        return Promise.resolve();
      };
    } catch (e) { }
  });
  await page.goto('/');
  await seed(page, 0);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null);

  const out = await page.evaluate(async () => {
    const wait = () => new Promise(r => setTimeout(r, 250));
    S.last.t1 = { level: 1, at: Date.now(), ph: 'lluvia' };
    const d = S.data.t1;
    d.level = 0; d.storm = false; d.sinDato = false; d.hydro = null;
    checkAlert(S.places[0], d);
    await wait();
    const bajada = window.__notifs.slice();
    window.__notifs.length = 0;

    // ahora sin dato: no se puede afirmar calma, pero el aviso viejo igual se retira
    S.last.t1 = { level: 2, at: Date.now(), ph: 'lluvia' };
    d.level = 0; d.sinDato = true;
    checkAlert(S.places[0], d);
    await wait();
    const sinDato = window.__notifs.slice();
    return { bajada, sinDato, guardado: S.last.t1 };
  });

  expect(out.bajada.length).toBe(1);
  expect(out.bajada[0].title).toContain('Sin alerta');
  expect(out.bajada[0].title).toContain('Casa');
  // el ícono grande va en color y el chico monocromo
  expect(out.bajada[0].icon).toBe('icon-192.png');
  expect(out.bajada[0].badge).toBe('notif-96.png');

  expect(out.sinDato.length).toBe(1);
  expect(out.sinDato[0].title).toContain('Sin dato');
  expect(out.sinDato[0].body).toContain('no podemos confirmar calma');
  expect(out.guardado.level).toBe(0);
});

test('la tarjeta no muestra nombres de modelos ni conteos de fuentes', async ({ page }) => {
  await page.goto('/');
  await seed(page, 2);

  const txt = await page.evaluate(() => {
    const d = S.data.t1;
    d.level = 2;
    d.models.forEach(m => { m.has = true; m.l = 2; m.rain = true; });
    d.ensOk = false;
    d.met = { level: 2, rain3: 20, gustKmh: 70 };
    paint();
    /* lo que se ve sin abrir "Ver detalles" */
    const c = document.querySelector('.hero').cloneNode(true);
    c.querySelectorAll('details').forEach(x => x.remove());
    return c.textContent;
  });

  // lo técnico es interno: a la persona se le habla del aviso, no del método
  ['ECMWF', 'GFS', 'ICON', 'GEM', 'Ensemble', 'MET Norway', 'De dónde sale', 'fuentes']
    .forEach(w => expect(txt).not.toContain(w));
  expect(txt).toContain('Alerta');
});

test('la voz de una crecida informa y no ordena evacuar', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    try {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    } catch (e) { }
    try {
      ServiceWorkerRegistration.prototype.showNotification = function () { return Promise.resolve(); };
    } catch (e) { }
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = u => window.__spoken.push(u.text);
      window.speechSynthesis.cancel = () => { };
    }
    class FakeUtter {
      constructor(t) { this.text = t; }
    }
    window.SpeechSynthesisUtterance = FakeUtter;
  });
  await page.goto('/');
  await seed(page, 0);

  const out = await page.evaluate(async () => {
    S.voice = true;
    const d = S.data.t1;
    d.hydro = null;
    d.level = 4;
    d.sinDato = false;
    S.last.t1 = { level: 0, at: 0, ph: '' };
    checkAlert(S.places[0], d);
    await new Promise(r => setTimeout(r, 1800));
    return window.__spoken;
  });

  const dicho = (out || []).join(' | ');
  expect(dicho).toContain('Riesgo extremo');
  expect(dicho).not.toContain('salí');
  expect(dicho).not.toContain('no vuelvas');
  expect(dicho).not.toContain('hay que evacuar');
});

test('el pop-up confirma la respuesta y se cierra aunque el radar no conteste', async ({ page }) => {
  await page.goto('/');
  await seed(page, 1);

  await page.evaluate(() => {
    S.askPlace = 't1';
    document.getElementById('askResult').hidden = true;
    document.getElementById('askSheet').hidden = false;
  });

  await page.click('#askSheet [data-askans="no"]');

  // la confirmación tiene que aparecer al instante, no depender del radar
  await expect(page.locator('#askResult')).toContainText('Anotado');
  await expect(page.locator('#askSheet [data-askans="no"]')).toHaveClass(/picked/);
  await expect(page.locator('#askSheet')).toBeHidden({ timeout: 9000 });

  const fb = await page.evaluate(() => (S.feedback || []).slice(-1)[0]);
  expect(fb.a).toBe('no');
});

test('desde una alerta de clima se abre el radar animado', async ({ page }) => {
  await page.goto('/');
  await seed(page, 2);

  const btn = page.locator('[data-gif]').first();
  await expect(btn).toContainText('radar');
  await btn.click();
  await expect(page.locator('#gifSheet')).toBeVisible();
});

test('el seguimiento dice desde cuándo sigue y cómo termina', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  const out = await page.evaluate(() => {
    const d = S.data.t1;
    d.level = 1; d.storm = false; d.sinDato = false; d.hydro = null;
    S.track.t1 = {
      since: Date.now() - 40 * 60000, level: 1, peak: 1, ph: 'lluvia',
      checks: 1, at: Date.now(), hist: [1]
    };
    trackAlert(S.places[0], d);   // segundo control: sigue en 1
    paint();
    const activo = document.querySelector('.hero').textContent;

    d.level = 0;
    trackAlert(S.places[0], d);   // dejó de existir
    paint();
    const terminado = [...document.querySelectorAll('.hero')].map(x => x.textContent).join(' | ');
    return { activo, terminado, track: S.track.t1 };
  });

  expect(out.activo).toContain('El aviso sigue');
  expect(out.activo).toContain('desde las');
  expect(out.track.level).toBe(0);
  expect(out.terminado).toContain('El aviso terminó');
});

test('el pop-up pregunta una sola vez por episodio y no en rojo', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  const out = await page.evaluate(() => {
    const d = S.data.t1;
    d.level = 1; d.sinDato = false; d.error = false;
    S.track.t1 = { since: Date.now() - 30 * 60000, level: 1, peak: 1, ph: 'lluvia', checks: 3, hist: [1, 1, 1] };

    const primero = !!askTarget();                 // alerta con 30 min: pregunta
    S.track.t1.askedAt = Date.now();
    const repetido = !!askTarget();                // ya preguntado en este episodio

    S.track.t1 = { since: Date.now() - 30 * 60000, level: 3, peak: 3, ph: 'lluvia', checks: 3, hist: [3] };
    d.level = 3;
    const rojo = !!askTarget();                    // en rojo no se pregunta

    d.level = 1;
    S.track.t1 = { since: Date.now() - 2 * 60000, level: 1, peak: 1, ph: 'lluvia', checks: 1, hist: [1] };
    const recien = !!askTarget();                  // recién empieza: esperar

    d.level = 0;
    S.track.t1 = { since: Date.now() - 30 * 60000, level: 0, ended: Date.now(), peak: 1, ph: 'lluvia' };
    const sinAlerta = !!askTarget();

    return { primero, repetido, rojo, recien, sinAlerta };
  });

  expect(out.primero).toBe(true);
  expect(out.repetido).toBe(false);
  expect(out.rojo).toBe(false);
  expect(out.recien).toBe(false);
  expect(out.sinAlerta).toBe(false);
});

test('un nulo de lluvia no se lee como cero', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  const out = await page.evaluate(() => {
    const H = {
      time: ['2026-10-19T12:00'],
      precipitation_ecmwf_ifs025: [null, null, null],
      wind_gusts_10m_ecmwf_ifs025: [20, 20, 20],
      cape_ecmwf_ifs025: [1200, 1100, 1000]
    };
    const a = aggregate(H, null);
    return { sinDato: !!a.sinDato, level: a.level, storm: !!a.storm, rainModels: a.rainModels };
  });
  // sin una sola hora con dato no se puede afirmar calma
  expect(out.sinDato).toBe(true);
  expect(out.level).toBe(0);
  expect(out.rainModels).toBe(0);
});

test('la inestabilidad sola no declara alerta si nadie pronostica lluvia', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  // caso real del 21/10: cielo despejado, CAPE 1050, ensemble caído (429)
  const out = await page.evaluate(() => {
    const H = {
      time: ['2026-10-19T12:00'],
      precipitation_ecmwf_ifs025: [0, 0, 0],
      wind_gusts_10m_ecmwf_ifs025: [28, 25, 23],
      cape_ecmwf_ifs025: [620, 600, 560],
      precipitation_gem_seamless: [0, 0, 0],
      wind_gusts_10m_gem_seamless: [21, 20, 19],
      cape_gem_seamless: [1050, 920, 750]
    };
    const a = aggregate(H, null);
    return { level: a.level, storm: !!a.storm, ensOk: !!a.ensOk, sinDato: !!a.sinDato };
  });
  expect(out.sinDato).toBe(false);
  expect(out.ensOk).toBe(false);
  expect(out.storm).toBe(false);
  expect(out.level).toBe(0);
});

test('con lluvia pronosticada la tormenta sí se declara', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);

  const out = await page.evaluate(() => {
    const H = {
      time: ['2026-10-19T12:00'],
      precipitation_ecmwf_ifs025: [6, 8, 5],
      wind_gusts_10m_ecmwf_ifs025: [30, 35, 30],
      cape_ecmwf_ifs025: [1400, 1300, 1200],
      precipitation_gfs_seamless: [5, 7, 4],
      wind_gusts_10m_gfs_seamless: [25, 28, 25],
      cape_gfs_seamless: [1200, 1100, 1000]
    };
    const a = aggregate(H, null);
    return { level: a.level, storm: !!a.storm, rainModels: a.rainModels };
  });
  expect(out.rainModels).toBeGreaterThanOrEqual(2);
  expect(out.storm).toBe(true);
  expect(out.level).toBeGreaterThanOrEqual(1);
});



function ncStorm(o = {}) {
  return {
    lat: o.lat ?? -31.29,
    lon: o.lon ?? -64.65,
    tb: 210,
    km2: 900,
    confianza: o.confianza ?? 'alta',
    movimiento: o.movimiento ?? { kmh: 60, rumbo: 90, giro: 8, cuadros: 3, llega: [] }
  };
}

async function seedNc(page, storm, sinDato) {
  await seed(page, 0);
  await page.evaluate(({ storm, sinDato }) => {
    S.nc = { generado: new Date().toISOString(), tormentas: storm ? [storm] : [] };
    if (sinDato) S.data.t1.sinDato = true;
    paintNowcast();
    paint();
  }, { storm, sinDato });
}

test('la tarjeta muestra la ETA solo con vector coherente', async ({ page }) => {
  await page.goto('/');
  await seedNc(page, ncStorm());
  const bar = page.locator('#ncBar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('llegaría en ~');
  await expect(page.locator('[data-gif="t1"]')).toBeVisible();
});

test('sin vector coherente hay distancia y ninguna hora', async ({ page }) => {
  await page.goto('/');
  await seedNc(page, ncStorm({
    confianza: 'baja',
    movimiento: { descartado: 'rumbo inestable (giro=89)' }
  }));
  const bar = page.locator('#ncBar');
  await expect(bar).toContainText('Tormenta a');
  await expect(bar).not.toContainText('llegaría');
  await expect(page.locator('[data-gif="t1"]')).toHaveCount(0);
});

test('si se está formando encima no se inventa una hora', async ({ page }) => {
  await page.goto('/');
  await seedNc(page, ncStorm({ lat: -31.30, lon: -64.32 }));
  const bar = page.locator('#ncBar');
  await expect(bar).toContainText('formándose sobre');
  await expect(bar).not.toContainText('llegaría');
  await expect(page.locator('[data-gif="t1"]')).toHaveCount(0);
});

test('sin dato de clima el ETA no habilita el GIF', async ({ page }) => {
  await page.goto('/');
  await seedNc(page, ncStorm(), true);
  await expect(page.locator('#ncBar')).toContainText('llegaría en ~');
  await expect(page.locator('[data-gif="t1"]')).toHaveCount(0);
});

test('el dictamen se muestra en la tarjeta y escapa texto externo', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate(() => {
    S.data.t1.dict = {
      ok: true, estado: 'atencion', titulo: 'Conviene mirar',
      texto: 'Hay señales parciales: 2 de 3 fuentes.', acuerdo: 75,
      fuentes_validas: 3, fuentes_totales: 4,
      votos: [
        { fuente: 'Nivel del río', voto: 2, detalle: '<img src=x onerror="window.__xss=1">' },
        { fuente: 'Lluvia medida en la cuenca', voto: 1, detalle: '3 de 5 pluviómetros' },
        { fuente: 'Suelo cargado', voto: 0, detalle: 'acumulado de la semana' }
      ],
      nota: '<b>no</b>'
    };
    paint();
  });
  await expect(page.locator('#view')).toContainText('Cómo se llegó a esto');
  await expect(page.locator('#view')).toContainText('Nivel del río');
  await expect(page.locator('#view')).toContainText('Conviene mirar');
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
});
