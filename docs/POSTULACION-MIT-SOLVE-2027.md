# Postulación MIT Solve 2027 — borrador listo para copiar

**Challenge:** Global Climate Challenge
**Deadline oficial:** viernes 6 de noviembre de 2026, 12:00 (mediodía) Eastern Time.
**Ojo:** el PDF de preguntas menciona una vez "November 2, 2026" en la página 3. Es un error del documento. La fecha válida es la del sitio y la primera página: **6 de noviembre**. Aun así, apuntá a enviar el **2 de noviembre** para cubrirte de cualquier problema técnico.
**Idioma:** todo en inglés. Una postulación en español queda fuera de revisión.
**Video:** opcional, máximo 2 minutos, en YouTube o Vimeo público.

> Instrucciones: copiá cada respuesta en el formulario. Los textos entre `[CORCHETES]` son datos que tenés que completar vos; no los inventé. Las respuestas están en inglés y respetan los límites de palabras del formulario.

> **Advertencia previa:** el repositorio `github.com/Paulomillanez1983/asn` devuelve 404 al 21/10/2026: está privado o todavía no existe con ese nombre. La respuesta de "What makes your solution innovative" afirma que el código es público. **No envíes la postulación sin publicar el repo**, o cambiá esa frase. Publicarlo también es requisito para Open Source Collective.

---

## Page 1 — Solution Profile

**Organization name**
ASN 4.0 — Alerta Super Niño

**Solution name (≤30 characters)**
ASN 4.0

**One-line summary (≤150 characters)**
Free, ad-free early warnings for heavy rain, hail, wind, snow and river floods, hyperlocal and in plain language.

**City / region**
Córdoba

**Country**
Argentina

**Type of organization**
Not registered as any organization

**Elevator pitch video**
[CARGAR LINK DE YOUTUBE, 2 MINUTOS, PÚBLICO. Guion sugerido al final de este documento.]

---

### What specific problem are you solving? (≤200 words)

Córdoba, Argentina, receives short, violent summer storms. A cell can form west of the city and reach a neighborhood within a couple of hours, with damaging gusts, hail and intense rainfall. Official warnings are issued at provincial scale and in technical language. By the time a family reads a severe storm warning for an entire province, the decisions that matter — secure the roof, move the car, clear a drain, check on an older neighbor — are already late.

The people with the least margin are hit hardest: households in flood-prone peripheries, people living alone, and small shop owners with merchandise outside. They do not need another meteorological model. They need to know what is coming to their address, how bad it will be, and when.

Existing options either cover the whole country at coarse resolution, require registration, show advertising, or present uncertainty as certainty. None tells a person in a specific neighborhood what may happen in the next few hours, in words they can act on. ASN 4.0 was built for that gap: the last two hours, at the scale of one address.

---

### What is your solution? (≤200 words)

ASN 4.0 is a free web app that turns open meteorological and hydrological data into a five-level alert for each place a person cares about: home, work, school, a parent's house. The user adds an address and receives a card colored green, yellow, orange, red or purple, one sentence on what may happen, one practical precaution, and the time of the next event.

It does not average models. It reads the 51-member ECMWF ensemble through Open-Meteo and computes the probability of exceeding hazard thresholds in the next three hours — rainfall, gusts, snow — and combines CAPE with rainfall probability for thunderstorms. It cross-checks with MET Norway as an independent source and compares river levels from public INA stations against a 92-day 95th percentile. When sources disagree, it says so. When a source is missing, it does not treat silence as calm.

Alerts run on a Cloudflare Worker every 10 minutes and reach the phone by Web Push, even with the app closed. No account, no ads, no data sale.

---

### Who does your solution serve, and in what ways will it impact their lives? (≤200 words)

ASN 4.0 serves families in Córdoba who make decisions based on the sky: whether to leave laundry outside, park under a tree, send a child to school, open a shop, or check on an older relative. It is designed for people who are not weather experts — plain language, color first, one action per card.

They are underserved in three ways. Provincial warnings are not address-specific. Commercial apps are ad-supported or require accounts. Official channels assume familiarity with meteorological terms.

The impact is time. A household that knows a storm will arrive at 16:00 can secure the roof, move the car, clear a drain and warn a neighbor before it starts. That reduces exposure and damage, and it gives people a reason to look after each other. The app does not tell anyone to evacuate or stay; it informs and points to official instructions.

Today the pilot serves 21 active devices in Córdoba, with [N] alerts delivered since [MES/AÑO]. The next step is to measure whether those alerts change what people do, not just what they know.

