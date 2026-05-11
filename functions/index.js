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
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const ANTHROPIC_KEY = defineSecret('ANTHROPIC_KEY');

// ════════════════════════════════════════════════════════════════════
// ── 1. Proxy seguro a Anthropic ─────────────────────────────────────
// ════════════════════════════════════════════════════════════════════
exports.anthropicProxy = onCall(
  { secrets: [ANTHROPIC_KEY], cors: true, region: 'us-central1', timeoutSeconds: 60 },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Login requerido');

    const uid = req.auth.uid;
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) throw new HttpsError('permission-denied', 'Usuario no encontrado');
    const { hospitalId } = userDoc.data();
    if (!hospitalId) throw new HttpsError('permission-denied', 'Sin hospital asignado');
    const hospUserDoc = await db.doc(`hospitals/${hospitalId}/users/${uid}`).get();
    const hu = hospUserDoc.data() || {};
    if (hu.status !== 'aprobado' && hu.status !== 'admin') {
      throw new HttpsError('permission-denied', 'Usuario no aprobado');
    }

    const { messages, system, max_tokens = 1500, model = 'claude-sonnet-4-5' } = req.data || {};
    if (!Array.isArray(messages) || !messages.length) {
      throw new HttpsError('invalid-argument', 'messages requerido');
    }

    // Rate limiting básico: máx 30 req/min/usuario
    const rlKey = `rate:${uid}:${Math.floor(Date.now() / 60000)}`;
    const rl = await db.doc(`_ratelimits/${rlKey}`).get();
    const count = (rl.exists ? rl.data().n : 0) + 1;
    if (count > 30) throw new HttpsError('resource-exhausted', 'Rate limit excedido (30/min)');
    await db.doc(`_ratelimits/${rlKey}`).set({ n: count, ts: Date.now() });

    const apiKey = ANTHROPIC_KEY.value();
    if (!apiKey) throw new HttpsError('failed-precondition', 'API key no configurada en secrets');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    });
    const j = await res.json();
    if (!res.ok) throw new HttpsError('internal', j.error?.message || 'Error Anthropic');

    try {
      await db.collection(`hospitals/${hospitalId}/_ai_audit`).add({
        uid, email: req.auth.token.email,
        model, tokens_in: j.usage?.input_tokens || 0, tokens_out: j.usage?.output_tokens || 0,
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });
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

    const hospId = req.query.hospId;
    if (!hospId) return res.json({ cards: [] });

    // Validar token
    const token = req.headers['x-stewardmx-token'];
    let validToken = false;
    try {
      const cfgSnap = await db.doc(`hospitals/${hospId}/ehr_config/main`).get();
      if (cfgSnap.exists) {
        validToken = cfgSnap.data().webhookToken === token;
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

    const body = req.body || {};

    // Detectar si es FHIR MedicationRequest o JSON simplificado
    const isFHIR = body.resourceType === 'MedicationRequest';

    let hospId, token, patientName, patientId, medicationName, dosage, route, requester, service;

    if (isFHIR) {
      // FHIR R4 MedicationRequest
      hospId = req.query.hospId;
      token = req.headers['x-stewardmx-token'] || req.query.token;
      patientName = body.subject?.display || 'Paciente';
      patientId = body.subject?.reference || null;
      medicationName = getMedName(body);
      dosage = getDose(body);
      route = getRoute(body);
      requester = getRequester(body);
      service = body.encounter?.display || null;
    } else {
      // JSON simplificado
      hospId = body.hospId || req.query.hospId;
      token = body.token || req.headers['x-stewardmx-token'];
      patientName = body.patientName || 'Paciente';
      patientId = body.patientId || null;
      medicationName = body.medication || 'ATB no especificado';
      dosage = body.dosage || null;
      route = body.route || null;
      requester = body.requester || 'Médico';
      service = body.service || null;
    }

    if (!hospId) return res.status(400).json({ ok: false, error: 'hospId requerido' });

    // Validar token
    let validToken = false;
    try {
      const cfgSnap = await db.doc(`hospitals/${hospId}/ehr_config/main`).get();
      if (cfgSnap.exists) {
        validToken = cfgSnap.data().webhookToken === token;
      }
    } catch (e) {
      console.error('[ehrWebhook] error validating token:', e.message);
    }
    if (!validToken) return res.status(401).json({ ok: false, error: 'Token inválido' });

    // Guardar solicitud
    let docId;
    try {
      const fhirMedicationRequestId = isFHIR ? (body.id || `fhir_${Date.now()}`) : `web_${Date.now()}`;
      const docRef = await db.collection(`hospitals/${hospId}/ehr_requests`).add({
        fhirMedicationRequestId,
        patientName,
        patientFhirId: isFHIR ? (body.subject?.reference?.split('/').pop() || null) : null,
        medicationName,
        dosage,
        route,
        requester,
        service,
        status: 'pending',
        source: isFHIR ? 'fhir_webhook' : 'generic_webhook',
        fhirContext: isFHIR ? JSON.stringify(body) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      docId = docRef.id;

      // Notificar equipo PROA
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
