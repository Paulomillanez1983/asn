/* Publica solo si todo pasa.
   Orden: compilar -> tests -> publicar -> prueba de humo en producción.
   Si la prueba de humo falla, avisa cómo volver atrás. */

import { spawnSync } from 'node:child_process';

const run = (cmd, args) => {
  console.log('\n▸ ' + cmd + ' ' + args.join(' ') + '\n');
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true });
  return r.status === 0;
};

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);

console.log('ASN 4.0 · publicación controlada\n');

if (!run('npm', ['run', 'build'])) {
  console.log('\nFalló la compilación. No se publicó nada.');
  process.exit(1);
}

if (!run('npx', ['playwright', 'test'])) {
  console.log('\nFallaron los tests. No se publicó nada.');
  process.exit(1);
}

if (!run('npx', ['wrangler', 'deploy'])) {
  console.log('\nFalló la publicación. La versión anterior sigue activa.');
  process.exit(1);
}

if (!run('node', ['scripts/smoke.mjs'])) {
  console.log('\nLa app quedó publicada pero no pasa la prueba de humo.');
  console.log('Volvé atrás ahora mismo:');
  console.log('  npx wrangler rollback\n');
  process.exit(1);
}

run('git', ['tag', '-a', 'prod-' + stamp, '-m', '"publicado ' + stamp + '"']);
console.log('\nPublicado y verificado. Etiqueta: prod-' + stamp + '\n');
