// ════════════════════════════════════════════════════════════════════
// js/core/vanco.js — AUC₀₋₂₄ de vancomicina por DOS NIVELES (PK de primer orden).
// PURO, testeable. Objetivo AUC 400–600 mg·h/L (IDSA/ASHP/SIDP/PIDS 2020).
// HONESTO: este método es de primer orden de DOS niveles, NO bayesiano. Para
// estimación bayesiana (MAP, un solo nivel, modelo poblacional) se requiere un
// motor validado aparte; aquí NO se simula. Toda dosis sugerida → "validación clínica".
// ════════════════════════════════════════════════════════════════════

/**
 * @param o { C1, t1, C2, t2, tau, tinf }
 *   C1 (mg/L) nivel 1 a t1 (h desde el INICIO de la infusión),
 *   C2 (mg/L) nivel 2 a t2 (h), tau = intervalo (h), tinf = duración de infusión (h).
 *   t1 y t2 deben ser ≥ tinf (fase de eliminación) y t1 < t2 < tau.
 * @returns { ke, thalf, Cmax, Cmin, aucTau, auc24, inTarget } o null si inválido.
 */
export function vancoAUC2level(o) {
  o = o || {};
  const { C1, t1, C2, t2, tau, tinf } = o;
  const nums = [C1, t1, C2, t2, tau, tinf];
  if (!nums.every(x => typeof x === 'number' && isFinite(x))) return null;
  if (C1 <= 0 || C2 <= 0 || t2 <= t1 || tau <= 0 || tinf <= 0 || t2 >= tau) return null;
  const ke = Math.log(C1 / C2) / (t2 - t1);          // constante de eliminación (h⁻¹)
  if (!(ke > 0) || !isFinite(ke)) return null;
  const thalf = 0.693 / ke;
  const Cmax = C1 * Math.exp(ke * (t1 - tinf));        // concentración al FIN de la infusión
  const Cmin = C2 * Math.exp(-ke * (tau - t2));        // concentración al FIN del intervalo
  const aucInf = ((Cmin + Cmax) / 2) * tinf;           // trapecio durante la infusión
  const aucElim = (Cmax - Cmin) / ke;                  // fase de eliminación log-lineal
  const aucTau = aucInf + aucElim;
  const auc24 = aucTau * (24 / tau);
  return { ke, thalf, Cmax, Cmin, aucTau, auc24, inTarget: auc24 >= 400 && auc24 <= 600 };
}

/** Dosis diaria sugerida para alcanzar un AUC objetivo (lineal). Requiere validación clínica. */
export function vancoSuggestDailyDose(currentDailyDose, auc24, target) {
  target = target || 500;
  if (!(currentDailyDose > 0) || !(auc24 > 0)) return null;
  return currentDailyDose * (target / auc24);
}
