'use strict';
// ════════════════════════════════════════════════════════════════════
// W1.3 — Helpers de ingesta LIS (puros, testeables).
//  · labIdFor: clave de laboratorio DETERMINISTA → idempotencia (reenviar el
//    mismo mensaje NO crea duplicados). Usa el control id del mensaje (HL7 MSH-10)
//    o, si no hay, un hash estable de (paciente, organismo, fecha de toma).
//  · normalizeLisInput: une la entrada HL7 (parseORU) o JSON en campos canónicos.
// ════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

function labIdFor({ controlId, patientId, organism, collectedAt } = {}) {
  if (controlId) return 'LIS_' + String(controlId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const key = [patientId || '', organism || '', collectedAt || ''].join('|');
  return 'LIS_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
}

function normalizeLisInput({ hl7, body } = {}) {
  if (hl7) {
    const p = hl7.patient || {}, s = hl7.specimen || {};
    return {
      exp: p.exp || null, name: p.name || null, patientId: null,
      specimenType: s.type || null, organism: hl7.organism || null,
      antibiogram: hl7.antibiogram || [], collectedAt: s.collectedAt || null,
      reportedAt: s.reportedAt || null, controlId: hl7.controlId || null, source: 'LIS-HL7',
    };
  }
  const b = body || {};
  return {
    exp: b.exp || null, name: b.nombre || b.patientName || null, patientId: b.patientId || null,
    specimenType: b.specimenType || null, organism: b.organism || null,
    antibiogram: b.antibiogram || [], collectedAt: b.collectedAt || null,
    reportedAt: b.reportedAt || null, controlId: b.messageId || b.controlId || null, source: 'LIS',
  };
}

module.exports = { labIdFor, normalizeLisInput };
