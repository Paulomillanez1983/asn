# ☂️ Paraguas

**El clima antes de que te agarre.**

App web (PWA) para saber, de un vistazo, si en alguno de tus lugares se viene lluvia fuerte, ráfagas o granizo. Sin planillas, sin siglas, sin interpretar gráficos.

## Por qué se llama así

Un paraguas no te explica la atmósfera: te cubre. La app funciona igual. No muestra modelos ni acumulados en milímetros; responde una sola cosa: **¿pasa algo o no, y qué hago?** El nombre es la promesa, y el ícono es el objeto.

## Cómo está pensada

1. **Gravedad primero.** Cada lugar es una tarjeta que se pinta entera según el riesgo: verde, amarillo, naranja o rojo. El lugar más complicado aparece arriba.
2. **Una frase, una acción.** El título dice qué viene ("Se viene lluvia") y abajo dice qué hacer ("Guardá lo que tengas afuera y cerrá las ventanas").
3. **Respuestas rápidas.** Cuatro pastillas resuelven las dudas de todos los días: paraguas, tender ropa, salir en bici, dejar el auto afuera.
4. **Cuándo.** Una línea con el próximo evento: "Lluvia a las 16:00 · en 2 h".
5. **Lo técnico, escondido.** Modelos, probabilidad hora por hora, radar y rayos viven en "Ver detalles". Si no lo abrís, no te enterás de que existen.
6. **Sin configurar nada raro.** Buscás el barrio, tocás "Elegir" y listo. Se guarda en el teléfono.

## Cómo se calcula

Cuatro modelos (ECMWF, GFS, ICON, GEM) para las próximas 3 horas:

| Fenómeno | Nivel 1 | Nivel 2 | Nivel 3 |
|---|---|---|---|
| Lluvia | ≥ 0,5 mm | ≥ 2,5 mm | ≥ 7,6 mm (o ≥ 25/50 mm en 3 h) |
| Ráfagas | ≥ 50 km/h | ≥ 70 km/h | ≥ 90 km/h |
| Granizo | CAPE ≥ 1500 + ráfagas ≥ 80 | CAPE ≥ 2500 + ráfagas ≥ 80 | código WMO 96/99 |

El nivel que se muestra es **el que alcanzan al menos 2 de los 4 modelos**: filtra los picos de un solo modelo y deja pasar lo que varios pronósticos ven igual.

La línea **"Ahora"** viene del bloque `current` de Open-Meteo para ese punto exacto: temperatura, estado del cielo, viento y si está lloviendo en este momento.

## Avisos

- **App abierta o en segundo plano:** notificación del navegador cuando el riesgo pasa a naranja o rojo.
- **App cerrada:** un workflow de GitHub Actions revisa cada 10 minutos y publica en **ntfy.sh**. Instalá la app ntfy en el celular y suscribite al canal que muestra ⚙️ Ajustes (botón "Copiar"). Sin cuenta y sin costo.
- **Horario silencioso:** entre 23 y 7 solo pasa un aviso de nivel 3.

### Secretos del repositorio

*Settings → Secrets and variables → Actions*:

| Secreto | Contenido |
|---|---|
| `PLACES` | `[{"n":"Casa","lat":-31.33,"lon":-64.256}]` |
| `NTFY_TOPIC` | el mismo canal que muestra la app |

Sin secretos, la app funciona igual: solo se pierden los avisos con la app cerrada.

## Verificación empírica

El botón **"¿Está pasando?"** (aparece cuando hay riesgo) guarda qué pronosticaba cada modelo en ese momento. Con tus respuestas, ⚙️ Ajustes muestra qué modelo acierta más en tu zona: "ECMWF: 8 de 10". Sirve para saber a quién mirar en Córdoba.

## Estructura

```
index.html            interfaz (hero por severidad, estilos)
app.js                datos, riesgo, lenguaje humano, ajustes
sw.js                 service worker: offline + notificaciones
manifest.json         instalación como app
icon-192/512.png      íconos
alert.mjs             chequeo en segundo plano (Node 20, sin dependencias)
.github/workflows/    cron cada 10 minutos
hardware/             sensor de canal con ESP32 (opcional)
```

## Probarla en tu compu

```bash
python -m http.server 8080
```

Abrí `http://localhost:8080`.

## Privacidad

El repo no tiene direcciones, teléfonos ni coordenadas. Los lugares se cargan desde el teléfono y quedan en `localStorage`.

## Límites

Es una ayuda para decidir, no un servicio meteorológico oficial. Los modelos se equivocan, y el granizo es lo más difícil de pronosticar: si el cielo se pone feo, mirá el radar en "Ver detalles".

## Nota de investigación: God's Eye View

Se evaluó [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) ("Ojos de Dios"), un globo 3D de código abierto con datos públicos. Sus capas de clima (radar MRMS de NOAA, rayos, ciclones) **solo cubren Estados Unidos** y el visor 3D no aporta a una alerta familiar. Se descartó como dependencia; se conservó su idea de fondo: mostrar también el estado actual.

También se probó el METAR del aeropuerto de Córdoba (SACO): el dato es bueno, pero `aviationweather.gov` no envía cabeceras CORS y el navegador lo bloquea. Se descartó antes que meter un proxy frágil.
