import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('asn.intro', '1'); } catch (e) { }
  });

  // sin red externa: los tests controlan los datos con seed()
  await page.route('**/*', route => {
    const u = route.request().url();
    if (
      u.includes('open-meteo.com') || u.includes('api.met.no') ||
      u.includes('nominatim.openstreetmap.org') || u.includes('photon.komoot.io') ||
      /\/api\//.test(new URL(u).pathname)
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







const HYDRO_ITATI = {
  level: 4, source: 'ina', now: 8.17, al: 6.8, ev: 7.5, p99: 7.64,
  rain48: 0, river: 'Itatí (0,5 km)', station: { id: 17, name: 'Itatí', d: 0.5 },
  headline: 'Crecida grave',
  plain: 'El agua ya pasó el nivel de evacuación y sigue alta.',
  detail: 'Hoy el agua está en 8,17 m (alerta 6,80 m · evacuación 7,50 m).',
  advice: 'Si estás en zona baja o cerca de la costa, salí ahora.'
};

test('la crecida en nivel 4 pinta la tarjeta y no dice "todo tranquilo"', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate((h) => {
    S.data.t1.hydro = h;
    paint();
  }, HYDRO_ITATI);

  // encabezado: la crecida manda sobre el clima tranquilo
  await expect(page.locator('#sub')).toContainText('Crecida grave en un lugar');

  const card = page.locator('.hero.flood4');
  await expect(card).toHaveCount(1);

  // mismo color que la escala del clima (morado) pero con el ícono de agua
  await expect(card.locator('.title')).toHaveText('Crecida grave');
  await expect(card.locator('.chip3h')).toContainText('Crecida grave');
  await expect(card).not.toContainText('Todo tranquilo');
  await expect(card).not.toContainText('Buen momento para estar afuera');
  await expect(card).toContainText('salí ahora');
  await expect(card.locator('.hdetail')).toContainText('8,17 m');

  // y el banner de arriba también
  await expect(page.getByText('Crecida grave · Casa')).toBeVisible();
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

