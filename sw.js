// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v309 (Trasplante: la evaluación Pre-TX se LIGA al expediente)
//  El Dr. pidió que el módulo sea un protocolo y que las pestañas se liguen. Antes la evaluación
//  Pre-TX (serologías, tipo de TX, VDRL, vacunas) era SOLO-DOM → se perdía al cambiar de paciente.
//  AHORA persiste: window._txSavePretx recoge todos los campos pt_*/pd_*/ptv_* y, con debounce de
//  1.2 s, escribe p.txPretx en el expediente (updateDoc). _renderTxPreTx pre-carga p.txPretx al
//  seleccionar al paciente (con guard _txPretxLoading para no guardar durante la carga). Así la
//  evaluación queda ligada al paciente y disponible en todas las pestañas y entre sesiones.
//  +1 prueba (205). node --check + el motor sigue corriendo en DOM simulado.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v308 (CONSOLIDACIÓN de dos sesiones concurrentes)
//  Dos sesiones de Claude trabajaron el repo a la vez y ambas marcaron v307 (colisión). Este commit
//  unifica AMBOS conjuntos de cambios (árbol combinado, 204 pruebas en verde, ya en prod):
//   A) Trasplante v307 (esta sesión): alta de paciente de trasplante SIN ATB (exento como la
//      interconsulta) + botón "➕ Nuevo paciente de trasplante" en el módulo (window._txNuevoPaciente).
//   B) QA panel 8 expertos v307 (sesión paralela): 13 bugs funcionales (2 botones muertos por
//      JSON.stringify en onclick, 2 XSS, toast err→rojo, imipenem convulsiones, popup-blocker WA,
//      servicio stale en _waTransicion, guard confirmarRevision, fuga de listeners onSnapshot).
//  Se sube a v308 para dejar UNA sola versión coherente. RECOMENDACIÓN: no correr dos sesiones de
//  Claude sobre el mismo repo a la vez (se pisan el árbol de trabajo sin commitear).
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v307 (QA panel 8 expertos: 13 bugs funcionales reparados)
//  Auditoría multiagente + reparación (sin tocar lógica clínica delicada):
//   · 2 BOTONES MUERTOS: "Pasar a nota PROA" y "Guardar labs extraídos" — onclick roto por
//     JSON.stringify() (la comilla doble cerraba el atributo); ahora escapan a &quot; y SÍ ejecutan.
//   · 2 XSS almacenado: notas de laboratorio (faltaba escHtml) y nombre de hospital en panel
//     plataforma (.replace solo escapaba comilla, no backslash → ahora escJs).
//   · toast(): alias 'err' caía en verde-éxito → un fallo real de decisión PROA se veía como
//     éxito; ahora 'err'/'error' → rojo (mapeo centralizado).
//   · Imipenem: advertencia de convulsiones en ClCr<5 era código inalcanzable → ahora visible.
//   · Popup-blocker (CLAUDE.md #5): WA de transición farmacia/almacén/enfermería, FC urgente y
//     resumen PROA usaban window.open tras await → ahora botón flotante click-through (URL endurecida).
//   · _waTransicion/_auxNotificarServicio: el servicio quedaba stale → se resuelve de PACS (como la cama).
//   · confirmarRevision: guard anti-doble-click (try/finally). Decisión "alternativa": valida el ATB.
//   · Fuga de listeners onSnapshot (culture_requests + notificaciones IC) → unsubscribe-antes-de-resuscribir.
//  Pendiente para criterio clínico (NO autofixeado): respuesta de interconsulta oculta por
//  ruta+tipo de nota (NOM-004). 202 pruebas verde + check de sintaxis.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v307 (Trasplante: alta sin ATB + crear paciente desde el módulo)
//  Reporte (Dr. Rodríguez): (1) al dar de alta un paciente en el censo SIN antibiótico no dejaba
//  guardar; un paciente pre-TX en evaluación todavía no lleva ATB. (2) No había forma de agregar
//  un paciente desde el apartado de Trasplante.
//  FIX 1 — guardar(): el paciente con Inmunosupresión=trasplante (o visita trasplante) queda EXENTO
//  del requisito de antimicrobiano (igual que la interconsulta). Toast guía al usuario.
//  FIX 2 — botón "➕ Nuevo paciente de trasplante" en el módulo (window._txNuevoPaciente): abre el
//  formulario del censo con Inmunosupresión=trasplante preseleccionada → al guardar (sin ATB) cae
//  en el dropdown del módulo. Así el flujo queda ligado: crear → aparece → trabajar su protocolo.
//  +2 pruebas (204 total). PENDIENTE propuesto: persistir la evaluación Pre-TX (serologías) al
//  expediente para que NO se pierda al cambiar de paciente/pestaña.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v306 (Trasplante Pre-TX: TODO valor da recomendación + tipo de TX + VDRL)
//  Reporte del Dr. Rodríguez (3 cosas): (1) serologías en POSITIVO que no daban recomendación
//  (EBV, etc.); (2) faltaba elegir el TIPO de trasplante y que module; (3) faltaba VDRL.
//  FIX — _pretxRecs reescrito: cada serología emite para CUALQUIER valor (positivo, negativo/inmune,
//  no realizado → pendiente), no solo la polaridad accionable. Nuevo campo pt_tipotx (renal/hepático/
//  cardíaco/pulmonar/páncreas/intestino/TCMH autólogo/alogénico/haplo/cordón) que MODULA: duración
//  CMV por órgano (riñón/hígado 3-6m, corazón/pulmón 6-12m, TCMH letermovir d100/200), Toxo D+/R-
//  en corazón → pirimetamina, riesgo alogénico vs autólogo. Nuevo campo pt_sifilis (VDRL/RPR).
//  Todo citado (AST IDCOP 2019, AASLD 2023, CDC STI 2021, IDSA). +8 pruebas (202): el motor se
//  ejecuta en DOM simulado (EBV+/Toxo+/VDRL/negativos) y se verifica que el tipo de TX modula.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v305 (Trasplante Fase 2b: nuevo subtab Vacunación)
//  Nuevo subtab "💉 Vacunación" en el módulo de trasplante (_renderTxVacunas): la regla de oro
//  (vivas contraindicadas post-TX → dar ≥4 sem antes; inactivadas/recombinantes seguras, completar
//  pre-TX y reanudar 3-6 m post-TX), lista de vacunas vivas vs inactivadas (incl. Shingrix NO viva,
//  Meningococo para eculizumab/asplenia), contactos del hogar y situaciones especiales. Citado a
//  AST ID CoP (Danziger-Isakov & Kumar 2019), IDSA 2013 (Rubin), AST IDCOP Screening 2019, ACIP/CDC.
//  Contenido estático (sin motor); +2 pruebas que ejecutan _renderTxVacunas y verifican el contenido.
//  194 pruebas verde. Doc rector: docs/PROMPT_MAESTRO_INMUNODEPRIMIDOS.md.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v304 (Trasplante Fase 3: mapa de inmunosupresores — huecos críticos)
//  El mapa de fármacos ya era extenso (~54 agentes). Se cubren 4 huecos de seguridad reales con cita:
//   · Anti-complemento (Eculizumab, Ravulizumab) → enfermedad MENINGOCÓCICA (caja negra FDA/ACIP):
//     vacuna MenACWY+MenB ≥2 sem antes + profilaxis penicilina si ventana no cumplida.
//   · Anti-CD52 (Alemtuzumab) → CMV/HSV/PCP/hongos/Listeria; profilaxis + PCR-CMV semanal.
//   · TNF-α (Infliximab/Adalimumab/Etanercept…) → TB latente 4-10×, HBV/HCV, hongos endémicos.
//   · Anti-integrina (Natalizumab) → LMP por virus JC. [Morrison VA, CID 2014;59(S5):S360-4]
//  Las clases se agregan a inmunoClases → checkbox + tarjeta que ejecuta automáticamente (_txShowInmuno).
//  Prueba nueva: evalúa el array real (59 agentes), exige los críticos + 4 campos completos por agente.
//  192 pruebas verde. Doc rector: docs/PROMPT_MAESTRO_INMUNODEPRIMIDOS.md.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v303 (Trasplante Fase 2: cero selecciones muertas en TODO el módulo)
//  Continúa la Fase 1 (v302). Ahora también ejecutan:
//   · Profilaxis (_txProfRec): pf_ebv (PTLD), pf_hcv (AAD si RNA+), pf_hbv_dna (entecavir) — antes
//     se leían sin usarse. · Word export (_pretxWordExport): Coccidioides, VZV, HSV, HTLV, WNV,
//     HBV-DNA, EBV D+/R-, cultivos del donante (BAL/LCR/hemo/orina) y TB (Rx/PPD/BCG/TB previa)
//     ahora aparecen en el resumen del documento. Todo citado a AST IDCOP 2019 / AASLD 2023.
//   · +6 pruebas: _txProfRec se extrae, se des-escapan sus template-literals y se ejecuta en DOM
//     simulado; el IIFE de pre-TX se compila para validar _pretxWordExport. 191 pruebas verde.
//  Sin archivo nuevo. Doc rector: docs/PROMPT_MAESTRO_INMUNODEPRIMIDOS.md.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v302 (FIX trasplante: serologías Pre-TX que no ejecutaban)
//  BUG (Dr. Rodríguez): en el apartado Trasplante > Pre-Trasplante se seleccionaban anticuerpos
//  (Coccidioides, HTLV, VZV, HSV, HBV-DNA, WNV, cultivos del donante, Rx/PPD/BCG/TB previa) y la
//  recomendación NO los ejecutaba. CAUSA: el formulario ofrecía 17 campos que el motor _pretxRecs
//  nunca leía → selecciones muertas. FIX: cada campo ahora ejecuta con recomendación CITADA a la
//  guía rectora (AST IDCOP — Malinis & Boucher, Clin Transplant 2019;33:e13548). Prueba nueva que
//  EJECUTA _pretxRecs en DOM simulado (15 casos) + guard anti-selección-muerta (FALLA si algún
//  campo de serología queda sin consumir). Fase 1 del plan de inmunodeprimidos (prompt maestro en
//  docs/PROMPT_MAESTRO_INMUNODEPRIMIDOS.md). Sin archivo nuevo.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v301 (SEGURIDAD: cierre de la escalada de rol/status)
//  Cierra al 100% el hallazgo del CI v294. Antes el cliente podía auto-asignarse rol/status
//  privilegiado en su propio doc de usuario. AHORA:
//   · firestore.rules — los helpers isHospPROA/Farmacia/FarmaceuticoTitular/Medico exigen
//     status aprobado/admin (antes solo el rol → un doc auto-creado 'pendiente' con rol:'PROA'
//     daba acceso). El CREATE de users solo permite auto-crearse PENDIENTE, o ADMIN si el
//     registro central te nombra adminUid (fundador), o super-admin. UPDATE no deja cambiar el
//     propio rol/status. La auto-aprobación por código la hace SOLO joinWithCode (Admin SDK).
//   · index.html — el fallback de _unirseConCodigo ya NO escribe status:'aprobado'; deja
//     PENDIENTE y un admin aprueba (degradación segura si la función falla).
//   · tests/firestore-rules.test.mjs — 7 pruebas nuevas de escalada (pendiente OK, aprobado/
//     admin-ajeno DENEGADO, fundador OK, auto-update de rol DENEGADO, rol-sin-status sin acceso).
//  Verificado en el emulador del CI. Reglas desplegadas con firebase deploy --only firestore:rules.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v300 (5º módulo: Dx/CIE-10 → js/core/dx-cie10.js)
//  La taxonomía de diagnósticos infecciosos (DX_CATEGORIES, 40+ categorías regex) + el mapeo a
//  CIE-10 (DX_CIE10, cie10DeDx, interoperabilidad OMS/GLASS) salen de index.html a un módulo PURO.
//  categorizarDx se usa bare en los cálculos EI/BACT/UTI del Excel (por eso se exporta+importa).
//  ANTES se probaba un espejo simplificado; AHORA la función REAL con la taxonomía completa:
//  pielonefritis→N39.0, sepsis→A41.9, CLABSI>bacteriemia→T80.2, no-infeccioso→B99.9. 167 verde.
//  /js/core/dx-cie10.js precacheado en SHELL.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v299 (4º módulo: Magiorakos MDR/XDR/PDR → js/core/magiorakos.js)
//  Sigue la des-monolitización con el clúster de SEGURIDAD CLÍNICA más sensible: la clasificación
//  de multirresistencia. Salen de index.html a js/core/magiorakos.js (módulo PURO): CLSI_CATEGORIES
//  (panel por especie, CLSI M100), _organismToSpeciesKey, _intrinsicResistanceKeys (intrínsecos
//  EUCAST, se EXCLUYEN del cómputo), clasificarMagiorakos (algoritmo Magiorakos 2012). index.html
//  los importa y reexpone en window.* (CLSI_CATEGORIES se usa también bare en la verificación de
//  Pseudomonas). ANTES se probaban vía espejo regex (_mMag); AHORA como función REAL: Klebsiella
//  amp-R sola NO es MDR (intrínseco), E. coli 3 categorías R SÍ. 167 pruebas en verde.
//  /js/core/magiorakos.js precacheado en SHELL; invalidación automática al subir CACHE.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v298 (3er módulo: IC95% Wilson/Poisson → js/core/stats.js)
//  Sigue la des-monolitización. Los IC95% de proporciones (Wilson) y tasas (Poisson/Byar) — la base
//  de la hoja "Bioestadística" nivel publicación — salen de index.html a js/core/stats.js (junto al
//  resto del núcleo estadístico): ci95_wilson, ci95_poisson_rate, fmtPropIC, fmtRateIC. index.html
//  los importa y reexpone en window.*. ANTES no tenían prueba; ahora se verifican contra valores
//  PUBLICADOS (Wilson 5/10 = 23.7–76.3%; Byar 5 eventos/1000 = 1.61–11.67). 169 pruebas en verde.
//  Sin archivo nuevo (stats.js ya estaba en SHELL); invalidación automática al subir CACHE.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v297 (FIX científico: DOT no sub-cuenta por zona horaria)
//  HALLAZGO durante la extracción v296: calcDiaATB parseaba el corte `hoy` (string 'YYYY-MM-DD',
//  como lo pasan calcDOT/dotPer1000 desde el <input type=date>) con new Date(str) = medianoche UTC,
//  mientras las fechas de inicio usan medianoche LOCAL (_parseFecha). En zonas detrás de UTC
//  (México, UTC−6) el DOT de antibióticos ACTIVOS sub-contaba 1 día → la métrica DOT/1000
//  días-paciente del Excel salía sesgada hacia abajo. El "Día N" del paciente NO se afectaba
//  (usa new Date() local). FIX: el corte string se parsea a medianoche LOCAL (consistente). Las
//  entradas Date no cambian. Regresión cubierta: calcDOT(2 ATB × 5 días)=10 determinista en
//  cualquier zona. 162 pruebas en verde. Sin archivos nuevos (solo lógica de js/core/clinical-days.js).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v296 (2º módulo extraído: js/core/clinical-days.js)
//  Sigue la des-monolitización: el cálculo de DÍAS (terapia/estancia/DOT) sale de index.html a un
//  módulo ESM PURO — calcDiaATB, diaATBLabel, calcDia, _fechaADate, calcDiasEstancia,
//  calcDiasPaciente, calcDOT, dotPer1000. index.html lo importa y reexpone en window.* (lo usan
//  onclick y el cálculo de días-dispositivo de IAAS). calcTerapiaCombinada y _blindarCamposClinicos
//  estaban INTERCALADOS y NO se movieron (siguen en index.html, verificado por la salvaguarda).
//  GANANCIA: calcDiaATB, calcDOT y dotPer1000 (DOT NHSN) ahora se prueban como función REAL, no
//  como espejo regex. Las internas calcDiasPaciente/dotPer1000 referencian directo (no vía window)
//  → módulo autocontenido y testeable en Node. Mismo resultado clínico. 163 pruebas en verde.
//  CACHÉ: /js/core/clinical-days.js precacheado en SHELL; invalidación automática al subir CACHE.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v295 (1er módulo extraído del monolito: js/core/stats.js)
//  Primer paso REAL de des-monolitización (deuda de arquitectura): el núcleo estadístico/clínico
//  PURO (chiSquareTest, fisherExact2x2, testAuto2x2, parseMICnum, micStats, cockcroftGault) salió
//  de index.html a js/core/stats.js (módulo ESM). index.html lo importa y reexpone en window.*.
//  GANANCIA CLAVE: las pruebas importan la función REAL (no un espejo regex) — Fisher vs R, MIC50/90,
//  Cockcroft-Gault y χ² se verifican contra el código que DE VERDAD corre. 162 pruebas en verde.
//  CACHÉ: el módulo se precachea en SHELL; la invalidación es automática (activate borra cachés con
//  nombre ≠ CACHE → al subir a v295 se re-descarga fresco). check-syntax escanea js/core/*.js solo.
//  Sin cambio de comportamiento clínico: la misma matemática, ahora aislada y testeable.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v294 (CI en GitHub Actions + cierre de escalada de rol por servidor)
//  · CI: .github/workflows/ci.yml corre en cada push — sintaxis + 161 pruebas + 8 pruebas de
//    SEGURIDAD de firestore.rules en el emulador de Firestore (con Java del runner). package.json
//    con scripts (check/test/test:rules/predeploy/deploy). Canal de STAGING para probar antes de prod.
//  · HALLAZGO del CI: un usuario podía escribir su propio 'rol' (escalada) porque el código de alta
//    se validaba en CLIENTE. FIX: nueva Cloud Function joinWithCode valida el código EN SERVIDOR y
//    asigna el rol con privilegios de servidor. _unirseConCodigo ahora la usa (con fallback al flujo
//    cliente durante la transición, para no romper el alta de nadie).
//  · PENDIENTE (tras migrar clientes): endurecer firestore.rules para BLOQUEAR el cambio de
//    rol/status directo del cliente (diff().affectedKeys) — cierra el hueco al 100%. Documentado
//    en firestore.rules y tests/firestore-rules.test.mjs.
//  Verificación: CI en VERDE (8/8 reglas + 161) + node --check de functions/index.js.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v293 (AUDITORÍA: botones muertos + flag de guardado atascado)
//  Pasada A (handler↔window): 385 handlers vs 676 expuestos. 4 BOTONES MUERTOS corregidos
//  (ReferenceError silencioso porque la función no estaba en window):
//    · Expediente Clínico: _clinicaRenderDetalle + _clinicaRenderTab (cada clic en paciente/pestaña
//      no hacía nada) → expuestos a window.
//    · Asistente de voz "Abrir ↗": llamaba abrirFormPaciente('id') (no expuesta + esperaba objeto)
//      → corregido a abrirEditar('id'); se quitó el try/catch que ocultaba el error.
//    · Censo de hoy: colapsar no re-renderizaba (_renderCensoHoy) → expuesta.
//  GUARD PERMANENTE: prueba node:test que extrae todos los handlers y FALLA si alguno no está en
//  window (previene regresiones de esta clase para siempre).
//  Pasada D (async/UI) — P1 corregido: el GATE de sepsis (Urgencias + amplio espectro) dejaba
//  window._guardarBusy=true al CANCELAR → el botón Guardar quedaba bloqueado hasta recargar. FIX:
//  liberar el flag ANTES de abrir el gate (cualquier cierre ya no bloquea). Otros 5 flags Busy
//  (_perfil/_lab/_mol/_histo/_reco/_sol) verificados: usan release()/finally → OK.
//  Verificado: modelo IA = claude-sonnet-4-6 (regla #10 OK); window.open en handlers/funciones sync
//  (no post-await). 161 pruebas en verde + node --check.
//  PENDIENTE de auditoría (próxima ronda): pasadas B (rutas Firestore), C (flujos end-to-end),
//  E (cálculos vs estándar), F (paridad de roles vs firestore.rules), G (Service Worker).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v292 (FIX micro/cama + nueva capacidad: PROA captura preliminares)
//  BUG (reporte de usuarios): al agregar un preliminar a un paciente YA hospitalizado salía
//  "cama ocupada" y no se enlazaba sobre el mismo paciente. CAUSA: el preliminar se registraba
//  por un flujo de CREACIÓN de paciente (matching frágil → duplicado / choque de cama en guardar()),
//  no como updateDoc sobre el pid existente.
//  FIX (blinda AMBOS caminos):
//    · guardarPacienteMicro: matching robusto (cama+servicio o nombre+servicio) → ADJUNTA las
//      muestras al pid existente (merge) y abre su ficha; nunca crea duplicado.
//    · Formulario micro: la cama ocupada ya NO se deshabilita (se muestra el ocupante).
//    · guardar(): si la cama está ocupada al crear "nuevo", ofrece abrir la ficha de ESE paciente
//      (abrirReporteMicro) en vez de un callejón sin salida (local + chequeo server-side).
//  NUEVA CAPACIDAD: PROA (no solo Micro) captura preliminares — botón "🟡 Capturar preliminar"
//  en la ficha (visible si _isMicrobiologo||_isPROA). Modelo: 1 preliminar activo por cultivo
//  con SELLO DE ORIGEN (preliminar:{fuente:'micro'|'proa',capturadoPor,capturadoRol,fechaCaptura}).
//  Regla: Micro REEMPLAZA al de PROA; si PROA intenta sobre uno de Micro, prevalece Micro. La UI
//  muestra el origen (🔬Micro / ⭐PROA) en chips y resumen.
//  firestore.rules: SIN CAMBIOS (permisos por membresía isHospMember, no por rol → PROA ya puede).
//  159 pruebas en verde + node --check.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v291 (FIX CRÍTICO: agregar/modificar ATB en pacientes existentes)
//  REPORTE (médico, vía Dr. Rodríguez): "no me deja agregar atb a los px que ya estaban".
//  Ningún paciente es estático — debe poder cambiarse el manejo de ATB en cualquier momento.
//  CAUSA RAÍZ (dos defectos del GATE de Reserve en guardar()):
//    1) Usaba PACS.find (frágil) para saber qué ATB ya existían. Si el paciente no estaba en
//       PACS, sus ATB Reserve EXISTENTES se trataban como NUEVOS → exigía re-justificar →
//       BLOQUEABA. FIX: usar el `prev` robusto (re-leído de Firestore, v279).
//    2) El GATE BLOQUEABA el guardado por completo si un ATB Reserve nuevo no tenía 50+ chars.
//       FIX: ya NO bloquea — muestra un confirm ("Guardar igual / justifico después"); el cambio
//       de tratamiento SIEMPRE se puede documentar. Los Reserve sin justificar quedan marcados
//       (reserveJusPendiente) y se listan en el Resumen y en el Excel para seguimiento PROA.
//  REFLEJADO EN: Resumen del paciente (⚠ Justificación Reserve PENDIENTE) y hoja Excel
//    "Historial ATBs" (nueva columna Justificación Reserve: Documentada / ⚠ PENDIENTE).
//  El historial/evolución de ATB ya se mostraba (ACTIVOS + SUSPENDIDOS con fechas) — verificado.
//  152 pruebas en verde + node --check.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v290 (FASE 4.3+4.8: Cockcroft-Gault + días libres de ATB)
//  · Cockcroft-Gault (window.cockcroftGault): aclaramiento de creatinina para ajuste de dosis,
//    mostrado JUNTO a la TFG (CKD-EPI 2021) en el formulario cuando hay peso. Verificado vs
//    cálculo manual (60a/70kg/Cr1.0: 77.8 mL/min hombre, 66.1 mujer).
//  · Hoja "Tasas IAAS": + Días libres de antibiótico (días-paciente − LOT) y % días con
//    exposición antibiótica.
//  · Verificado ya correcto: la columna esr (VSG) del dataset SPSS SÍ se llena (labFirst vsg).
//  148 pruebas en verde + node --check.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v289 (FASE 4: tasas de IAAS por densidad + LOT/DOT)
//  NUEVA HOJA "📉 Tasas IAAS (densidad)" — la métrica que pide NOM-045/NHSN y que faltaba:
//    · CLABSI /1000 días-catéter-central · CAUTI /1000 días-sonda — con IC95% Poisson (Byar).
//    · Días-dispositivo REALES (inserción→retiro/corte) desde dispositivos.cvc/foley.
//    · Razón de utilización de dispositivo (días-disp / días-paciente).
//    · LOT (días de terapia nivel paciente), DOT (cada agente), razón DOT/LOT (redundancia),
//      DOT/1000 días-paciente (NHSN).
//  HONESTIDAD: numeradores CLABSI/CAUTI INFERIDOS (dispositivo presente + dx/bacteriemia) y
//    etiquetados "inferido"; VAP marcado N/D porque no se captura el dispositivo ventilador.
//  Reúsa ci95_poisson_rate/fmtRateIC ya existentes. 142 pruebas en verde + node --check.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v288 (FASE 2: gráficas embebidas en el .xlsx)
//  Las gráficas se renderizan con Chart.js a un <canvas> oculto de alta resolución (2×),
//  se exportan a PNG y se incrustan con ExcelJS.addImage ancladas junto a su tabla:
//    · Dashboard: dona AWaRe + dona Política de antibióticos.
//    · ATB por DOT: barras DOT por antibiótico (top 10).
//    · Microorganismos: barras (top 10).
//  _chartToPNG es browser-only (si Chart/document no existen → null, el Excel sale sin imagen,
//  sin romperse). El EMBEDDING (addImage→media+drawing XML) se verificó en Node: 2 imágenes,
//  2 drawings (una por hoja), datos intactos. 139 pruebas en verde.
//  Nota honesta: el render Chart.js→PNG solo corre en navegador; confírmalo al abrir en Excel.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v287 (FASE 3: hojas listas para análisis + CONTENIDO Portada)
//  4 HOJAS NUEVAS en el .xlsx, calculadas de datos reales y con todo el estilo ExcelJS:
//    · 🧫 WHONET — 1 fila por aislamiento (dedup CLSI M39) con códigos de organismo/espécimen
//      WHONET (OPS/PAHO) + S/I/R por antibiótico → importable a WHONET.
//    · 🌍 GLASS-AMR (OMS) — agregado RIS: espécimen×patógeno×antibiótico con n_tested/R/I/S y %R.
//    · ✅ Control de Calidad — completitud por variable (% presente/faltante), outliers fuera de
//      rango fisiológico (edad/peso/creatinina) y duplicados removidos (dedup CLSI M39).
//    · 💻 Scripts (SPSS-R-Python) — código listo para copiar e importar el dataset.
//  Además: se rellenó la columna CONTENIDO de la Portada (descripción de cada hoja) que había
//    quedado vacía al migrar a ExcelJS. Sello de versión actualizado a v287.
//  Verificación Node con exceljs: hojas presentes, datos intactos (E. coli en WHONET),
//    CONTENIDO con descripciones, sello "Motor: ExcelJS v287". 136 pruebas en verde.
//  PENDIENTE: gráficas embebidas (Chart.js→PNG→addImage) + sparklines (etapa browser-only).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v286 (sello de motor en el .xlsx — diagnóstico "se ve igual")
//  El usuario reportó que el Excel "se ve exactamente igual". Como el path SheetJS de respaldo
//  YA tenía colores, era imposible saber a simple vista qué motor generó el archivo. Ahora:
//    · La Portada del .xlsx estampa "Motor: ExcelJS vXXX — con menús desplegables y semáforos".
//    · El aviso (toast) al descargar dice el motor usado: ExcelJS (con dropdowns) o SheetJS
//      (respaldo, sin dropdowns) y recuerda NO abrirlo en Numbers.
//    · window._xlsxEngine registra el motor; window._APP_VER = versión visible.
//  Diagnóstico del servidor (verificado): CDN ExcelJS responde 200 y define window.ExcelJS;
//    la versión en vivo trae el script + branch. Si el usuario ve "igual" es por (a) app no
//    actualizada o (b) abrir en Numbers. El sello permite distinguirlo sin ambigüedad.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v285 (FASE 1: motor .xlsx migrado a ExcelJS)
//  El .xlsx ahora se genera con ExcelJS (carga por <script src>), ganando NATIVO en Excel:
//    · Listas desplegables (data validation) en columnas categóricas: AWaRe, Política, Acción,
//      Gravedad, Sí/No → el usuario edita con menú sin romper la estructura.
//    · Formato condicional NATIVO (semáforos): Access/S verde, Watch/I ámbar, Reserve/R rojo,
//      ALERTA/CUMPLE/REVISAR; color scale (heatmap) en %R/%S; data bars en DOT/conteos.
//    · Freeze de encabezado (+1ª col en hojas anchas), autofiltro, zebra, anchos, fechas serial,
//      fórmulas vivas del Dashboard, Portada con hipervínculos + "↩ Portada" en cada hoja.
//  CLAVE: consume el MISMO writeData que el path SheetJS → NO se pierde ninguna hoja/columna.
//  SheetJS queda como FALLBACK automático si ExcelJS no cargó. Verificado en Node con exceljs:
//    5 hojas, datos intactos, fórmula viva, y XML con pane/autoFilter/dataValidation/
//    conditionalFormatting/colorScale/dataBar/hyperlinks. 131 pruebas en verde.
//  PENDIENTE (siguientes etapas Fase 1-5): gráficas embebidas (Chart.js→PNG→addImage),
//    sparklines, hojas nuevas WHONET/GLASS/Control de Calidad/Scripts SPSS-R-Python.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v284 (FASE 0 COMPLETA: F0.2 denominadores + F0.3 Magiorakos)
//  · F0.2 DENOMINADORES REALES: días-paciente = Σ(egreso|corte − ingreso) por paciente
//    (calcDiasPaciente/calcDiasEstancia). DOT NHSN correcto (calcDOT: cada agente cuenta) y
//    DOT/1000 días-paciente (dotPer1000, estándar CDC/NHSN-AUR). Añadidos al Dashboard, a la
//    hoja "Servicios" (DOT/1000 por servicio) y a Metadatos (metodología). Se conserva el
//    DOT/100 camas-día como proxy legacy (no se borra). DDD/100 días-cama (ESAC) sin cambios.
//  · F0.3 MAGIORAKOS: _intrinsicResistanceKeys (EUCAST) EXCLUYE resistencia intrínseca del
//    cálculo MDR/XDR/PDR (Klebsiella + solo ampicilina ya NO sale "MDR"). 'I' = no-susceptible
//    per definición publicada Magiorakos (separado del %R del reporte). isMDR() UNIFICADO:
//    usa clasificarMagiorakos cuando hay antibiograma, con respaldo de marcadores fenotípicos.
//  Verificación: 126 pruebas (Fisher vs R, MIC50/90, días-paciente, Magiorakos intrínsecos) verde.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v283 (FASE 0: credibilidad científica del .xlsx PROA)
//  Misión "mejor base de datos PROA/AMS": primero corregir bugs que minan la credibilidad.
//  · DDD WHO ATC/DDD (auditado vs atcddd.fhi.no): Meropenem J01DH02 2→3 g; Colistina
//    J01XB01 0.006→0.24 g (WHO=3 MU ≈ 240 mg CMS, conversión documentada). Resto verificado
//    correcto (cefepime 4g, ampicilina 2g, pip/tazo 14g). Cefotaxima J01DC07→J01DD01 flagged
//    (no se cambia la clave para no orfanar datos históricos; el DDD 4g sí es correcto).
//  · Test EXACTO de Fisher 2×2 (fisherExact2x2) + selección automática (testAuto2x2): para
//    n<30 o esperado<5 ahora hay p-value exacto, no solo χ² aproximado. Verificado vs R.
//  · Antibiograma hospitalario: %S/%I/%R COMPLETO (antes solo %S) + MIC50/MIC90 (micStats,
//    parser de CMI) + regla CLSI M39 (≥30 Reportable / 10-29 Cautela / <10 No reportable).
//  Verificación: 109 pruebas (Fisher vs R, MIC50/90, blindaje) en verde + node --check.
//  PENDIENTE (staged, honesto): F0.2 días-paciente reales, F0.3 Magiorakos intrínsecos,
//    y Fases 1-5 (migración ExcelJS: dropdowns, formato condicional, gráficas, WHONET/GLASS).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v282 (onboarding del equipo: alta con código limpia)
//  · Se quitó el toast de depuración "Código no encontrado en BD" que aparecía durante
//    el alta aunque el código fuera válido (confundía al equipo nuevo).
//  · Si el código tecleado es inválido, ahora aparece un aviso claro en rojo con el código
//    y la indicación de pedir el correcto al administrador (antes quedaba en pantalla muda).
//  Flujo de alta confirmado: Admin genera código por rol (panel) → lo comparte → el médico
//    crea su cuenta (Paso 3 pide 🔑 código) → entra AUTO-APROBADO a su hospital con su rol.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v281 (BLINDAJE ANTI-BORRADO de datos clínicos)
//  MOTIVO (Dr. Rodríguez — caso San Luis): "no puede estárseles borrando" la info.
//  v279 ya tapó el borrado de CULTIVOS (re-lectura de prev + salvaguarda de muestras).
//  v281 GENERALIZA ese blindaje a TODO dato clínico acumulativo con _blindarCamposClinicos():
//    atbList, muestras, comorbilidades, charlsonItems(+score), atbPrevios, abg, abgFoto.
//  REGLA: si el formulario llega SIN un campo (vacío/{}) pero el paciente YA tenía datos,
//    se CONSERVAN los previos en vez de borrarlos, y se AVISA al médico con un toast 🛡
//    (preservación transparente, nunca silenciosa). Campos escalares editables (notas,
//    alergias, dx) NUNCA se tocan. updateDoc reemplaza arrays completos → este era el hueco.
//  Verificación: node --check del módulo + 91 pruebas (13 nuevas del blindaje) en verde.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v267 (auto-actualización fiable + mantenimiento masivo)
//  · FIX buscadores muertos: renderTabla/renderMicro/renderGuias/cargarApp/syncAtbField/
//    _clinicaFiltrar no estaban en window → ReferenceError desde onclick/oninput. Bridge añadido.
//  · FIX e.message sin escapar en innerHTML (4 catch) → escHtml().
//  · FIX AUTO-UPDATE: se quitó skipWaiting() incondicional del install. Cortocircuitaba el
//    banner "Actualizar" y dejaba a los usuarios con versión vieja (debían Cmd+Shift+R).
//    Ahora el SW nuevo espera y el banner (1 clic) lo activa limpio. Mecanismo ya existente
//    en index (updatefound + controllerchange + polling 5min) ahora funciona de verdad.
//  · Escalas objetivas: SOFA/qSOFA en formulario + calculadora 6 componentes; Charlson formal
//    19 ítems; Tabla 1 de ensayo clínico (IC95% Wilson) en Analítica y manuscrito.
//  · Reiniciar hospital (super-admin) + borrado de paciente completo (mes+global+subcols).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v252 (FIX: pacientes no se podían crear + interconsulta fusionada)
//  SÍNTOMA (reportado por el Dr. Rodríguez): al abrir "Nuevo Paciente" salía el error
//   "Cannot access 'tvActual' before initialization" (repetido en el panel de alertas) y no se
//   podía registrar a nadie.
//  CAUSA RAÍZ: en v248/v249 se agregó `const _icTabVisible = tvActual===...` ANTES de la
//   declaración `const tvActual` dentro de abrirNuevo() → temporal-dead-zone (TDZ). Toda la
//   función reventaba al construir el formulario. Los clientes que tenían cacheado ese
//   index.html (v249) seguían viendo el error.
//  FIX: v250-v251 eliminaron _icTabVisible y FUSIONARON la pestaña "Datos de Interconsulta"
//   dentro de la pestaña Paciente (sección #ic-section que solo aparece si tipo=interconsulta).
//   tvActual ahora se declara antes de cualquier uso (verificado: usos en 6496/6499/6935, todos
//   posteriores a la declaración en 6486). v252 sube el nombre de caché para que el activate
//   borre la caché vieja y TODOS los clientes reciban el index.html limpio.
//  NOTA: el handler fetch ya es network-first para index.html → al recargar siempre baja la
//   última versión. Verificación: node --check (index.html módulo + sw.js) + 42 pruebas.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v226 (FIX botón de dictado por voz no aparecía)
//  SÍNTOMA: no había botón de dictado ni forma de iniciarlo.
//  CAUSA RAÍZ (timing): window._vaInit (crea el FAB 🎙️) se DEFINE en el <script type="module">,
//  que es DIFERIDO (corre al final). Pero se LLAMABA desde el 2º <script> regular, que ejecuta
//  ANTES → window._vaInit aún no existía → el try/catch tragaba el error → el FAB nunca se creaba.
//  FIX: llamar _vaInit() DENTRO del módulo, en cargarApp() tras el login (donde la función ya
//  está definida y hay sesión activa). El FAB de voz aparece abajo-derecha (bottom 22px, no choca
//  con los FABs por rol en 84/136px). Verificación: node --check + 42 pruebas.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v225 (FIX Google Sheets — botón roto tras agregar hoja Bioestadística)
//  CAUSA RAÍZ: al agregar la hoja "Bioestadística (IC95%)" (v221), en spreadsheets YA existentes
//  Google la añade AL FINAL. El código tomaba sttl/sids del orden FÍSICO de Google, pero writeData
//  y el formato condicional asumen el orden de sheetDefs → sttl[2] dejó de ser la hoja SPSS y la
//  exportación escribía/formateaba hojas equivocadas o fallaba ("no abre el Google Sheet").
//  FIX: tras agregar hojas faltantes, REORDENAR sttl/sids según sheetDefs (mapa por título), no por
//  el orden físico. Así sttl[i]/sids[i] siempre corresponden a sheetDefs[i]. Modo creación ya
//  estaba bien (se crean en orden). Verificación: node --check + 42 pruebas.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v224 (Dictado por voz médico de ÉLITE + limpieza código muerto)
//  El dictado ("el plus de la app") era frágil. Mejoras de comprensión y de ingeniería de audio:
//   · 🧠 System prompt de INFECTÓLOGO DE ÉLITE: comprende conversación natural del pase de visita
//     (muletillas, datos desordenados, correcciones en voz alta). Interpreta sinónimos coloquiales
//     ("la procal"→procalcitonina, "los blancos"→leucocitos, "la creati"→creatinina), valores
//     hablados ("creatinina de dos punto tres"→2.3, "leucos en dieciocho mil"→18 ×10³), y corrige
//     errores fonéticos de transcripción ("mero pe nem"→meropenem, "bancomicina"→vancomicina).
//   · 🔬 NO confunde labs entre sí (procalcitonina≠PCR, BUN≠creatinina, Na≠K) — usa rango biológico
//     para desambiguar. Integridad científica: si duda, va a "missing", NUNCA inventa valor.
//   · 🎙️ Reconocimiento mejorado: maxAlternatives=3 (mejor captura de términos médicos).
//   · 📊 MEDIDOR DE AUDIO REAL: las barras del waveform reaccionan al volumen del micrófono
//     (AnalyserNode/FFT) — el médico VE que lo está escuchando. AudioContext liberado al parar.
//   · max_tokens 2048→3000 para el prompt enriquecido. labs +lactato +inr.
//   · 🧹 Limpieza: eliminadas funciones muertas (_contactarDemoWA, toggleCultFecha, alias
//     abrirDictado) verificadas con 0 referencias por auditoría estática.
//  Verificación: node --check del módulo + 42 pruebas. El dictado real es _va (Asistente Clínico IA).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v222 (Dx → CIE-10 / ICD-10: interoperabilidad OMS/GLASS)
//  La DX_LIST (616 dx) ya estaba categorizada en 40+ taxonomías. Ahora cada dx se CODIFICA a
//  CIE-10 para reportes estándar internacionales:
//   · DX_CIE10: mapa categoría → código CIE-10 representativo (A41.9 sepsis, J18.9 NAC, N39.0 ITU,
//     A04.7 CDI, I33.0 endocarditis, T80.2 CLABSI…) con descripción oficial.
//   · cie10DeDx(dx): resuelve el código por la categoría MÁS ESPECÍFICA (prioridad: IAAS y
//     síndromes específicos ganan sobre genéricos; CLABSI > bacteriemia). dx no infeccioso →
//     B99.9 (no inventa códigos). Reutiliza categorizarDx (sin duplicar lógica).
//   · Hoja "Análisis SPSS/R": +2 columnas icd10 e icd10_desc. Codebook documentado.
//   · No elimina el dx clínico libre — lo codifica. Base lista para vigilancia GLASS-OMS.
//  Verificación: node --check del módulo + 42 pruebas (6 nuevas CIE-10: mapeo, prioridad, B99.9).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v221 (BD Google Sheets nivel OMS: Bioestadística + IC95%)
//  La base ya tenía ~40 hojas, Codebook, variables SPSS/R y metodología citada (CLSI/Magiorakos).
//  Salto a nivel publicación científica:
//   · 🧮 Nueva hoja "Bioestadística (IC95%)": proporciones clave (AWaRe Access/Watch/Reserve,
//     cultivo, MDR/BLEE/CRE/MRSA/VRE, bacteriemia) con INTERVALO DE CONFIANZA 95% por método de
//     WILSON (correcto para % vs Wald, ref. Brown-Cai-DasGupta 2001). Medidas de tendencia
//     central (edad, SOFA) con media/mediana/DE/Q1/Q3. Densidad de incidencia (DOT/100 cama-día,
//     tasa MDR/1000 pac-día Poisson). Nota metodológica.
//   · FÓRMULAS VIVAS: las celdas son =COUNTIF/=AVERAGE/=MEDIAN/=QUARTILE/=Wilson sobre la hoja
//     "Análisis SPSS/R" → el epidemiólogo edita datos y TODO recalcula. valueInputOption USER_ENTERED.
//   · Helpers nuevos: ci95_wilson, ci95_poisson_rate, fmtPropIC, fmtRateIC (reutilizables en UI).
//  Verificación: node --check del módulo + 36 pruebas (5 nuevas de Wilson). (v227–v250: ver git log)
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v220 (BUGFIX prioritario: días por ATB + guardado de labs)
//  Reportes de testers en producción. Dos correcciones críticas:
//   1) ⏱ DÍAS POR ATB: calcDia(p) solo daba el día de terapia GLOBAL (ATB más antiguo). Faltaba
//      el conteo EXACTO de CADA antimicrobiano. Nueva calcDiaATB(a): cuenta inclusivo desde el
//      inicio de ESE ATB hasta su fin propio (si suspendido) o hasta hoy (si activo).
//   2) 🧪 GUARDADO DE LABORATORIOS robusto: validación de contexto (pid/U/HOSP) antes de escribir;
//      mensajes de error accionables (permiso/offline/otro) en vez de genérico.
//   Verificación: node --check del módulo + 31 pruebas (6 nuevas calcDiaATB).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v219 (FLUJOS: Enfermería conectada + fases canónicas)
//   1) 💉 ENFERMERÍA CONECTADA: el último eslabón (recepción + administración) era inalcanzable.
//      Enfermería ahora entra a Farmacia forzada al subtab "Enfermería".
//   2) 🔄 FASES CANÓNICAS: _faseDeStatus mapea los ~15 estados internos a 5 fases claras
//      (Solicitada→En revisión→Aprobada→En farmacia→Administrada) + rama "no autorizada".
//      NO renombra estados (cero regresión). Verificación: node --check + 25 pruebas.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v218 (AUDITORÍA: fix scope Benchmarking/Geo-Epi/notificaciones)
//   · BUG (regla #4 CLAUDE.md): el 2º <script> regular usaba db/HOSP/PACS/getDocs/getDoc/
//     collection/query/where/escHtml/SOLICITUDES/currentMonth SIN exponerlos → ReferenceError.
//     FIX: bridge window.* al final del módulo (getters para valores reasignables).
//   · Verificación: node --check del módulo completo + 18 pruebas críticas.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v217 (IA clínica profunda + antibiograma acumulado + pruebas)
//   1) 🧠 Consulta IA Infectología (CLSI · PK/PD · desescalada) con claude-sonnet-4-6.
//   2) 📊 Antibiograma acumulado (CLSI M39): mapa local de resistencia por organismo×ATB.
//   3) 🧪 MODULARIZATION.md + tests/critical-flows.test.mjs.
// ═══════════════════════════════════════════════════════════════
//  (v193–v216: historial completo en git log. Resumen: v216 DDD tendencia/auto-llenado;
//   v215 importador laboratorio CSV/Excel; v214 sistema de roles + culture-lock + UCI timer;
//   v204 dispositivos multi-instancia + alarmas PICC; v200 design polish Emil Kowalski;
//   v198 fix scope módulo; v194-195 base epidemiológica AMR + Magiorakos.)
// ═══════════════════════════════════════════════════════════════
const CACHE = 'stewardmx-v309';
const SHELL = [
  '/',
  '/index.html',
  '/guia.html',
  '/manifest.json',
  '/js/core/stats.js',
  '/js/core/clinical-days.js',
  '/js/core/magiorakos.js',
  '/js/core/dx-cie10.js',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable.svg'
];

