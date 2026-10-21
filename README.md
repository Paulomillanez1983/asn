# ASN 4.0 — Alerta Super Niño

Monitor de inteligencia meteorológica para la familia. Te dice, de un vistazo, si viene lluvia fuerte, ráfagas, granizo o tormenta eléctrica en tus lugares.

**App:** https://asn.asn-clima.workers.dev/
**Código:** licencia AGPL-3.0 (ver [Licencia](#licencia)).
**Estado:** proyecto independiente, en piloto en Córdoba, Argentina. No es un servicio oficial de emergencia.

## Cómo está pensada

1. **Gravedad primero.** Cada lugar es una tarjeta pintada según el riesgo (verde, amarillo, naranja, rojo). El lugar más complicado aparece arriba.
2. **Una frase y una acción.** "Se viene lluvia" y "Guardá lo que tengas afuera y cerrá las ventanas".
3. **Respuestas rápidas.** Paraguas, tender ropa, bici, auto afuera.
4. **Cuándo.** El próximo evento en las 12 horas: "Lluvia a las 16:00 · en 2 h".
5. **Tutorial con simulador.** Al entrar aparece una hoja con dos explicaciones ("¿Por qué monitor de inteligencia?" y "¿Qué está viendo?") y un simulador: elegís intensidad de viento (leve, moderado, fuerte) y fenómeno (lluvia, tormenta, granizo, nieve, eléctrico, rayos, eléctrico total) y ves cómo se vería la alerta.
6. **Lo técnico, escondido.** Modelos, probabilidades, radar y rayos viven en "Ver detalles".
7. **Instalación y permisos a la vista.** Banner "Instalá ASN 4.0" (con respaldo de instrucciones si el navegador no muestra el diálogo) y "Avisos en tiempo real" con un toque.

### Búsqueda de direcciones

Se consultan tres fuentes en paralelo y se mezclan por prioridad: **Photon/OSM** (calles y alturas), **Nominatim/OSM** (búsqueda estructurada calle + ciudad) y **Open-Meteo Geocoding** (ciudades y barrios). Los duplicados se descartan por nombre y por cercanía.

Límite real: si una altura no está cargada en OpenStreetMap, no existe en ninguna de las tres fuentes. En ese caso la app avisa ("esa altura no está cargada en el mapa") y toma la calle como referencia del barrio.

## Cómo decide

**Probability of exceedance sobre ensemble**, no un voto entre modelos. El ensemble del IFS tiene 51 escenarios; la app cuenta cuántos superan cada umbral en las próximas 3 horas:

| Fenómeno | 🟡 Amarilla | 🟠 Naranja | 🔴 Roja | 🟣 Morada |
|---|---|---|---|---|
| Lluvia en 3 h | P(≥15 mm) ≥ 30 % | P(≥30 mm) ≥ 40 % | P(≥60 mm) ≥ 50 % | P(≥100 mm) ≥ 30 % |
| Ráfagas | P(≥60 km/h) ≥ 40 % | P(≥80 km/h) ≥ 40 % | P(≥100 km/h) ≥ 30 % | P(≥130 km/h) ≥ 30 % |
| Tormenta eléctrica | CAPE ≥ 1000 J/kg **y** P(lluvia ≥ 10 mm) ≥ 30 % | — | — | — |
| Granizo | etiqueta "posible granizo" (CAPE ≥ 1500, ráfaga ≥ 70 km/h, congelamiento 3000–4500 m) | | | |
| Nieve (cm en 3 h) | ≥ 0,2 cm | ≥ 2 cm | ≥ 5 cm | ≥ 15 cm |

### Escala de colores

Verde, amarilla, naranja y roja son los cuatro niveles de la vigilancia de **Météo-France**; el **morado** es el nivel excepcional que ese sistema agrega para fenómenos extremos (en ciclones se activa cuando incluso los servicios de rescate deben confinarse). En ASN 4.0 el morado se reserva para umbrales que en Córdoba se ven muy rara vez: ≥100 mm en 3 h o ráfagas ≥130 km/h.

Los umbrales numéricos son una decisión operativa nuestra, documentada acá, no una tabla oficial: el color describe gravedad esperada, no una probabilidad exacta.

**La nieve no es un ejemplo:** se calcula con las variables `snowfall` (cm) y `snow_depth` (m) de Open-Meteo, alimentadas por el IFS. En Córdoba es poco frecuente pero real: la última nevada en la capital fue el 16 de junio de 2021 y, según registros históricos recogidos por La Voz, las nevadas en la ciudad sólo habían ocurrido en julio, agosto y septiembre ([La Voz, 28/06/2025](https://www.lavoz.com.ar/ciudadanos/la-ola-polar-trajo-frio-extremo-y-altas-chances-de-nieve-incluso-en-la-ciudad-de-cordoba_0_oZC8NgiZ77.html)).

Además se calculan los cuatro modelos determinísticos (ECMWF, GFS, ICON, GEM) como control: si el ensemble y el determinístico difieren en más de un nivel, se baja uno y se muestra el rango.

**Por qué no se usa `weather_code >= 96` para granizo:** esos códigos sólo se emiten en Europa Central; en Argentina nunca aparecen. Era código muerto. Ver [docs/INVESTIGACION.md](docs/INVESTIGACION.md).

## Fuentes y redundancia

| Dato | Fuente | Rol |
|---|---|---|
| Pronóstico | Open-Meteo (ECMWF, GFS, ICON, GEM) + ensemble IFS 51 | Principal |
| Pronóstico | **MET Norway** (`api.met.no`) | Control externo independiente y respaldo si Open-Meteo falla |
| Direcciones | OpenStreetMap (Photon + Nominatim) + Open-Meteo Geocoding | Búsqueda |
| Imagen satelital | NASA GIBS — GOES-19 ABI GeoColor | GIF de 6 cuadros, sin credenciales |
| Altura de ríos | Estaciones públicas del INA (`alerta.ina.gob.ar`) | Nivel y tendencia; criterio de crecida |
| Reportes de usuarios | Cruce con radar RainViewer | Validación de lo que la gente ve en su zona |

Si Open-Meteo no responde, la tarjeta se arma con MET Norway y avisa "Datos de respaldo: MET Norway". En "Ver detalles" aparece la línea "Control externo MET Norway" con su nivel, lluvia acumulada y ráfagas; si difiere en dos niveles o más del principal, se marca la discrepancia.

## GIF satelital (GOES-19)

Desde alerta naranja, el botón 🎞️ genera un GIF de 6 cuadros de 560×560 con imagen GOES-19 ABI GeoColor de NASA GIBS: marca de ubicación, escala, hora, logo y nombre ASN 4.0. No se presenta como radar: es imagen satelital de color real.

Se habilita con una alerta meteorológica o con una tormenta detectada, no con una alerta exclusivamente hidrológica: una imagen satelital no muestra el nivel del río. RainViewer se usa solo para cruzar los reportes de los usuarios, no para armar el GIF.

## Avisos

- **App abierta o en segundo plano:** notificación del navegador **desde amarilla en adelante**, con el color y el fenómeno en el título: `🟡 Alerta amarilla · 💨 ráfagas en Casa`, `🔴 Alerta roja · 🧊 granizo en Colegio`, `🟠 Alerta naranja · 🌊 lluvia torrencial en Casa`. El mismo nivel no se repite antes de 3 h.
- **Pregunta en pantalla:** a los 20 segundos de abrir, la app pregunta “¿Qué estás viendo en tu zona?” (máximo cada 6 h). Con esa respuesta cruza el reporte con el radar de RainViewer en vivo y guarda el resultado para la estadística de acierto por modelo.
- **App cerrada:** **Web Push real** desde un Worker de Cloudflare (cron cada 10 minutos). Se activa con un toque desde ⚙️ Ajustes y se prueba con **Probar**; no hay que instalar nada extra.
- **Reglas de emisión:** mismo nivel no se repite antes de 3 h; el nivel baja sólo tras dos corridas por debajo; de 23 a 7 sólo pasan roja y morada.

## Infraestructura

| Pieza | Detalle |
|---|---|
| Dominio | https://asn.asn-clima.workers.dev/ |
| Hosting | Cloudflare Worker `asn` con assets estáticos desde `public/` |
| Suscripciones | KV `SUBS` (una entrada por dispositivo, con sus lugares) |
| Chequeo | Cron `*/10 * * * *` sobre el ensemble del IFS |
| Push | Web Push VAPID (P-256 + aes128gcm), servicio FCM/APNs del navegador |

Despliegue: copiá `wrangler.example.toml` a `wrangler.toml`, completá tus IDs y cargá los secretos.

```bash
npx wrangler secret put OWNER_KEY
npx wrangler secret put VAPID_PRIVATE
npx wrangler secret put VAPID_SUBJECT
npx wrangler deploy
```

`wrangler.toml` está en `.gitignore`: la configuración real con claves nunca se publica. La plantilla vive en `wrangler.example.toml`.

## Estructura

```
public/index.html     interfaz + hoja de bienvenida y simulador
public/app.js         ensemble, riesgo, aprendizaje, push, ajustes
public/sw.js          service worker (offline + evento push)
public/manifest.json  instalación como app
worker/index.js       API de suscripción + cron de alertas + envío push
wrangler.toml         configuración del Worker, KV y cron
docs/INVESTIGACION.md investigación con fuentes y umbrales
hardware/             sensor de canal con ESP32 (opcional)
```

## Probarla en tu compu

```bash
python -m http.server 8080
```

## Privacidad

El repositorio no contiene direcciones, teléfonos ni coordenadas. Los lugares se cargan desde el teléfono y quedan en `localStorage`.

## Límites

No reemplaza tu criterio. El granizo es el fenómeno más difícil: la app lo marca como "posible", nunca como certeza, porque sin radar propio no hay forma de confirmarlo. Si el cielo se pone feo, abrí el radar desde "Ver detalles".

Las fuentes son modelos y redes independientes (ECMWF, NOAA, DWD, CMC vía Open-Meteo; MET Norway; NASA GIBS; RainViewer; Blitzortung) y estaciones hidrológicas públicas del INA. No hay dependencia operativa de organismos provinciales ni nacionales: si una fuente no publica, la app dice que no hay dato; no lo interpreta como calma.


## Calidad y seguridad

- **9 tests E2E** con Playwright (`npm test`): carga, menú, rail con dos tarjetas, alineación de horas, día/noche, compartir según nivel, página de apoyo, OG del enlace y cabeceras de seguridad.
- **CI** en cada push (`.github/workflows/ci.yml`): instala Chromium y corre la suite contra producción.
- **CSP estricta**: `script-src 'self'`, sin scripts inline (el arranque vive en `boot.js`), `frame-ancestors 'none'`, `object-src 'none'`.
- **Rate limiting** por IP en KV: hydro 60/10 min, ríos 30/10 min, suscripciones 20/10 min, prueba 10/10 min.
- **Accesibilidad**: región `aria-live` para avisos, foco visible, `prefers-reduced-motion` y etiquetas por hora en la tira.

### Hidrología: criterio de crecida

Se compara el caudal con su **p95 de 92 días**: +15 % sobre el p95 → señal, +35 % → crecida. Si el INA publica umbral para la estación, se toma como referencia. La lluvia local sólo cuenta para cuencas chicas; el Paraná crece por lluvia a cientos de kilómetros.

## Licencia

El código de ASN 4.0 se publica bajo **GNU Affero General Public License v3.0 o posterior** (AGPL-3.0-or-later, ver [LICENSE](LICENSE)). Podés usarlo, modificarlo y redistribuirlo. Si modificás el código y lo ofrecés como servicio en red, tenés que publicar tu versión bajo la misma licencia.

Esa cláusula es la que impide que alguien tome ASN 4.0, lo cierre y lo convierta en un producto propietario: cualquier mejora que se sirva a usuarios por internet vuelve a la comunidad.

Eso no cubre:

- **Datos de terceros:** Open-Meteo (CC BY 4.0), MET Norway (NLOD / CC BY 4.0), OpenStreetMap (ODbL), NASA GIBS / GOES-19 (dominio público) e INA (datos públicos). Cada fuente mantiene su licencia.
- **Marca e identidad visual:** "ASN 4.0", "Alerta Super Niño" y el logo no se licencian para uso comercial ni para sugerir respaldo oficial.

La versión anterior, propietaria, queda archivada en [LICENSE-PROPRIETARY.txt](LICENSE-PROPRIETARY.txt) como registro histórico. No se aplica al código publicado a partir de esta versión.
