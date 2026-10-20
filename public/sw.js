const CACHE = 'asn-v69';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.json', 'icon-192.png?v=4', 'icon-512.png?v=4', 'logo-mark.svg?v=5'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isApi = url.pathname.startsWith('/api/') ||
    url.hostname.endsWith('open-meteo.com') || url.hostname === 'ntfy.sh';

  if (isApi) return; // datos siempre frescos

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        caches.open(CACHE).then(c => c.put('index.html', r.clone()));
        return r;
      }).catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  if (sameOrigin) {
    // red primero (código siempre al día), caché como respaldo sin conexión
    e.respondWith(
      fetch(req).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
        return r;
      }).catch(() => caches.match(req))
    );
  }
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const title = d.title || 'ASN 4.0';
  const body = d.body || 'Hay una alerta nueva en tus lugares.';

  const MAP = {
    lluvia: 'rain', llovizna: 'rain', torrencial: 'rain', rain: 'rain',
    viento: 'wind', wind: 'wind',
    granizo: 'hail', hail: 'hail',
    nieve: 'snow', snow: 'snow',
    tormenta: 'storm', storm: 'storm',
    flood: 'flood', hydro: 'flood'
  };
  const kind = MAP[d.kind] || 'alert';
  const level = Number(d.level || 0);

  const vib = kind === 'flood' ? [420, 140, 420, 140, 420]
    : kind === 'storm' ? [220, 90, 220, 90, 380]
      : [300, 100, 300];

  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: 'icon-192.png',
    badge: 'badge-' + kind + '.png',
    vibrate: vib,
    requireInteraction: level >= 2,
    renotify: true,
    tag: d.tag || ('asn-' + kind),
    data: { url: d.url || './', speech: d.speech || d.title || '', kind }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const speech = data.speech || '';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          return c.focus().then(() => {
            if (speech) c.postMessage({ type: 'speak', text: speech });
          });
        }
      }
      const url = './' + (speech ? '?speak=' + encodeURIComponent(speech.slice(0, 140)) : '');
      return self.clients.openWindow(url);
    })
  );
});
















































