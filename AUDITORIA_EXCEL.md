# Auditoría de Mejora — Excel StewardMX (Reporte Epidemiológico PROA)

> Documento de referencia. Basado en la estructura REAL generada por `_buildGoogleSheet('__XLSX__',...)` en `index.html` (L21399–23230). 58 hojas verificadas. Sin reconstrucción: solo potenciación.

---

## 1. Resumen ejecutivo

**¿Qué tan funcional está?** Muy funcional. Es, con diferencia, el export PROA más completo que he auditado: 58 hojas que cubren censo clínico (77 columnas), dataset SPSS/R listo para análisis, codebook, antibiograma acumulado CLSI M39, Magiorakos MDR/XDR/PDR, genes de carbapenemasa, resistencia estratificada (sitio/espécimen/edad/sexo), χ², bioestadística con IC95% de Wilson, y portada navegable con hipervínculos. Estilo visual cuidado (semáforos Access/Watch/Reserve, zebra, freeze panes, anchos auto).

**Fortalezas reales (conservar):**
- Cobertura clínica y epidemiológica de nivel publicación (CLSI M39/M100, Magiorakos 2012, NHSN, GLASS-OMS vía CIE-10).
- Hoja SPSS/R + Codebook = interoperabilidad estadística real.
- Portada con índice e hipervínculos; renombrado limpio de hojas que **ya reescribe las fórmulas cross-sheet** para no romper Excel (esto está muy bien resuelto).
- Semáforos y estilos coherentes con xlsx-js-style.

**Viabilidad de mejorar sin reconstruir:** ALTA. Todo se genera por código en una sola función. Cada mejora aprobada se aplica una vez y se propaga a todos los hospitales, todos los meses, sin tocar archivos a mano. Cero riesgo de "romper fórmulas manualmente" — el riesgo se controla con el gate de sintaxis + pruebas que ya usamos.

**El hallazgo central:** 57 de 58 hojas son **valores estáticos** (precomputados en JS y pegados como texto). Solo *Bioestadística (IC95%)* usa fórmulas vivas. Consecuencia: el libro es una **foto**, no una **hoja de cálculo**. Si el usuario edita datos dentro del Excel, nada recalcula. La mejora de mayor impacto es convertir las hojas-resumen clave en **fórmulas vivas** sobre la hoja `Análisis SPSS/R` (la fuente única de verdad).

---

## 2. Elementos que deben conservarse

| Hoja / función | Por qué conservarse | Posible mejora menor |
|---|---|---|
| `Censo Clínico` (77 col, 2 filas de encabezado por secciones) | Núcleo operativo; agrupación por secciones es excelente | Convertir en Tabla de Excel con nombre (`tblCenso`) para que las demás hojas la referencien |
| `Análisis SPSS/R` (76 col, códigos numéricos) | Fuente única para estadística y Power BI | Es la base ideal para fórmulas vivas (ver §5) |
| `Codebook` | Diccionario de datos real — raro y valioso | Añadir columna "Hoja_Destino" y versión |
| `Bioestadística (IC95%)` | ÚNICA con fórmulas vivas (Wilson) — modelo a replicar | Extender el patrón a más indicadores |
| `Antibiograma Hospitalario` (CLSI M39) | Guía terapia empírica; marca n<30/n<10 | Conservar; añadir IC95% por celda %S |
| `Magiorakos MDR/XDR/PDR` | Clasificación validada por especie | Conservar tal cual |
| `Genes Carbapenemasa (PCR)` | Vigilancia molecular; subtotales correctos | Conservar |
| `Resistencia × Sitio/Espécimen/Edad/Sexo` + `Chi² Tests` | Análisis estratificado nivel paper | Conservar; añadir leyenda de ⚠ n<30 |
| `Portada` con hipervínculos + renombrado que reescribe fórmulas | Resuelve el bug "libro vinculado" elegantemente | Añadir botón "volver a Portada" por hoja |
| `Dashboard KPIs` con benchmark + estado | Lectura ejecutiva inmediata | Hacer KPIs vivos (fórmula) + microgáficas |
| Semáforos `_semaforo()` (Access/Watch/Reserve, S/I/R) | Identidad visual clínica correcta | Extender a más columnas (días, creatinina) |

