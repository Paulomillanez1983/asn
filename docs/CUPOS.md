# Cupos de Cloudflare: qué gastamos y qué conviene usar

Actualizado: 2026-10-20. Los números son del plan **Workers Free**.
Fuentes: developers.cloudflare.com/kv/platform/limits, /kv/platform/pricing,
/d1/platform/pricing, /durable-objects/platform/pricing, /workers/platform/limits.

## Los límites que nos importan

| Servicio | Gratis por día | Se agota con |
|---|---|---|
| Workers (peticiones) | 100.000 | ~2.700 sesiones de app (6 llamadas por lugar) |
| Workers (CPU) | 10 ms por petición | cálculos muy pesados, no es nuestro caso |
| **KV · escrituras** | **1.000** | cualquier cosa que guarde seguido |
| KV · lecturas | 100.000 | poco probable |
| D1 · filas escritas | 100.000 | 100 veces más margen que KV |
| D1 · filas leídas | 5.000.000 | prácticamente libre |
| Durable Objects · peticiones | 100.000 | similar a Workers |
| Caché HTTP (Cache API) | sin cupo propio | solo cuenta como subpetición |

El número que nos mató es **1.000 escrituras diarias de KV**. Es el cupo más
chico de toda la plataforma y es fácil de romper sin darse cuenta.

## Qué gastaba el cupo (incidente del 20/10)

1. **Los enlaces para compartir.** Cada «compartir» guardaba una entrada en KV
   para acortar la URL. Una persona compartiendo 5 veces gastaba 5 escrituras.
2. **El limitador de peticiones.** Escribía una clave en KV *en cada llamada a
   la API*: hidro, clima, ensemble, sol, geocodificación. Una sola carga de la
   app con dos lugares eran ~12 escrituras. Con 80 sesiones al día, el cupo
   entero.
3. **La caché del río.** Se guardaba con 30 minutos de vigencia: hasta 48
   escrituras por día por cada punto distinto.

Con eso, 1.000 escrituras se agotan con **menos de 100 personas usando la app**.
No era un problema de crecimiento: era un problema de arquitectura.

## Qué hace ahora

| Dato | Dónde vive | Por qué |
|---|---|---|
| Suscripciones de push | KV (`sub:*`) | se escriben solo al activar o cambiar lugares |
| Serie histórica de la estación | KV (7 días) | es cara y global: una escritura por estación por semana |
| Nivel actual del río | Caché HTTP (30 min) | cambia seguido, no debe tocar KV |
| Lista de estaciones INA | KV (1 día) | una escritura por día en total |
| Arroyos y ríos cercanos | Caché HTTP (7 días) | muchas claves distintas, cupo de KV no alcanza |
| Enlaces para compartir | nada | la URL lleva los datos: `/alerta/4/crecida-grave/-27.27/-58.24/casa` |
| Limitador de peticiones | memoria del Worker | no hace falta persistencia |

Resultado: las escrituras de KV bajaron de **~12 por sesión** a **0 en el uso
normal**. Solo se escribe cuando alguien activa avisos o cuando una estación
nueva entra en la serie histórica.

## Cuánto aguanta así

- **Hoy:** el gasto de KV es de decenas de escrituras al día. Margen enorme.
- **El próximo techo es 100.000 peticiones diarias del Worker**, no KV. Eso son
  unas 2.500–3.000 sesiones por día. Cuando se acerque, el camino es reducir
  llamadas por sesión (agrupar `/api/wx` + `/api/ens` en una sola) o pasar a
  Workers Paid (5 USD/mes, sin límite de peticiones).
- **Si algún día hay miles de usuarios con avisos**, las suscripciones se
  pueden mover a **D1** (100.000 escrituras diarias, 100 veces más que KV) sin
  cambiar la app, solo el Worker.

## Regla para el futuro

Antes de guardar algo en KV, preguntarse: **¿esto se escribe más de una vez por
usuario por día?** Si la respuesta es sí, va a la caché HTTP o a D1. KV queda
solo para lo que se escribe poco y se lee mucho (listas, suscripciones).
