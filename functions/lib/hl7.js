'use strict';
// ════════════════════════════════════════════════════════════════════
// W1.2 — Parser HL7 v2 para resultados de microbiología (mensaje ORU^R01).
// La mayoría de los LIS mexicanos emiten HL7 v2 (no FHIR). Este parser convierte
// un ORU^R01 a la MISMA forma normalizada que ya consume StewardMX/lisSync:
//   { patient:{exp,name,sex,dob,bed,visit}, specimen:{type,collectedAt,reportedAt},
//     organism, antibiogram:[{drug, mic, interpretation}], rawResults:[...] }
// El FENOTIPO (BLEE/AmpC/carbapenemasa) NO se infiere aquí: lo hace el motor
// determinista `js/core/abg-phenotype.js` (cliente). Así no se duplica el motor.
//
// Unidad PURA (sin red, sin Firestore) → testeable. Pragmático: HL7 v2 micro varía
// entre laboratorios; cubre el layout común y se valida con mensajes reales en W1.5.
// ════════════════════════════════════════════════════════════════════

const SIR = /^(S|I|R|SDD|NS)$/i;            // banderas de susceptibilidad
const ORG_HINT = /organism|micro|identif|cultiv|isolate|aislad|germen/i;

/** HL7 datetime (YYYYMMDD[HHMMSS]) → 'YYYY-MM-DD[THH:MM:SS]' (sin objeto Date). */
function hl7date(s) {
  s = (s || '').replace(/\D/g, '');
  if (s.length < 8) return '';
  let out = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.length >= 12) out += `T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.length >= 14 ? s.slice(12, 14) : '00'}`;
  return out;
}

/**
 * @param {string} message  ORU^R01 crudo (segmentos separados por \r, \n o \r\n)
 * @returns objeto normalizado (ver cabecera). Lanza si no parece HL7.
 */
function parseORU(message) {
  const text = String(message || '').replace(/\r\n|\r/g, '\n').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const mshLine = lines.find(l => l.slice(0, 3) === 'MSH');
  if (!mshLine) throw new Error('Mensaje sin segmento MSH (no es HL7 v2)');

  // Separadores desde MSH: MSH<fieldSep><compSep><repSep><escChar><subSep>...
  const fieldSep = mshLine[3] || '|';
  const enc = mshLine.slice(4).split(fieldSep)[0] || '^~\\&';
  const compSep = enc[0] || '^';
  const repSep = enc[1] || '~';
  const escChar = enc[2] || '\\';

  const unesc = (s) => (s || '')
    .split(escChar + 'F' + escChar).join(fieldSep)
    .split(escChar + 'S' + escChar).join(compSep)
    .split(escChar + 'R' + escChar).join(repSep)
    .split(escChar + 'E' + escChar).join(escChar);

  const segs = lines.map(l => ({ name: l.slice(0, 3), f: l.split(fieldSep) }));
  const get = (seg, n) => (seg && seg.f[n] != null) ? seg.f[n] : '';
  const comp = (val, i) => (val || '').split(compSep)[i - 1] || '';   // componente 1-based

  const find = (name) => segs.find(s => s.name === name);
  const all = (name) => segs.filter(s => s.name === name);

  // ── MSH (tipo de mensaje / control id). En MSH, MSH-9 cae en f[8], MSH-10 en f[9].
  const msh = find('MSH');
  const messageType = [comp(get(msh, 8), 1), comp(get(msh, 8), 2)].filter(Boolean).join('^');
  const controlId = get(msh, 9);

  // ── PID: exp (MRN), nombre, sexo, dob.
  const pid = find('PID');
  let exp = '';
  if (pid) {
    const reps = (get(pid, 3) || '').split(repSep);
    const chosen = reps.find(r => comp(r, 5).toUpperCase() === 'MR') || reps[0] || '';
    exp = (comp(chosen, 1) || chosen).trim();
  }
  const nm = pid ? get(pid, 5) : '';
  const name = [comp(nm, 2), comp(nm, 1)].filter(Boolean).join(' ').trim();   // given family
  const sex = pid ? comp(get(pid, 8), 1).toUpperCase().slice(0, 1) : '';
  const dob = pid ? hl7date(get(pid, 7)) : '';

  // ── PV1: cama / cuenta.
  const pv1 = find('PV1');
  const bed = pv1 ? (comp(get(pv1, 3), 3) || comp(get(pv1, 3), 1)) : '';
  const visit = pv1 ? comp(get(pv1, 19), 1) : '';

  // ── OBR: muestra / fechas.
  const obr = find('OBR');
  const collectedAt = obr ? hl7date(get(obr, 7)) : '';
  const reportedAt = obr ? hl7date(get(obr, 22)) : '';
  const specimenType = obr ? (comp(get(obr, 15), 1) || unesc(get(obr, 15))) : '';

  // ── OBX: organismo + antibiograma.
  const rawResults = [];
  const antibiogram = [];
  let organism = '';
  for (const o of all('OBX')) {
    const code = comp(get(o, 3), 1);
    const ctext = unesc(comp(get(o, 3), 2)) || code;
    const value = unesc(get(o, 5)).trim();
    const units = comp(get(o, 6), 1);
    const flag = (get(o, 8) || '').trim();
    const valIsSIR = SIR.test(value);

    if (SIR.test(flag) || valIsSIR) {
      const interpretation = (SIR.test(flag) ? flag : value).toUpperCase();
      antibiogram.push({ drug: ctext, mic: valIsSIR ? null : (value || null), interpretation });
    } else if (!organism && (ORG_HINT.test(ctext) || ORG_HINT.test(code))) {
      organism = value;
    }
    rawResults.push({ code, text: ctext, value, units, interpretation: flag });
  }
  // Fallback: si ningún OBX se marcó como organismo, toma el primer resultado de texto no numérico/no-SIR.
  if (!organism) {
    const cand = rawResults.find(r => r.value && !SIR.test(r.value) && isNaN(parseFloat(r.value)));
    if (cand) organism = cand.value;
  }

  return {
    messageType, controlId,
    patient: { exp, name, sex, dob, bed, visit },
    specimen: { type: specimenType, collectedAt, reportedAt },
    organism: organism || null,
    antibiogram,
    rawResults,
  };
}

module.exports = { parseORU, hl7date };