---

## 3. Problemas detectados

| Ubicación | Problema | Severidad | Riesgo | Solución sugerida |
|---|---|---|---|---|
| 57/58 hojas | Valores estáticos: no recalculan si se edita el dato | **Crítica (Alta)** | El libro engaña: parece interactivo y no lo es; análisis sobre datos editados queda inconsistente | Convertir hojas-resumen a fórmulas vivas sobre `Análisis SPSS/R` (§5). Conservar el JS como respaldo de valor inicial |
| Todo el libro | Sin **AutoFilter** en las tablas largas (Censo, SPSS/R, Historial ATB, Solicitudes, Aislamientos) | Alta | El usuario no puede filtrar/ordenar sin esfuerzo; reduce utilidad operativa | Añadir `ws['!autofilter']={ref:...}` a hojas tabulares (1 línea por hoja) |
| Todo el libro | Sin **Tablas de Excel con nombre** (ListObjects) | Alta | Las fórmulas usan rangos fijos `A2:A10000` (frágiles, sobre-dimensionados) | Definir Tablas (`tblSPSS`, `tblCenso`) → fórmulas estructuradas y Power BI directo |
| Hojas-resumen | Sin fila **TOTAL** ni n analizado | Media | Falta contexto del denominador en cada tabla | Añadir fila TOTAL y "n=" al pie |
| Formato | Sin formato **%** ni **fecha** nativo (se pasan como texto) | Media | Ordenar por fecha falla; los % no son numéricos | Marcar celdas `%` con `z:'0.0%'` y fechas con `z:'yyyy-mm-dd'` y valor Date |
| Seguridad | Sin **protección** de hojas/fórmulas | Media | Un clic borra una fórmula del IC95% sin aviso | Proteger hojas de fórmulas; dejar editable solo `Análisis SPSS/R` |
| Captura | Sin **validación/listas** desplegables | Media | Si el usuario captura dentro del Excel, mete basura | Validación en columnas categóricas (sexo, AWaRe, acción) |
| Navegación | Portada enlaza hacia las hojas, pero no hay retorno | Baja | Navegar 58 hojas es tedioso | Hipervínculo "↩ Portada" en A1 de cada hoja |
| Rangos | `A2:A10000` hardcodeado | Baja | Si >10000 filas, trunca silenciosamente | Tablas con nombre eliminan el límite |

---

## 4. Mejoras propuestas sin eliminar funcionalidad

| Hoja | Elemento actual | Mejora propuesta | Beneficio | Riesgo | Prioridad |
|---|---|---|---|---|---|
| `Análisis SPSS/R` | Rango de datos suelto | Convertir en **Tabla de Excel** `tblSPSS` | Fórmulas estructuradas, autofiltro, Power BI 1-clic | Bajo | **Crítica** |
| `Dashboard KPIs` | Valores estáticos | KPIs **vivos** (`=COUNTIF(tblSPSS[...])`) + columna "Meta cumplida" con semáforo | El dashboard reacciona a los datos | Bajo | **Crítica** |
| Censo, SPSS/R, Historial, Solicitudes, Aislamientos | Sin filtro | `!autofilter` | Filtrar/ordenar nativo | Muy bajo | Alta |
| `Bioestadística` | Rangos `!O2:O10000` | Migrar a referencias de Tabla `tblSPSS[aware_1a_3r]` | Robustez, sin truncar | Bajo | Alta |
| Hojas-resumen (Gravedad, Acción, Cultivos…) | Conteos JS | Conteos `=COUNTIF` vivos | Recalculan al editar | Bajo | Alta |
| Todas | Sin retorno a portada | Hipervínculo "↩ Portada" en A1 | Navegación | Muy bajo | Media |
| `Antibiograma Hospitalario` | %S sin intervalo | Añadir IC95% Wilson por %S | Rigor M39 | Bajo | Media |
| Nueva: `ALERTAS_PROA` | (no existe) | Hoja de alertas accionables (§11) | Valor clínico directo | Bajo | Alta |
| Nueva: `README` | (no existe) | Instrucciones + versión + leyenda de semáforos/⚠ | Onboarding | Nulo | Media |

---

## 5. Mejoras de fórmulas (foto → calculadora)

