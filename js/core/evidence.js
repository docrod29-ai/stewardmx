// ════════════════════════════════════════════════════════════════════
// js/core/evidence.js — Arnés de métricas de impacto PROA (W5). PURO, testeable.
// Combina los denominadores ya validados (días-paciente, DOT, DOT/1000) con la
// aceptación de intervenciones y el % de aislamientos multirresistentes, para
// poder medir un estudio piloto antes/después. NO ejecuta el estudio (eso es
// externo: comité/IRB + meses); aquí está la INFRAESTRUCTURA de medición.
// ════════════════════════════════════════════════════════════════════
import { calcDOT, calcDiasPaciente, dotPer1000 } from './clinical-days.js';

/**
 * @param pacs  arreglo de pacientes (mismo shape que el censo).
 * @param opts  { hasta?, intervenciones:{total,aceptadas}, resistencia:{mdr,total} }
 * @returns objeto con las métricas del periodo.
 */
export function buildEvidenceReport(pacs, opts) {
  opts = opts || {};
  const arr = Array.isArray(pacs) ? pacs : [];
  const diasPaciente = calcDiasPaciente(arr, opts.hasta);
  const dot = calcDOT(arr, opts.hasta);
  const dot1000 = dotPer1000(arr, opts.hasta);
  const iv = opts.intervenciones || {};
  const r = opts.resistencia || {};
  const pct = (num, den) => (den > 0 ? Math.round((1000 * num / den)) / 10 : null);  // 1 decimal
  // dotPer1000() devuelve {dot, diasPaciente, por1000}; el reporte necesita el NÚMERO por1000.
  // Antes se guardaba el objeto entero → el render mostraba "[object Object]" y compareEvidence,
  // al comparar objetos con delta(a,b) (a>0 falso), dejaba deltaPct siempre en null.
  const dotPer1000Num = (dot1000 && typeof dot1000 === 'object') ? dot1000.por1000 : dot1000;
  return {
    pacientes: arr.length,
    diasPaciente,
    dot,
    dotPer1000: dotPer1000Num,
    intervenciones: iv.total || 0,
    aceptadas: iv.aceptadas || 0,
    aceptacionPct: pct(iv.aceptadas || 0, iv.total || 0),
    mdrIsolados: r.mdr || 0,
    isolados: r.total || 0,
    mdrPct: pct(r.mdr || 0, r.total || 0),
  };
}

/** Compara dos periodos (antes/después) y devuelve los deltas relativos (%). */
export function compareEvidence(antes, despues) {
  if (!antes || !despues) return null;
  const delta = (a, b) => (a > 0 && b != null ? Math.round((1000 * (b - a) / a)) / 10 : null);
  return {
    dotPer1000: { antes: antes.dotPer1000, despues: despues.dotPer1000, deltaPct: delta(antes.dotPer1000, despues.dotPer1000) },
    mdrPct: { antes: antes.mdrPct, despues: despues.mdrPct, deltaPct: delta(antes.mdrPct, despues.mdrPct) },
    aceptacionPct: { antes: antes.aceptacionPct, despues: despues.aceptacionPct },
  };
}