// ── Instalación: cachear shell ─────────────────────────────────
// v267: SIN skipWaiting incondicional. El SW nuevo espera en "waiting" hasta que el
// médico toque "Actualizar" en el banner (que dispara el mensaje SKIP_WAITING abajo).
// Antes, skipWaiting() incondicional cortocircuitaba el banner y dejaba a los usuarios
// con versión vieja en memoria (tenían que hacer Cmd+Shift+R a mano). Ahora el banner
// es el mecanismo real: 1 clic del médico → actualiza limpio, sin recargar solo en
// medio de una consulta. Primera instalación (sin SW previo) activa normal igual.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(err => console.warn('[SW] Error cacheando shell:', err))
  );
});

// ── Activación: limpiar cachés viejos y tomar control ──────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.info('[SW] Eliminando caché antigua:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Mensaje desde el cliente: el médico aprobó la actualización ─
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    console.info('[SW] Actualización aprobada por el usuario — activando nueva versión');
    self.skipWaiting();
  }
});

// ── Fetch: estrategia según tipo de recurso ─────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Firebase, Google Auth y Google Fonts: dejar pasar SIN interceptar
  // (son dinámicos o tienen su propio sistema de caché)
  if (
    url.includes('firebase') ||
    url.includes('googleapis') ||
    url.includes('gstatic') ||
    url.includes('fonts.goog')
  ) return;

  // index.html y raíz (/): SIEMPRE pedir a la red primero
  // Solo usar caché como fallback si no hay internet.
  // Esto garantiza que el médico siempre tenga el código más reciente.
  const isIndex = url.endsWith('/') || url.endsWith('/index.html');
  if (isIndex) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          // Guardar copia fresca en caché para uso offline
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          return res;
        })
        .catch(() =>
          // Sin internet: servir desde caché o fallback a /index.html
          caches.match(e.request)
            .then(r => r || caches.match('/index.html'))
        )
    );
    return;
  }

  // Resto de assets (js, css, svg, imágenes): Stale-While-Revalidate
  // → Responde inmediato desde caché, actualiza en segundo plano.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request)
        .then(res => {
          if (res && res.status === 200 && res.type !== 'error') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached); // Sin red: usar caché aunque esté viejecita
      return cached || networkFetch;
    })
  );
});
