# Cómo se trabaja sobre ASN 4.0 sin romper lo que ya funciona

El problema no es «mejorar»: es mejorar mirando solo lo que se está cambiando.
El 20/10 se arregló la caché de un endpoint y, del otro lado de la app, Itatí
dejó de mostrar la crecida. Nada de eso se vio en los tests: los tests miraban
la interfaz, no el dato.

La regla es una sola: **lo que está en producción es la referencia, y ninguna
versión nueva sale sin demostrar que sigue cumpliendo el contrato.**

## 1. El contrato (lo que nunca puede fallar)

Estas son las promesas de la app. Cada una tiene un chequeo automático.

| # | Promesa | Dónde se verifica |
|---|---|---|
| 1 | Si el río está sobre el nivel de alerta, la app **no** puede mostrar «tranquilo» | `smoke`: Itatí debe dar nivel ≥ 2 |
| 2 | Si el río no se pudo leer, se dice («sin dato del río»), no se inventa calma | test de interfaz |
| 3 | Compartir un lugar no escribe nada en el servidor | test de enlace |
| 4 | Un enlace compartido abre una vista previa con color y nombre | `smoke` |
| 5 | Los avisos no se dan por activados si el servidor no los guardó | código + test de ajustes |
| 6 | La portada, el clima y la página de apoyo responden | `smoke` |
| 7 | El cupo diario de escrituras no se puede agotar por uso normal | revisión: solo se escribe en activación y series |

Si un cambio rompe alguno de estos puntos, **no se publica**, aunque la función
nueva funcione perfecto.

## 2. El portón: `npm run ship`

Publicar a mano ya no es la vía. Un solo comando hace todo en orden:

```
npm run ship
```

1. Compila (`build`).
2. Corre los 20 tests de navegador.
3. Publica en Cloudflare.
4. Corre la prueba de humo **contra producción**, con datos reales.
5. Si todo pasa, deja una etiqueta `prod-AAAA-MM-DD-HH` en git.

Si falla en 1 o 2, no se publica nada. Si falla en 4 (ya publicado), el comando
avisa y hay que volver atrás:

```
npx wrangler rollback
```

El rollback de Cloudflare devuelve la versión anterior al instante, sin recompilar.

## 3. Qué mira la prueba de humo

`scripts/smoke.mjs` consulta la app publicada como lo haría una persona:

- portada con sus etiquetas de vista previa
- enlace de alerta con el color correcto
- pronóstico con temperatura real
- **el río de Itatí: nivel medido, y que no esté «tranquilo» si está crecido**
- clave pública de avisos
- página de apoyo

La cuarta es la que faltaba. Es la que hubiera frenado el incidente de hoy.

## 4. Antes de tocar datos, un lugar de control

Itatí es el lugar de referencia: tiene estación del INA, umbrales conocidos
(alerta 6,80 m · evacuación 7,50 m) y una crecida real en curso. Cualquier
cambio en la cadena de datos se prueba primero ahí:

```
curl "https://asn.asn-clima.workers.dev/api/hydro?lat=-27.27&lon=-58.24"
```

Tiene que devolver `"now"` con un número y `"level"` coherente con ese número.
Si vuelve un `error` o un nivel 0 con el agua en 8 metros, se para todo.

## 5. Reglas de trabajo

- **Un cambio, una publicación.** No se mezcla una mejora visual con un cambio
  de datos: si algo falla, no se sabe qué fue.
- **Nunca borrar sin reemplazar.** Cuando se quita una caché, un límite o un
  camino de datos, la primera pregunta es qué pasa si eso falla. La respuesta
  tiene que ser «la app sigue funcionando», no «la app muestra otra cosa».
- **Lo que falla se dice.** Si una fuente no responde, la interfaz lo declara.
  Nunca se rellena un hueco con un valor optimista (el caso «todo tranquilo»).
- **Toda escritura se justifica.** Ver `docs/CUPOS.md`: si algo se escribe
  seguido, no va a KV.
- **Después de publicar, se mira.** `npm run smoke` no es opcional; es parte
  de publicar.
