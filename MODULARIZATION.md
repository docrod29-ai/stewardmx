# StewardMX — Plan de Modularización y Pruebas

> **Objetivo:** reducir el riesgo técnico del monolito (`index.html`, ~30 700 líneas) **sin reescribirlo de golpe**. Extraer por módulos, con pruebas de los flujos críticos primero. Cada paso deja la app funcionando.

Estado actual: **v217**. Un solo `<script type="module">` dentro de `index.html`. Sin build step (se sirve directo).

---

## 1. Por qué (la deuda real)

| Riesgo | Impacto si no se atiende |
|---|---|
| Un archivo de ~30k líneas, 1 desarrollador | Difícil de auditar para certificación (ISO 27001 / ENS / SOC 2 que pedirá un hospital grande) |
| Sin pruebas automatizadas | Cada cambio puede romper culture-lock, timer UCI o aprobación sin que nadie lo note |
| Lógica clínica mezclada con UI y Firestore | Imposible probar una regla (p. ej. cálculo de día de ATB) en aislamiento |
| Continuidad | Si el autor no está, nadie más puede mantenerlo con seguridad |

**No es urgente para que funcione hoy. Sí es urgente para vender a instituciones serias.**

---

## 2. Estrategia: "Strangler Fig" (estrangulamiento progresivo)

No se reescribe. Se **extrae función pura por función pura** a archivos `.js` separados que `index.html` importa. Cada extracción:

1. Mueve **solo lógica pura** (sin DOM, sin Firestore) a un módulo.
2. `index.html` la importa con `import {…} from './js/modulo.js'`.
3. Se le agrega una **prueba** antes o justo después de mover.
4. Se despliega y verifica. Si algo falla, el cambio es pequeño y reversible.

> Regla de oro (de CLAUDE.md): todo el código sigue accesible desde el módulo principal. Los nuevos `.js` se importan **dentro** del `<script type="module">`, nunca como `<script>` suelto.

---

## 3. Capas objetivo (orden de extracción)

```
js/
  core/
    clinico.js      ← calcDia, _crClCG, isMDR, clasificación AWaRe   (PURO, sin DOM)
    fechas.js       ← _esFinDeSemana, _calcUCIReleaseAt, timeouts     (PURO)
    lab-parser.js   ← _labParseCSV, _labEstructurar, _labMatch        (PURO)
    antibiograma.js ← _antibiogramaAcumulado, _abgOrgNorm             (PURO)
    ddd.js          ← cálculo DDD/DOT, resumen mensual                (PURO)
  data/
    firestore.js    ← rutas (_pacPath), wrappers get/set/onSnapshot
  ui/
    censo.js, micro.js, farmacia.js, reportes.js, …                  (render)
  ia/
    consulta.js     ← _iaCtxPaciente, prompts, parser de respuesta
```

**Empezar por `core/` (lógica pura).** Es lo más fácil de extraer y lo más valioso de probar: son las reglas clínicas donde un bug hace daño real.

---

## 4. Flujos críticos que DEBEN tener prueba (prioridad)

| # | Flujo | Función(es) | Por qué es crítico |
|---|---|---|---|
| 1 | **Culture-lock** | `_calcCultureLockTimeout`, liberación por Micro / timeout 15 min | Bloquea/libera antibióticos en Urgencias — un error retrasa tratamiento |
| 2 | **Timer UCI 24 h** | `_esFinDeSemana`, `_calcUCIReleaseAt` | Fin de semana → lunes 08:00; un error libera ATB cuando no debe |
| 3 | **Día de ATB** | `calcDia` (respeta suspensión) | Alimenta alertas, DOT y reportes |
| 4 | **CrCl / PK-PD** | `_crClCG` (Cockcroft-Gault) | Ajuste de dosis renal — error = toxicidad o subdosis |
| 5 | **Importador laboratorio** | `_labParseCSV`, `_labEstructurar`, `_labMatch` | Mete datos al expediente — un mal parseo corrompe resultados |
| 6 | **Antibiograma acumulado** | `_antibiogramaAcumulado` | Guía terapia empírica del hospital |
| 7 | **DDD/DOT** | resumen mensual, % AWaRe | Evidencia de comité y reporte a autoridad |

---

## 5. Pruebas — cómo correrlas

Sin build ni framework pesado. Pruebas en Node puro (`node --test`) sobre las funciones puras.

```bash
# Una vez extraídas a js/core/*.js con export:
node --test tests/
```

Mientras la lógica siga embebida en `index.html`, las pruebas viven en `tests/critical-flows.test.mjs` con **copias verificadas** de las funciones puras (espejo), y sirven de:
- **especificación ejecutable** (documentan el comportamiento esperado), y
- **red de seguridad**: al extraer la función real, debe pasar exactamente las mismas pruebas.

> Ver `tests/critical-flows.test.mjs`.

---

## 6. Roadmap incremental (sin romper nada)

- [ ] **Fase 0 (hecho):** documentar plan + pruebas de flujos críticos como especificación.
- [ ] **Fase 1:** extraer `core/fechas.js` (weekend/UCI) + `core/clinico.js` (calcDia, CrCl, isMDR). Importar. Correr pruebas. Deploy.
- [ ] **Fase 2:** extraer `core/lab-parser.js` y `core/antibiograma.js`. Pruebas. Deploy.
- [ ] **Fase 3:** extraer `core/ddd.js`. Pruebas. Deploy.
- [ ] **Fase 4:** capa `data/firestore.js` (rutas + wrappers).
- [ ] **Fase 5:** módulos de UI por pestaña (los más grandes, al final).

Regla: **una fase = un deploy verificado.** Nunca dos fases juntas.

---

## 7. Criterio de "hecho bien"

- `node --test` pasa al 100% antes de cada deploy.
- Cada función pura extraída tiene ≥1 prueba de caso normal + ≥1 de borde.
- `sw.js` se versiona en cada deploy (regla CLAUDE.md).
- El comportamiento observable de la app no cambia (las extracciones son refactor, no features).
