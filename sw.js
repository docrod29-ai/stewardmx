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
const CACHE = 'stewardmx-v275';
const SHELL = [
  '/',
  '/index.html',
  '/guia.html',
  '/manifest.json',
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