---

## Page 2 — Eligibility

**Is technology a core part of your solution?**
Yes.

**Does your solution address a climate or environmental problem?**
Yes.

**Stage of development**
Pilot

### Please share details about why you selected the stage above. (≤200 words)

ASN 4.0 is live in production at https://asn.asn-clima.workers.dev/ and has been used by residents of Córdoba since [MES/AÑO]. It is not a prototype: it ingests real ensemble data every 10 minutes, issues real alerts, delivers Web Push notifications to closed phones, and has a public health endpoint that reports whether the cron and the rainfall accumulator are running.

I selected "Pilot" rather than "Growth" because the solution operates in one city, has not yet established a sustainable funding stream, and is still iterating on its alert thresholds and message design with users. It has more than ten direct users — 21 active devices on 21 October 2026 — but not the consistent multi-community deployment that Growth implies.

What has been built and tested: the probability-of-exceedance engine, the MET Norway cross-check, the INA river-level comparison, the five-level card system, Web Push delivery, and a satellite GIF for storm events. Nine end-to-end tests run against production on every push, plus unit tests for the storm-tracking logic. The storm ETA feature is in development and is not presented as available.

---

## Page 3 — Solution & Team Details

**How many beneficiaries or customers does your solution currently serve?**
11–100

**Does your solution have a website, app, or social media handle?**
Yes — https://asn.asn-clima.workers.dev/

**Which dimension of the Challenge does your solution most closely address?**
Protect people, livelihoods, and essential services from extreme heat, floods, drought, wildfire, or other climate hazards through infrastructure design, resilient water and cooling systems, or risk management approaches.

### How are you and your team well-positioned to deliver this solution? (≤300 words)

I am an independent developer based in Córdoba, and I built and operate every layer of ASN 4.0: the data pipeline, the risk engine, the interface, the push service and the deployment. That means the person who designed the thresholds is the same person who sees the alerts fail at 3 a.m. and fixes them.

My connection to the problem is local. I live in the region the app serves, and I built it after watching storms arrive faster than any warning I could find. The design decisions come from that experience: color before numbers, one action per card, and a rule that a missing data source is never shown as calm.

I have engaged with users directly through the in-app report prompt ("What are you seeing in your area?"), which asks people to describe conditions on the ground. Those reports are cross-checked against radar and stored to evaluate whether the alert was right. [AGREGAR: cuántos reportes recibiste y qué cambió en el diseño a partir de ellos.]

I also document the reasoning publicly: the repository includes the thresholds, the sources, the known limits and the cases where the app deliberately refuses to issue an alert. That documentation is what allows a partner — a university, a civil defense office, a local NGO — to audit the system instead of trusting it.

What I lack is not technical capacity. It is a legal vehicle to receive grants, a validation partner to compare alerts against observations, and the capital to run a rigorous evaluation. That is what I am asking Solve to help me build.

### In which countries do you currently operate?
Argentina.

### Additional countries in the next year
None confirmed. [Si tenés un piloto concreto en otro país, ponelo acá; si no, dejar así.]

### How many people work on your solution team? (≤100 words)
One full-time founder (me). [CONFIRMAR: si hay colaboradores part-time o contratistas, agregarlos.] No part-time staff and no contractors at present.

### How long have you been working on your solution? (≤100 words)
[COMPLETAR: tiempo desde la primera versión, por ejemplo "Since early 2025" o "For 18 months".] The current version, ASN 4.0, has been in production since [MES/AÑO].

### Why are you applying to Solve? (≤200 words)

I am applying to Solve for three things I cannot build alone.

First, a legal and financial vehicle. As an unregistered independent project, I cannot receive most grants, sign agreements with universities or agencies, or pay collaborators formally. Solve's network and guidance on fiscal sponsorship would let ASN 4.0 stop being a personal project and become an institution that can survive its founder.

Second, validation. The app issues alerts, but I have not yet measured whether they change behavior. I need a partner who can compare alerts against station observations and help design a simple evaluation. Solve's network includes universities and agencies that have done this before.

Third, credibility with the institutions that already work on early warning in Argentina. I am not trying to replace them, and I do not want to depend on them politically. I want ASN 4.0 to be a complement they can recommend, and Solve's name opens that conversation.

Funding matters, but it is not the only reason. If the only goal were money, I would be applying to the wrong program.

### Team Lead
Name: [COMPLETAR — nombre completo]
Email: [COMPLETAR]
Phone with country code: [COMPLETAR — +54 9 ...]
Backup contact: [COMPLETAR — opcional]

