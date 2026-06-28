// ════════════════════════════════════════════════════════════════════
// js/core/alerts.js — Motor DETERMINISTA de alertas PROA (W2).
// PURO: sin DOM, sin Firebase, sin PACS. Opera sobre un paciente `p` con la forma
// real de la app (p.atbList[{nombre,via}], p.abg{clave:S/I/R}, p.organismo, p.cult,
// …). Lo stateful (mapear nombre→clave abg, CrCl, días, isMDR) lo inyecta la app vía
// `opts` para mantener este módulo puro y testeable. Cada regla es citable a guía;
// las dosis se marcan "validación clínica". La IA no interviene aquí.
// ════════════════════════════════════════════════════════════════════

const RENAL_RX = /vancomic|meropenem|imipenem|ertapenem|piperacil|cefepim|ceftazidim|amikac|gentamic|tobramic|colistin|polimix|fluconaz|trimetop|sulfameto|levofloxac|ciprofloxac|aciclov|ganciclov|valganciclov/i;
const BROAD_RX = /meropenem|imipenem|ertapenem|piperacil|cefepim|ceftazidim|vancomic|linezolid|daptomic|tigecic|colistin|cefta.*avi|ceftol/i;
const IV_RX = /\biv\b|i\.?v\.?|intraven|endoven/i;

const A = (p) => Array.isArray(p && p.atbList) ? p.atbList : [];

// 1) Discordancia antibiótico–antibiograma (bug-drug mismatch).
export function ruleMismatch(p, resolveKey) {
  if (!resolveKey) return [];
  const abg = (p && p.abg) || {};
  const out = [];
  for (const a of A(p)) {
    const k = resolveKey(a.nombre || '');
    const v = k && abg[k];
    if (v === 'R' || v === 'I') {
      out.push({ id: 'mismatch_' + k, sev: 'alta', atb: a.nombre,
        titulo: 'Discordancia antibiótico–antibiograma',
        detalle: (a.nombre || 'El antibiótico') + ' reporta ' + v + ' en el antibiograma de este aislamiento: cambiar a un agente con sensibilidad demostrada.' });
    }
  }
  return out;
}

// 2) Ajuste por función renal.
export function ruleRenal(p, crcl) {
  if (crcl == null || isNaN(crcl) || crcl >= 30) return [];
  const hits = A(p).filter(a => RENAL_RX.test(a.nombre || ''));
  if (!hits.length) return [];
  return [{ id: 'renal', sev: 'media', titulo: 'Ajuste por función renal',
    detalle: 'TFG estimada ' + Math.round(crcl) + ' mL/min: revisar la dosis de ' + hits.map(a => a.nombre).join(', ') + ' (validación clínica).' }];
}

// 3) Candidato a switch IV→VO.
export function ruleIVtoPO(p, dot) {
  const iv = A(p).filter(a => IV_RX.test(a.via || ''));
  if (iv.length && (dot || 0) >= 3) {
    return [{ id: 'ivpo', sev: 'media', titulo: 'Candidato a switch IV→VO',
      detalle: 'Terapia IV ≥' + dot + ' días: si está estable, afebril y tolera la vía oral, considerar el cambio a vía oral.' }];
  }
  return [];
}

// 4) Duración prolongada.
export function ruleDuration(p, dot, max) {
  max = max || 7;
  if ((dot || 0) >= max) {
    return [{ id: 'dur', sev: 'media', titulo: 'Duración prolongada',
      detalle: 'Antibiótico ≥' + dot + ' días: revisar la indicación, el foco y definir fecha de término.' }];
  }
  return [];
}

// 5) Antibiótico sin cultivo documentado.
export function ruleNoCulture(p) {
  if (!A(p).length) return [];
  const hasCult = (p && (p.cult === 'positivo' || p.cult === 'pendiente')) || !!(p && p.organismo) || !!(p && Array.isArray(p.cultivos) && p.cultivos.length);
  if (!hasCult) {
    return [{ id: 'nocult', sev: 'media', titulo: 'Antibiótico sin cultivo',
      detalle: 'Bajo antibiótico sin cultivo documentado: tomar cultivos apropiados antes de continuar o escalar.' }];
  }
  return [];
}

// 6) Multirresistente / notificación NOM-045.
export function ruleMDR(p, isMDR) {
  if (!isMDR) return [];
  return [{ id: 'mdr', sev: 'alta', titulo: 'Multirresistente — notificación NOM-045',
    detalle: 'Aislamiento multirresistente' + (p && p.organismo ? ' (' + p.organismo + ')' : '') + ': precauciones de contacto y notificación epidemiológica; tratamiento dirigido por antibiograma.' }];
}

// 7) Oportunidad de desescalada.
export function ruleDeescalation(p) {
  const onBroad = A(p).some(a => BROAD_RX.test(a.nombre || ''));
  const hasResult = (p && (p.cult === 'positivo' || p.organismo));
  if (onBroad && hasResult) {
    return [{ id: 'deesc', sev: 'media', titulo: 'Oportunidad de desescalada',
      detalle: 'Antibiótico de amplio espectro con cultivo disponible: desescalar al agente más estrecho según el antibiograma.' }];
  }
  return [];
}

/**
 * Corre todas las reglas. opts = { resolveKey(name)→claveAbg, crcl, dot, isMDR, maxDur }.
 * Devuelve un arreglo de alertas {id, sev, titulo, detalle, atb?}.
 */
export function proaAlerts(p, opts) {
  opts = opts || {};
  return [].concat(
    ruleMismatch(p, opts.resolveKey),
    ruleMDR(p, opts.isMDR),
    ruleRenal(p, opts.crcl),
    ruleIVtoPO(p, opts.dot),
    ruleDuration(p, opts.dot, opts.maxDur),
    ruleNoCulture(p),
    ruleDeescalation(p),
  );
}
