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







test('el banner de crecida aparece con hidrología en nivel 2', async ({ page }) => {
  await page.goto('/');
  await seed(page, 0);
  await page.evaluate(() => {
    S.data.t1.hydro = {
      level: 2, q: 21877, p95: 17741, rain48: 0,
      river: 'Paraná (0.3 km)', msg: 'Posible crecida: caudal 23 % sobre el p95'
    };
    paint();
  });
  await expect(page.getByText('Crecida posible cerca de Casa')).toBeVisible();
  await expect(page.getByText(/Paraná \(0\.3 km\)/).first()).toBeVisible();
});