**Is the Team Lead a resident of the United States?**
No.

**Have you or your organization been selected as a Solver before?**
No.

**Is your solution an active or past participant in another entrepreneurship network?**
No, Solve would be the first.

**Did you take the MITx course "Business and Impact Planning for Social Enterprises"?**
No.

**Did you hear about Solve through a network/mailing list?**
[COMPLETAR — si llegaste por búsqueda propia, poné No.]

---

## Page 4 — More About Your Solution and Business Model

### What makes your solution innovative? (≤300 words)

Most consumer weather apps answer "what will the weather be?" ASN 4.0 answers a narrower and harder question: "what is coming to this address in the next three hours, and what should I do about it?"

Three design choices make it different.

First, probability of exceedance instead of a single forecast. The app reads the 51-member ECMWF ensemble and counts how many members exceed hazard thresholds for rainfall, gusts and snow. A yellow alert means at least 30% of scenarios exceed 15 mm in three hours; red means at least 50% exceed 60 mm. The user sees a level, not a false precision.

Second, disagreement is visible. A deterministic control (ECMWF, GFS, ICON, GEM) and an independent source (MET Norway) are compared against the ensemble. If they differ by more than one level, the app lowers the alert and shows the range. If a source is missing, the card says there is no data. Null is not zero.

Third, the alert is written to be acted on. Five levels adapted from the French Météo-France vigilance scale, with purple reserved for events that are rare in Córdoba. One sentence, one precaution, one time. Technical detail is one tap away, not in the user's face.

The result is a service with near-zero marginal cost — a Cloudflare Worker, open data, no account — that can run in places where commercial weather apps do not see a market. The code and the thresholds are public, so any municipality or NGO can audit or replicate them.

---

### Describe in simple terms how and why you expect your solution to have an impact on the problem. (≤300 words)

The logic is simple: earlier, local, understandable information leads to protective action, and protective action reduces damage and injury.

Activities: every 10 minutes, the system ingests ensemble forecasts, cross-checks an independent model, and compares river levels from public stations. It converts those inputs into a five-level alert per saved place.

Outputs: a colored card with what may happen, when, and one precaution; a push notification when the level rises; a satellite GIF when a storm is relevant.

Immediate outcomes: people secure roofs, move vehicles, clear drains, delay trips, and check on neighbors before the event. Medium-term outcomes: less property damage, fewer weather-related accidents, and greater trust in the alert — which only holds if the app also stays quiet when there is nothing to say.

The key assumption is that a clear, address-specific message at the right time changes behavior. There is broad evidence that early warning systems save lives when they reach people with actionable information; the weak link is usually the last mile, not the forecast. ASN 4.0 works on that last mile.

I do not yet have an impact evaluation, and I will not claim one. What I have is the instrument to run it: the app already asks users what they are seeing, and it can ask whether they took action. The next step is to pair that with station observations and measure the gap between alert and outcome.

---

### Describe your solution's tech stack and how you know that it works. (≤300 words)

The stack is deliberately small: a Cloudflare Worker serving static assets and an API, KV for device subscriptions, R2 for the rainfall accumulator, a cron trigger every 10 minutes, and a vanilla JavaScript progressive web app with a service worker. Web Push uses VAPID. There is no framework and no database server, which keeps cost and operational surface low.

Data: Open-Meteo for ECMWF, GFS, ICON and GEM plus the 51-member IFS ensemble (CC BY 4.0); MET Norway as an independent cross-check; OpenStreetMap via Photon and Nominatim for addresses (ODbL); public INA stations for river levels; NASA GIBS GOES-19 GeoColor for satellite imagery.

I know it works because it runs in production and reports on itself. The public endpoint `/api/health` returns whether the cron and the accumulator are alive and how many minutes since their last run. Nine end-to-end Playwright tests run against production on every push, covering load, menu, card layout, time alignment, day/night, share behavior, support page, link preview and security headers. Unit tests cover the storm-tracking logic. The security posture includes a strict CSP, no inline scripts, and per-IP rate limiting.

Known limits are documented in the repository: hail is marked "possible", never certain, because there is no local radar; the satellite GIF is imagery, not radar; and the storm ETA feature is still in development and is not shown as available.

---

### Technologies currently used
- Software and Mobile Applications
- Big Data
- GIS and Geospatial Technology
- Imaging and Sensor Technology

---

### What is your business model? (≤300 words)

ASN 4.0 is free for the person who uses it. There is no account, no advertising, no premium tier and no sale of location data. The value to the user is time and safety: knowing what is coming to their address early enough to act.

