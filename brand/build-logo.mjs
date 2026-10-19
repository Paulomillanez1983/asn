/**
 * Genera el logo de ASN 4.0 (estático + animado) a partir de un SVG.
 * Uso: node brand/build-logo.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = path.resolve('brand');
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

/* ---------- geometría ---------- */
const C = 256;
const R = 178;
const SW = 30;
const GAP = 7;

const rad = d => (d - 90) * Math.PI / 180;
const pt = (r, deg) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))];

function arc(from, to, r = R) {
  const [x1, y1] = pt(r, from);
  const [x2, y2] = pt(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const A1 = arc(-153, -88);
const A2 = arc(-73, -8);
const A3 = arc(8, 92);

const SHIELD = 'M256 152 L336 182 V268 C336 328 300 364 256 384 C212 364 176 328 176 268 V182 Z';

const CLOUD = `
  <circle cx="224" cy="244" r="24"/>
  <circle cx="256" cy="236" r="30"/>
  <circle cx="288" cy="246" r="21"/>
  <rect x="212" y="246" width="88" height="26" rx="13"/>
`;
const BOLT = 'M268 266 L240 308 H258 L248 342 L286 302 H268 L278 266 Z';

const conePath = `M${C} ${C} L${pt(R - 20, -32)[0].toFixed(1)} ${pt(R - 20, -32)[1].toFixed(1)}
  A${R - 20} ${R - 20} 0 0 1 ${pt(R - 20, 10)[0].toFixed(1)} ${pt(R - 20, 10)[1].toFixed(1)} Z`;

const svg = (animated, rounded = true, beam = animated, zoom = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <radialGradient id="bg" cx="50%" cy="34%" r="78%">
    <stop offset="0" stop-color="#12213f"/>
    <stop offset="58%" stop-color="#0a1428"/>
    <stop offset="100%" stop-color="#050a14"/>
  </radialGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%">
    <stop offset="55%" stop-color="#2f6dff" stop-opacity=".24"/>
    <stop offset="100%" stop-color="#2f6dff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="yel" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFDE59"/><stop offset="100%" stop-color="#F5A80C"/>
  </linearGradient>
  <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FF7A3D"/><stop offset="100%" stop-color="#EE2D1C"/>
  </linearGradient>
  <linearGradient id="blu" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5AA8FF"/><stop offset="100%" stop-color="#1D3ED8"/>
  </linearGradient>
  <linearGradient id="shd" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#D8E4FA"/>
  </linearGradient>
  <radialGradient id="cone" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#9EC5FF" stop-opacity=".92"/>
    <stop offset="45%" stop-color="#4E8BFF" stop-opacity=".42"/>
    <stop offset="100%" stop-color="#2F6DFF" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#CFE2FF" stop-opacity=".85"/>
    <stop offset="100%" stop-color="#CFE2FF" stop-opacity="0"/>
  </linearGradient>
  <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="9"/>
  </filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="3.2" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="inner"><circle cx="${C}" cy="${C}" r="${R - SW / 2 - 12}"/></clipPath>
  <style>
    .spin  { transform-origin:${C}px ${C}px; animation: rot 4s linear infinite; }
    .spin2 { transform-origin:${C}px ${C}px; animation: rot 4s linear infinite; }
    .ping  { transform-origin:${C}px ${C}px; animation: ping 2s ease-out infinite; }
    .ping2 { transform-origin:${C}px ${C}px; animation: ping 2s ease-out infinite; animation-delay:-1s; }
    .breathe { transform-origin:${C}px ${C}px; animation: breathe 4s ease-in-out infinite; }
    @keyframes rot { to { transform: rotate(360deg); } }
    @keyframes ping {
      0%   { transform: scale(.62); opacity: .55; }
      70%  { opacity: 0; }
      100% { transform: scale(1.12); opacity: 0; }
    }
    @keyframes breathe {
      0%,100% { transform: scale(1); }
      50%     { transform: scale(1.035); }
    }
  </style>
</defs>

<rect width="512" height="512"${rounded ? ' rx="96"' : ''} fill="url(#bg)"/>
<g${zoom !== 1 ? ` transform="translate(256,256) scale(${zoom}) translate(-256,-256)"` : ''}>
<circle cx="${C}" cy="${C}" r="212" fill="url(#halo)"/>

<g clip-path="url(#inner)">
  <circle class="${animated ? 'ping' : ''}" cx="${C}" cy="${C}" r="${R - 26}"
    fill="none" stroke="#8FB6FF" stroke-width="3" opacity="${animated ? '.5' : '.16'}"/>
  <circle class="${animated ? 'ping2' : ''}" cx="${C}" cy="${C}" r="${R - 26}"
    fill="none" stroke="#8FB6FF" stroke-width="3" opacity="${animated ? '.5' : '.1'}"/>

  ${beam ? `<g class="${animated ? 'spin2' : ''}">
    <path d="${conePath}" fill="#7FB4FF" opacity=".22" filter="url(#soft)"/>
    <path d="${conePath}" fill="#7FB4FF" opacity=".1"/>
    <line x1="${C}" y1="${C}" x2="${pt(R - 20, -32)[0].toFixed(1)}" y2="${pt(R - 20, -32)[1].toFixed(1)}"
      stroke="#D8E9FF" stroke-width="5" stroke-linecap="round" opacity=".9"/>
  </g>` : ''}
</g>

<g fill="none" stroke-linecap="round" stroke-width="${SW}">
  <path d="${A1}" stroke="url(#yel)" filter="url(#glow)"/>
  <path d="${A2}" stroke="url(#red)" filter="url(#glow)"/>
  <path d="${A3}" stroke="url(#blu)" filter="url(#glow)"/>
</g>



<g class="${animated ? 'breathe' : ''}">
  <path d="${SHIELD}" fill="#040913" opacity=".55" transform="translate(0,10)" filter="url(#soft)"/>
  <path d="${SHIELD}" fill="url(#shd)"/>
  <g fill="#081226">
    ${CLOUD}
    <path d="${BOLT}"/>
  </g>
</g>
</g>
</svg>`;

fs.writeFileSync(path.join(OUT, 'asn-logo.svg'), svg(true, true));
fs.writeFileSync(path.join(OUT, 'asn-logo-static.svg'), svg(false, true));
/* marca animada que usa el encabezado de la app */
fs.writeFileSync(path.resolve('public', 'logo-mark.svg'), svg(true, true, true, 1.16));

/* ---------- render ---------- */
const FPS = 25, SECS = 4, SIZE = 512;

const browser = await chromium.launch();

/* estático 1024, con transparencia fuera del cuadrado redondeado */
const big = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 });
const bigPage = await big.newPage();
await bigPage.setContent(
  `<html><body style="margin:0;background:transparent"><div style="width:${SIZE}px;height:${SIZE}px">${svg(false, true, false)}</div></body></html>`,
  { waitUntil: 'load' }
);
await bigPage.waitForTimeout(250);
await bigPage.screenshot({ path: path.join(OUT, 'asn-logo-1024.png'), omitBackground: true });

/* misma pieza a sangre, sin transparencia (para video, jpg e iconos opacos) */
await bigPage.setContent(
  `<html><body style="margin:0;background:#050a14"><div style="width:${SIZE}px;height:${SIZE}px">${svg(false, false, false)}</div></body></html>`,
  { waitUntil: 'load' }
);
await bigPage.waitForTimeout(150);
await bigPage.screenshot({ path: path.join(OUT, 'asn-logo-1024-flat.png') });

/* iconos: la marca ocupa más lugar dentro del cuadrado, para que no se vea chica
   al lado de las otras apps del teléfono */
const iconVariants = [
  ['asn-icon-1024.png', 1.16, true],           // propósito "any"
  ['asn-icon-maskable-1024.png', 1.08, false]  // maskable / iOS: opaco y más conservador
];
for (const [name, z, round] of iconVariants) {
  await bigPage.setContent(
    `<html><body style="margin:0;background:#050a14"><div style="width:${SIZE}px;height:${SIZE}px">${svg(false, round, false, z)}</div></body></html>`,
    { waitUntil: 'load' }
  );
  await bigPage.waitForTimeout(120);
  await bigPage.screenshot({ path: path.join(OUT, name), omitBackground: round });
}
await big.close();

/* frames animados, a sangre (sin esquinas redondeadas) para video y gif */
const ctx = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(
  `<html><body style="margin:0;background:#0a1428"><div style="width:${SIZE}px;height:${SIZE}px">${svg(true, false)}</div></body></html>`,
  { waitUntil: 'load' }
);
await page.waitForTimeout(200);

const total = FPS * SECS;
for (let i = 0; i < total; i++) {
  const t = (i / FPS) * 1000;
  await page.evaluate((ms) => {
    document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; });
  }, t);
  await page.screenshot({ path: path.join(OUT, 'frames', `f${String(i).padStart(3, '0')}.png`) });
}
await browser.close();

/* ---------- video + gif ---------- */
const frames = path.join(OUT, 'frames', 'f%03d.png');

execFileSync('ffmpeg', [
  '-y', '-framerate', String(FPS), '-i', frames,
  '-vf', 'scale=1080:1080:flags=lanczos,format=yuv420p',
  '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart',
  path.join(OUT, 'asn-logo-loop.mp4')
], { stdio: 'inherit' });

execFileSync('ffmpeg', [
  '-y', '-framerate', String(FPS), '-i', frames,
  '-vf', 'scale=480:480:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse',
  '-loop', '0', path.join(OUT, 'asn-logo-loop.gif')
], { stdio: 'inherit' });

fs.rmSync(path.join(OUT, 'frames'), { recursive: true, force: true });
console.log('listo');
