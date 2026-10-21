/**
 * Compila los fuentes de src/ a public/ listos para publicar.
 *
 * No es ofuscación fuerte: es minificado con nombres internos acortados.
 * Levanta bastante el costo de leer el código sin tocar el comportamiento.
 * Los nombres que necesitan las pruebas automatizadas quedan reservados.
 */
import { minify } from 'terser';
import fs from 'node:fs/promises';

const RESERVED = [
  'S', 'paint', 'refresh', 'save', 'load', 'toast', 'aggregate',
  'openMenu', 'enablePush', 'learnAdd', 'supportPopup', 'supportClose', 'supportInvite',
  /* las pruebas verifican que una alerta pueda bajar y cómo se sigue */
  'checkAlert', 'levelInfo', 'trackAlert', 'askTarget',
  /* las pruebas de ETA siembran el nowcast y repintan la barra */
  'paintNowcast'
];

const FILES = [
  ['src/app.js', 'public/app.js'],
  ['src/radar.js', 'public/radar.js'],
  ['src/boot.js', 'public/boot.js']
];

let totalIn = 0, totalOut = 0;

for (const [from, to] of FILES) {
  const code = await fs.readFile(from, 'utf8');
  const out = await minify(code, {
    ecma: 2020,
    compress: {
      passes: 2,
      drop_debugger: true,
      // no borrar nada de nivel superior: hay funciones que se llaman entre sí
      // por nombre y algunas las usan las pruebas
      toplevel: false
    },
    mangle: { toplevel: true, reserved: RESERVED },
    format: { comments: false, ascii_only: true }
  });

  if (!out.code) throw new Error('no se pudo compilar ' + from);

  await fs.writeFile(to, out.code + '\n');
  totalIn += Buffer.byteLength(code);
  totalOut += Buffer.byteLength(out.code);

  const kb = n => (n / 1024).toFixed(1) + ' KB';
  console.log(`${from} → ${to}  ${kb(Buffer.byteLength(code))} → ${kb(Buffer.byteLength(out.code))}`);
}

console.log(`total: ${(totalOut / totalIn * 100).toFixed(0)}% del original`);
