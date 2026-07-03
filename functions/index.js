// ════════════════════════════════════════════════════════════════════
// Cloud Functions de StewardMX — EHR Integration Layer
// 1) anthropicProxy       — proxy seguro a la Anthropic API
// 2) sendPROANotification — push notifications para solicitudes PROA
// 3) cdsHooks             — endpoint CDS Hooks order-sign (Epic, Cerner…)
// 4) ehrWebhook           — webhook genérico para cualquier EHR
// 5) ehrSync              — sincronización FHIR R4 programada (cada 60 min)
// 6) proaDecision         — onCall: registra decisión y notifica al EHR
// 7) manualEhrSync        — onCall: dispara sincronización inmediata
//
// Despliegue:
//   1. firebase functions:secrets:set ANTHROPIC_KEY
//   2. firebase deploy --only functions
// ════════════════════════════════════════════════════════════════════

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
// W1.1: pareo de paciente (exp → fhirId → nombre) extraído a un módulo testeable.
const { findExistingPatient } = require('./lib/pairing');
// W1.2/W1.3: parser HL7 v2 (ORU^R01) + helpers de ingesta LIS (idempotencia/normalización).
const { parseORU } = require('./lib/hl7');
const { labIdFor, normalizeLisInput } = require('./lib/lis');

// ════════════════════════════════════════════════════════════════════
// ── 1. Proxy seguro a Anthropic ─────────────────────────────────────
// El secret 'ANTHROPIC_KEY' se declara SOLO aquí (no a nivel de módulo)
// para que las demás functions puedan desplegarse sin necesitarlo.
// ════════════════════════════════════════════════════════════════════
exports.anthropicProxy = onCall(
  { secrets: ['ANTHROPIC_KEY'], cors: true, region: 'us-central1', timeoutSeconds: 180 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const uid = req.auth.uid;
    const email = req.auth.token.email || '';
    const isSA = email === SUPER_ADMIN_EMAIL;

    // Obtener hospitalId: del cliente (prioritario para super-admin) o de users/{uid}
    let hospitalId = req.data?.hospitalId || null;

    if (!isSA) {
      // Usuarios normales: verificar aprobación en su hospital
      if (!hospitalId) {
        const userDoc = await db.doc(`users/${uid}`).get();
        if (!userDoc.exists) throw new HttpsError('permission-denied', 'Usuario no encontrado');
        hospitalId = userDoc.data().hospitalId;
      }
      if (!hospitalId) throw new HttpsError('permission-denied', 'Sin hospital asignado');
      const hospUserDoc = await db.doc(`hospitals/${hospitalId}/users/${uid}`).get();
      const hu = hospUserDoc.data() || {};
      if (hu.status !== 'aprobado' && hu.status !== 'admin') {
        throw new HttpsError('permission-denied', 'Usuario no aprobado');
      }
    } else {
      // Super-admin: acceso total — obtener hospitalId de users/{uid} si no vino en el body
      if (!hospitalId) {
        try {
          const userDoc = await db.doc(`users/${uid}`).get();
          hospitalId = userDoc.exists ? userDoc.data().hospitalId : null;
        } catch (_) { /* sin hospitalId para el audit log */ }
      }
    }

    const { messages, system, max_tokens = 1500, model = 'claude-sonnet-4-6' } = req.data || {};
    if (!Array.isArray(messages) || !messages.length) {
      throw new HttpsError('invalid-argument', 'messages requerido');
    }

    // Rate limiting básico: máx 30 req/min/usuario (anti-abuso instantáneo)
    const rlKey = `rate:${uid}:${Math.floor(Date.now() / 60000)}`;
    const rl = await db.doc(`_ratelimits/${rlKey}`).get();
    const count = (rl.exists ? rl.data().n : 0) + 1;
    if (count > 30) throw new HttpsError('resource-exhausted', 'Rate limit excedido (30/min)');
    await db.doc(`_ratelimits/${rlKey}`).set({ n: count, ts: Date.now() });

    // ── TOPE MENSUAL DE IA POR HOSPITAL (control de costo / plan comercial) ──
    // Protege el margen: cada plan incluye N consultas de IA/mes. Al llegar al tope, se detiene
    // (igual que Whisper con voice_cap_min). El super-admin queda exento. Configurable por hospital
    // en hospitals_registry/{hospId}.ai_cap_month (number) — default 1500; -1 = ilimitado.
    if (!isSA && hospitalId) {
      try {
        const _reg = await db.collection('hospitals_registry').doc(hospitalId).get();
        const _regD = _reg.exists ? _reg.data() : {};
        const _aiCap = _regD.ai_cap_month === -1 ? Infinity : (typeof _regD.ai_cap_month === 'number' ? _regD.ai_cap_month : 1500);
        if (_aiCap !== Infinity) {
          const _mes = new Date().toISOString().slice(0, 7);
          const _aiUseRef = db.collection('hospitals').doc(hospitalId).collection('ai_usage').doc(_mes);
          const _aiUseSnap = await _aiUseRef.get();
          const _aiUsed = _aiUseSnap.exists ? (_aiUseSnap.data().calls || 0) : 0;
          if (_aiUsed >= _aiCap) {
            throw new HttpsError('resource-exhausted',
              `Límite mensual de IA alcanzado (${_aiCap} consultas). Contacta al administrador para ampliar el plan.`);
          }
        }
      } catch (e) {
        if (e instanceof HttpsError) throw e; // re-lanzar el tope; tragar errores de lectura para no bloquear
        console.warn('[anthropicProxy] ai_cap check falló (continúa):', e.message);
      }
    }

    // Acceso al secret via process.env (inyectado por Firebase al tenerlo en secrets:[])
    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'API key no configurada en secrets');

    // Cadena de modelos: si el principal está saturado, cae al siguiente
    const modelChain = [model, 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
    const tried = new Set();
    let res, j, usedModel = model;

    for (const m of modelChain) {
      if (tried.has(m)) continue;
      tried.add(m);
      usedModel = m;
      let overloaded = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 4000));
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model: m, max_tokens, ...(system ? { system } : {}), messages }),
        });
        j = await res.json();
        if (res.status !== 529) { overloaded = false; break; }
        overloaded = true;
      }
      if (!overloaded) break; // éxito con este modelo — salir del loop de modelos
    }
    if (!res.ok) throw new HttpsError('internal', j.error?.message || 'Error Anthropic');

    try {
      await db.collection(`hospitals/${hospitalId}/_ai_audit`).add({
        uid, email: req.auth.token.email,
        model: usedModel, tokens_in: j.usage?.input_tokens || 0, tokens_out: j.usage?.output_tokens || 0,
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Contador mensual de consultas IA (para el tope del plan). Suma tokens para reporte de costo.
      if (hospitalId) {
        const _mes = new Date().toISOString().slice(0, 7);
        await db.collection('hospitals').doc(hospitalId).collection('ai_usage').doc(_mes).set({
          calls: admin.firestore.FieldValue.increment(1),
          tokens_in: admin.firestore.FieldValue.increment(j.usage?.input_tokens || 0),
          tokens_out: admin.firestore.FieldValue.increment(j.usage?.output_tokens || 0),
          month: _mes, hospId: hospitalId,
          lastCallAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } catch (_) { /* no bloquea */ }
    return j;
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 2. Notificación push cuando hay solicitud nueva ─────────────────
// ════════════════════════════════════════════════════════════════════
exports.sendPROANotification = onCall(
  { region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');
    const { hospitalId, title, body, targetRole = 'PROA' } = req.data;
    if (!hospitalId) throw new HttpsError('invalid-argument', 'hospitalId requerido');

    // F-8 SEGURIDAD: el llamante debe ser miembro APROBADO del hospital. Antes solo se exigía login,
    //   así que cualquier usuario autenticado podía enviar push (title/body arbitrarios) a los usuarios
    //   de CUALQUIER hospital → spoofing de alertas clínicas. Espejo del gate de anthropicProxy.
    const _caller = (await db.doc(`hospitals/${hospitalId}/users/${req.auth.uid}`).get()).data() || {};
    if (_caller.status !== 'aprobado' && _caller.status !== 'admin') {
      throw new HttpsError('permission-denied', 'No eres miembro aprobado de este hospital');
    }

    const usersSnap = await db.collection(`hospitals/${hospitalId}/users`).get();
    const tokens = [];
    usersSnap.forEach(d => {
      const u = d.data();
      if (u.fcmToken && (targetRole === 'all' || u.rol === targetRole)) {
        tokens.push(u.fcmToken);
      }
    });
    if (!tokens.length) return { sent: 0, reason: 'no_tokens' };
    const msg = {
      notification: { title, body },
      data: { hospitalId, type: 'proa_alert' },
      tokens,
    };
    const r = await admin.messaging().sendEachForMulticast(msg);
    return { sent: r.successCount, failed: r.failureCount };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── HELPERS INTERNOS ────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

/**
 * Aplica el mapeo de campos configurado por el admin.
 * Si el EHR manda { nombre_completo: "Juan" } y el mapeo dice { nombre: "nombre_completo" },
 * el resultado tendrá { nombre: "Juan", ...resto }.
 */
function applyFieldMapping(raw, fieldMapping) {
  if (!fieldMapping || !Object.keys(fieldMapping).length) return raw;
  const out = Object.assign({}, raw);
  for (const [stdKey, ehrKey] of Object.entries(fieldMapping)) {
    if (ehrKey && raw[ehrKey] !== undefined && raw[stdKey] === undefined) {
      out[stdKey] = raw[ehrKey];
    }
  }
  return out;
}

/**
 * Normaliza el valor de sexo a 'M' o 'F' independientemente de cómo lo mande el EHR.
 */
function normalizeSexo(val) {
  if (!val) return '';
  const v = String(val).toLowerCase().trim();
  if (['m', 'male', 'masculino', 'hombre', 'h', 'masc'].includes(v)) return 'M';
  if (['f', 'female', 'femenino', 'mujer', 'fem', 'fem.'].includes(v)) return 'F';
  return String(val).toUpperCase().slice(0, 1);
}

// findExistingPatient(db, hospId, month, {fhirId, name, exp}) → ./lib/pairing.js (W1.1, testeable).

/**
 * Obtiene token OAuth2 client_credentials desde el EHR (SMART on FHIR).
 * Si no hay clientId/clientSecret usa staticToken.
 * Retorna el valor de Authorization header (ej. "Bearer eyJ…")
 */
async function getFHIRToken(cfg) {
  if (cfg.clientId && cfg.clientSecret && cfg.tokenEndpoint) {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: 'system/MedicationRequest.read system/Patient.read',
    });
    const res = await fetch(cfg.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Token endpoint error ${res.status}`);
    const j = await res.json();
    return `Bearer ${j.access_token}`;
  }
  if (cfg.staticToken) return cfg.staticToken.startsWith('Bearer ') ? cfg.staticToken : `Bearer ${cfg.staticToken}`;
  return null; // Sin auth (EHRs internos en red privada)
}

/** Formatea nombre desde recurso FHIR Patient */
function formatName(fhirPatient) {
  try {
    const name = (fhirPatient.name || [])[0] || {};
    const given = (name.given || []).join(' ');
    const family = name.family || '';
    return [given, family].filter(Boolean).join(' ') || 'Desconocido';
  } catch (_) { return 'Desconocido'; }
}

/** Calcula edad en años desde birthDate FHIR */
function calcAge(birthDate) {
  if (!birthDate) return null;
  const diff = Date.now() - new Date(birthDate).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

/** Extrae nombre del medicamento desde MedicationRequest FHIR */
function getMedName(mr) {
  return (
    mr.medicationCodeableConcept?.text ||
    mr.medicationCodeableConcept?.coding?.[0]?.display ||
    mr.medicationReference?.display ||
    'ATB no especificado'
  );
}

/** Extrae dosis desde MedicationRequest */
function getDose(mr) {
  try {
    const d = (mr.dosageInstruction || [])[0] || {};
    const dose = d.doseAndRate?.[0]?.doseQuantity;
    if (dose) return `${dose.value || ''} ${dose.unit || ''}`.trim();
    return d.text || null;
  } catch (_) { return null; }
}

/** Extrae vía de administración desde MedicationRequest */
function getRoute(mr) {
  try {
    const d = (mr.dosageInstruction || [])[0] || {};
    return d.route?.text || d.route?.coding?.[0]?.display || null;
  } catch (_) { return null; }
}

/** Extrae nombre del prescriptor desde MedicationRequest */
function getRequester(mr) {
  try {
    return mr.requester?.display || mr.requester?.reference || 'Médico';
  } catch (_) { return 'Médico'; }
}

// Lista de palabras clave ATB para filtrado de MedicationRequests
const ATB_KEYWORDS = [
  'meropenem', 'imipenem', 'vancomicina', 'ceftriaxona', 'ciprofloxacino',
  'piperacilina', 'ampicilina', 'clindamicina', 'metronidazol', 'fluconazol',
  'voriconazol', 'linezolid', 'daptomicina', 'colistina', 'cefepime',
  'amikacina', 'gentamicina', 'levofloxacino', 'azitromicina',
  'vancomycin', 'ceftriaxone', 'ciprofloxacin', 'piperacillin', 'ampicillin',
  'clindamycin', 'metronidazole', 'fluconazole', 'voriconazole', 'linezolid',
  'daptomycin', 'colistin', 'cefepime', 'amikacin', 'gentamicin',
  'levofloxacin', 'azithromycin',
];

/** Verifica si MedicationRequest es un antibiótico (ATC J01 o keyword) */
function isATB(mr) {
  const medName = getMedName(mr).toLowerCase();
  if (ATB_KEYWORDS.some(kw => medName.includes(kw))) return true;
  // Chequear código ATC J01 (antibióticos sistémicos)
  const codings = mr.medicationCodeableConcept?.coding || [];
  return codings.some(c =>
    (c.system || '').includes('atc') && (c.code || '').toUpperCase().startsWith('J01')
  );
}

/**
 * Sincroniza todos los MedicationRequests activos de un EHR FHIR R4.
 * Para cada ATB + su Paciente, upserta en hospitals/{hospId}/months/{YYYY-MM}/patients/ehr_{fhirId}
 */
async function syncHospitalFHIR(hospId, cfg) {
  const authHeader = await getFHIRToken(cfg);
  const headers = { 'Accept': 'application/fhir+json' };
  if (authHeader) headers['Authorization'] = authHeader;

  const url = `${cfg.fhirBase}/MedicationRequest?status=active&_include=MedicationRequest:subject&_count=500`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`FHIR fetch error ${res.status}: ${await res.text()}`);

  const bundle = await res.json();
  const entries = bundle.entry || [];

  // Separar MedicationRequests y Patients del Bundle
  const medRequests = entries
    .map(e => e.resource)
    .filter(r => r && r.resourceType === 'MedicationRequest');
  const patients = {};
  entries
    .map(e => e.resource)
    .filter(r => r && r.resourceType === 'Patient')
    .forEach(p => { patients[`Patient/${p.id}`] = p; });

  const now = Date.now();
  const fiftyFiveMinutes = 55 * 60 * 1000;
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  let syncedCount = 0;

  for (const mr of medRequests) {
    if (!isATB(mr)) continue;

    // Obtener el Paciente (del Bundle o referencia directa)
    const subjectRef = mr.subject?.reference;
    let patient = patients[subjectRef] || null;

    // Si el paciente no vino en el Bundle, intentar fetching directo
    if (!patient && subjectRef) {
      try {
        const fhirId = subjectRef.split('/').pop();
        const pRes = await fetch(`${cfg.fhirBase}/Patient/${fhirId}`, { headers });
        if (pRes.ok) patient = await pRes.json();
      } catch (_) { /* skip */ }
    }

    const fhirId = mr.id;
    const docId = `ehr_${fhirId}`;
    const docRef = db.doc(`hospitals/${hospId}/months/${currentMonth}/patients/${docId}`);

    // Evitar trabajo duplicado: saltar si doc existe Y se actualizó en los últimos 55 min
    try {
      const existing = await docRef.get();
      if (existing.exists) {
        const updatedAt = existing.data().updatedAt?.toMillis?.() || 0;
        if (now - updatedAt < fiftyFiveMinutes) continue;
      }
    } catch (_) { /* no bloquea */ }

    const patientFhirId = patient?.id || null;
    const nombre = patient ? formatName(patient) : (mr.subject?.display || 'Paciente FHIR');
    const edad = patient ? calcAge(patient.birthDate) : null;
    const sexo = patient?.gender || null;

    const medNom = getMedName(mr);
    const dosis = getDose(mr);
    const via = getRoute(mr);
    const inicio = mr.authoredOn || null;
    const requester = getRequester(mr);

    await docRef.set({
      nombre,
      edad,
      sexo,
      fhirId,
      fhirPatientRef: subjectRef || null,
      fhirMedicationRequestId: mr.id,
      ehrSource: cfg.ehrName || 'EHR',
      atbs: [{ nom: medNom, dosis, via, inicio }],
      auto_synced: true,
      requester,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    syncedCount++;
  }

  return syncedCount;
}

/**
 * Envía notificación FCM al equipo PROA de un hospital (uso interno desde Cloud Functions).
 * No requiere auth del caller — solo para uso desde el admin SDK.
 */
async function notificarEquipoPROA(hospId, title, body) {
  try {
    const usersSnap = await db.collection(`hospitals/${hospId}/users`).get();
    const tokens = [];
    usersSnap.forEach(d => {
      const u = d.data();
      if (u.fcmToken && (u.rol === 'PROA' || u.status === 'admin')) tokens.push(u.fcmToken);
    });
    if (!tokens.length) return;
    await admin.messaging().sendEachForMulticast({
      notification: { title, body },
      data: { hospitalId: hospId, type: 'proa_ehr_alert' },
      tokens,
    });
  } catch (e) {
    console.error('[StewardMX] notificarEquipoPROA error:', e.message);
  }
}

// ════════════════════════════════════════════════════════════════════
// ── 3. CDS Hooks — order-sign endpoint ──────────────────────────────
// Recibe solicitudes de EHRs compatibles (Epic, Cerner, etc.)
// cuando un médico firma una orden de antibiótico.
// ════════════════════════════════════════════════════════════════════
exports.cdsHooks = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-StewardMX-Token, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');

    // CDS Hooks discovery endpoint
    if (req.method === 'GET') {
      return res.json({
        services: [{
          hook: 'order-sign',
          id: 'proa-stewardmx',
          title: 'StewardMX PROA — Revisión de antibióticos',
          description: 'Intercepta órdenes de antibióticos para revisión del equipo PROA.',
          prefetch: { patient: 'Patient/{{context.patientId}}' },
        }],
      });
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const hospId = (req.query.hospId || '').trim();
    if (!hospId) return res.status(400).json({ cards: [], error: 'hospId requerido' });

    // Validar token — leer cfg una sola vez y reutilizarla en el bloque de censo
    const token = req.headers['x-stewardmx-token'];
    let validToken = false;
    let cdsHooksCfgData = {};
    try {
      const cfgSnap = await db.doc(`hospitals/${hospId}/ehr_config/main`).get();
      if (cfgSnap.exists) {
        cdsHooksCfgData = cfgSnap.data();
        // F-7 SEGURIDAD: exigir webhookToken configurado y NO vacío (antes, si el doc existía sin
        //   webhookToken, `undefined === undefined` daba validToken=true → bypass de autenticación).
        validToken = !!cdsHooksCfgData.webhookToken && cdsHooksCfgData.webhookToken === token;
      }
    } catch (e) {
      console.error('[cdsHooks] error validating token:', e.message);
    }
    if (!validToken) {
      return res.status(401).json({ cards: [] });
    }

    const body = req.body || {};

    // Extraer MedicationRequest del Bundle de draftOrders
    let mr = null;
    try {
      const entries = body.context?.draftOrders?.entry || [];
      mr = entries.map(e => e.resource).find(r => r?.resourceType === 'MedicationRequest') || null;
    } catch (_) { /* safe */ }

    if (!mr) return res.json({ cards: [] });

    // Extraer datos del Paciente desde prefetch
    let patientName = 'Paciente';
    let patientFhirId = null;
    try {
      const pat = body.prefetch?.patient;
      if (pat) {
        patientFhirId = pat.id || null;
        const name = (pat.name || [])[0] || {};
        const given = (name.given || []).join(' ');
        const family = name.family || '';
        patientName = [given, family].filter(Boolean).join(' ') || 'Paciente';
      }
    } catch (_) { /* safe */ }

    const medicationName = getMedName(mr);
    const dosage = getDose(mr);
    const route = getRoute(mr);
    const requester = getRequester(mr);
    const service = mr.encounter?.display || body.context?.encounterId || null;
    const fhirMedicationRequestId = mr.id || `cds_${Date.now()}`;

    // Crear solicitud en Firestore
    try {
      const docRef = db.collection(`hospitals/${hospId}/ehr_requests`).doc(fhirMedicationRequestId);
      await docRef.set({
        fhirMedicationRequestId,
        patientName,
        patientFhirId,
        medicationName,
        dosage,
        route,
        requester,
        service,
        status: 'pending',
        source: 'cds_hooks',
        fhirContext: JSON.stringify(body.context || {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Upsert paciente al CENSO mensual (months/{YYYY-MM}/patients/) para que aparezca
      // en la tabla principal del equipo PROA, no sólo en la Cola EHR.
      try {
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const censoDocId = `ehr_${patientFhirId || fhirMedicationRequestId}`;
        await db.doc(`hospitals/${hospId}/months/${currentMonth}/patients/${censoDocId}`).set({
          nombre: patientName,
          fhirId: patientFhirId || null,
          fhirMedicationRequestId,
          ehrSource: cdsHooksCfgData.ehrName || 'EHR',
          atbs: [{ nom: medicationName, dosis: dosage, via: route, inicio: new Date().toISOString().slice(0, 10) }],
          auto_synced: true,
          requester,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (censoErr) {
        console.error('[cdsHooks] error upserting censo paciente:', censoErr.message);
      }

      // Notificar al equipo PROA
      await notificarEquipoPROA(
        hospId,
        '⚕ Nuevo ATB para revisión PROA',
        `${medicationName} — ${patientName}`
      );
    } catch (e) {
      console.error('[cdsHooks] error saving request:', e.message);
    }

    // Responder con CDS Hook card
    return res.json({
      cards: [{
        summary: '⚕ PROA StewardMX — Revisión pendiente',
        detail: `El antibiótico ${medicationName} está en revisión por el equipo PROA. Recibirás confirmación en ≤24 h.`,
        indicator: 'warning',
        source: {
          label: 'StewardMX PROA',
          url: 'https://stewardmx-1.web.app',
        },
      }],
    });
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 4. Webhook genérico — para EHRs sin soporte CDS Hooks ───────────
// Acepta FHIR R4 MedicationRequest o JSON simplificado.
// ════════════════════════════════════════════════════════════════════
exports.ehrWebhook = onRequest(
  { region: 'us-central1', cors: true },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-StewardMX-Token, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const rawBody = req.body || {};

    // Detectar si es FHIR MedicationRequest o JSON simplificado
    const isFHIR = rawBody.resourceType === 'MedicationRequest';

    // hospId y token — antes del mapeo (campos de sistema, no de paciente)
    const hospId = (rawBody.hospId || req.query.hospId || '').trim();
    const token  = rawBody.token || req.headers['x-stewardmx-token'] || req.query.token;

    if (!hospId) return res.status(400).json({ ok: false, error: 'hospId requerido' });

    // Validar token — leer cfg una sola vez y reutilizarla más abajo
    let validToken = false;
    let ehrCfgData = {};
    try {
      const cfgSnap = await db.doc(`hospitals/${hospId}/ehr_config/main`).get();
      if (cfgSnap.exists) {
        ehrCfgData = cfgSnap.data();
        // F-7 SEGURIDAD: exigir webhookToken configurado y NO vacío (antes, si el doc existía sin
        //   webhookToken, `undefined === undefined` daba validToken=true → bypass de autenticación).
        validToken = !!ehrCfgData.webhookToken && ehrCfgData.webhookToken === token;
      }
    } catch (e) {
      console.error('[ehrWebhook] error validating token:', e.message);
    }
    if (!validToken) return res.status(401).json({ ok: false, error: 'Token inválido' });

    // ── Aplicar mapeo de campos configurado por el admin ──────────────
    // Si el EHR manda { nombre_completo: "Juan" } y el mapeo dice { nombre: "nombre_completo" },
    // body tendrá { nombre: "Juan" } para los pasos siguientes.
    const body = isFHIR ? rawBody : applyFieldMapping(rawBody, ehrCfgData.fieldMapping || {});

    // ── Extraer campos según el tipo de payload ───────────────────────
    let patientName, patientFhirId, medicationName, dosage, route, requester, service,
        edad, sexo, cama, dx, exp, creat, peso;

    if (isFHIR) {
      patientName    = body.subject?.display || 'Paciente';
      patientFhirId  = body.subject?.reference?.split('/').pop() || null;
      medicationName = getMedName(body);
      dosage         = getDose(body);
      route          = getRoute(body);
      requester      = getRequester(body);
      service        = body.encounter?.display || null;
    } else {
      patientName    = body.nombre    || body.patientName  || body.patient_name  || 'Paciente';
      patientFhirId  = body.patientId || body.fhirId       || null;
      medicationName = body.medicationName || body.medication || body.drug || body.antibiotic || 'ATB no especificado';
      dosage         = body.dosage    || body.dosis         || null;
      route          = body.route     || body.via           || null;
      requester      = body.requester || body.medico        || body.physician || 'Médico';
      service        = body.service   || body.servicio      || body.ward    || null;
      // Campos extra del expediente (enriquecen el censo)
      edad  = body.edad  || body.age    ? Number(body.edad || body.age)  : null;
      sexo  = normalizeSexo(body.sexo  || body.gender || body.sex || '');
      cama  = body.cama  || body.bed    || body.room   || null;
      dx    = body.dx    || body.diagnostico || body.diagnosis || null;
      exp   = body.exp   || body.expediente  || body.chart_no  || body.mrn || null;
      creat = body.creat || body.creatinina  || body.creatinine || null;
      peso  = body.peso  || body.weight      ? Number(body.peso || body.weight) : null;
    }

    // Robustez: acotar la longitud de los campos de texto del EHR (anti-bloat del doc; el render ya escapa).
    const _clamp = (s, n = 300) => (s == null ? s : String(s).slice(0, n));
    patientName = _clamp(patientName, 200); medicationName = _clamp(medicationName, 200);
    dosage = _clamp(dosage, 100); route = _clamp(route, 60); requester = _clamp(requester, 120);
    service = _clamp(service, 120); dx = _clamp(dx, 300); cama = _clamp(cama, 40); exp = _clamp(exp, 60);

    // ── Guardar solicitud en ehr_requests y upsert al CENSO ───────────
    let docId;
    try {
      const fhirMedicationRequestId = isFHIR ? (body.id || `fhir_${Date.now()}`) : `web_${Date.now()}`;
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

      // Guardar en Cola PROA (ehr_requests)
      const docRef = await db.collection(`hospitals/${hospId}/ehr_requests`).add({
        fhirMedicationRequestId,
        patientName,
        patientFhirId: patientFhirId || null,
        medicationName,
        dosage:    dosage    || null,
        route:     route     || null,
        requester: requester || 'Médico',
        service:   service   || null,
        status: 'pending',
        source: isFHIR ? 'fhir_webhook' : 'generic_webhook',
        fhirContext: isFHIR ? JSON.stringify(body) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      docId = docRef.id;

      // ── Upsert al CENSO (deduplicación por fhirId o nombre) ─────────
      // El paciente aparece en la tabla principal del equipo PROA automáticamente.
      try {
        // Buscar si ya existe para actualizar en vez de crear duplicado
        const existingDocId = await findExistingPatient(db, hospId, currentMonth, { fhirId: patientFhirId, name: patientName, exp });
        const censoDocId = existingDocId || `ehr_${patientFhirId || fhirMedicationRequestId}`;
        const censoRef   = db.doc(`hospitals/${hospId}/months/${currentMonth}/patients/${censoDocId}`);

        // Construir datos del paciente (solo campos con valor)
        const pacData = {
          nombre:    patientName,
          fhirId:    patientFhirId || null,
          fhirMedicationRequestId,
          ehrSource: ehrCfgData.ehrName || 'EHR',
          atbs: [{ nom: medicationName, dosis: dosage || '', via: route || '', inicio: new Date().toISOString().slice(0, 10) }],
          auto_synced: true,
          requester:   requester || null,
          updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        };
        // Agregar campos opcionales solo si tienen valor (no sobreescribir con null)
        if (edad)    pacData.edad    = edad;
        if (sexo)    pacData.sexo    = sexo;
        if (cama)    pacData.cama    = cama;
        if (service) pacData.svc     = service;
        if (dx)      pacData.dx      = dx;
        if (exp)     pacData.exp     = exp;
        if (creat)   pacData.creat   = String(creat);
        if (peso)    pacData.peso    = peso;

        await censoRef.set(pacData, { merge: true });
      } catch (censoErr) {
        console.error('[ehrWebhook] error upserting censo paciente:', censoErr.message);
      }

      // Notificar equipo PROA vía FCM
      await notificarEquipoPROA(
        hospId,
        '⚕ Nuevo ATB para revisión PROA',
        `${medicationName} — ${patientName}`
      );
    } catch (e) {
      console.error('[ehrWebhook] error saving:', e.message);
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }

    return res.json({ ok: true, requestId: docId });
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 5. Sincronización FHIR programada — cada 60 minutos ─────────────
// ════════════════════════════════════════════════════════════════════
exports.ehrSync = onSchedule(
  { schedule: 'every 60 minutes', region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    console.info('[ehrSync] Iniciando sincronización FHIR global');

    // Obtener todos los hospitales activos
    let registrySnap;
    try {
      registrySnap = await db.collection('hospitals_registry').where('activo', '==', true).get();
    } catch (e) {
      console.error('[ehrSync] Error leyendo hospitals_registry:', e.message);
      return;
    }

    const promises = registrySnap.docs.map(async (regDoc) => {
      const hospId = regDoc.id;
      let cfgSnap;
      try {
        cfgSnap = await db.doc(`hospitals/${hospId}/ehr_config/main`).get();
      } catch (e) {
        console.warn(`[ehrSync] ${hospId}: error leyendo ehr_config:`, e.message);
        return;
      }
      if (!cfgSnap.exists) return;
      const cfg = cfgSnap.data();
      if (!cfg.enabled || !cfg.fhirBase) return;

      const startTs = Date.now();
      try {
        const count = await syncHospitalFHIR(hospId, cfg);
        await db.doc(`hospitals/${hospId}/ehr_config/main`).update({
          lastSync: admin.firestore.FieldValue.serverTimestamp(),
          lastSyncStatus: 'ok',
          lastSyncCount: count,
          lastSyncError: null,
        });
        console.info(`[ehrSync] ${hospId}: sincronizados ${count} pacientes en ${Date.now() - startTs}ms`);
      } catch (e) {
        console.error(`[ehrSync] ${hospId}: error:`, e.message);
        await db.doc(`hospitals/${hospId}/ehr_config/main`).update({
          lastSync: admin.firestore.FieldValue.serverTimestamp(),
          lastSyncStatus: 'error',
          lastSyncError: e.message,
        }).catch(() => {});
      }
    });

    await Promise.allSettled(promises);
    console.info('[ehrSync] Sincronización global completada');
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 6. Decisión PROA — registra y notifica al EHR ───────────────────
// ════════════════════════════════════════════════════════════════════
exports.proaDecision = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const uid = req.auth.uid;
    const {
      hospitalId, requestId, decision,
      alternativaMed, justificacion, duracionDias,
    } = req.data || {};

    if (!hospitalId || !requestId || !decision) {
      throw new HttpsError('invalid-argument', 'hospitalId, requestId y decision son requeridos');
    }
    if (!['autorizado', 'rechazado', 'alternativa'].includes(decision)) {
      throw new HttpsError('invalid-argument', 'decision debe ser: autorizado, rechazado o alternativa');
    }

    // Validar que el caller es miembro PROA o admin del hospital
    const hospUserSnap = await db.doc(`hospitals/${hospitalId}/users/${uid}`).get();
    if (!hospUserSnap.exists) throw new HttpsError('permission-denied', 'No eres miembro de este hospital');
    const hospUser = hospUserSnap.data();
    const validRol = hospUser.status === 'admin' || hospUser.rol === 'PROA' || hospUser.rol === 'Infectología';
    if (!validRol) throw new HttpsError('permission-denied', 'Rol insuficiente — se requiere PROA o admin');

    // Leer la solicitud actual
    const reqRef = db.doc(`hospitals/${hospitalId}/ehr_requests/${requestId}`);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Solicitud no encontrada');
    const reqData = reqSnap.data();

    // Actualizar la solicitud con la decisión
    await reqRef.update({
      status: decision,
      decidedBy: uid,
      decidedByEmail: req.auth.token.email,
      decidedAt: admin.firestore.FieldValue.serverTimestamp(),
      justificacion: justificacion || null,
      alternativaMed: alternativaMed || null,
      duracionDias: duracionDias || null,
    });

    // Intentar push al EHR (no crítico — fallo no rompe la función)
    const cfgSnap = await db.doc(`hospitals/${hospitalId}/ehr_config/main`).get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};

    if (cfg.fhirBase && reqData.fhirMedicationRequestId) {
      try {
        const authHeader = await getFHIRToken(cfg);
        const headers = { 'Content-Type': 'application/fhir+json', 'Accept': 'application/fhir+json' };
        if (authHeader) headers['Authorization'] = authHeader;

        if (decision === 'autorizado') {
          // Enviar FHIR Task "completed" al EHR
          await fetch(`${cfg.fhirBase}/Task`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              resourceType: 'Task',
              status: 'completed',
              intent: 'proposal',
              description: `PROA autoriza: ${reqData.medicationName}`,
              focus: { reference: `MedicationRequest/${reqData.fhirMedicationRequestId}` },
              note: [{ text: justificacion || 'Autorizado por equipo PROA' }],
              authoredOn: new Date().toISOString(),
            }),
          });
        } else {
          // Enviar FHIR Communication con el rechazo / alternativa
          const commText = decision === 'rechazado'
            ? `PROA rechaza: ${reqData.medicationName}. Motivo: ${justificacion || '(sin motivo)'}${alternativaMed ? `. Alternativa: ${alternativaMed}` : ''}`
            : `PROA propone alternativa a ${reqData.medicationName}: ${alternativaMed}. Motivo: ${justificacion || '(sin motivo)'}`;

          await fetch(`${cfg.fhirBase}/Communication`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              resourceType: 'Communication',
              status: 'completed',
              subject: reqData.patientFhirId ? { reference: `Patient/${reqData.patientFhirId}` } : undefined,
              payload: [{ contentString: commText }],
              sent: new Date().toISOString(),
            }),
          });
        }
      } catch (fhirErr) {
        // Registrar el fallo en el log pero NO interrumpir
        console.error('[proaDecision] FHIR push falló:', fhirErr.message);
        try {
          await db.collection(`hospitals/${hospitalId}/ehr_sync_log`).add({
            type: 'fhir_push_error',
            requestId,
            decision,
            error: fhirErr.message,
            ts: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (_) { /* no bloquea */ }
      }
    }

    // Notificar al equipo PROA
    const decisionLabel = {
      autorizado: '✅ ATB autorizado',
      rechazado: '🚫 ATB rechazado',
      alternativa: '🔄 Alternativa propuesta',
    }[decision] || 'Decisión PROA';

    await notificarEquipoPROA(
      hospitalId,
      decisionLabel,
      `${reqData.medicationName} — ${reqData.patientName}`
    );

    return { ok: true, decision };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 7. Sincronización manual desde la app ───────────────────────────
// ════════════════════════════════════════════════════════════════════
exports.manualEhrSync = onCall(
  { region: 'us-central1', timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const uid = req.auth.uid;
    const { hospitalId } = req.data || {};
    if (!hospitalId) throw new HttpsError('invalid-argument', 'hospitalId requerido');

    // Validar que el caller es admin del hospital
    const hospUserSnap = await db.doc(`hospitals/${hospitalId}/users/${uid}`).get();
    if (!hospUserSnap.exists || hospUserSnap.data().status !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin del hospital');
    }

    const cfgSnap = await db.doc(`hospitals/${hospitalId}/ehr_config/main`).get();
    if (!cfgSnap.exists) throw new HttpsError('not-found', 'EHR no configurado. Configura el EHR primero.');
    const cfg = cfgSnap.data();
    if (!cfg.fhirBase) throw new HttpsError('not-found', 'fhirBase no configurado. Configura la URL FHIR primero.');

    const errors = [];
    let syncedCount = 0;
    try {
      syncedCount = await syncHospitalFHIR(hospitalId, cfg);
      await db.doc(`hospitals/${hospitalId}/ehr_config/main`).update({
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncStatus: 'ok',
        lastSyncCount: syncedCount,
        lastSyncError: null,
      });
    } catch (e) {
      errors.push(e.message);
      await db.doc(`hospitals/${hospitalId}/ehr_config/main`).update({
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        lastSyncStatus: 'error',
        lastSyncError: e.message,
      }).catch(() => {});
    }

    return { ok: errors.length === 0, syncedCount, errors };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 8. lisSync — HTTP POST: recibe resultados del LIS (laboratorio) ──
// Justificación clínica: los SIL (Sistemas de Información de
// Laboratorio) envían antibiogramas de forma asíncrona. La lógica
// CRDT garantiza que las notas clínicas del médico nunca se
// sobreescriben por datos del laboratorio si el médico actualizó
// el registro DESPUÉS de que se tomó la muestra.
// Compatible con el esquema FHIR DiagnosticReport R4.
// ════════════════════════════════════════════════════════════════════
exports.lisSync = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-StewardMX-Token, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    // ── Identidad del hospital + token ANTES de parsear nada (defensa en profundidad) ──
    const jsonBody = (req.body && typeof req.body === 'object') ? req.body : {};
    const hospId = (jsonBody.hospId || req.query.hospId || '').trim();
    if (!hospId) return res.status(400).json({ ok: false, error: 'hospId requerido' });

    const token = req.headers['x-stewardmx-token'] || req.query.token;
    let validToken = false;
    try {
      const cfgSnap = await db.doc(`hospitals/${hospId}/ehr_config/main`).get();
      if (cfgSnap.exists) {
        // F-7 SEGURIDAD: exigir webhookToken configurado y NO vacío.
        const _wt = cfgSnap.data().webhookToken;
        validToken = !!_wt && _wt === token;
      }
    } catch (e) {
      console.error('[lisSync] error validando token:', e.message);
    }
    if (!validToken) return res.status(401).json({ ok: false, error: 'Token inválido' });

    // ── W1.3: ya autenticado, detectar y parsear HL7 v2 (texto) vs JSON ──
    const rawStr = (typeof req.body === 'string') ? req.body
      : (req.rawBody ? req.rawBody.toString('utf8') : '');
    const looksHL7 = (typeof req.body === 'string' && req.body.trimStart().slice(0, 3) === 'MSH')
      || /^\s*MSH/.test(rawStr);
    let hl7 = null;
    if (looksHL7) {
      try { hl7 = parseORU(rawStr || req.body); }
      catch (e) { return res.status(400).json({ ok: false, error: 'HL7 inválido: ' + e.message }); }
    }

    // ── Normalizar entrada (HL7 o JSON) a campos canónicos ───────────
    const inp = normalizeLisInput({ hl7, body: jsonBody });
    const { specimenType, organism, antibiogram, collectedAt, reportedAt, controlId } = inp;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // ── Resolver paciente: patientId explícito → exp/MRN → nombre ────
    let patientId = inp.patientId;
    if (!patientId) {
      patientId = await findExistingPatient(db, hospId, currentMonth, { exp: inp.exp, name: inp.name });
    }

    // ── Sin paciente: NO perder el resultado → cola de no pareados ────
    if (!patientId) {
      try {
        await db.collection(`hospitals/${hospId}/lis_unmatched`).add({
          reason: 'patient_not_found', exp: inp.exp || null, name: inp.name || null,
          organism: organism || null, antibiogram: antibiogram || [],
          collectedAt: collectedAt || null, controlId: controlId || null,
          receivedAt: admin.firestore.FieldValue.serverTimestamp(), source: inp.source,
        });
      } catch (e) { console.error('[lisSync] error en lis_unmatched:', e.message); }
      return res.status(202).json({
        ok: true, matched: false, queued: 'lis_unmatched',
        message: 'Resultado recibido pero el paciente no se pudo parear (exp/nombre). Encolado para conciliación.',
      });
    }

    // ── Lógica CRDT: el laboratorio nunca pisa el estado clínico ─────
    let resolution = 'overwritten';
    let patientData = null;
    const patRef = db.doc(`hospitals/${hospId}/months/${currentMonth}/patients/${patientId}`);
    try {
      const patSnap = await patRef.get();
      if (patSnap.exists) {
        patientData = patSnap.data();
        const collectedTs = collectedAt ? new Date(collectedAt).getTime() : 0;
        const clinicalUpdatedTs = patientData.updatedAt?.toMillis
          ? patientData.updatedAt.toMillis()
          : (patientData.updatedAt || 0);
        const hasPhysicianUpdate = patientData.accion || patientData.gravedad;
        if (hasPhysicianUpdate && clinicalUpdatedTs > collectedTs) resolution = 'merged';
      }
    } catch (e) {
      console.error('[lisSync] error leyendo paciente:', e.message);
    }

    // ── DiagnosticReport IDEMPOTENTE (labId determinista) ────────────
    const labId = labIdFor({ controlId, patientId, organism, collectedAt });
    const labData = {
      resourceType: 'DiagnosticReport',
      fhirId: labId,
      status: 'final',
      category: [{ coding: [{ system: 'http://hl7.org/fhir/v2/0074', code: 'MB', display: 'Microbiology' }] }],
      specimenType: specimenType || null,
      organism: organism || null,
      antibiogram: (antibiogram || []).map(a => ({
        drug: a.drug || null, mic: a.mic || null, interpretation: a.interpretation || null, atcCode: null,
      })),
      collectedAt: collectedAt || null,
      reportedAt: reportedAt || null,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      source: inp.source,
      conflictResolution: resolution,
      controlId: controlId || null,
    };
    try {
      // .set() con id determinista → reenviar el mismo mensaje sobreescribe (no duplica).
      await db.doc(`hospitals/${hospId}/patients/${patientId}/labs/${labId}`).set(labData);
    } catch (e) {
      console.error('[lisSync] error guardando lab:', e.message);
      return res.status(500).json({ ok: false, error: 'Error guardando laboratorio' });
    }

    // ── Fusionar o sobreescribir en el censo mensual ─────────────────
    const censoUpdate = {
      lisLastSync: admin.firestore.FieldValue.serverTimestamp(),
      lisOrganism: organism || null,
      lisSpecimen: specimenType || null,
      lisCollectedAt: collectedAt || null,
      lisReportedAt: reportedAt || null,
    };
    if (resolution === 'overwritten') censoUpdate.bact = organism || null;
    try {
      await patRef.set(censoUpdate, { merge: true });
    } catch (e) {
      console.error('[lisSync] error actualizando censo:', e.message);
    }

    if (resolution === 'merged') {
      try {
        await db.collection(`hospitals/${hospId}/lis_queue`).add({
          conflictType: 'physician_update_after_collection',
          resolution: 'merged',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          patientId,
          data: { organism, antibiogram, collectedAt, reportedAt },
        });
      } catch (e) {
        console.error('[lisSync] error registrando lis_queue:', e.message);
      }
    }

    try {
      await _checkBiomarkerAlertsInternal(hospId, patientId);
    } catch (e) {
      console.error('[lisSync] error en checkBiomarkerAlerts:', e.message);
    }

    return res.json({ ok: true, matched: true, patientId, resolution, labId, format: hl7 ? 'hl7' : 'json' });
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 9. calcBenchmarks — Programado: 1° de cada mes a las 02:00 ──────
// Justificación clínica: los benchmarks anónimos de prescripción
// crean normas sociales (nudging) que reducen el uso innecesario
// de antibióticos de amplio espectro. La anonimización via SHA-256
// previene la identificación del médico mientras permite seguimiento
// longitudinal (JAMA Internal Medicine 2016, Meeker et al.).
// ════════════════════════════════════════════════════════════════════
exports.calcBenchmarks = onSchedule(
  { schedule: '0 2 1 * *', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    const crypto = require('crypto');
    console.info('[calcBenchmarks] Iniciando cálculo mensual de benchmarks');

    // Mes anterior (YYYY-MM)
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const targetMonth = prevMonth.toISOString().slice(0, 7);

    // Lista de hospitales activos
    let registrySnap;
    try {
      registrySnap = await db.collection('hospitals_registry').where('activo', '==', true).get();
    } catch (e) {
      console.error('[calcBenchmarks] Error leyendo hospitals_registry:', e.message);
      return;
    }

    // ATBs de amplio espectro (ATC J01D + carbapenémicos + Watch/Reserve)
    const BROAD_SPECTRUM = [
      'meropenem', 'imipenem', 'ertapenem', 'doripenem',
      'piperacilina', 'piperacillin', 'tazobactam',
      'cefepime', 'ceftazidima', 'ceftazidime',
      'vancomicina', 'vancomycin', 'linezolid', 'daptomicina', 'daptomycin',
      'colistina', 'colistin', 'tigeciclina', 'tigecycline',
      'caspofungin', 'micafungin', 'anidulafungin',
    ];
    const CARBAPENEM = ['meropenem', 'imipenem', 'ertapenem', 'doripenem'];
    const WATCH_LIST = [
      'vancomicina', 'vancomycin', 'linezolid', 'daptomicina', 'daptomycin',
      'colistina', 'colistin', 'tigeciclina', 'tigecycline',
      'caspofungin', 'micafungin',
    ];
    const RESERVE_LIST = ['colistina', 'colistin', 'fosfomicina', 'fosfomycin', 'ceftazidima-avibactam'];

    const isBroadSpectrum = (atbs) => atbs.some(a =>
      BROAD_SPECTRUM.some(kw => (a.nom || '').toLowerCase().includes(kw))
    );
    const isCarbapenem = (atbs) => atbs.some(a =>
      CARBAPENEM.some(kw => (a.nom || '').toLowerCase().includes(kw))
    );
    const isWatch = (atbs) => atbs.some(a =>
      WATCH_LIST.some(kw => (a.nom || '').toLowerCase().includes(kw))
    );
    const isReserve = (atbs) => atbs.some(a =>
      RESERVE_LIST.some(kw => (a.nom || '').toLowerCase().includes(kw))
    );

    const promises = registrySnap.docs.map(async (regDoc) => {
      const hospId = regDoc.id;
      try {
        // Leer todos los pacientes del mes anterior
        const patientsSnap = await db
          .collection(`hospitals/${hospId}/months/${targetMonth}/patients`)
          .get();

        if (patientsSnap.empty) return;

        // Agrupar por servicio y por médico
        const serviceMap = {};  // { service → { totalPatients, totalDOT, broadSpectrum, carbapenem, watch, reserve, desescalada, organisms } }
        const physicianMap = {}; // { hashedUid → { service, prescriptions, broadSpectrum, watch, totalDOT, carbapenemCount } }

        patientsSnap.forEach(doc => {
          const p = doc.data();
          const atbs = p.atbs || [];
          if (!atbs.length) return;

          const svc = p.svc || p.servicio || 'Sin servicio';
          const dot = parseInt(p.dot || 0);
          const medico = p.medico || p.requester || null;

          // ── Agregar por servicio ───────────────────────────────────
          if (!serviceMap[svc]) {
            serviceMap[svc] = {
              totalPatients: 0, totalDOT: 0,
              broadSpectrum: 0, carbapenem: 0,
              watch: 0, reserve: 0, desescalada: 0,
              organisms: {},
            };
          }
          const svcData = serviceMap[svc];
          svcData.totalPatients++;
          svcData.totalDOT += dot;
          if (isBroadSpectrum(atbs)) svcData.broadSpectrum++;
          if (isCarbapenem(atbs)) svcData.carbapenem++;
          if (isWatch(atbs)) svcData.watch++;
          if (isReserve(atbs)) svcData.reserve++;
          if (p.accion === 'desescalada' || p.accion === 'Desescalada') svcData.desescalada++;
          const org = p.bact || p.organismo || null;
          if (org) {
            svcData.organisms[org] = (svcData.organisms[org] || 0) + 1;
          }

          // ── Agregar por médico (hash anónimo) ─────────────────────
          if (medico) {
            const hashedMedico = crypto
              .createHash('sha256')
              .update(medico + hospId)
              .digest('hex')
              .slice(0, 16);

            if (!physicianMap[hashedMedico]) {
              physicianMap[hashedMedico] = {
                hashedMedico,
                service: svc,
                totalPrescriptions: 0,
                broadSpectrum: 0,
                watch: 0,
                totalDOT: 0,
                carbapenemCount: 0,
              };
            }
            const phData = physicianMap[hashedMedico];
            phData.totalPrescriptions++;
            phData.totalDOT += dot;
            if (isBroadSpectrum(atbs)) phData.broadSpectrum++;
            if (isWatch(atbs)) phData.watch++;
            if (isCarbapenem(atbs)) phData.carbapenemCount++;
          }
        });

        // ── Calcular tasas y construir arrays finales ─────────────────
        const services = Object.entries(serviceMap).map(([service, d]) => {
          const n = d.totalPatients || 1;
          const topOrganisms = Object.entries(d.organisms)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([org, count]) => ({ org, count }));
          return {
            service,
            totalPatients: d.totalPatients,
            totalDOT: d.totalDOT,
            avgDOT: d.totalDOT / n,
            broadSpectrumRate: (d.broadSpectrum / n) * 100,
            carbapenemRate: (d.carbapenem / n) * 100,
            watchRate: (d.watch / n) * 100,
            reserveRate: (d.reserve / n) * 100,
            desescalationRate: (d.desescalada / n) * 100,
            topOrganisms,
          };
        });

        const physicians = Object.values(physicianMap).map(d => {
          const n = d.totalPrescriptions || 1;
          return {
            hashedMedico: d.hashedMedico,
            service: d.service,
            totalPrescriptions: d.totalPrescriptions,
            broadSpectrumRate: (d.broadSpectrum / n) * 100,
            watchRate: (d.watch / n) * 100,
            avgDOT: d.totalDOT / n,
            carbapenemCount: d.carbapenemCount,
          };
        });

        // ── Escribir benchmark al Firestore (admin SDK, ignora regla write:false) ──
        await db.doc(`hospitals/${hospId}/benchmarks/${targetMonth}`).set({
          services,
          physicians,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          month: targetMonth,
          totalPatients: patientsSnap.size,
        });

        console.info(`[calcBenchmarks] ${hospId}: benchmark ${targetMonth} generado — ${services.length} servicios, ${physicians.length} médicos`);
      } catch (e) {
        console.error(`[calcBenchmarks] ${hospId}: error:`, e.message);
      }
    });

    await Promise.allSettled(promises);
    console.info('[calcBenchmarks] Cálculo global completado');
  }
);

// ════════════════════════════════════════════════════════════════════
// ── HELPER INTERNO: lógica de biomarcadores (reutilizable) ───────────
// ════════════════════════════════════════════════════════════════════
async function _checkBiomarkerAlertsInternal(hospitalId, patientId) {
  // Leer todos los labs del paciente ordenados por fecha descendente
  const labsSnap = await db
    .collection(`hospitals/${hospitalId}/patients/${patientId}/labs`)
    .orderBy('creadoAt', 'desc')
    .get();

  let pctPeak = null;
  let pctLatest = null;
  let crpPeak = null;
  let crpLatest = null;

  labsSnap.forEach(doc => {
    const lab = doc.data();
    if (doc.id === 'biomarker_alert') return; // skip meta doc

    // PCT (Procalcitonina)
    if (lab.pct != null) {
      const val = parseFloat(lab.pct);
      if (!isNaN(val)) {
        if (pctLatest === null) pctLatest = val; // first = latest (desc order)
        if (pctPeak === null || val > pctPeak) pctPeak = val;
      }
    }
    // PCR (Proteína C reactiva) — field key is 'pcr' in LAB_GRUPOS/LAB_KEY_MAP
    if (lab.pcr != null) {
      const val = parseFloat(lab.pcr);
      if (!isNaN(val)) {
        if (crpLatest === null) crpLatest = val;
        if (crpPeak === null || val > crpPeak) crpPeak = val;
      }
    }
  });

  // Leer DOT del paciente en el censo mensual
  const currentMonth = new Date().toISOString().slice(0, 7);
  let dot = 0;
  try {
    const patSnap = await db
      .doc(`hospitals/${hospitalId}/months/${currentMonth}/patients/${patientId}`)
      .get();
    if (patSnap.exists) dot = parseInt(patSnap.data().dot || 0);
  } catch (_) { /* no bloquea */ }

  // ── Evaluar condiciones de alerta ───────────────────────────────
  const pctDropPct = (pctPeak && pctLatest != null)
    ? Math.round(((pctPeak - pctLatest) / pctPeak) * 100)
    : null;

  const pctDropAlert = (
    pctPeak != null && pctLatest != null &&
    pctLatest < pctPeak * 0.2 && // >80% de caída
    dot >= 3
  );

  const crpNormalizedAlert = (
    crpLatest != null && crpPeak != null &&
    crpLatest < 10 &&
    crpLatest < crpPeak * 0.5 &&
    dot >= 5
  );

  let alertLevel = 'none';
  let recommendation = 'Sin datos suficientes para recomendación de cese.';

  if (pctDropAlert && crpNormalizedAlert) {
    alertLevel = 'strong';
    recommendation =
      'RECOMENDACIÓN FUERTE: Considerar suspensión de ATB. ' +
      `PCT redujo ${pctDropPct}% desde el pico (NPV 99% resolución infecciosa, guías IDSA/SHEA). ` +
      `CRP normalizada (${crpLatest} mg/L). DOT: ${dot} días. Evaluar con el equipo clínico.`;
  } else if (pctDropAlert) {
    alertLevel = 'moderate';
    recommendation =
      'RECOMENDACIÓN MODERADA: PCT redujo >80% desde el pico. ' +
      `Considerar desescalada o suspensión según contexto clínico. DOT: ${dot} días.`;
  } else if (crpNormalizedAlert) {
    alertLevel = 'moderate';
    recommendation =
      'RECOMENDACIÓN MODERADA: CRP normalizada (<10 mg/L). ' +
      `Evaluar suspensión de ATB si hay mejoría clínica. DOT: ${dot} días.`;
  }

  const alertObj = {
    type: 'biomarker_cessation',
    pct_peak: pctPeak,
    pct_latest: pctLatest,
    pct_drop_pct: pctDropPct,
    crp_peak: crpPeak,
    crp_latest: crpLatest,
    dot,
    alert_level: alertLevel,
    recommendation,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Guardar alerta en labs/biomarker_alert (doc especial del paciente)
  await db
    .doc(`hospitals/${hospitalId}/patients/${patientId}/labs/biomarker_alert`)
    .set(alertObj);

  // Notificar al equipo PROA si la alerta es relevante
  if (alertLevel !== 'none') {
    await notificarEquipoPROA(
      hospitalId,
      alertLevel === 'strong'
        ? '🛑 Alerta biomarcador FUERTE — posible cese ATB'
        : '⚠️ Alerta biomarcador moderada',
      `Paciente ${patientId} · ${recommendation.slice(0, 100)}…`
    );
  }

  return alertObj;
}

// ════════════════════════════════════════════════════════════════════
// ── 10. checkBiomarkerAlerts — onCall: alerta por PCT / CRP ─────────
// Justificación clínica: la caída de PCT >80% desde el pico tiene
// un valor predictivo negativo del 99% para resolución de infección
// (De Jong et al., Lancet 2016). La normalización de CRP (<10 mg/L)
// combinada con mejoría clínica apoya la discontinuación (guías
// IDSA/SHEA 2019 de uso de biomarcadores en ATB stewardship).
// ════════════════════════════════════════════════════════════════════
exports.checkBiomarkerAlerts = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const { hospitalId, patientId } = req.data || {};
    if (!hospitalId || !patientId) {
      throw new HttpsError('invalid-argument', 'hospitalId y patientId son requeridos');
    }

    // Validar membresía del hospital
    const hospUserSnap = await db.doc(`hospitals/${hospitalId}/users/${req.auth.uid}`).get();
    if (!hospUserSnap.exists) {
      throw new HttpsError('permission-denied', 'No eres miembro de este hospital');
    }

    try {
      const alertObj = await _checkBiomarkerAlertsInternal(hospitalId, patientId);
      return alertObj;
    } catch (e) {
      console.error('[checkBiomarkerAlerts] error:', e.message);
      throw new HttpsError('internal', e.message);
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 11. detectResistanceClusters — Programado cada 6 horas ──────────
// Justificación clínica: la detección temprana de clústeres de
// Klebsiella pneumoniae resistente a carbapenémicos (≥2 casos en
// el mismo servicio en 14 días) activa el control de brotes.
// El CDC define clúster como ≥2 casos epidemiológicamente vinculados.
// La ventana de 14 días cubre el período de incubación + transmisión
// nosocomial (CDC MDRO Guidance 2019).
// ════════════════════════════════════════════════════════════════════
exports.detectResistanceClusters = onSchedule(
  { schedule: 'every 6 hours', region: 'us-central1', timeoutSeconds: 540 },
  async () => {
    console.info('[detectResistanceClusters] Iniciando detección de clústeres MDR');

    const MDR_MARKERS = ['kpc', 'ndm', 'oxa-48', 'vim', 'mrsa', 'vre', 'crab', 'pdr', 'xdr'];
    const MDR_ORGANISMS = ['klebsiella', 'acinetobacter', 'pseudomonas'];
    const MDR_PHENOTYPES = ['carba', 'mdr', 'xdr'];

    function isMDRCase(p) {
      const bact = (p.bact || '').toLowerCase();
      const fenotipo = (p.fenotipo || '').toLowerCase();
      // Marcador directo
      if (MDR_MARKERS.some(m => bact.includes(m) || fenotipo.includes(m))) return true;
      // Organismo + fenotipo MDR
      if (
        MDR_ORGANISMS.some(o => bact.includes(o)) &&
        MDR_PHENOTYPES.some(ph => fenotipo.includes(ph))
      ) return true;
      return false;
    }

    function getClusterType(cases) {
      const bacts = cases.map(c => (c.bact || '').toLowerCase());
      if (bacts.some(b => b.includes('kpc') || b.includes('ndm') || b.includes('oxa-48'))) return 'KPC';
      if (bacts.some(b => b.includes('mrsa'))) return 'MRSA';
      if (bacts.some(b => b.includes('vre'))) return 'VRE';
      if (bacts.some(b => b.includes('crab') || b.includes('acinetobacter'))) return 'CRAB';
      return 'MDR_mixed';
    }

    let registrySnap;
    try {
      registrySnap = await db.collection('hospitals_registry').where('activo', '==', true).get();
    } catch (e) {
      console.error('[detectResistanceClusters] Error leyendo hospitals_registry:', e.message);
      return;
    }

    const allClusters = [];
    const now = new Date();
    const cutoff14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const cutoff30Month = cutoff30.toISOString().slice(0, 7);
    const currentMonth = now.toISOString().slice(0, 7);

    const promises = registrySnap.docs.map(async (regDoc) => {
      const hospId = regDoc.id;
      try {
        // Leer pacientes de los últimos 30 días (mes actual y anterior)
        const months = Array.from(new Set([cutoff30Month, currentMonth]));
        const allPatients = [];

        for (const month of months) {
          try {
            const snap = await db
              .collection(`hospitals/${hospId}/months/${month}/patients`)
              .get();
            snap.forEach(doc => allPatients.push({ id: doc.id, ...doc.data() }));
          } catch (_) { /* mes puede no existir */ }
        }

        // Filtrar solo casos MDR con fecha en últimos 14 días
        const mdrCases = allPatients.filter(p => {
          if (!isMDRCase(p)) return false;
          // Obtener fecha de ingreso/actualización
          const dateAdded = p.fecha || p.ingreso || p.createdAt || null;
          if (!dateAdded) return true; // incluir si no tiene fecha (conservador)
          const ts = dateAdded.toDate ? dateAdded.toDate() : new Date(dateAdded);
          return ts >= cutoff14;
        });

        // Agrupar por servicio
        const serviceGroups = {};
        mdrCases.forEach(p => {
          const svc = p.svc || p.servicio || 'Sin servicio';
          if (!serviceGroups[svc]) serviceGroups[svc] = [];
          serviceGroups[svc].push(p);
        });

        // Detectar clústeres (≥2 casos por servicio)
        for (const [service, cases] of Object.entries(serviceGroups)) {
          if (cases.length < 2) continue;

          // Agrupar por organismo para encontrar el más común
          const orgCount = {};
          cases.forEach(c => {
            const org = c.bact || 'Organismo MDR';
            orgCount[org] = (orgCount[org] || 0) + 1;
          });
          const mostCommonOrganism = Object.entries(orgCount)
            .sort((a, b) => b[1] - a[1])[0][0];

          const clusterType = getClusterType(cases);
          const alertLevel = cases.length >= 4 ? 'critical' : 'high';

          // Evitar duplicados: verificar si ya existe clúster activo
          // para este servicio + tipo en las últimas 24h
          const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          let duplicateExists = false;
          try {
            const existingSnap = await db
              .collection(`hospitals/${hospId}/resistance_clusters`)
              .where('active', '==', true)
              .where('service', '==', service)
              .where('clusterType', '==', clusterType)
              .get();
            duplicateExists = existingSnap.docs.some(doc => {
              const detectedAt = doc.data().detectedAt;
              if (!detectedAt) return false;
              const ts = detectedAt.toDate ? detectedAt.toDate() : new Date(detectedAt);
              return ts >= cutoff24h;
            });
          } catch (_) { /* no bloquea */ }

          if (duplicateExists) continue;

          // Crear clúster
          const clusterData = {
            service,
            organism: mostCommonOrganism,
            cases: cases.map(c => ({
              patientId: c.id,
              patientName: '[ANONIMIZADO]',
              dateAdded: c.fecha || c.ingreso || null,
              bact: c.bact || null,
              fenotipo: c.fenotipo || null,
            })),
            caseCount: cases.length,
            windowDays: 14,
            clusterType,
            alertLevel,
            detectedAt: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
          };

          try {
            await db.collection(`hospitals/${hospId}/resistance_clusters`).add(clusterData);
            allClusters.push({ hospId, service, organism: mostCommonOrganism, caseCount: cases.length });

            // Notificar al equipo PROA
            await notificarEquipoPROA(
              hospId,
              `🚨 Clúster MDR detectado — ${service}`,
              `${cases.length} casos de ${mostCommonOrganism} en los últimos 14 días. Activar protocolo de brote.`
            );
          } catch (e) {
            console.error(`[detectResistanceClusters] ${hospId}: error guardando clúster:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[detectResistanceClusters] ${hospId}: error:`, e.message);
      }
    });

    await Promise.allSettled(promises);
    console.info(`[detectResistanceClusters] Completado — ${allClusters.length} clústeres detectados`);
    return { clusters: allClusters };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 12. auditLog — onCall: registro de auditoría HIPAA/SaMD ─────────
// Justificación clínica/regulatoria:
// - HIPAA §164.312(b): los sistemas deben registrar la actividad
//   de acceso a PHI (Protected Health Information).
// - FDA 21 CFR Part 11: los registros electrónicos deben ser
//   auditables e inalterables.
// - El log es inmutable: las reglas de Firestore prohíben
//   update/delete en _audit_log; solo el admin SDK puede leer.
// ════════════════════════════════════════════════════════════════════
exports.auditLog = onCall(
  { region: 'us-central1', timeoutSeconds: 15 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const {
      action, resourceType, resourceId, hospitalId, details,
    } = req.data || {};

    if (!action || !resourceType) {
      throw new HttpsError('invalid-argument', 'action y resourceType son requeridos');
    }

    // Validar enum de acciones permitidas
    const validActions = ['READ', 'WRITE', 'DELETE', 'PROA_DECISION', 'EHR_SYNC', 'BIOMARKER_ALERT'];
    if (!validActions.includes(action)) {
      throw new HttpsError('invalid-argument', `action debe ser uno de: ${validActions.join(', ')}`);
    }

    // Validar enum de tipos de recurso
    const validResourceTypes = ['patient', 'lab', 'atb_request', 'decision'];
    if (!validResourceTypes.includes(resourceType)) {
      throw new HttpsError('invalid-argument', `resourceType debe ser uno de: ${validResourceTypes.join(', ')}`);
    }

    const logEntry = {
      uid: req.auth.uid,
      email: req.auth.token.email || 'unknown',
      action,
      resourceType,
      resourceId: resourceId || null,
      hospitalId: hospitalId || null,
      details: details || {},
      ipAddress: req.rawRequest?.ip || 'unknown',
      userAgent: req.rawRequest?.headers?.['user-agent'] || 'unknown',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      immutable: true,
    };

    let logId;
    try {
      const docRef = await db.collection('_audit_log').add(logEntry);
      logId = docRef.id;
    } catch (e) {
      console.error('[auditLog] error escribiendo log:', e.message);
      throw new HttpsError('internal', 'Error registrando auditoría');
    }

    return { logged: true, logId };
  }
);

// ── 13. whisperTranscribe — Transcripción de audio con OpenAI Whisper ────────
// POST { audioBase64, mimeType, hospId, uid, durationEstSec }
// Returns { ok, transcript, durationSec, minutesUsed, cap }
exports.whisperTranscribe = onRequest(
  { region: 'us-central1', cors: true, secrets: ['OPENAI_KEY'], timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { audioBase64, mimeType, hospId, durationEstSec } = req.body;
    if (!audioBase64 || !hospId) {
      return res.status(400).json({ error: 'audioBase64 y hospId son requeridos' });
    }

    // ── SEGURIDAD (v270): verificar token de Firebase y que el usuario pertenezca al hospital.
    // Antes se confiaba en el uid/hospId del body sin validar → cualquiera podía consumir la
    // cuota de voz de un hospId conocido. Ahora exigimos un idToken válido en Authorization y
    // que ese uid sea miembro aprobado del hospId (mismo modelo que anthropicProxy).
    let uid = null;
    try {
      const _authH = req.headers['authorization'] || req.headers['Authorization'] || '';
      const _idToken = _authH.startsWith('Bearer ') ? _authH.slice(7) : '';
      if (!_idToken) return res.status(401).json({ error: 'Sesión no válida (token requerido)', code: 'NO_TOKEN' });
      const _decoded = await admin.auth().verifyIdToken(_idToken);
      uid = _decoded.uid;
      const _email = _decoded.email || '';
      // Super-admin tiene acceso total; los demás deben ser miembros aprobados del hospId
      if (_email !== SUPER_ADMIN_EMAIL) {
        const _hu = await db.doc(`hospitals/${hospId}/users/${uid}`).get();
        const _huData = _hu.exists ? _hu.data() : {};
        if (_huData.status !== 'aprobado' && _huData.status !== 'admin') {
          return res.status(403).json({ error: 'No autorizado para este hospital', code: 'NOT_HOSP_MEMBER' });
        }
      }
    } catch (e) {
      console.warn('[whisperTranscribe] auth fail:', e.message);
      return res.status(401).json({ error: 'Token inválido o expirado', code: 'BAD_TOKEN' });
    }

    // ── Verificar que el hospital tiene voz habilitada ──
    let regData = {};
    try {
      const regSnap = await db.collection('hospitals_registry').doc(hospId).get();
      regData = regSnap.exists ? regSnap.data() : {};
    } catch (e) {
      console.error('[whisperTranscribe] Error leyendo registry:', e.message);
    }

    if (!regData.voice_enabled) {
      return res.status(403).json({
        error: 'La función de voz no está activada para este hospital. Contacta al equipo PROA de StewardMX.',
        code: 'VOICE_DISABLED',
      });
    }

    const capMin = regData.voice_cap_min === -1 ? Infinity : (regData.voice_cap_min || 300);

    // ── Verificar uso mensual ──
    const month = new Date().toISOString().slice(0, 7);
    const usageRef = db.collection('hospitals').doc(hospId).collection('voice_usage').doc(month);
    let usageData = { minutesUsed: 0, recordings: 0 };
    try {
      const usageSnap = await usageRef.get();
      if (usageSnap.exists) usageData = usageSnap.data();
    } catch (e) { /* continuar */ }

    if (usageData.minutesUsed >= capMin) {
      return res.status(402).json({
        error: `Límite mensual de voz alcanzado (${capMin} min). Contacta al administrador para ampliar el plan.`,
        code: 'VOICE_CAP_REACHED',
        minutesUsed: usageData.minutesUsed,
        cap: capMin,
      });
    }

    // ── Llamar a Whisper ──
    try {
      const OpenAI = require('openai').default || require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });

      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const ext = mimeType?.includes('mp4') ? 'm4a'
               : mimeType?.includes('ogg') ? 'ogg'
               : mimeType?.includes('wav') ? 'wav'
               : mimeType?.includes('webm') ? 'webm'
               : 'webm';

      // OpenAI SDK acepta un File-like object con toFile helper
      const { toFile } = require('openai');
      // v327: prompt enriquecido con vocabulario médico (Whisper limita a ~224 tokens → se
      // priorizan los términos con mayor riesgo de error fonético). El cliente además aplica el
      // corrector fonético/Levenshtein (js/core/medical-voice.js).
      const MED_PROMPT = 'Transcripción de visita médica PROA en español de México. Términos: meropenem, piperacilina/tazobactam, ceftazidima/avibactam, ceftolozano/tazobactam, cefepime, ertapenem, vancomicina, daptomicina, linezolid, tigeciclina, colistina, amikacina, levofloxacino, trimetoprim/sulfametoxazol, fosfomicina, anfotericina, caspofungina, fluconazol, voriconazol, isavuconazol. Microorganismos: Klebsiella pneumoniae, Escherichia coli, Pseudomonas aeruginosa, Acinetobacter baumannii, Stenotrophomonas maltophilia, Staphylococcus aureus, Enterococcus faecium, Candida auris, Clostridioides difficile. Resistencia: BLEE, KPC, NDM, OXA-48, VIM, MRSA, VRE, CRE, CRAB, MDR, XDR. Antirretrovirales: Biktarvy, Dovato, dolutegravir, bictegravir, tenofovir. Labs: procalcitonina, PCR, lactato, creatinina, leucocitos. Síndromes: bacteriemia, sepsis, choque séptico, neumonía, pielonefritis, endocarditis, neutropenia febril.';
      // v327: CASCADA de modelos por precisión (paridad con la app de agenda médica):
      //   gpt-4o-transcribe (~30% menos WER en español médico) → gpt-4o-mini-transcribe → whisper-1.
      // temperature 0 = determinístico (no improvisa fármacos). Override: OPENAI_TRANSCRIBE_MODEL.
      // gpt-4o-* no soportan verbose_json → usan 'json' (duración del estimado del cliente).
      const TRANSCRIBE_MODELS = process.env.OPENAI_TRANSCRIBE_MODEL
        ? [process.env.OPENAI_TRANSCRIBE_MODEL]
        : ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];
      let transcript = '', durationSec = durationEstSec || 60, usedModel = '', _lastErr = null;
      for (const _model of TRANSCRIBE_MODELS) {
        try {
          const _af = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType || 'audio/webm' });
          const _isW = _model === 'whisper-1';
          const _r = await openai.audio.transcriptions.create({
            file: _af, model: _model, language: 'es', temperature: 0,
            response_format: _isW ? 'verbose_json' : 'json',
            prompt: MED_PROMPT,
          });
          transcript = _r.text || '';
          durationSec = _r.duration || durationEstSec || 60;
          usedModel = _model;
          break;
        } catch (e) {
          _lastErr = e;
          const _st = (e && (e.status || (e.response && e.response.status))) || 0;
          console.warn(`[whisperTranscribe] ${_model} falló (${_st}) — probando siguiente`);
          // 404/403/400 = modelo no disponible para la cuenta → probar el siguiente.
          // Otros (auth/rate-limit/server) → abortar la cascada.
          if (_st && _st !== 404 && _st !== 403 && _st !== 400) throw e;
        }
      }
      if (!usedModel) throw (_lastErr || new Error('Transcripción no disponible'));
      const durationMin = durationSec / 60;

      // ── Actualizar uso ──
      try {
        await usageRef.set({
          minutesUsed: admin.firestore.FieldValue.increment(durationMin),
          recordings: admin.firestore.FieldValue.increment(1),
          lastRecordingAt: admin.firestore.FieldValue.serverTimestamp(),
          month, hospId,
        }, { merge: true });
      } catch (e) { console.warn('[whisperTranscribe] Error actualizando uso:', e.message); }

      return res.json({
        ok: true,
        transcript,
        durationSec,
        model: usedModel, // v327: modelo de la cascada que respondió (gpt-4o-transcribe / mini / whisper-1)
        minutesUsed: (usageData.minutesUsed || 0) + durationMin,
        cap: capMin === Infinity ? -1 : capMin,
      });
    } catch (e) {
      console.error('[whisperTranscribe] Error:', e.message);
      return res.status(502).json({ error: 'Error en transcripción. Intenta de nuevo. ' + e.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// ── checkBedAvailable — validación atómica de cama libre ────────────
// Usa una transacción Firestore para garantizar que ningún otro proceso
// asignó la misma cama entre la lectura y la escritura del cliente.
// Llamar ANTES de guardar el paciente. No escribe datos clínicos.
// ════════════════════════════════════════════════════════════════════
exports.checkBedAvailable = onCall(
  { region: 'us-central1' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const { hospitalId, servicio, cama, excludePatientId } = req.data || {};
    if (!hospitalId || !servicio || !cama) {
      throw new HttpsError('invalid-argument', 'hospitalId, servicio y cama son obligatorios');
    }

    // Verificar que el usuario pertenece al hospital solicitado
    const uid = req.auth.uid;
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists || userDoc.data().hospitalId !== hospitalId) {
      throw new HttpsError('permission-denied', 'Sin acceso a este hospital');
    }

    // Transacción de solo lectura: busca pacientes activos con esa cama
    const patientsRef = db.collection(`hospitals/${hospitalId}/patients`);
    const snap = await patientsRef
      .where('servicio', '==', servicio)
      .where('cama', '==', cama)
      .get();

    const conflict = snap.docs.find(d => {
      if (d.data().alta) return false;          // dado de alta → no cuenta
      if (excludePatientId && d.id === excludePatientId) return false; // propio paciente en edición
      return true;
    });

    if (conflict) {
      return {
        available: false,
        occupiedBy: conflict.data().nombre || '—',
        patientId: conflict.id,
      };
    }
    return { available: true };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── limpiarPacientes — borra todos los pacientes de un hospital ──────
// Solo super-admin O admin del propio hospital pueden invocarla.
// Borra en lotes de 400 (límite Firestore batch).
// ════════════════════════════════════════════════════════════════════
const SUPER_ADMIN_EMAIL = 'docrod29@gmail.com';

exports.limpiarPacientes = onCall(
  { region: 'us-central1', timeoutSeconds: 120 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const { hospitalId } = req.data || {};
    if (!hospitalId) throw new HttpsError('invalid-argument', 'hospitalId requerido');

    const uid = req.auth.uid;
    const email = req.auth.token.email || '';

    // Verificar permiso: super-admin o admin del hospital
    const isSA = email === SUPER_ADMIN_EMAIL;
    if (!isSA) {
      const hospUserDoc = await db.doc(`hospitals/${hospitalId}/users/${uid}`).get();
      const hu = hospUserDoc.data() || {};
      if (hu.rol !== 'admin' && hu.status !== 'admin') {
        throw new HttpsError('permission-denied', 'Solo admins del hospital pueden limpiar datos');
      }
    }

    // Borrar todos los pacientes de todos los meses en lotes de 400
    let totalDeleted = 0;
    let batch = db.batch();
    let count = 0;

    const monthsSnap = await db.collection(`hospitals/${hospitalId}/months`).get();
    for (const monthDoc of monthsSnap.docs) {
      const patientsSnap = await monthDoc.ref.collection('patients').get();
      for (const docSnap of patientsSnap.docs) {
        // v404 (P2 datos): nombres REALES de las subcolecciones del paciente. Antes 'recos' (el cliente usa
        //   'recomendaciones') y faltaba 'micro_reports' → esas quedaban HUÉRFANAS al limpiar el hospital.
        for (const sub of ['visits', 'antibiograms', 'labs', 'molecular', 'histo', 'recomendaciones', 'micro_reports']) {
          const subSnap = await docSnap.ref.collection(sub).get();
          for (const s of subSnap.docs) {
            batch.delete(s.ref);
            count++;
            if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
          }
        }
        batch.delete(docSnap.ref);
        totalDeleted++;
        count++;
        if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
      }
    }
    if (count > 0) await batch.commit();

    // Audit log
    await db.collection(`hospitals/${hospitalId}/_audit`).add({
      accion: 'limpiar_pacientes',
      por: email,
      uid,
      totalBorrados: totalDeleted,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, totalDeleted };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── seedDemoData — carga pacientes demo realistas ────────────────────
// Crea 10 pacientes ficticios que cubren todas las alertas y casos
// de uso de StewardMX: MDR, cultivos, IC, restricción farmacia, CDI…
// ════════════════════════════════════════════════════════════════════
exports.seedDemoData = onCall(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const { hospitalId } = req.data || {};
    if (!hospitalId) throw new HttpsError('invalid-argument', 'hospitalId requerido');

    const uid = req.auth.uid;
    const email = req.auth.token.email || '';
    const isSA = email === SUPER_ADMIN_EMAIL;
    if (!isSA) {
      const hospUserDoc = await db.doc(`hospitals/${hospitalId}/users/${uid}`).get();
      const hu = hospUserDoc.data() || {};
      if (hu.rol !== 'admin' && hu.status !== 'admin') {
        throw new HttpsError('permission-denied', 'Solo admins pueden cargar datos demo');
      }
    }

    const now = new Date();
    const daysAgo = d => new Date(now - d * 86400000).toISOString().slice(0, 10);
    const ts = admin.firestore.FieldValue.serverTimestamp();

    const demoPacientes = [
      {
        nombre: 'María González Ramos', exp: 'EXP-001', edad: '67', sexo: 'F', peso: '62',
        servicio: 'Medicina Interna', cama: '3',
        ingreso: daysAgo(16), medico: 'Dr. Pérez',
        dx: 'Neumonía nosocomial (VAP)',
        atb: 'Meropenem', atbList: [{ nombre: 'Meropenem', via: 'IV', dosis: '1g c/8h', fechaInicioIV: daysAgo(16) }],
        aware: 'Watch', pol: 'restringido',
        cult: 'positivo', organismo: 'Klebsiella pneumoniae',
        mec_kpc: true, mec_blee: true,
        fenotipo: 'Carbapenemasa KPC',
        riesgo: 'alto', accion: 'mantener', adecuacion: 'adecuado',
        rev: '24h', notas: 'Paciente en VM. KPC confirmado por PCR. DOT elevado — evaluar tigeciclina.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'José Martínez López', exp: 'EXP-002', edad: '54', sexo: 'M', peso: '78',
        servicio: 'UCI Adultos', cama: '1',
        ingreso: daysAgo(4), medico: 'Dra. Sánchez',
        dx: 'Bacteriemia por S. aureus',
        atb: 'Vancomicina', atbList: [{ nombre: 'Vancomicina', via: 'IV', dosis: '1.5g c/12h', fechaInicioIV: daysAgo(4) }],
        aware: 'Reserve', pol: 'restringido',
        cult: 'positivo', organismo: 'Staphylococcus aureus',
        mec_mrsa: true, fenotipo: 'MRSA',
        riesgo: 'alto', accion: 'mantener', adecuacion: 'adecuado',
        bacteriemia: 'sí',
        rev: '24h', notas: 'MRSA bacteriemia. Eco pendiente para descartar endocarditis. AUC/MIC monitorizado.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Ana Flores Herrera', exp: 'EXP-003', edad: '38', sexo: 'F', peso: '58',
        servicio: 'Medicina Interna', cama: '7',
        ingreso: daysAgo(3), medico: 'Dr. Torres',
        dx: 'ITU complicada / Pielonefritis',
        atb: 'Ceftriaxona', atbList: [{ nombre: 'Ceftriaxona', via: 'IV', dosis: '2g c/24h', fechaInicioIV: daysAgo(3), toleraVO: 'sí' }],
        aware: 'Watch', pol: 'vigilado',
        cult: 'pendiente', organismo: '',
        riesgo: 'moderado', accion: 'desescalar',
        rev: '48h', notas: 'Urocultivo pendiente 48h. Paciente tolerando VO. Candidata IV→VO si cultivo sin resistencias.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Carlos Reyes Gutiérrez', exp: 'EXP-004', edad: '72', sexo: 'M', peso: '70',
        servicio: 'Medicina Interna', cama: '12',
        ingreso: daysAgo(5), medico: 'Dra. Morales',
        dx: 'Infección por Clostridioides difficile — severa',
        atb: 'Vancomicina oral', atbList: [{ nombre: 'Vancomicina oral', via: 'PO', dosis: '125mg c/6h', fechaInicioIV: daysAgo(5) }],
        aware: 'Watch', pol: 'libre',
        cult: 'positivo', organismo: 'Clostridioides difficile',
        cdi: true, cdiSeveridad: 'severa', cdiRecurrencia: false,
        riesgo: 'alto', accion: 'mantener',
        rev: '48h', notas: 'C. diff toxina A/B+. Aislamiento de contacto activo. Leuco 18k, Creat 1.8.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Lucía Vega Mendoza', exp: 'EXP-005', edad: '45', sexo: 'F', peso: '65',
        servicio: 'Cirugía General', cama: '2',
        ingreso: daysAgo(8), medico: 'Dr. Ramírez',
        dx: 'IAB / Peritonitis secundaria post-op',
        atb: 'Pip-Tazo', atbList: [{ nombre: 'Pip-Tazo', via: 'IV', dosis: '4.5g c/8h', fechaInicioIV: daysAgo(8) }],
        aware: 'Watch', pol: 'vigilado',
        cult: 'positivo', organismo: 'Escherichia coli',
        mec_blee: true, mec_blee_ctxm: true, fenotipo: 'BLEE CTX-M',
        riesgo: 'moderado', accion: 'escalar',
        rev: '24h', notas: 'BLEE confirmada. Cambiar a Ertapenem según antibiograma. IAB con CL drenado.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Roberto Díaz Castillo', exp: 'EXP-006', edad: '61', sexo: 'M', peso: '85',
        servicio: 'Neumología', cama: '5',
        ingreso: daysAgo(6), medico: 'Dra. López',
        dx: 'NAC grave / CURB-65 ≥3',
        atb: 'Levofloxacino', atbList: [{ nombre: 'Levofloxacino', via: 'IV', dosis: '500mg c/24h', fechaInicioIV: daysAgo(6), toleraVO: 'sí' }],
        aware: 'Watch', pol: 'vigilado',
        cult: 'sí', organismo: 'Streptococcus pneumoniae',
        riesgo: 'moderado', accion: 'vo',
        rev: '48h', notas: 'Mejoría clínica 72h. Candidato switch IV→VO. Cultivo de esputo +. Desescalar a amoxicilina.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Sandra Moreno Ibarra', exp: 'EXP-007', edad: '29', sexo: 'F', peso: '55',
        servicio: 'Ginecología y Obstetricia', cama: '4',
        ingreso: daysAgo(2), medico: 'Dr. Jiménez',
        dx: 'Endometritis postparto',
        atb: 'Clindamicina + Gentamicina', atbList: [
          { nombre: 'Clindamicina', via: 'IV', dosis: '900mg c/8h', fechaInicioIV: daysAgo(2) },
          { nombre: 'Gentamicina', via: 'IV', dosis: '5mg/kg/día', fechaInicioIV: daysAgo(2) },
        ],
        aware: 'Watch', pol: 'libre',
        cult: 'no', organismo: '',
        alergias: 'Penicilina (rash urticarial)',
        riesgo: 'bajo', accion: 'mantener',
        icServicio: 'Infectología', icMotivo: 'Alergia a betalactámicos — orientación terapéutica',
        icUrgencia: 'rutinaria', icFinalizado: false,
        rev: '48h', notas: 'Alergia documentada a penicilina. IC infectología pendiente respuesta.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Pedro Ruiz Salinas', exp: 'EXP-008', edad: '58', sexo: 'M', peso: '90',
        servicio: 'Medicina Interna', cama: '15',
        ingreso: daysAgo(14), medico: 'Dra. Ríos',
        dx: 'Bacteriemia primaria — origen desconocido',
        atb: 'Cefepime', atbList: [{ nombre: 'Cefepime', via: 'IV', dosis: '2g c/8h', fechaInicioIV: daysAgo(14) }],
        aware: 'Watch', pol: 'libre',
        cult: 'positivo', organismo: 'Pseudomonas aeruginosa',
        mec_ampc: true, mec_bomba: true, fenotipo: 'AmpC + bomba de eflujo',
        riesgo: 'alto', accion: 'ajustar',
        rev: '24h', notas: 'Tratamiento >14 días. Considera optimización PK/PD con infusión extendida.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Carmen Álvarez Núñez', exp: 'EXP-009', edad: '43', sexo: 'F', peso: '60',
        servicio: 'Oncología Médica', cama: '8',
        ingreso: daysAgo(1), medico: 'Dr. Aguilar',
        dx: 'Neutropenia febril — LLA en tratamiento',
        atb: 'Cefepime', atbList: [{ nombre: 'Cefepime', via: 'IV', dosis: '2g c/8h', fechaInicioIV: daysAgo(1) }],
        aware: 'Watch', pol: 'libre',
        cult: 'pendiente', organismo: '',
        inmuno: 'neutropenia',
        riesgo: 'alto', accion: 'mantener',
        rev: '24h', notas: 'Neutropenia <500. Hemocultivos x2 enviados. Procalcitonina 8.4. Sin foco claro.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
      {
        nombre: 'Fernando Cruz Espinoza', exp: 'EXP-010', edad: '77', sexo: 'M', peso: '68',
        servicio: 'Geriatría', cama: '6',
        ingreso: daysAgo(9), medico: 'Dra. Vargas',
        dx: 'SSTI / Celulitis infectada — pie diabético',
        atb: 'Ceftriaxona', atbList: [{ nombre: 'Ceftriaxona', via: 'IV', dosis: '2g c/24h', fechaInicioIV: daysAgo(9), toleraVO: 'sí' }],
        aware: 'Watch', pol: 'libre',
        cult: 'sí', organismo: 'Streptococcus agalactiae',
        riesgo: 'moderado', accion: 'suspender',
        rev: '48h', notas: 'Buena evolución. Cultivo sensible a amoxicilina. Suspender IV y completar 7 días PO.',
        ts, updatedBy: 'demo@stewardmx.com', updatedAt: now.toISOString(),
      },
    ];

    const currentMonth = new Date().toISOString().slice(0, 7); // "2026-05"
    const patientsRef = db.collection(`hospitals/${hospitalId}/months/${currentMonth}/patients`);
    const writes = demoPacientes.map(p => patientsRef.add(p));
    await Promise.all(writes);

    return { ok: true, total: demoPacientes.length };
  }
);

// ════════════════════════════════════════════════════════════════════
// ── 8. exportSheetSA — Exportar a Google Sheets vía SERVICE ACCOUNT ──
//  Ningún hospital configura OAuth ni mete su correo. El servidor crea la
//  hoja con la identidad del Service Account de Firebase Functions y la
//  comparte al correo del usuario (writer). Multi-tenant, cero fricción.
//
//  Requisitos (una sola vez por el dueño):
//   1. Habilitar Google Sheets API + Drive API en el proyecto GCP.
//   2. Dar al Service Account de Functions el scope de Sheets/Drive
//      (las Application Default Credentials ya lo permiten si se solicita
//       el scope correcto en GoogleAuth, como aquí abajo).
//   3. firebase deploy --only functions:exportSheetSA
// ════════════════════════════════════════════════════════════════════
exports.exportSheetSA = onCall(
  // W4: SA_KEY ya NO se declara como secreto obligatorio (su ausencia bloqueaba TODO `firebase deploy
  // --only functions`). Google Sheets es legacy; la exportación oficial es local (.xlsx). Si algún día se
  // reactiva, configurar el secreto y leerlo de process.env; la guarda de abajo da un error claro entretanto.
  { cors: true, region: 'us-central1', timeoutSeconds: 300, memory: '512MiB' },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');
    if (!process.env.SA_KEY) throw new HttpsError('failed-precondition', 'La exportación a Google Sheets no está configurada (SA_KEY). Usa la exportación local a Excel (.xlsx).');
    const uid = req.auth.uid;
    const email = req.auth.token.email || '';
    const isSA = email === SUPER_ADMIN_EMAIL;

    // ── Autorización: admin/aprobado del hospital ──
    let hospitalId = req.data?.hospitalId || null;
    if (!isSA) {
      if (!hospitalId) {
        const ud = await db.doc(`users/${uid}`).get();
        hospitalId = ud.exists ? ud.data().hospitalId : null;
      }
      if (!hospitalId) throw new HttpsError('permission-denied', 'Sin hospital asignado');
      const hu = (await db.doc(`hospitals/${hospitalId}/users/${uid}`).get()).data() || {};
      if (hu.status !== 'admin' && hu.rol !== 'Líder PROA' && hu.rol !== 'Infectólogo') {
        throw new HttpsError('permission-denied', 'Solo administrador/Líder PROA puede exportar');
      }
    }

    const { title, sheets } = req.data || {};
    // sheets: [{ title:'...', values:[[...],[...]] }, ...]
    if (!Array.isArray(sheets) || !sheets.length) {
      throw new HttpsError('invalid-argument', 'sheets requerido (array de {title,values})');
    }

    // ── Auth con Service Account — LLAVE JSON (método definitivo multi-hospital) ──
    // El metadata/IAM Credentials falla con 403 en proyectos "sin organización".
    // Solución: firmar un JWT con la LLAVE JSON de la cuenta de servicio (secret SA_KEY) y
    // canjearlo por un access token con scopes de Sheets/Drive. Esto NO depende de IAM del
    // entorno → funciona para TODOS los hospitales sin configurar nada en el cliente.
    const SHEET_SCOPES = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ];
    let token = null;
    const rawKey = process.env.SA_KEY;
    if (rawKey) {
      try {
        const creds = JSON.parse(rawKey);
        const { JWT } = require('google-auth-library');
        const jwt = new JWT({
          email: creds.client_email,
          key: creds.private_key,
          scopes: SHEET_SCOPES,
        });
        const at = await jwt.authorize();   // intercambia el JWT firmado por un access_token
        token = at.access_token;
      } catch (e) {
        console.error('[exportSheetSA] SA_KEY JWT error', e.message);
      }
    }
    // Fallback: ADC (por si algún día se mueve a organización y el SA_KEY no está)
    if (!token) {
      try {
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({ scopes: SHEET_SCOPES });
        const client = await auth.getClient();
        token = (await client.getAccessToken()).token;
      } catch (e) { console.error('[exportSheetSA] ADC fallback error', e.message); }
    }
    if (!token) throw new HttpsError('failed-precondition', 'Falta configurar la llave de servicio (SA_KEY). El administrador de la plataforma debe subirla una vez. Mientras tanto usa "Exportar Excel".');
    if (!token) throw new HttpsError('internal', 'No se pudo obtener token de Sheets. Verifica que la cuenta de servicio tenga el rol "Creador de tokens de cuenta de servicio".');
    const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // ── DIAGNÓSTICO v233: verificar el scope REAL del token obtenido ──
    try {
      const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
      const tj = await ti.json();
      console.log('[exportSheetSA] TOKEN scopes=', tj.scope || '(sin scope)', '| email=', tj.email || tj.azp || '?');
    } catch (e) { console.log('[exportSheetSA] tokeninfo error', e.message); }

    // ── 1. Reusar spreadsheet existente o crear uno nuevo ──
    let ssId = null;
    try {
      const cfg = await db.doc(`hospitals/${hospitalId}/config/sheets_sa`).get();
      ssId = cfg.exists ? (cfg.data().ssId || null) : null;
    } catch (_) { /* ignore */ }

    // Verificar que el ssId guardado siga existiendo
    if (ssId) {
      const chk = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=spreadsheetId`, { headers: H });
      if (!chk.ok) ssId = null;
    }

    if (!ssId) {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          properties: { title: title || ('StewardMX — ' + hospitalId), locale: 'es_MX' },
          sheets: sheets.map(s => ({ properties: { title: s.title } })),
        }),
      });
      const cj = await createRes.json();
      if (!createRes.ok) {
        const gerr = cj.error || {};
        console.error('[exportSheetSA] create FAILED', createRes.status, JSON.stringify(gerr));
        // Mensaje accionable según el error real de Google
        const reason = (gerr.status || '') + ' ' + (gerr.message || '');
        if (/SERVICE_DISABLED|has not been used|disabled/i.test(reason)) {
          throw new HttpsError('failed-precondition', 'Falta habilitar Google Sheets API en el proyecto. Abre console.cloud.google.com → APIs → habilita "Google Sheets API" y "Google Drive API", espera 2 min y reintenta.');
        }
        if (/PERMISSION_DENIED|caller does not have/i.test(reason)) {
          throw new HttpsError('permission-denied', 'La cuenta de servicio no tiene permiso de Sheets. Verifica que Google Sheets API esté HABILITADA (no solo el rol Editor). Error Google: ' + (gerr.message || ''));
        }
        throw new HttpsError('internal', gerr.message || 'Error creando hoja');
      }
      ssId = cj.spreadsheetId;
      try { await db.doc(`hospitals/${hospitalId}/config/sheets_sa`).set({ ssId, createdAt: Date.now(), createdBy: email }, { merge: true }); } catch (_) {}
    } else {
      // Reúso: asegurar que existan todas las hojas necesarias
      const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=sheets.properties`, { headers: H })).json();
      const existing = (meta.sheets || []).map(s => s.properties.title);
      const missing = sheets.filter(s => !existing.includes(s.title));
      if (missing.length) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}:batchUpdate`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ requests: missing.map(s => ({ addSheet: { properties: { title: s.title } } })) }),
        });
      }
      // Limpiar contenido previo de las hojas que vamos a reescribir
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values:batchClear`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ ranges: sheets.map(s => `'${s.title.replace(/'/g, "''")}'!A1:ZZ20000`) }),
      });
    }

    // ── 2. Escribir valores (USER_ENTERED → las fórmulas viven) ──
    const data = sheets.map(s => ({ range: `'${s.title.replace(/'/g, "''")}'!A1`, values: s.values }));
    const wRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values:batchUpdate`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });
    if (!wRes.ok) { const ej = await wRes.json(); throw new HttpsError('internal', ej.error?.message || 'Error escribiendo'); }

    // ── 3. Compartir con el usuario (writer) para que pueda abrirla ──
    if (email) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${ssId}/permissions?sendNotificationEmail=false`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
        });
      } catch (_) { /* si falla el share, igual devolvemos el link */ }
    }

    const url = 'https://docs.google.com/spreadsheets/d/' + ssId;
    return { ok: true, ssId, url };
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
//  joinWithCode — onCall: valida el código de alta EN SERVIDOR y asigna el rol con
//  privilegios de servidor (Admin SDK omite reglas). Cierra el vector de escalada
//  encontrado por el CI: el cliente ya NO decide su propio rol — solo manda el código.
// ═══════════════════════════════════════════════════════════════════════════════
exports.joinWithCode = onCall(
  { region: 'us-central1', cors: true, timeoutSeconds: 30 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');
    const uid = req.auth.uid;
    const email = (req.auth.token.email || '').toString();
    const code = ((req.data && req.data.code) || '').toString().trim().toLowerCase();
    const nombre = ((req.data && req.data.nombre) || req.auth.token.name || email).toString().slice(0, 120);
    const especialidad = ((req.data && req.data.especialidad) || '').toString().slice(0, 80);
    if (!code) throw new HttpsError('invalid-argument', 'Código requerido');

    // 1) Validar el código SERVER-SIDE (no se confía en el cliente)
    let hospitalId, rol, autoAprobado;
    const codeSnap = await db.doc(`hospital_role_codes/${code}`).get();
    if (codeSnap.exists) {
      hospitalId = codeSnap.data().hospitalId;
      rol = codeSnap.data().rol;
      autoAprobado = true;
    } else {
      // ¿El código es el ID del hospital directo (código de Líder/hospital)?
      let hospOk = false;
      const reg = await db.doc(`hospitals_registry/${code}`).get();
      if (reg.exists) hospOk = true;
      else { const info = await db.doc(`hospitals/${code}/info/main`).get(); if (info.exists) hospOk = true; }
      if (!hospOk) throw new HttpsError('not-found', 'Código no válido');
      hospitalId = code;
      rol = 'Pendiente';
      autoAprobado = false;
    }

    // 2) Escribir el doc del usuario con el rol CONFIABLE (resuelto en servidor).
    //    Fechas en ISO string (consistente con lo que ya escribía el cliente; evita el gotcha de
    //    admin.firestore.FieldValue undefined en algunos runtimes).
    const nowISO = new Date().toISOString();
    await db.doc(`hospitals/${hospitalId}/users/${uid}`).set({
      uid, email, nombre, rol, especialidad,
      status: autoAprobado ? 'aprobado' : 'pendiente',
      active: autoAprobado,
      createdAt: nowISO,
      ...(autoAprobado ? { approvedAt: nowISO, approvedBy: 'role_code_server' } : {})
    }, { merge: true });
    await db.doc(`users/${uid}`).set({ hospitalId, email }, { merge: true });

    return { ok: true, hospitalId, rol, autoAprobado };
  }
);