> Patrón: la hoja `Análisis SPSS/R` (códigos numéricos) es la fuente. Las hojas-resumen referencian con `=COUNTIF`. Hoy se hace en JS; proponemos emitir la fórmula además del valor.

| Hoja | Cálculo | Fórmula actual (efectiva) | Fórmula propuesta | Ventaja | Prueba de validación |
|---|---|---|---|---|---|
| Dashboard | % Access | Valor JS estático `42` | `=IFERROR(ROUND(100*COUNTIF(tblSPSS[aware_1a_3r],1)/COUNTA(tblSPSS[id]),1),"—")` | Recalcula; sin rango fijo | Debe dar el mismo % que el JS en el set inicial |
| Dashboard | % Cultivo tomado | Estático | `=IFERROR(ROUND(100*COUNTIF(tblSPSS[cult_taken],1)/COUNTA(tblSPSS[id]),1),"—")` | Vivo | Comparar con valor JS actual |
| Dashboard | DOT promedio | Estático | `=IFERROR(ROUND(AVERAGE(tblCenso[Días_ATB]),1),"—")` | Vivo | Igual a `dotTot/n` JS |
| Gravedad | n por categoría | Estático | `=COUNTIF(tblSPSS[severity_0l_3c],{0;1;2;3})` | Vivo | Suma = N total |
| Bioestadística | IC95% Wilson | `…!O2:O10000` (rango fijo) | Igual fórmula Wilson pero `tblSPSS[aware_1a_3r]` | No trunca a 10000 | Mismo IC en set <10000 |
| Antibiograma Hosp. | %S | Estático | `=IFERROR(ROUND(100*S/(S+I+R),1),"—")` con celdas n | Auditable | Igual al %S JS |

**Implementación segura:** mantener el valor JS como *fallback* y, donde la fuente exista, escribir `cell.f` (fórmula) en vez de `cell.v`. El renombrado de hojas ya reescribe refs — pero con **Tablas con nombre** ni siquiera hace falta (las Tablas no llevan emoji). Esto **elimina** la fragilidad de raíz.

---

## 6. Mejoras de nombres y etiquetas

> El Censo usa nombres con sufijo de unidad (`Hb_gdL`, `Creatinina_mgdL`) — **excelente práctica, conservar**. Solo afinaría consistencia menor. **Riesgo general: las hojas-resumen referencian estos nombres → cambiarlos exige actualizar el JS que las genera (no es manual).**

| Nombre actual | Nombre sugerido | Motivo | Impacto fórmulas/dashboards |
|---|---|---|---|
| `Días_ATB` | `Dias_Terapia_DOT` | Alinear con término DOT internacional | Bajo — solo si alguna hoja lo referencia por nombre (hoy es posicional) |
| `Auth_PROA` | `Autorizacion_PROA` | Evitar abreviatura ambigua | Bajo |
| `Cats_Todas` | `Categorias_Dx_Todas` | Claridad | Bajo |
| `Riesgo_MDR` | `Riesgo_MDR_Score` | Indica que es score, no booleano | Bajo |
| Hoja `Restringidos` | `ATB Restringidos` | Consistencia con resto | El renombrado `_san()` ya lo maneja; actualizar `_descDe()` |

**Recomendación:** estos cambios son **opcionales/baja prioridad**. La nomenclatura actual ya es profesional. No tocar salvo que se haga el lote completo con pruebas.

---

## 7. Nuevas columnas sugeridas

| Hoja | Columna sugerida | Tipo | Manual/Calc | Fórmula/validación | Utilidad clínica/PROA |
|---|---|---|---|---|---|
| Censo | `Charlson_Score` | Entero | Calc | de `charlsonAprox(p).score` (ya existe en app) | Comorbilidad/mortalidad basal |
| Censo | `qSOFA` | Entero 0–3 | Calc | de `p.qsofaScore` | Gravedad cabecera |
| Censo | `Horas_Desde_Inicio` | Número | Calc | `=( HOY() - Fecha_Inicio )*24` | Disparar alerta 48–72h |
| Censo | `Switch_IV_VO_Candidato` | Sí/No | Calc | regla: vía IV + afebril + VO disponible | Oportunidad de switch |
| Censo | `Ajuste_Renal_Pendiente` | Sí/No | Calc | TFG<50 y ATB nefrotóxico sin ajuste | Seguridad |
| SPSS/R | `los_days` (estancia) | Entero | Calc | `=HOY()-Fecha_Ingreso` | Denominador cama-día |
| Historial ATB | `Solapamiento_Cobertura` | Sí/No | Calc | 2+ ATB con espectro redundante | Duplicidad |
| Antibiograma Hosp. | `IC95_inf_%S` / `IC95_sup_%S` | Número | Calc | Wilson sobre S y n | Rigor M39 |

