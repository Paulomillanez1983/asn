# Reel ASN 4.0 — paquete completo para Google Flow

**Formato:** 9:16 vertical · 1080×1920 · 24 fps · 15 s
**Tono:** cinematográfico realista, sin épica de Hollywood. La credibilidad viene de que parezca filmado, no producido.

---

## 0. Regla de coherencia (leer antes de generar)

Flow mantiene el estilo si repetís **el mismo bloque técnico** en los cuatro prompts. Está incluido en cada uno; no lo cambies entre clips.

> `shot on 35mm, anamorphic, shallow depth of field, subtle film grain, handheld, desaturated teal-and-amber grade, natural light only, no text, no logos, no watermarks`

Además, **adjuntá siempre la imagen de referencia del clip**. Es lo que evita que Flow invente otra casa, otra mano u otra calle en cada toma.

Cómo adjuntarla en Flow: subila como *ingredient* / frame inicial del clip. Si tu versión permite "frames to video", usala como primer frame y pedí el movimiento en el prompt. Generá 8 s por clip y después recortá en el editor — no pidas 3 s exactos, Flow rinde peor con duraciones cortas.

---

## 1. Assets

| Clip | Archivo a adjuntar | Qué fija |
|---|---|---|
| 1 | `refs/01-habitacion.png` | La habitación, el velador, la lluvia, la luz violeta |
| 2 | `refs/02-mano.png` | Misma habitación + la mano. Continuidad exacta con el clip 1 |
| 3 | `refs/03-calle.png` | La calle, el agua, los vecinos, la paleta |
| 4 | `refs/04-lluvia.png` | La mano con el teléfono bajo la lluvia (otra locación, es de noche) |
| 5 | `refs/05-app-real.png` | Pantalla real de la app para pegar en el clip 4 |

Los cinco archivos van adjuntos en la entrega junto a este documento.

---

## 2. Clip 1 — el gancho (0:00–0:03)

**Adjuntar:** `refs/01-habitacion.png`

**Prompt**

```
Vertical 9:16 cinematic footage. Night interior of a modest bedroom in a small
riverside town in Argentina. A smartphone lies face down on a dark wooden
nightstand; a deep violet glow pulses out from under its edges in a slow,
rhythmic breathing pattern, catching the wood grain and a glass of water. The
phone vibrates twice against the wood, a small physical jolt. Behind, heavy rain
streaks a window, out of focus; a cold blue streetlight filters through slatted
blinds. Handheld camera, very slow push-in toward the phone, shallow depth of
field, only light source is the pulsing violet screen and the blue streetlight.
shot on 35mm, anamorphic, subtle film grain, handheld, desaturated teal-and-amber
grade, natural light only, no text, no logos, no watermarks. No people.
Mood: quiet dread, the moment before bad news.
```

**Negativo**

```
text, subtitles, watermark, logos, readable screen interface, phone brand logo,
people, faces, extra fingers, cartoon, anime, oversaturated, lens flare, stock
footage look, fake rain, floating objects, camera shake excess, day light
```

**Cámara:** push-in de 3 cm por segundo, nada más. Si Flow agrega movimiento, pedile "static except for a barely perceptible push-in".
**Sonido:** lluvia sobre vidrio (primer plano), room tone grave, dos vibraciones secas `brrzt-brrzt` sincronizadas con el pulso violeta.

---

## 3. Clip 2 — la mano (0:03–0:06)

**Adjuntar:** `refs/02-mano.png`

**Prompt**

```
Vertical 9:16 cinematic footage. Same bedroom, same camera position, same night
lighting as the reference image. A bare human hand enters from the lower right
and closes its fingers around the edge of the smartphone on the nightstand, then
lifts it slightly. The violet glow spills across the fingers, knuckles and wrist,
soft purple rim light on the skin. Camera stays tight on the hand and the phone,
slight handheld drift, shallow focus, rain shadows moving slowly on the wall
behind. Realistic skin texture with fine detail, cinematic colour grading
matching the reference exactly. shot on 35mm, anamorphic, subtle film grain,
handheld, desaturated teal-and-amber grade, natural light only. No readable
interface on the screen — the screen is an abstract violet-white glow. No text,
no logos, no watermarks.
```

