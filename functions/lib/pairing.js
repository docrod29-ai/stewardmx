'use strict';
// ════════════════════════════════════════════════════════════════════
// W1.1 — Pareo de paciente para ingesta EHR/LIS.
// Prioridad: exp (expediente/MRN) → fhirId → nombre exacto.
//   · exp es el identificador ESTABLE del hospital (Fase 0 · D2): el más seguro
//     para parear entre sistemas; por eso va primero.
//   · fhirId pares a pacientes originados en el EHR (docId determinista ehr_{fhirId}).
//   · nombre es ÚLTIMO recurso (frágil; riesgo de ligar al paciente equivocado).
// Recibe `db` (Firestore) como parámetro → unidad PURA y testeable sin emulador.
// ════════════════════════════════════════════════════════════════════

/**
 * @param db Firestore (admin)
 * @param hospId string
 * @param month  'YYYY-MM'
 * @param ids    { fhirId?, name?, exp? }
 * @returns docId del paciente existente, o null.
 */
async function findExistingPatient(db, hospId, month, ids) {
  const { fhirId, name, exp } = ids || {};
  const base = `hospitals/${hospId}/months/${month}/patients`;

  // 1) Por expediente / MRN — el más confiable para parear entre sistemas.
  if (exp != null && String(exp).trim() !== '') {
    const e = String(exp).trim();
    let q = await db.collection(base).where('exp', '==', e).limit(1).get();
    // El expediente puede estar almacenado como número; si es solo dígitos, reintenta numérico.
    if (q.empty && /^\d+$/.test(e)) {
      q = await db.collection(base).where('exp', '==', Number(e)).limit(1).get();
    }
    if (!q.empty) return q.docs[0].id;
  }

  // 2) Por fhirId (paciente originado en el EHR → docId ehr_{fhirId}).
  if (fhirId) {
    const snap = await db.doc(`${base}/ehr_${fhirId}`).get();
    if (snap.exists) return `ehr_${fhirId}`;
  }

  // 3) Por nombre exacto — ÚLTIMO recurso.
  if (name) {
    const q = await db.collection(base).where('nombre', '==', name).limit(1).get();
    if (!q.empty) return q.docs[0].id;
  }

  return null;
}

module.exports = { findExistingPatient };
