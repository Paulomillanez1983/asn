/**
 * Deriva los JPG para Mercado Pago y los iconos de la app desde los PNG de 1024.
 * Uso: node brand/make-icons.mjs  (después de build-logo.mjs)
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.resolve('brand');
const PUB = path.resolve('public');
const r = path.join(OUT, 'asn-logo-1024.png');        // esquinas redondeadas + transparencia
const f = path.join(OUT, 'asn-logo-1024-flat.png');   // a sangre, opaco

const ff = (args) => execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' });

/* --- Mercado Pago: PNG con transparencia y JPG opaco, 1024 --- */
ff(['-i', r, '-frames:v', '1', '-pix_fmt', 'rgba', path.join(OUT, 'asn-logo-mercadopago-1024.png')]);
ff(['-i', f, '-frames:v', '1', '-q:v', '2', path.join(OUT, 'asn-logo-mercadopago-1024.jpg')]);

/* --- iconos de la app --- */
const rounded = [
  ['icon-512.png', 512],
  ['icon-192.png', 192]
];
for (const [name, px] of rounded) {
  ff(['-i', r, '-vf', `scale=${px}:${px}:flags=lanczos`, '-frames:v', '1', path.join(PUB, name)]);
}
/* iOS y maskable van opacos y sin esquinas: el sistema aplica su propia máscara */
for (const [name, px] of [['apple-touch-icon.png', 180], ['icon-maskable-512.png', 512]]) {
  ff(['-i', f, '-vf', `scale=${px}:${px}:flags=lanczos`, '-frames:v', '1', path.join(PUB, name)]);
}

console.log('iconos listos');
