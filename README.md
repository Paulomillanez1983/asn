# ⛈️ Alerta Meteo Córdoba

App web (PWA) para vigilar varios lugares —casa, colegio, trabajo, el canal— y recibir un aviso cuando se viene **lluvia fuerte, ráfagas o granizo** en las próximas 3 horas.

No tiene servidor ni base de datos: es un sitio estático que consulta **Open-Meteo** con **4 modelos** (ECMWF, GFS, ICON, GEM) y guarda tus lugares en el propio celular.

## Cómo se usa

1. Abrí la URL en el celular.
2. **➕ Agregar lugar** → escribí el nombre (ej. "Villa Allende") y elegí de la lista, o tocá 📍 para usar tu ubicación.
3. Repetí para cada lugar que quieras vigilar.
4. Para tenerla como app: menú del navegador → **Agregar a pantalla de inicio**.
5. En **⚙️ Ajustes** activá los avisos del navegador.

## Cómo se calcula el riesgo

Cada modelo se evalúa por separado en las próximas 3 h:

| Fenómeno | Nivel 1 (atención) | Nivel 2 (alerta) | Nivel 3 (peligro) |
|---|---|---|---|
| Lluvia acumulada | ≥ 0,5 mm | ≥ 2,5 mm | ≥ 7,6 mm (o ≥ 25/50 mm en 3 h) |
| Ráfagas | ≥ 50 km/h | ≥ 70 km/h | ≥ 90 km/h |
| Granizo | CAPE ≥ 1500 + ráfagas ≥ 80 | CAPE ≥ 2500 + ráfagas ≥ 80 | código WMO 96/99 |

El nivel que ves en la tarjeta es **el que alcanzan al menos 2 de los 4 modelos**. Eso filtra los picos aislados de un modelo y deja pasar lo que varios pronósticos coinciden en ver. La tira de barras muestra la probabilidad media de lluvia hora por hora (12 h).

Además de la tarjeta, cada lugar tiene accesos directos al **radar** (RainViewer) y a los **rayos** (Blitzortung) para confirmar en el momento.

## Avisos

- **Con la app abierta o en segundo plano:** notificación del navegador cuando el nivel sube a 2 o 3.
- **Con la app cerrada:** un workflow de GitHub Actions revisa cada 10 minutos (`alert.mjs`) y publica en **ntfy.sh**. Para recibirlo, instalá la app **ntfy** en el celular y suscribite al mismo canal que figura en ⚙️ Ajustes. No hay que crear cuenta.
- **Horario silencioso:** entre 23 y 7 solo pasan los avisos de nivel 3 (configurable en `QUIET_HOURS`).

### Secretos del repositorio

En *Settings → Secrets and variables → Actions*:

| Secreto | Contenido |
|---|---|
| `PLACES` | `[{"n":"Casa","lat":-31.33,"lon":-64.256},{"n":"Colegio","lat":-31.294,"lon":-64.296}]` |
| `NTFY_TOPIC` | el canal que muestra la app en Ajustes |

Sin secretos la app web funciona igual; solo se pierden los avisos con la app cerrada.

## Verificación empírica

El botón **"¿Qué ves ahora?"** guarda lo que pronosticaba cada modelo en ese momento. Cuando respondés el cuadro *¿Está pasando?* (Llueve / No llueve / Granizo / Viento), la app calcula el porcentaje de acierto por modelo en tu zona y lo muestra en Ajustes. Sirve para saber a qué modelo conviene mirar en Córdoba.

## Estructura

```
index.html            interfaz y estilos
app.js                lógica: consulta, riesgo, avisos, ajustes
sw.js                 service worker (offline + notificaciones)
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

El repositorio no contiene direcciones, teléfonos ni coordenadas. Los lugares se cargan desde el celular y quedan en `localStorage`. El canal de ntfy es el único dato compartido, y solo se usa para publicar avisos.

## Límites

Es una herramienta de apoyo, no un servicio meteorológico oficial: no reemplaza el criterio propio ni las indicaciones de Defensa Civil. Los modelos tienen error, sobre todo con granizo, que es el fenómeno más difícil de pronosticar.
