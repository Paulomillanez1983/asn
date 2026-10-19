# ASN 4.0 — Alerta Super Niño

Monitor de inteligencia meteorológica para la familia. Te dice, de un vistazo, si viene lluvia fuerte, ráfagas, granizo o tormenta eléctrica en tus lugares.

**App:** https://paulomillanez1983.github.io/asn/

## Cómo está pensada

1. **Gravedad primero.** Cada lugar es una tarjeta pintada según el riesgo (verde, amarillo, naranja, rojo). El lugar más complicado aparece arriba.
2. **Una frase y una acción.** "Se viene lluvia" y "Guardá lo que tengas afuera y cerrá las ventanas".
3. **Respuestas rápidas.** Paraguas, tender ropa, bici, auto afuera.
4. **Cuándo.** El próximo evento en las 12 horas: "Lluvia a las 16:00 · en 2 h".
5. **Tutorial con simulador.** Al entrar aparece una hoja con dos explicaciones ("¿Por qué monitor de inteligencia?" y "¿Qué está viendo?") y un simulador: elegís intensidad de viento (leve, moderado, fuerte) y fenómeno (lluvia, tormenta, granizo, nieve, eléctrico, rayos, eléctrico total) y ves cómo se vería la alerta.
6. **Lo técnico, escondido.** Modelos, probabilidades, radar y rayos viven en "Ver detalles".

## Cómo decide

**Probability of exceedance sobre ensemble**, no un voto entre modelos. El ensemble del IFS tiene 51 escenarios; la app cuenta cuántos superan cada umbral en las próximas 3 horas:

| Fenómeno | Nivel 1 | Nivel 2 | Nivel 3 |
|---|---|---|---|
| Lluvia en 3 h | P(≥15 mm) ≥ 30 % | P(≥30 mm) ≥ 40 % | P(≥60 mm) ≥ 50 % |
| Ráfagas | P(≥60 km/h) ≥ 40 % | P(≥80 km/h) ≥ 40 % | P(≥100 km/h) ≥ 30 % |
| Tormenta eléctrica | CAPE ≥ 1000 J/kg **y** P(lluvia ≥ 10 mm) ≥ 30 % | — | — |
| Granizo | etiqueta "posible granizo" (CAPE ≥ 1500, ráfaga ≥ 70 km/h, nivel de congelamiento 3000–4500 m) | | |

Además se calculan los cuatro modelos determinísticos (ECMWF, GFS, ICON, GEM) como control: si el ensemble y el determinístico difieren en más de un nivel, se baja uno y se muestra el rango.

**Por qué no se usa `weather_code >= 96` para granizo:** esos códigos sólo se emiten en Europa Central; en Argentina nunca aparecen. Era código muerto. Ver [docs/INVESTIGACION.md](docs/INVESTIGACION.md).

## Avisos

- **App abierta o en segundo plano:** notificación del navegador al pasar a naranja o rojo.
- **App cerrada:** GitHub Actions cada 10 minutos con el mismo criterio de ensemble, publicando en **ntfy.sh**. Instalá ntfy y suscribite al canal que muestra ⚙️ Ajustes.
- **Reglas de emisión:** mismo nivel no se repite antes de 3 h; el nivel baja sólo tras dos corridas por debajo; de 23 a 7 sólo pasa el nivel 3.

### Secretos del repositorio

| Secreto | Contenido |
|---|---|
| `PLACES` | `[{"n":"Casa","lat":-31.33,"lon":-64.256}]` |
| `NTFY_TOPIC` | el mismo canal que muestra la app |

## Estructura

```
index.html            interfaz + hoja de bienvenida y simulador
app.js                ensemble, riesgo, lenguaje humano, ajustes
sw.js                 service worker (offline + notificaciones)
manifest.json         instalación como app
alert.mjs             chequeo en segundo plano (Node 20, sin dependencias)
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

No reemplaza un servicio meteorológico oficial ni las indicaciones de Defensa Civil. El granizo es el fenómeno más difícil: la app lo marca como "posible", nunca como certeza, porque sin radar propio no hay forma de confirmarlo.
