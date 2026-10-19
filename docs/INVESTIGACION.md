# Monitoreo y alerta meteorológica para Córdoba: qué es confiable y qué cambiar en la PWA

**Resumen.** El voto "2 de 4 modelos" no es una probabilidad: es el promedio de cuatro opiniones correlacionadas, cuantizado en saltos de 25 puntos. La evidencia publicada para Sudamérica no muestra un ganador entre IFS, GFS, ICON y GEM, y sí muestra que los globales de 9–25 km no resuelven las ráfagas convectivas. La mejora está en tres capas: ensemble para 12–72 h, radar/rayos para <2 h, y reglas de emisión con histéresis.

## 1. Verificación comparada: lo que hay y lo que no

No existe verificación pública estación por estación de los cuatro modelos para Córdoba. Lo más cercano es el piloto WGNE/JWGFVR liderado por SMN y ECMWF (Gascón y Matsudo, *ECMWF Newsletter* 185, 2025): sobre Sudamérica el IFS rinde "de forma competitiva" frente a GFS, ICON, CMC y UKMO, con sesgo bajo en casi toda Argentina y mejor desempeño en la Pampa. No publica ranking ni RMSE por modelo. Sí documenta el límite que importa: en la tormenta convectiva del 16–17/12/2023 en el NEA el IFS **no resolvió las ráfagas dañinas**, y lo compensó el modelo regional del SMN ([NL185](https://www.ecmwf.int/en/newsletter/185/news/verification-global-and-regional-nwp-models-over-south-america), 2025).

Tampoco hay scores conjuntos: el intercambio estándar de precipitación del WMO Lead Centre (ETS, bias, SEEPS) sólo incluye ECMWF, Met Office, NCEP y JMA; DWD y CMC no aparecen ([wmolcdnv](https://wmolcdnv.ecmwf.int/score_home/surface.mean), 2026). **No hay dato duro que justifique ponderar distinto a los cuatro**, y la diferencia entre modelos es menor que el error del evento.

## 2. Ensemble > contar determinísticos

Un ensemble de 51 miembros (IFS 0.25°, 3-horario, corridas cada 6 h; GFS 31, ICON 40, GEM 21 — [ensemble-api](https://open-meteo.com/en/docs/ensemble-api), 2026) muestrea incertidumbre de condiciones iniciales: permite P(excedencia) calibrable. Cuatro determinísticos dan sólo 0/25/50/75/100 %, sin resolución entre "30 %" y "45 %", y comparten errores de gran escala: sus votos no son independientes. Ebert (2001, *MWR* 129) mostró que un "poor man's ensemble" tiene skill para lluvia diaria ≥50 mm/día medido con Brier, pero es un piso; la probabilidad operativa se arma con miembros perturbados ([MWR](https://journals.ametsoc.org/view/journals/mwre/129/10/1520-0493_2001_129_2461_aoapms_2.0.co_2.xml), 2001). No encontré Brier skill score publicado que compare ensemble vs voto 2-de-4 en Argentina; no lo estimo.

## 3. Nowcasting (<2 h)

La extrapolación de radar supera al NWP en intensidad de precipitación **hasta 2 h** ([MWR 148](https://journals.ametsoc.org/view/journals/mwre/148/12/MWR-D-20-0221.1.xml), 2020). Los modelos generativos (DGMR, *Nature* 2021) mejoran 0–90 min, pero se entrenaron con radar del Reino Unido y no son trasladables sin reentrenar. GOES-19 —GOES-East desde el 4/4/2025, reemplazó a GOES-16, cuya distribución se apagó— da disco completo cada 10 min y mesoescala cada 30–60 s ([AWS](https://registry.opendata.aws/noaa-goes/), 2025); sirve para topes fríos y GLM (rayos), no para lluvia en mm. RainViewer aporta mosaico cada 5 min con 2 h de historia y nowcast, sin SLA ([rainviewer](https://www.rainviewer.com/api.html), 2026).

## 4. Granizo y tormenta eléctrica

Los servicios operativos usan MUCAPE, CIN, shear 0–6 km, nivel de congelamiento y, con radar, reflectividad y ZDR. Categorías SPC: CAPE <1000 débil, 1000–2500 moderada, 2500–4000 fuerte, >4000 extrema; shear 0–6 km de 35–40 kt para superceldas ([SPC](https://www.spc.noaa.gov/exper/mesoanalysis/help/begin.html)). Para granizo se usa SHIP (MUCAPE, shear, humedad, nivel de congelamiento) ([Hail hazard](https://www.sciencedirect.com/science/article/pii/S2212094718300744), 2018).

Dato crítico: los códigos WMO 96/99 (tormenta con granizo) **sólo se emiten en Europa Central**; en Argentina `weather_code` nunca devuelve granizo ([docs](https://open-meteo.com/en/docs), 2026). El disparador actual `code >= 96` es código muerto.

## 5. Qué hace confiable una alerta

- **CAP v1.2** (OASIS, 2010): `severity`, `urgency`, `certainty`, `onset`, `expires`, `references`; permite cancelar y actualizar sin ambigüedad ([CAP](https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html)).
- **Doble fuente**: ensemble + observación. Si divergen más de un nivel, publicar rango.
- **Histéresis**: subir con P≥50 %, bajar sólo con P<25 % en dos corridas seguidas (12 h).
- **Re-emisión**: mismo nivel no antes de 3 h, salvo suba o fenómeno nuevo; cancelación explícita al bajar.
- **Silencio**: nivel ≤2 callado de 23 a 7; rojo siempre suena.
- **Trazabilidad**: guardar modelo, corrida, umbral y probabilidad de cada aviso.

## 6. APIs: medición de hoy (CORS con Origin real)

| API | Aporte | Latencia / cobertura | Límite | Cliente |
|---|---|---|---|---|
| Open-Meteo forecast/ensemble/geocoding | determinístico + 51 miembros + geocoding | 6 h (IFS), global 25 km | 600/min, 5.000/h, 10.000/día; ensemble = 4 llamadas; no comercial | **Sí** (`ACAO: *`) |
| NOAA GOES-19 en S3 | ABI/GLM crudo (NetCDF) | 10 min disco completo | sin clave | CORS sí, pero pesado: server-side |
| RainViewer | mosaico radar + nowcast | 5 min; depende de radares nacionales | sin clave; personal/educativo, sin SLA | Sí (`ACAO: *`) |
| aviationweather.gov METAR | observación SAEZ/SACO | horaria | sin clave | **No**: sin `Access-Control-Allow-Origin` |
| SMN | avisos oficiales | — | — | **No**: 403/Cloudflare a clientes automáticos |
| Blitzortung | rayos en tiempo real | segundos | uso comunitario, sin API oficial | No recomendable |

Los METAR de Córdoba, si se necesitan, van por proxy propio (GitHub Action).

## 7. Recomendación priorizada

**Sacar**: el voto 2-de-4 como decisor; `weather_code>=96`; CAPE de un determinístico como disparador de granizo.

**Poner**, en orden:

1. **Probabilidad de ensemble**, una llamada:
`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=-31.42&longitude=-64.19&hourly=precipitation,wind_gusts_10m,cape,freezing_level_height&models=ecmwf_ifs025&forecast_hours=72&wind_speed_unit=kmh`
Contar miembros (`precipitation_memberNN`, 51) con lluvia ≥10 mm en cualquier ventana de 3 h.
2. **Umbrales** por probabilidad:
 - Lluvia 3 h: P(≥15 mm) ≥30 % amarillo; P(≥30 mm) ≥40 % naranja; P(≥60 mm) ≥50 % rojo. Intensidad: ≥15 mm/h atención, ≥30 mm/h alerta.
 - Ráfaga: P(≥60 km/h) ≥40 % amarillo; P(≥80) ≥40 % naranja; P(≥100) ≥30 % rojo.
 - Tormenta: CAPE≥1000 J/kg + P(lluvia≥10 mm/3h)≥30 %. "Posible granizo" sólo como etiqueta si CAPE≥1500, ráfaga≥70 km/h y `freezing_level_height` 3000–4500 m; nunca nivel propio sin radar.
3. **Cruce determinístico**: IFS y GFS como control. Si el determinístico y la mediana del ensemble difieren más de un nivel, bajar uno y mostrar rango.
4. **Observación <2 h**: RainViewer en el mapa; rayos por GLM vía job server-side. Rayos a <20 km elevan a naranja aunque el ensemble diga verde.
5. **Emisión**: histéresis 50/25 %, re-emisión 3 h, silencio 23–7 salvo rojo.

**Costo**: ensemble cada 30 min = 4 unidades por corrida, ~192/día, holgado dentro de 10.000/día.

## Fuentes

| Fuente | Año | URL |
|---|---|---|
| Gascón & Matsudo, verificación NWP en Sudamérica, ECMWF NL185 | 2025 | https://www.ecmwf.int/en/newsletter/185/news/verification-global-and-regional-nwp-models-over-south-america |
| WMO LC-DNV, scores de precipitación (centros participantes) | 2026 | https://wmolcdnv.ecmwf.int/score_home/surface.mean |
| Ebert, Poor Man's Ensemble, MWR 129 | 2001 | https://journals.ametsoc.org/view/journals/mwre/129/10/1520-0493_2001_129_2461_aoapms_2.0.co_2.xml |
| Open-Meteo Ensemble API (miembros, modelos, límites) | 2026 | https://open-meteo.com/en/docs/ensemble-api |
| Open-Meteo Forecast API (variables, códigos WMO) | 2026 | https://open-meteo.com/en/docs |
| Open-Meteo Pricing (límites y uso comercial) | 2026 | https://open-meteo.com/en/pricing |
| Radar extrapolation vs NWP, MWR 148 | 2020 | https://journals.ametsoc.org/view/journals/mwre/148/12/MWR-D-20-0221.1.xml |
| Ravuri et al., nowcasting generativo, Nature | 2021 | https://www.nature.com/articles/s41586-021-03854-z |
| NOAA GOES en AWS Open Data (GOES-19 operativo) | 2025 | https://registry.opendata.aws/noaa-goes/ |
| NESDIS, ABI: cadencia de escaneo | 2026 | https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/advanced-baseline-imager-abi |
| RainViewer API (cobertura, 5 min, términos) | 2026 | https://www.rainviewer.com/api.html |
| SPC, parámetros de tiempo severo (CAPE, shear) | s.f. | https://www.spc.noaa.gov/exper/mesoanalysis/help/begin.html |
| Global estimates of damaging hail hazard (SHIP) | 2018 | https://www.sciencedirect.com/science/article/pii/S2212094718300744 |
| OASIS CAP v1.2 | 2010 | https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html |
| SMN, sistema de alerta (4 niveles) | 2026 | https://www.smn.gob.ar/alertas |
