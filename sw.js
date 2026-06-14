// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v339 (Antibiograma — cross-resistencia FQ + HLAR enterococo, EUCAST T12/T13)
//  Sigue la capa de seguridad: js/core/abg-phenotype.js suma 2 reglas interpretativas citadas (EUCAST
//  Expert Rules T12/T13, CMI 2013). (1) quinoloneCrossResistance: la R a la fluoroquinolona MÁS ACTIVA
//  implica R a TODAS — en Gram-negativos cipro-R ⇒ levo/moxi R (regla 13.5); en Gram-positivos levo/moxi-R
//  ⇒ todas R (13.2/13.4), y cipro-R con levo/moxi-S = mutación de primer paso → aviso (13.1/13.3). Produce
//  EDICIONES interpretativas (reportar R por inferencia) — solo sobre lo reportado "S" (la trampa). (2)
//  aminoglycosideSynergy: enterococo con gentamicina no-S → aviso HLAR (confirmar screen MIC>128; si HLAR+
//  se pierde la sinergia β-lactámico+aminoglucósido de la endocarditis enterocócica — regla 12.6). El panel
//  "🧠 Interpretación del motor" añade secciones ✎ Edición interpretativa e ℹ Aviso; ambas se persisten en
//  el campo safety (interpretive/avisos). +2 pruebas (257).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v338 (Antibiograma — capa de SEGURIDAD EUCAST: intrínsecos + excepcionales)
//  Releídas letra por letra las Tablas 1-7 de EUCAST Expert Rules (Leclercq/Cantón, CMI 2013;19:141-160).
//  Nuevo módulo PURO js/core/abg-phenotype.js (citado, testeable, sin estado): (1) intrinsicConflicts =
//  marca la "S engañosa" cuando el organismo es intrínsecamente R (Klebsiella→amp; Proteus/Providencia/
//  Morganella→colistina/tigeciclina/nitrofurantoína; Serratia→colistina; Stenotrophomonas→carbapenémicos;
//  enterococo→todas las cefalosporinas; PAE/Acinetobacter→intrínsecos; OJO: Acinetobacter NO marca
//  amp-sulbactam porque el sulbactam SÍ es activo). (2) exceptionalPhenotypes = alerta probable error de
//  ID/AST (S. aureus vanco/linezolid-R; neumococo carbapenem/glucopéptido-R; estrep β-hemolítico pen-R;
//  E. faecalis amp-R→sospechar E. faecium; PAE/Acinetobacter colistina-R; Enterobacterales no-Proteae
//  carbapenem-R→confirmar carbapenemasa). Se computa y persiste al guardar (campo safety) + alerta roja si
//  hay fenotipo excepcional. NUEVO panel "🧠 Interpretación del motor": mecanismo inferido + confianza +
//  alertas EUCAST, reactivo en la captura del antibiograma. Módulo añadido a SHELL. +3 pruebas (255).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v337 (Motor de antibiograma — carbapenem-R NO enzimático: porinas + eflujo)
//  Tanda 3 leída letra por letra: BOMBAS DE FLUJO (Sun et al, BBRC 2014;453:254-267 — AcrAB-TolC
//  enterobacterias → FQ/cloranfenicol/tetraciclina±β-lactámicos; MexAB-OprM/MexXY P. aeruginosa →
//  FQ+meropenem+aminoglucósidos = patrón multidroga inespecífico) y PORINAS (Mammeri & Skurnik, PLoS
//  Pathog 2025;21:e1012902). Hallazgo rector (Tablas 1-2): la PÉRDIDA DE PORINA SOLA no eleva la MIC de
//  carbapenémicos; con BLEE/AmpC sí → carbapenem-R SIN carbapenemasa (en serie multicéntrica francesa,
//  MÁS frecuente que la carbapenemasa). El ERTAPENEM es el carbapenémico más sensible a la impermeabilidad.
//  detectPhenotypes AHORA: (1) PorinLoss (Enterobacterales) = ertapenem no-S con imipenem Y meropenem S →
//  pérdida de porina + β-lactamasa, no carbapenemasa; (2) OprD_PA = imipenem no-S con meropenem S en
//  P. aeruginosa → pérdida de OprD (imipenem-específica); meropenem-R sugiere eflujo/MBL. elegirTX matiza
//  la rama CRE cuando el patrón es ertapenem-aislado (confirmar mecanismo, tratar BLEE/AmpC). MR4 leído
//  (Ahmed 2023, terapias nuevas) — sin regla S/I/R nueva. +2 pruebas (252).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v336 (Motor de antibiograma — cefoxitina discrimina BLEE vs AmpC)
//  Leídas Bush & Bradford "Interplay between β-lactamases and new BLI" (Nat Rev Microbiol 2019; matriz
//  Ambler↔Bush-Jacoby + inhibidor→enzima: clavulánico/tazo solo BLEE; avibactam=BLEE+AmpC+KPC+OXA-48 no
//  MBL; vaborbactam/relebactam=+KPC no OXA-48/MBL; MBL solo aztreonam-avibactam/cefiderocol) y la review
//  de ESBL (Rahman 2018). Regla clave aprovechando la cefoxitina (añadida en v335): BLEE es cefoxitina-S;
//  AmpC es cefoxitina-R y NO se restaura con clavulanato. detectPhenotypes AHORA: (1) BLEE exige
//  cefoxitina NO-R (la separa de AmpC); (2) AmpC FENOTÍPICA por cefoxitina-R + 3GC no-S → capta AmpC
//  PLASMÍDICA (CMY/DHA/ACT) en E. coli/Klebsiella, no solo la cromosómica por organismo. +1 prueba (250).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v335 (Motor de antibiograma — cefoxitina/eritromicina + MRSA-fox + iMLSb)
//  Leídas letra por letra las 5 piezas que enseñan a leer el antibiograma: EUCAST Expert Rules (CMI
//  2013), AmpC Primer (CID 2019) + las 3 lecturas interpretadas EIMC 2010 (cocos gram+ Torres/Cercenado;
//  enterobacterias Navarro/Miró; no fermentadores Vila/Marco). Paso C del prompt maestro: COMPLETAR el
//  panel. AHORA ABG_ATBS incluye Cefoxitina (fox) y Eritromicina (eri) — antes faltaban y bloqueaban 2
//  reglas. Con ellas: (1) MRSA por CEFOXITINA (el mejor marcador fenotípico de mecA — Torres; antes el
//  código buscaba 'cefoxitin', clave inexistente → no disparaba); (2) nuevo flag iMLSb (clindamicina
//  inducible: eritromicina-R + clindamicina-S → D-test → reportar CLI-R; EUCAST 11.2). El panel es la
//  fuente única → fox/eri se propagan a UI de captura, Vision, Excel y getAbg. +2 pruebas (249).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v334 (Motor de antibiograma — AmpC + BLEE afinada, desde bibliografía)
//  Misión "mejor IA de antibiogramas". Leídas LETRA POR LETRA las 2 piezas rectoras: EUCAST Expert
//  Rules (Leclercq/Cantón CMI 2013;19:141-160) y AmpC Primer (Tamma/Doi/Bonomo CID 2019;69:1446-55).
//  Prompt maestro rector: docs/PROMPT_MAESTRO_ANTIBIOGRAMA.md (LLM solo EXTRAE S/I/R; el mecanismo lo
//  decide el motor determinista, citado, testeable). Primer upgrade a detectPhenotypes:
//  (1) AmpC AHORA se detecta (flag estaba muerto — auditoría 421) por ORGANISMO de alto riesgo
//      (E. cloacae complex, K. aerogenes, C. freundii, S. marcescens; Hafnia/Morganella/Providencia)
//      — EUCAST 9.2 + AmpC Primer; no por cefoxitina (no está en el panel).
//  (2) BLEE afinada (EUCAST 9.1): 3GC no-S + inhibidor-S (amox-clav/amp-sulbactam/pip-tazo) → distingue
//      BLEE de AmpC (inhibidor-R). Sin inhibidor probado, cae al cribado 3GC. +1 prueba (247).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v333 (Refactor clínico #2 — antibiograma acumulado consistente)
//  P2: las dos rutas de captura de antibiograma (ficha p.abg vs subcolección antibiograms[]) podían
//  sesgar los reportes acumulados. Verificado: la PRECEDENCIA ya existía (el Excel incluye p.abg legacy
//  SOLO si el paciente no tiene subcolección → sin doble conteo entre fuentes). Lo que faltaba: el
//  "Resumen epidemiológico por organismo" del Excel calculaba %S/%R sobre _allAislamientos SIN dedup
//  M39 → un paciente con cultivos repetidos sesgaba las tasas. FIX: se deduplica con clsim39Deduplicate
//  (1 por paciente+organismo+muestra) antes del resumen, igual que renderCumAbg (v323); el listado
//  crudo se mantiene completo. Cada aislamiento ahora lleva patientId para deduplicar. +1 prueba (246).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v332 (Refactor clínico — el motor de TX lee el antibiograma estructurado)
//  P2 clínico (el hueco más relevante que quedaba): elegirTX/detectarCombos dependían SOLO de los flags
//  mec_* y de regex sobre el organismo → si nadie marcaba el mecanismo, el motor ignoraba la resistencia
//  que SÍ estaba en el S/I/R y recomendaba un esquema inadecuado. AHORA elegirTX deriva el fenotipo del
//  antibiograma (p.abg) con detectPhenotypes(): los flags moleculares (más específicos) ganan; el
//  fenotipo llena huecos → MRSA (oxa/fox-R), VRE (van-R), ESBL fenotípica van directo a su esquema; la
//  carbapenemasa fenotípica (CRE) va a una rama nueva TX.CRE_PHENO que EXIGE confirmar el mecanismo
//  (KPC vs MBL vs OXA no se distinguen del antibiograma) con opciones por tipo (IDSA 2024). +2 pruebas
//  (245; una ejecuta detectPhenotypes real). El motor ya no es ciego al dato de resistencia capturado.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v331 (Función renal: etiqueta inequívoca CKD-EPI 2021)
//  El Dr. preguntó si la TFG usa la clasificación más actual (Cockcroft es viejo). Confirmado: calcTFG
//  YA calcula CKD-EPI 2021 race-free (Inker NEJM 2021 / NKF-ASN / KDIGO 2024) como TFG primaria con
//  estadios G1-G5; el Cockcroft solo se mostraba al lado para ajuste de dosis ATB. Esta versión hace
//  la etiqueta INEQUÍVOCA: "TFG X mL/min (Gx) [CKD-EPI 2021] · CrCl Y (Cockcroft — solo dosis ATB)".
//  Se mantiene CKD-EPI creatinina (el Dr. eligió no añadir cistatina C). +1 prueba que fija la
//  fórmula CKD-EPI como primaria (243).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v330 (Auditoría QA — seguridad/datos: dispensación auxiliar + camas)
//  (1) marcarDispensadoAux NO tenía gate de rol (cualquiera podía cerrar una dispensación) y guardaba
//  el nombre en `dispensadoPor` (que en confirmarDispensacion es un UID) → auditoría inconsistente.
//  AHORA exige Farmacia/Admin y unifica el esquema (dispensadoPorUid + dispensadoNombre + email).
//  (2) addCama/delCama reescribían el doc completo sobre un CAMAS cargado una sola vez → lost-update
//  entre dos admins (una sala desaparecía). AHORA refrescan CAMAS desde Firestore antes de mutar
//  (_refreshCamas) y exigen rol admin. +2 pruebas (242).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v329 (Auditoría QA — integridad: paciente por voz + vacunación Pre-TX)
//  (1) El paciente creado por dictado de voz guardaba solo `atb` (string) sin atbList/inicio/ingreso
//  → calcDia congelado en "Día 1", 0 DOT, 0 días-paciente. AHORA construye atbList[] + inicio +
//  ingreso (aware/pol derivados del 1er ATB con _clasificarAware). (2) Los selects de vacunación
//  Pre-TX (ptv_) no tenían onchange → no disparaban la persistencia y se perdía el estado vacunal
//  (dato load-bearing pre-TX). AHORA disparan _pretxRecs (debounce de _txSavePretx). +2 pruebas (240).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v328 (Auditoría QA — seguridad clínica: fenotipo ESBL + gate qSOFA ficha)
//  (1) detectPhenotypes marcaba BLEE incluyendo cefepime y contando solo 'R': falso positivo de BLEE
//  (cfp-R apunta a carbapenemasa/AmpC, no a BLEE) → podía inducir carbapenémico innecesario. AHORA
//  el cribado es ['cro','ctaz','azt'] con no-susceptible (R o I), por CLSI. (2) El gate de sepsis
//  (cultivos antes de ATB si qSOFA≥2 en Urgencias) vivía solo en crearSolicitud; un médico evadía la
//  regla solicitando desde la ficha. AHORA crearSolicitudPaciente también aplica el gate. +2 pruebas (238).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v327 (Dictado por voz: cascada de modelos — paridad agenda médica, parte A)
//  Cierra el overhaul de voz. Cloud Function whisperTranscribe: ANTES usaba solo whisper-1; AHORA
//  cascada por precisión gpt-4o-transcribe (~30% menos WER en español médico) → gpt-4o-mini-transcribe
//  → whisper-1 (fallback), temperature 0, prompt médico, con fallback automático por 404/403/400
//  (modelo no disponible para la cuenta). Devuelve `model` usado. Junto con el corrector
//  fonético/Levenshtein del cliente (v326), el dictado iguala las fortalezas de la app de agenda
//  médica. (Cambio server-side; se sube CACHE por trazabilidad.) Requiere deploy de functions.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v326 (Dictado por voz: corrector médico — paridad con agenda médica, parte B)
//  El Dr. pidió que el dictado por voz tenga las fortalezas del sistema de su app de agenda médica.
//  Parte B (cliente): nuevo módulo PURO js/core/medical-voice.js (portado de medical-vocabulary.ts):
//  corrección en 3 capas conservadora — (1) CONFUSIONES_CONOCIDAS (frase completa, errores
//  irrecuperables tipo "septriasona"→ceftriaxona, "plátano pros"→latanoprost), (2) fonética del
//  español (fonetEs: seseo/yeísmo/v↔b…), (3) Levenshtein con umbral por longitud contra vocabulario
//  médico PROA (ATB/antifúngicos/antivirales/ARV/microbiología + comorbilidad). Se aplica a la
//  transcripción ANTES de la extracción. No toca palabras comunes. +4 pruebas que ejecutan el módulo
//  real (236). PENDIENTE parte A (v327): cascada gpt-4o-transcribe→mini→whisper-1 + prompt médico en
//  la Cloud Function whisperTranscribe. js/core/medical-voice.js añadido a SHELL.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v325 (Auditoría QA — Mis-Solicitudes, guard de stock, crash Pre-TX)
//  Tres P2: (1) "Mis Solicitudes" clasificaba retenido_farmacia/sin_stock como RECHAZADAS → el médico
//  creía denegado un ATB solo retenido. Ahora van a "en proceso" y en_almacen cuenta como aprobada.
//  (2) farmaciaConfirmarStock sin guard anti-doble-click → ahora _stockBusy + finally. (3) Las
//  pestañas Pre-TX/Profilaxis del módulo de Trasplante CRASHEABAN si no había paciente seleccionado
//  (deref p.txPretx) → ahora muestran "selecciona un paciente". +3 pruebas (232).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v324 (Auditoría QA — batch de correctitud P2)
//  Tres bugs P2 contenidos: (1) calcDia inflaba los días contando filas de ATB SIN nombre con fecha
//  de inicio → ahora filtra por nombre (consistente con la lógica de suspensión). (2) La analítica
//  2x2 (_anVarBool) comparaba contra acciones inexistentes 'continuar'/'switch-vo' → ahora 'mantener'/
//  'vo' (enum real) → Fisher/χ² ya no salen sesgados a cero. (3) La auto-solicitud de Reserve a
//  Farmacia guardaba como 'antibiotico' el string concatenado de TODOS los ATB → ahora usa el nombre
//  del ATB Reserve REAL (matching de bloqueo + dedup funcionan). +3 pruebas (229).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v323 (Auditoría QA — antibiograma acumulado deduplica por paciente)
//  P1 (último del backlog): renderCumAbg (antibiograma acumulado hospitalario) y su hoja Excel
//  contaban TODOS los aislamientos, incluidos cultivos repetidos del mismo paciente → %S/R y MIC50/90
//  sesgados (un paciente con 5 hemocultivos R dominaba el %R). FIX: cada aislamiento ahora lleva
//  patientId+muestra+fecha y se pasa por clsim39Deduplicate (1 por paciente+organismo+muestra, el
//  primero por fecha) ANTES de calcular — cumple CLSI M39-A5. +2 pruebas (226). Con esto el set de
//  P1 de la auditoría queda cerrado (2 P0 + 17 P1, v312→v323). Backlog: 26 P2 + 17 P3.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v322 (Auditoría QA — FC/DDD solo para Farmacéutico titular)
//  P1: la UI mostraba al Auxiliar de Farmacia los botones "Reco FC" y captura "DDD", pero
//  firestore.rules solo permite escribir al titular (isHospFarmaceuticoTitular = rol 'Farmacéutico')
//  → al Auxiliar le fallaba en SILENCIO ("Missing permissions") creyendo que documentó. Política
//  elegida por el Dr.: ocultar al Auxiliar (alinear UI a las reglas, sin cambio de seguridad). FIX:
//  nuevo flag window._isFarmTitular (admin || rol 'Farmacéutico'); el botón Reco FC y el subtab DDD
//  se gatean/ocultan con él; guardarDDDFarmacia bloquea con mensaje explícito. +1 prueba (224).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v321 (Auditoría QA — retirar dispositivo resuelve su alarma)
//  P1 (fatiga de alarma): _retirarDispositivo solo ponía fechaRetiro, nunca marcaba status:'resuelta'
//  en la alerta24h del dispositivo → el panel se llenaba de alarmas no accionables. FIX: nuevo
//  _resolverAlarmaDispositivo(pid,dispKey) marca la alerta como resuelta; se llama en ambas ramas
//  (legacy cvc/foley + eventos[]). dispKey uniforme 'dispositivo_'+tipo+'_'+id. +1 prueba (223).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v320 (Auditoría QA — DOT por-agente, deja de subcontar combinación)
//  P1 regulatorio: el indicador "DOT" se calculaba con calcDia (1 por PACIENTE = LOT) en vez de
//  calcDOT (1 por AGENTE, NHSN) → 2 ATB × 5 días contaban 5, no 10. Subestimaba el consumo ante
//  CONASABI/comité. FIX: kpis muestra el DOT real (calcDOT); el consumo por-servicio (renderReporte
//  byService + svMap del reporte) acumula con calcDOT([p]); el reporte CONASABI añade una fila de
//  DOT real (NHSN-AUR) junto al LOT; y las métricas por-paciente que decían "DOT promedio" se
//  relabelaron a "Duración promedio (LOT/paciente)" (su número siempre fue LOT, no DOT). El export
//  NHSN-AUR ya usaba calcDOT. +1 prueba (222). Backlog: etiquetas "DOT prom./paciente" en Excel/Word.
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v319 (Auditoría QA — cama/servicio actual en tarjetas, no stale)
//  P1: las tarjetas de solicitud (PROA, Farmacia, almacén, enfermería) imprimían s.cama/s.servicio
//  directos del documento, que se congelan al crear la solicitud. Tras un traslado, el personal
//  leía la ubicación VIEJA y entregaba el ATB al lugar equivocado. FIX: helper _ubicacionSol(s)
//  resuelve cama/servicio ACTUAL desde PACS por patientId (patrón CLAUDE.md #2, ya usado en los
//  helpers WA); aplicado a las 4 tarjetas principales. +1 prueba que lo ejecuta (221).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v318 (Auditoría QA — los CMI de la ficha ya no se descartan)
//  P1: el editor de antibiograma de la FICHA llenaba window._abgMICs (CMI detectados por IA) pero
//  guardar() solo persistía abg:getAbg(), nunca el mic → MIC50/90 hospitalarios sub-poblados pese
//  a "8 MICs detectados". FIX: guardar() construye `mic` desde _abgMICs (keyed por a.k, como el
//  editor de subcolección con _nabgMICs) y `mic` se añade a _blindarCamposClinicos para que no se
//  pierda en ediciones posteriores (igual que abg). +2 pruebas (220).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v317 (Auditoría QA — IAAS cuenta eventos[]/PICC)
//  P1 regulatorio: la vigilancia IAAS (CLABSI/CAUTI) y los días-dispositivo leían SOLO
//  dispositivos.{cvc,foley}.presente (legacy) → la vía principal de enfermería (botón 🩺) y TODO
//  PICC no se contaban: días-dispositivo y tasas falseados a la baja, inválidos ante CONASABI/NHSN.
//  FIX: _devDaysTipos y los contadores CLABSI/CAUTI ahora leen la lista UNIFICADA _dispositivosDe(p)
//  (eventos[] + legacy). El PICC cuenta como acceso CENTRAL junto con el CVC (días-catéter/CLABSI).
//  +1 prueba (218). Reporte: docs/AUDITORIA_QA_2026-06-12.md (backlog: DOT, MIC ficha, dedup M39).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v316 (Auditoría QA — dictado por voz: 4 correcciones de seguridad)
//  El dictado introducía errores clínicos PLAUSIBLES y SILENCIOSOS:
//  (1) ACCIÓN INVERTIDA: selOpt usaba includes() → 'escalar' caía en 'desescalar'. Ahora match
//      EXACTO primero; el includes solo como respaldo.
//  (2) NOMBRE DE ATB perdido: fill() crudo dejaba el <select> vacío para pip-tazo, cefepima,
//      imipenem, cefta-avi, etc. Nuevo _fillAtbNom hace match tolerante contra ATBX (acentos, / -).
//  (3) FRECUENCIA perdida: atb-{i}-frec no existe → el intervalo se descartaba. Ahora se concatena
//      a la dosis ("1g c/8h") sin duplicar.
//  (4) ORGANISMO equivocado: el match por GÉNERO mapeaba krusei/auris→albicans, M.avium→TB,
//      neumococo→pyogenes y disparaba inferirFenotipo() sobre el organismo falso. Ahora exige
//      match de ESPECIE; si no hay match claro, no toca f-org. +2 pruebas (217, una ejecuta selOpt real).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v315 (Auditoría QA — dosis de profilaxis PCP corregida)
//  P1 CLÍNICO (potencial de daño): la profilaxis de Pneumocystis (PCP) recomendaba
//  "TMP-SMX DS 1 tableta VO TID × 3 días/semana" — TID (3 veces/día) es INCOMPATIBLE con
//  "× 3 días/semana" y, tomado literal, da ~3× la dosis profiláctica → toxicidad en
//  inmunodeprimido. Corregido en los 4 lugares (rec principal, tabla resumen, fila Idelalisib,
//  nota nefro) a la forma correcta: DS 1 tableta VO cada 24h (diario) o 3×/semana (L-M-V); la
//  basal renal pasa de "DS BID" a "DS QD". Dapsona/atovacuona (G6PD) quedan intactas. +1 prueba (215).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v314 (Auditoría QA — bloqueo "Total" funcional + sin auto-aprobación)
//  Dos P1 del módulo de bloqueos PROA:
//  (1) La severidad "⛔ Total — solo infectología puede liberar" era DECORATIVA: cualquier
//      farmacéutico/auxiliar podía quitar el bloqueo. AHORA se aplica — liberarBloqueoATB exige
//      _isInfectologo/_isAdmin si severidad==='total', y el botón se oculta a Farmacia en ese caso.
//  (2) Quitar un bloqueo AUTO-APROBABA en lote (Promise.all → status:'aprobado') todas las
//      solicitudes pendientes del ATB, saltándose confirmarRevision. AHORA solo se quita el bloqueo;
//      las solicitudes vuelven al flujo normal de revisión PROA (no se aprueban solas).
//  +2 pruebas (214). Reporte: docs/AUDITORIA_QA_2026-06-12.md
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v313 (Auditoría QA — gate Reserve que no disparaba)
//  P1 de seguridad PROA: las solicitudes creadas fuera de la ficha (crearSolicitud,
//  crearSolicitudPaciente, guardarSolicitudUrgente) NO estampaban aware/pol → en
//  farmaciaLiberarDirecto el gate (aware==='Reserve'||pol==='restringido') no disparaba y un
//  carbapenémico/Reserve podía liberarse para dispensación SIN aprobación PROA. FIX: helper
//  _clasificarAware(nombre) deriva {aware,pol} del catálogo ATBX; las 3 creadoras ahora estampan,
//  y farmaciaLiberarDirecto re-deriva como FAIL-SAFE para solicitudes legacy. De paso:
//  guardarSolicitudUrgente guardaba el ATB en la clave `atb` (no `antibiotico`) → "—" en Farmacia
//  y evadía el bloqueo: ahora estampa ambas. crearSolicitudPaciente añade el `servicio` faltante.
//  +3 pruebas que ejecutan _clasificarAware real (212). Reporte: docs/AUDITORIA_QA_2026-06-12.md
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v312 (Auditoría QA — los 2 P0 de integridad de datos)
//  Auditoría multidisciplinaria (23 agentes) → 67 hallazgos. Esta versión cierra los 2 CRÍTICOS:
//  P0-1 Dispositivos/PICC borrados al guardar: el form reescribía dispositivos.{cvc,foley} y el
//       updateDoc reemplazaba el mapa completo, destruyendo dispositivos.eventos[] (única vía del
//       PICC, registrado por enfermería). FIX: _blindarCamposClinicos ahora CONSERVA eventos[].
//  P0-2 Mes activo en UTC: currentMonth=new Date().toISOString().slice(0,7) saltaba al mes siguiente
//       la noche de fin de mes (MX UTC-6) → censo "vacío" + pacientes en el mes equivocado. FIX:
//       currentMonth se calcula en hora LOCAL. +3 pruebas (209). Reporte: docs/AUDITORIA_QA_2026-06-12.md
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v311 (Censo: dar de alta ya NO exige antimicrobiano)
//  El Dr. pidió quitar el "candado" del ATB. Hay pacientes que ingresan para ABORDAJE/estudio y
//  todavía no llevan antimicrobiano. Antes guardar() bloqueaba el alta si no había ATB (salvo
//  interconsulta/trasplante). AHORA lo único obligatorio es el NOMBRE; el ATB se agrega después.
//  Aplica a TODO el censo (general y trasplante) → se eliminó el candado _esTx y el toast que
//  bloqueaba. Un paciente sin ATB simplemente no cuenta días de DOT. Prueba ALTA actualizada (206).
// ═══════════════════════════════════════════════════════════════
//  StewardMX — Service Worker v310 (Trasplante: el tab Profilaxis se LIGA a la evaluación Pre-TX)
//  Continuación del protocolo ligado. La evaluación Pre-TX ya persiste (v309); AHORA el tab
//  Profilaxis se PRE-CARGA desde ese p.txPretx: al renderizar mapea las serologías capturadas en
//  Pre-TX (pt_/pd_) a sus campos pf_ (CMV R/D, EBV, HBsAg, HBc, HBV-DNA, QFT/TB, Chagas, Toxo,
//  Strongy, Histo, G6PD, CD4) y traduce HCV (Ac+RNA) al esquema del tab. Así dejas de recapturar:
//  evalúas una vez en Pre-TX y la profilaxis aparece sola. +1 prueba TXLINK que ejecuta el bloque
//  real en DOM simulado y verifica el mapeo (206). node --check verde.
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
const CACHE = 'stewardmx-v339';
const SHELL = [
  '/',
  '/index.html',
  '/guia.html',
  '/manifest.json',
  '/js/core/stats.js',
  '/js/core/clinical-days.js',
  '/js/core/magiorakos.js',
  '/js/core/dx-cie10.js',
  '/js/core/medical-voice.js',
  '/js/core/abg-phenotype.js',
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
