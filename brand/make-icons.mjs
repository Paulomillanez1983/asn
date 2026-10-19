/**
 * Deriva los JPG para Mercado Pago y los iconos de la app desde los PNG de 1024.
 * Uso: node brand/make-icons.mjs  (después de build-logo.mjs)
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.resolve('brand');
const PUB = path.resolve('public');
const r = path.join(OUT, 'asn-logo-1024.png');           // redondeado + transparencia
const f = path.join(OUT, 'asn-logo-1024-flat.png');      // a sangre, opaco
const icon = path.join(OUT, 'asn-icon-1024.png');        // marca más grande, "any"
const mask = path.join(OUT, 'asn-icon-maskable-1024.png'); // marca más grande, opaco

const ff = (args) => execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });

/* --- Mercado Pago: PNG con transparencia y JPG opaco, 1024 --- */
ff(['-i', r, '-frames:v', '1', '-pix_fmt', 'rgba', path.join(OUT, 'asn-logo-mercadopago-1024.png')]);
ff(['-i', f, '-frames:v', '1', '-q:v', '2', path.join(OUT, 'asn-logo-mercadopago-1024.jpg')]);

/* --- iconos de la app --- */
for (const [name, px] of [['icon-512.png', 512], ['icon-192.png', 192]]) {
  ff(['-i', icon, '-vf', `scale=${px}:${px}:flags=lanczos`, '-frames:v', '1', path.join(PUB, name)]);
}
for (const [name, px] of [['apple-touch-icon.png', 180], ['icon-maskable-512.png', 512]]) {
  ff(['-i', mask, '-vf', `scale=${px}:${px}:flags=lanczos`, '-frames:v', '1', path.join(PUB, name)]);
}

console.log('iconos listos');
