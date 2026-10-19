# Sensor de canal (ESP32)

Mide el nivel de agua del canal con un **JSN-SR04T** (ultrasónico impermeable) y lo publica en `ntfy.sh`. Sirve para el punto "Canal" de la app: si el agua sube rápido, la tarjeta lo muestra y el ESP32 manda un aviso propio.

## Materiales

| Ítem | Detalle |
|---|---|
| Placa | ESP32 DevKit (WiFi) |
| Sensor | JSN-SR04T v2.0 o A02YYUW (impermeable, con cable) |
| Alimentación | 5 V 1 A (fuente o panel + batería) |
| Gabinete | IP65, con el sensor apuntando al agua |

## Conexión

| Sensor | ESP32 |
|---|---|
| VCC | 5V |
| GND | GND |
| TRIG | GPIO 5 |
| ECHO | GPIO 18 |

## Puesta en marcha

1. Medí con una cinta la distancia desde el sensor hasta el **fondo** del canal y cargala en `ALTURA_SENSOR_CM`.
2. Ajustá `UMBRAL_CM` (nivel de alerta) y `SUBA_CM` (cuánto tiene que subir entre lecturas para avisar).
3. Completá `SSID`, `PASS`, `CANAL` y `ALERTA`. El topic de datos (`CANAL`) va en la app como canal del lugar; el de alertas es el mismo `NTFY_TOPIC` del repositorio.
4. Flasheá con Arduino IDE (placa "ESP32 Dev Module").

## Cómo reporta

- Publica el nivel en cm cada 3 minutos (o cada 15 si está tranquilo).
- Avisa cuando cruza el umbral o sube `SUBA_CM` de golpe, con rearme automático al bajar al 90 % del umbral.
- Usa mediana de 7 lecturas para descartar rebotes y olas.

El sensor **no** va incluido en la app web: la app solo lee el histórico de las últimas 3 h del topic y muestra `cm`, `cm/30 min`, "sube rápido" y "sensor sin señal".