**Negativo**

```
text, subtitles, watermark, logos, readable screen interface, app icons, extra
fingers, deformed hand, six fingers, cartoon, anime, oversaturated, lens flare,
stock footage look, bright room, daylight
```

**Cámara:** fija, con micro-deriva de mano. El movimiento lo hace la mano, no la cámara.
**Sonido:** sábanas, madera al rozar, una tercera vibración, respiración contenida. Nada de música todavía.

---

## 4. Clip 3 — la calle (0:06–0:11)

**Adjuntar:** `refs/03-calle.png`

**Prompt**

```
Vertical 9:16 documentary-style footage at dawn. A narrow street in a small
riverside town in Corrientes, Argentina after heavy flooding. Brown muddy water
runs fast over cracked asphalt up to the kerb, carrying leaves and a plastic
bottle. Two neighbours in rubber boots push a small hatchback away from the
water, seen from behind, slightly out of focus. Sandbags stacked against a low
painted doorway. Single-storey houses with corrugated metal roofs and peeling
paint. Overcast grey-blue sky, wet surfaces reflecting the light. Handheld camera
at chest height, walking slowly forward, natural motion blur, unstaged
documentary feel, muted desaturated colours. shot on 35mm, subtle film grain,
desaturated teal-and-amber grade, natural light only. No readable text, no logos,
no watermarks, faces not identifiable.
Mood: aftermath, community, quiet emergency.
```

**Negativo**

```
text, subtitles, watermark, logos, identifiable faces, smiling, posed, cinematic
hero shot, drone shot, cartoon, anime, oversaturated, tropical, palm trees, snow,
stock footage look, dry street
```

**Cámara:** caminata lenta hacia adelante a la altura del pecho. Que el agua ocupe el tercio inferior.
**Sonido:** agua corriendo (protagonista), botas en el barro, un perro lejano, voces apagadas sin palabras inteligibles, una puerta metálica.

---

## 5. Clip 4 — cierre (0:11–0:15)

**Adjuntar:** `refs/04-lluvia.png` + `refs/05-app-real.png`

**Prompt**

```
Vertical 9:16 cinematic footage. Night, outdoors in the rain: close-up of a hand
holding a smartphone, thumb hovering just above the glass then tapping once. Rain
beads on the phone screen and on the skin, droplets catching the light. The
screen is a dark cool teal-white glow, completely abstract with no readable
content. Background is heavy rain and out-of-focus streetlights forming soft
bokeh in deep blue and amber. Shallow depth of field, slight handheld drift.
Camera slowly pulls back and the frame fades to near-black. shot on 35mm,
anamorphic, subtle film grain, handheld, desaturated teal-and-amber grade,
natural light only, no text, no logos, no watermarks.
```

**Negativo**

```
text, subtitles, watermark, logos, readable interface, app icons, extra fingers,
deformed hand, cartoon, anime, oversaturated, lens flare, stock footage look,
dry weather, daylight
```

**Cámara:** el pull-back arranca en el segundo 2 del clip y termina en negro.
**Sonido:** lluvia sobre campera, un tap seco y nítido, y silencio inmediato después.

---

## 6. Montaje y textos

| Tiempo | Imagen | Texto en pantalla |
|---|---|---|
| 0:00–0:03 | Clip 1 | `3:12 AM` |
| 0:03–0:04.5 | Clip 2 | `En mi barrio no llovía.` |
| 0:04.5–0:06 | Clip 2 | `El río estaba a 500 metros.` |
| 0:06–0:08 | Clip 3 | `Y venía subiendo 29 cm por día.` |
| 0:08–0:10 | Clip 3 | `Nadie nos avisó.` |
| 0:10–0:11.5 | Clip 3 | *(sin texto, solo agua)* |
| 0:11–0:13 | Clip 4 + captura real de la app encima de la pantalla | `Esta sí.` |
| 0:13–0:15 | Fondo negro + logo animado | `ASN 4.0 — Alerta Super Niño` / `Gratis. Sin instalar nada raro.` / `asn.asn-clima.workers.dev` |

