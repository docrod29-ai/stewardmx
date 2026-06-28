'use strict';
// ════════════════════════════════════════════════════════════════════
// W1.4 — Simulador de mensajes HL7 v2 ORU^R01 (microbiología + antibiograma).
// Genera mensajes sintéticos de-identificados para probar TODO el tubo de ingesta
// (HL7 → parseORU → normalizeLisInput → pareo por exp → labId idempotente) SIN
// depender del hospital. Útil en pruebas y como generador de ejemplos para TI/LIS.
// ════════════════════════════════════════════════════════════════════

/**
 * @param o { controlId, exp, family, given, sex, dob, bed, service, specimenType,
 *            organism, antibiogram:[{drug,mic,interpretation}], collectedAt('YYYYMMDDHHMMSS') }
 * @returns string ORU^R01 (segmentos separados por \r)
 */
function buildORU(o = {}) {
  const S = (v) => (v == null ? '' : String(v));
  const cid = S(o.controlId || 'SIM1');
  const dt = S(o.collectedAt || '20260101120000').replace(/[-:T]/g, '').slice(0, 14);
  const seg = [];
  seg.push(`MSH|^~\\&|SIM|LAB|STEWARD|HOSP|${dt}||ORU^R01|${cid}|P|2.5.1`);
  seg.push(`PID|1||${S(o.exp)}^^^HOSP^MR||${S(o.family)}^${S(o.given)}||${S(o.dob)}|${S(o.sex)}`);
  if (o.bed) seg.push(`PV1|1|I|${S(o.bed)}`);
  // OBR-7 = fecha de toma; OBR-15 = muestra.
  seg.push(`OBR|1||${cid}|${S(o.service || 'Culture')}|||${dt}|||||||||${S(o.specimenType)}`);
  let n = 1;
  if (o.organism) seg.push(`OBX|${n++}|ST|ORG^Organism identified^L||${S(o.organism)}||||||F`);
  for (const a of (o.antibiogram || [])) {
    const mic = a.mic != null ? S(a.mic) : '';
    // OBX-5 = MIC, OBX-8 = S/I/R.
    seg.push(`OBX|${n++}|NM|${S(a.drug)}^${S(a.drug)}^L||${mic}|mg/L||${S(a.interpretation)}|||F`);
  }
  return seg.join('\r');
}

/** Un puñado de casos representativos para demos/pruebas. */
function sampleMessages() {
  return [
    buildORU({
      controlId: 'SIM-ECOLI', exp: '0012345', family: 'PEREZ', given: 'JUAN', sex: 'M',
      collectedAt: '20260626080000', specimenType: 'Sangre', organism: 'Escherichia coli',
      antibiogram: [
        { drug: 'Ceftriaxona', mic: '>=64', interpretation: 'R' },
        { drug: 'Meropenem', mic: '<=0.25', interpretation: 'S' },
        { drug: 'Ciprofloxacino', mic: '2', interpretation: 'I' },
      ],
    }),
    buildORU({
      controlId: 'SIM-SAUR', exp: '77777', family: 'LOPEZ', given: 'MARIA', sex: 'F',
      collectedAt: '20260627090000', specimenType: 'Hemocultivo', organism: 'Staphylococcus aureus',
      antibiogram: [
        { drug: 'Oxacilina', interpretation: 'R' },
        { drug: 'Vancomicina', interpretation: 'S' },
      ],
    }),
  ];
}

module.exports = { buildORU, sampleMessages };