> Todas alimentadas desde datos que la app **ya captura** (SOFA, Charlson, dispositivos, fechas ATB). Cero captura nueva para el médico.

---

## 8. Validaciones recomendadas (si se captura dentro del Excel)

| Campo | Regla | Mensaje de error | Riesgo que previene |
|---|---|---|---|
| `Sexo` | Lista: M, F, Otro | "Selecciona M, F u Otro" | Texto libre inconsistente |
| `AWaRe` | Lista: Access, Watch, Reserve | "Valor AWaRe inválido (OMS)" | Clasificación errónea |
| `Acción_PROA` | Lista: mantener/desescalar/suspender/vo/escalar/ajustar/cambiar | "Acción no reconocida" | KPI de intervención corrupto |
| `Edad` | Entero 0–120 | "Edad fuera de rango" | Outliers que rompen medias |
| `Creatinina_mgdL` | Decimal 0.1–30 | "Creatinina fuera de rango fisiológico" | Error de TFG |
| `SOFA_Total` | Entero 0–24 | "SOFA 0–24" | Gravedad inválida |
| `Fecha_Inicio` | Fecha ≤ hoy | "No puede ser futura" | Días ATB negativos |

> Implementable como `dataValidation` de xlsx-js-style en las columnas categóricas del Censo.

---

## 9. Mejoras visuales

- **Paleta:** ya coherente (navy `0A1A2F`, teal `0E7C66`, semáforos). Conservar. Añadir un **acento por dominio** (microbiología morado, farmacia ámbar) en los títulos de hoja.
- **Encabezados:** ya con wrap + centrado + teal. Conservar. Subir altura de fila de header a 28px.
- **Congelación:** ya congela 1 fila (2 en Censo). **Añadir** congelar también la **1ª columna** (`xSplit:1`) en hojas anchas (Censo 77 col, Antibiograma 68 col) para no perder el nombre al desplazar.
- **Formato condicional:** hoy es por celda vía `_semaforo()`. **Añadir** escalas de color en columnas numéricas (Días_ATB: verde→rojo; %R en antibiograma: verde≤20%→rojo≥50%).
- **Semáforos:** extender a `Días_ATB` (>7d ámbar, >14d rojo) y `Creatinina` (>1.5 ámbar).
- **Botones de navegación:** hipervínculo "↩ Portada" en A1 de cada hoja (xlsx soporta `l:{Target:"#'Portada'!A1"}`).
- **Protección:** proteger hojas de fórmulas (Bioestadística, Dashboard) dejando `Análisis SPSS/R` editable.

---

## 10. Mejoras de dashboards

- **Conservar:** Dashboard KPIs (indicador/valor/benchmark/estado) — estructura correcta.
- **Mejorar:** hacer los KPIs **vivos** (fórmula) + columna "Δ vs mes previo" + semáforo de meta.
- **Agregar:** 
  - `DASHBOARD_EJECUTIVO` (1 pantalla para dirección médica): % AWaRe, DOT/100 cama-día, % desescalada, % cultivo pre-ATB, tasa MDR/1000 pac-día — todos con IC95% y meta.
  - `DASHBOARD_OPERATIVO` (para el equipo PROA del día): pacientes >72h sin revisión, Reserve sin justificar, cultivos positivos sin ajuste, carbapenémico sin cultivo.
- **Indicadores nuevos:** % switch IV→VO logrado, días-terapia evitados (intervenciones aceptadas × duración), % ajuste renal correcto.
- **Filtros/segmentadores:** por servicio, por mes, por AWaRe (con Tablas + autofiltro; segmentadores reales requieren tabla dinámica — Fase 3).
- **Visualizaciones PROA:** sparkline de tendencia DOT, barras AWaRe apiladas, heatmap de %R (organismo × ATB).