The cost structure makes that possible. The service runs on Cloudflare's free or low-cost tiers, uses open data, and has no staff beyond the founder. Marginal cost per additional user is close to zero, which is why the app can serve low-income neighborhoods that a subscription product would not reach.

The funding model is grant- and donation-based, not transactional. The core product stays free. Revenue, when it exists, comes from three sources: philanthropic grants for public-interest technology and disaster risk reduction; fiscal sponsorship that allows the project to receive tax-deductible donations; and, optionally, support contracts for tailored deployments with NGOs, universities or municipalities that need a customized instance or training. Those contracts would never put the core alerts behind a paywall.

I am deliberately not building an advertising business. An app that tells people to act before a storm cannot have an incentive to exaggerate risk. The business model has to protect the alert's credibility.

---

### What is your plan for becoming financially sustainable, and what evidence can you provide that this plan has been successful? (≤300 words)

The plan has three stages.

Stage 1, next 12 months: keep infrastructure costs near zero, secure fiscal sponsorship to receive grants, and win one or two non-dilutive awards that fund a part-time collaborator and a validation study. Target programs: MIT Solve, the RISK Award, and open-source infrastructure funders.

Stage 2, months 12–24: convert the validation study into a published evaluation and use it to approach foundations that fund disaster risk reduction and civic technology. Add a second deployment in another Argentine province with a local partner, so the model is not dependent on one city.

Stage 3, years 2–5: a mixed model — grants for the public-good core, support contracts for custom deployments, and individual donations through the fiscal sponsor. The core app remains free.

Evidence to date: the service is live, the infrastructure cost is within free tiers, and the founder has funded development personally. I have not received external funding yet, and I will not present projections as results. What I can show is that the product exists, runs unattended, reports its own health, and is used by real people in Córdoba.

The main financial risk is founder dependency. The first use of any grant would be to document and transfer operational knowledge, so the service does not stop if I do.

---

## Guion sugerido para el video (2 minutos)

1. **0:00–0:15** — "This is Córdoba. In summer, a storm can go from nothing to this in two hours." (imagen real de tormenta)
2. **0:15–0:45** — Mostrar la app: tres lugares, tarjetas de colores, la frase y la acción. "No models, no probabilities on the surface. One sentence: what is coming, and what to do."
3. **0:45–1:15** — Abrir "Ver detalles": ensemble, probability, MET Norway, INA. "Under the hood, 51 scenarios, not one forecast. And when the sources disagree, the app tells you."
4. **1:15–1:40** — Mostrar una notificación push llegando con la app cerrada y el GIF satelital. "It reaches the phone even when the app is closed."
5. **1:40–2:00** — "I am one developer in Córdoba. The app is free, open source and has no ads. I am applying to Solve to validate it and to make sure it outlives me."

---

## Checklist antes de enviar

- [ ] **Publicar el repositorio** en GitHub con LICENSE AGPL-3.0 y README actualizado. Hoy da 404: está privado.
- [ ] URL de la app responde (probarla desde otro teléfono y en incógnito).
- [ ] Link del video en YouTube/Vimeo, público, ≤2 minutos.
- [ ] Reemplazar todos los `[CORCHETES]`: métricas, fecha de inicio, nombre, email, teléfono.
- [ ] Confirmar el número de beneficiarios real (no inflarlo: el formulario lo cruza con la etapa).
- [ ] Enviar antes del **2 de noviembre**; el deadline real es el **6 de noviembre a las 12:00 ET**.
- [ ] Guardar una copia de las respuestas enviadas.

## Datos que tenés que completar (no los inventé)

| Dato | Dónde obtenerlo |
|---|---|
| Usuarios activos | `/api/stats` o panel del dueño |
| Alertas emitidas | `/api/audit` o KV de suscripciones |
| Fecha de inicio del proyecto | tu registro |
| Reportes de usuarios recibidos | KV / panel |
| Nombre legal y datos de contacto | tus datos |
| Estadística local de impacto | INA, Defensa Civil de Córdoba o INDEC, citando fuente |

---

## Nota estratégica

Solve dice explícitamente que no es un programa para "solo recaudar fondos". La respuesta de "Why are you applying" está escrita para eso: pone la validación y la sostenibilidad institucional antes que la plata. No la cambies por una lista de necesidades de financiamiento.

Y una cosa que el formulario castiga: exagerar la etapa. Con 21 dispositivos, "Pilot" es correcto. "Growth" te dejaría fuera en la primera revisión.