**Cómo pegar la captura real:** en el clip 4, escalá `refs/05-app-real.png` al 78 % del ancho, centrada, con una leve perspectiva (rotateY 6°, rotateX 2°) y una sombra suave. Que se lea el número **8,17 m** y el chip **↑ 0,29 m/día**. Ese es el plano que convence.

**Tipografía:** una sola familia, sin serif decorativa. Blanco puro sobre negro o sobre el plano oscurecido al 45 %. Aparece y desaparece sin transición (corte), no con fade. Tamaño grande: que se lea en un teléfono a 40 cm.

**Nota de honestidad:** si el reel usa imágenes generadas, poné `Recreación` en 8 px en la esquina inferior durante los clips 2 y 3. No cuesta nada y te cubre de que alguien diga que estás mostrando una inundación real que no fue.

---

## 7. Voz en off (opcional)

**Voz:** masculina o femenina, 30–45 años, castellano rioplatense, tono bajo, sin locución publicitaria. Se lee **casi susurrando**, con pausas largas. La última frase, más baja todavía.

**Guion (voseo, como se habla acá):**

```
Tres y doce de la mañana.                    [0:00]
En mi barrio no llovía.                      [0:03]
El río estaba a quinientos metros.           [0:04.5]
Y venía subiendo veintinueve centímetros
por día.                                     [0:06]
Nadie nos avisó.                             [0:08]
Esta sí.                                     [0:11]
```

**Producción:** si podés, grabala vos. Tu voz es la que hace creíble la historia y no suena a publicidad. Si no, un TTS con voz española rioplatense (ElevenLabs tiene voces de Argentina) y bajale la velocidad al 92 %.

**Sincronía:** cada línea entra 0,2 s después del corte, no antes. La frase "Esta sí" tiene que caer exactamente cuando aparece la captura de la app.

**Qué NO hacer:** no digas "revolucionario", "el futuro del clima" ni "no te va a pasar más". El relato funciona porque es chico y concreto.

---

## 8. Música y sonido (Argentina)

**Cama musical (0:00–0:11):** drone grave en La menor, 55–60 BPM, sin melodía. Sumá un **bombo legüero** muy lejano marcando negras desde el segundo 4 — es el detalle que hace que suene local y no a stock genérico. La tensión sube de a poco: entran capas de cuerdas filtradas y ruido de lluvia procesado.

**El corte (0:11):** silencio total durante 0,3 s. Sin reverb. El silencio es el golpe.

**Cierre (0:11–0:15):** una sola nota sostenida, piano o cuerda, con cola larga. Nada más.

**Si usás audio en tendencia:** elegí uno con el drop entre el segundo 10 y el 11, y cortá la música a mano en ese punto. No dejes que el audio siga durante el cierre.

**Mezcla:** la voz siempre por encima de la música (‑6 dB), el agua del clip 3 al mismo nivel que la voz, y el tap del clip 4 como el sonido más nítido de todo el reel.

**Evitá:** cumbia si tu público no la escucha, trap genérico, y cualquier tema con letra — la letra compite con la voz en off.

---

## 9. Tres ganchos para testear

Cambiá solo el texto del clip 1 y el primer segundo de audio. El resto queda igual.

1. **Miedo concreto** — `3:12 AM. En mi barrio no llovía.`
2. **Contraste** — `Mi familia vive a 500 metros del Paraná. La radio no decía nada.`
3. **Autoridad** — `El río subió 2 metros en 7 días. Esto lo veía desde el living.`

Medí retención a los 3 segundos. El que gane se queda con el resto del presupuesto.

---

## 10. Cierre del reel

Logo animado (`asn-logo-loop.mp4`), tres líneas de texto, y nada más. Sin botones falsos, sin "descargala ya", sin flechas dibujadas. El reel vende por lo que mostró, no por lo que pide.