---

## 11. Alertas PROA recomendadas (nueva hoja `ALERTAS_PROA`)

> Una hoja viva que lista solo los pacientes que requieren acción HOY. Cada regla = fórmula sobre el Censo.

| Alerta | Regla (lógica) | Color |
|---|---|---|
| ATB >72h sin revisión | `Días_ATB>3 AND Revisado_PROA<>"Sí"` | 🔴 |
| Carbapenémico sin cultivo | `ATB contiene (mero/imi/erta/dorip) AND Cultivo="no"` | 🔴 |
| Vancomicina sin monitoreo | `ATB contiene vanco AND Notas no contiene "nivel/AUC"` | 🟠 |
| Duplicidad de cobertura | `ATBs_Activos_n≥2 AND espectros redundantes` | 🟠 |
| Tratamiento prolongado | `Días_ATB > Duración_Plan` (o > guía IDSA por dx) | 🟠 |
| Cultivo positivo sin ajuste | `Cultivo="positivo" AND Acción_PROA="mantener"` | 🔴 |
| Antibiótico restringido activo | `Política="restringido" AND Auth_PROA<>"liberado"` | 🔴 |
| Función renal alterada sin ajuste | `TFG<50 AND ATB nefrotóxico AND Ajuste_Renal_Pendiente="Sí"` | 🔴 |

> La app **ya tiene** esta lógica en el censo (alertas en pantalla). Aquí se materializa en el Excel para reuniones de comité.

---

## 12. Plan de implementación por fases

**Fase 1 — Seguros, bajo riesgo (1 deploy):**
- AutoFilter en hojas tabulares · Hipervínculo "↩ Portada" · Hoja `README` · Formato `%` y fecha nativo · Congelar 1ª columna en hojas anchas.

**Fase 2 — Fórmulas y validaciones (1–2 deploys):**
- Convertir `Análisis SPSS/R` y `Censo` en **Tablas con nombre**.
- Dashboard KPIs y hojas-resumen → fórmulas `COUNTIF/AVERAGE` vivas (con valor JS de fallback).
- Migrar Bioestadística de rangos fijos a Tablas.
- Validaciones de datos en columnas categóricas.

**Fase 3 — Dashboards (1 deploy):**
- `DASHBOARD_EJECUTIVO` + `DASHBOARD_OPERATIVO` + `ALERTAS_PROA` con formato condicional y semáforos.

**Fase 4 — Power Query (documentación + plantilla):**
- Como el libro ya tiene `Análisis SPSS/R` plano, entregar plantilla .pq que lo ingiera y normalice; instrucciones para refresco.

**Fase 5 — Power BI / SQL / web:**
- El dataset SPSS/R + Codebook ya es ideal. Documentar esquema relacional (paciente → atb → muestra → antibiograma) y un modelo estrella para Power BI.

---

## 13. Checklist para implementar sin romper el archivo

- [ ] **Respaldo:** git commit del `index.html` actual + guardar un .xlsx export de referencia.
- [ ] **Versión duplicada:** trabajar en rama; cada fase = 1 commit reversible.
- [ ] **Documentar:** changelog en `sw.js` + este MD por cada cambio.
- [ ] **Validar fórmulas antes/después:** exportar set de prueba; comparar que cada % vivo == % JS previo.
- [ ] **Comparar resultados:** abrir el .xlsx nuevo y el viejo lado a lado; mismas cifras.
- [ ] **Proteger fórmulas:** marcar hojas de fórmulas como protegidas tras validar.
- [ ] **Probar con casos reales:** 1 paciente, 0 pacientes, paciente sin ATB, MDR, multi-aislamiento.
- [ ] **Confirmar cero pérdida:** las 58 hojas siguen presentes y con su contenido (`grep` de títulos + apertura del libro).
- [ ] **Gate de despliegue:** `node --check` del módulo + pruebas + verificación en vivo (ya en uso).

---

*Generado para StewardMX. Ninguna hoja, columna o fórmula existente se elimina en este plan; todo es aditivo o sustituye frágil-por-robusto con validación de equivalencia.*
