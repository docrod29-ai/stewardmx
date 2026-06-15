// js/core/abg-phenotype.js
// ═══════════════════════════════════════════════════════════════════════════
//  Capa de SEGURIDAD del antibiograma — resistencia INTRÍNSECA + fenotipos EXCEPCIONALES.
//  Fuente única: EUCAST Expert Rules (Leclercq, Cantón et al., Clin Microbiol Infect 2013;19:141-160),
//  leído letra por letra (Tablas 1-7). Función PURA y determinista: (abg, organismo) → alertas. Sin
//  DOM/estado (PACS/HOSP/db). El objetivo es la seguridad clínica, ANTES de recomendar tratamiento:
//   (1) INTRÍNSECOS (Tablas 1-4): marcar una "S" engañosa cuando el organismo es intrínsecamente R
//       (un resultado S a un fármaco intrínsecamente inactivo = casi siempre error de ID/AST; aunque se
//       confirme, no debe usarse — EUCAST p.142).
//   (2) EXCEPCIONALES (Tablas 5-7): alertar de un fenotipo no descrito o rarísimo = probable error de
//       identificación/susceptibilidad → confirmar / enviar a referencia.
//  abg = {claveATB: 'S'|'I'|'R'} con las claves del panel ABG_ATBS de index.html.
// ═══════════════════════════════════════════════════════════════════════════

const CITA='EUCAST Expert Rules (Leclercq/Cantón, CMI 2013;19:141-160)';

// Nombres legibles de las claves referenciadas (autosuficiente para no depender de ABG_ATBS).
const ABG_PHENO_NOMBRES={
  amp:'Ampicilina',amsul:'Amp-Sulbactam',amcl:'Amox-Clav',oxa:'Oxacilina',pitaz:'Pip-Tazobactam',
  cefa:'Cefazolina',cfx:'Cefuroxima',fox:'Cefoxitina',cro:'Ceftriaxona',ctaz:'Ceftazidima',cfp:'Cefepime',
  imi:'Imipenem',mer:'Meropenem',ert:'Ertapenem',azt:'Aztreonam',
  gen:'Gentamicina',ami:'Amikacina',tob:'Tobramicina',cip:'Ciprofloxacino',lev:'Levofloxacino',
  van:'Vancomicina',tei:'Teicoplanina',lin:'Linezolid',dap:'Daptomicina',
  tmp:'TMP-SMX',nit:'Nitrofurantoína',fos:'Fosfomicina',col:'Colistina/PolB',tig:'Tigeciclina',mino:'Minociclina',
};

// ── Resistencia INTRÍNSECA por organismo (EUCAST Tablas 1-4) → claves del panel a las que es R ──
// Solo se codifican los fármacos presentes en el panel ABG_ATBS. Cada regla lleva su tabla EUCAST.
const INTRINSIC_RULES=[
  // ── Enterobacterales (Tabla 1) ──
  {re:/proteus/,                          ks:['col','tig','nit','mino'],                 t:'T1'}, // P. mirabilis/vulgaris/penneri
  {re:/providencia/,                      ks:['col','tig','nit','mino'],                 t:'T1'},
  {re:/morganella/,                       ks:['col','tig','nit','mino'],                 t:'T1'},
  {re:/serratia|marcescens/,              ks:['col'],                                    t:'T1'}, // S. marcescens R a colistina
  {re:/klebsiella/,                       ks:['amp'],                                    t:'T1'}, // Klebsiella siempre amp-R
  {re:/enterobacter|cloacae|aerogenes/,   ks:['amp','amcl','cefa','fox'],                t:'T1'},
  {re:/freundii/,                         ks:['amp','amcl','cefa','fox'],                t:'T1'}, // C. freundii (AmpC)
  {re:/koseri/,                           ks:['amp'],                                    t:'T1'}, // C. koseri solo amp-R
  {re:/hafnia/,                           ks:['amp','amcl','cefa','fox'],                t:'T1'},
  // ── No fermentadores (Tabla 2) ──
  {re:/aeruginosa/,                       ks:['amp','amsul','amcl','cefa','cfx','cro','ert','tmp'], t:'T2'},
  {re:/acinetobacter|baumannii/,          ks:['amp','amcl','ert','azt','tmp','fos'],     t:'T2'}, // NO amsul: sulbactam ES activo vs Acinetobacter
  {re:/stenotrophomonas|maltophilia/,     ks:['imi','mer','ert','amp','amcl','cefa','cro','gen','ami','tob','fos'], t:'T2'}, // carbapenémicos intrínsecamente R → TMP-SMX 1ª línea
  // ── Gram-positivos (Tabla 4 + cabecera: GP también R a aztreonam y colistina/PolB) ──
  {re:/enterococ|faecium|faecalis/,       ks:['cefa','cfx','fox','cro','ctaz','cfp','azt','col'], t:'T4'}, // enterococo R a TODAS las cefalosporinas
  {re:/staphyloc|aureus|streptoc|neumococo|pneumococ|pyogenes|agalactiae/, ks:['azt','col'], t:'T4'}, // NO usar /pneumoniae/ suelto: colisiona con Klebsiella pneumoniae (Gram-negativa)
];

// Devuelve los fármacos del panel a los que el organismo es intrínsecamente R PERO el AST reportó "S"
// (la "S engañosa" — el caso peligroso). R/I no se marca: coincide con lo esperado.
function intrinsicConflicts(abg,organismo){
  const org=(organismo||'').toLowerCase(); const out=[]; const seen=new Set();
  if(!abg||!org)return out;
  INTRINSIC_RULES.forEach(r=>{
    if(!r.re.test(org))return;
    r.ks.forEach(k=>{
      if(seen.has(k))return;
      if(abg[k]==='S'){ seen.add(k); out.push({k,n:ABG_PHENO_NOMBRES[k]||k,cita:CITA+' '+r.t}); }
    });
  });
  return out;
}

// Devuelve fenotipos EXCEPCIONALES (Tablas 5-7) = probable error de ID/AST → confirmar.
function exceptionalPhenotypes(abg,organismo){
  const org=(organismo||'').toLowerCase(); const out=[];
  if(!abg||!org)return out;
  const anyR=(...ks)=>ks.some(k=>abg[k]==='R'||abg[k]==='I');
  // 6.1 — S. aureus R a glucopéptido/linezolid/daptomicina/tigeciclina = rarísimo
  if(/aureus|staphylococcus/.test(org)&&anyR('van','tei','lin','dap','tig'))
    out.push({msg:'S. aureus R a vancomicina/teicoplanina/linezolid/daptomicina/tigeciclina es EXCEPCIONAL → confirmar ID/AST y enviar a laboratorio de referencia.',cita:CITA+' T6 (regla 6.1)'});
  // 6.4 — S. pneumoniae R a carbapenémico/glucopéptido/linezolid
  // OJO: /pneumoniae/ suelto colisiona con Klebsiella pneumoniae (Gram-negativa) → usar matcher de neumococo.
  if(/streptococc|neumococo|pneumococ|s\.?\s*pneumoniae/.test(org)&&anyR('imi','mer','van','tei','lin'))
    out.push({msg:'S. pneumoniae R a imipenem/meropenem/vancomicina/teicoplanina/linezolid es EXCEPCIONAL → confirmar ID/AST.',cita:CITA+' T6 (regla 6.4)'});
  // 6.5 — estreptococo β-hemolítico R a penicilina (proxy del panel: ampicilina)
  if(/pyogenes|agalactiae|hemol[ií]tic|grupo a|grupo b/.test(org)&&abg['amp']==='R')
    out.push({msg:'Estreptococo β-hemolítico (A/B/C/G) R a penicilina/ampicilina es EXCEPCIONAL (uniformemente sensible) → confirmar ID/AST.',cita:CITA+' T6 (regla 6.5)'});
  // 6.7/6.8 — E. faecalis R a ampicilina → sospechar identificación errónea (probable E. faecium)
  if(/faecalis/.test(org)&&abg['amp']==='R')
    out.push({msg:'E. faecalis R a ampicilina es raro → sospechar identificación errónea (probable E. faecium).',cita:CITA+' T6 (reglas 6.7-6.8)'});
  // 5.3 — P. aeruginosa / Acinetobacter R a colistina = excepcional (emergente → confirmar/notificar)
  if(/aeruginosa|acinetobacter|baumannii/.test(org)&&abg['col']==='R')
    out.push({msg:'Colistina-R en P. aeruginosa/Acinetobacter es EXCEPCIONAL → confirmar (resistencia emergente) y notificar.',cita:CITA+' T5 (regla 5.3)'});
  // 5.1 — Enterobacterales (salvo Proteae) R a carbapenémico → confirmar carbapenemasa o error
  if(/coli|klebsiella|enterobacter|serratia|citrobacter|cloacae|aerogenes|freundii|koseri|hafnia|escherichia/.test(org)
     && !/proteus|providencia|morganella/.test(org) && anyR('imi','mer'))
    out.push({msg:'Enterobacterales R a imipenem/meropenem: confirmar carbapenemasa por método molecular (o descartar error de ID/AST).',cita:CITA+' T5 (regla 5.1)'});
  return out;
}

// ── Cross-resistencia de FLUOROQUINOLONAS (EUCAST Tabla 13) → EDICIÓN interpretativa ──
// Principio (EUCAST): la R a la FQ MÁS ACTIVA in vitro implica R a TODAS las fluoroquinolonas.
//  • Gram-negativos: la más activa es ciprofloxacino → cipro-R ⇒ reportar levo/moxi como R (regla 13.5).
//  • Gram-positivos (estafilococo/neumococo): las más activas son levo/moxi → levo-R o moxi-R ⇒ todas R
//    (reglas 13.2/13.4); cipro-R con levo/moxi-S = mutación de PRIMER PASO → advertir selección de R
//    durante el tratamiento (reglas 13.1/13.3).
// Devuelve {edits:[{k,n,cita}], avisos:[{msg,cita}]}. Las ediciones solo marcan un fármaco reportado "S"
// que debe reportarse R por inferencia (la trampa accionable); no inventa fármacos no probados.
function quinoloneCrossResistance(abg,organismo){
  const org=(organismo||'').toLowerCase(); const edits=[],avisos=[];
  if(!abg||!org)return {edits,avisos};
  const FQ=[['cip','Ciprofloxacino'],['lev','Levofloxacino'],['mox','Moxifloxacino']];
  const isR=k=>abg[k]==='R'||abg[k]==='I';
  const cita=r=>CITA+' T13 (regla '+r+')';
  const editToR=(keys,c)=>keys.forEach(([k,n])=>{ if(abg[k]==='S')edits.push({k,n,cita:c}); });
  const isGN=/coli|klebsiella|enterobacter|serratia|citrobacter|cloacae|aerogenes|freundii|koseri|hafnia|escherichia|proteus|providencia|morganella|aeruginosa|acinetobacter|baumannii|salmonella|shigella/.test(org);
  const isStaph=/staphyloc|aureus/.test(org); const isPneumo=/streptococc|neumococo|pneumococ|s\.?\s*pneumoniae/.test(org); // no /pneumoniae/ suelto (colisiona con Klebsiella)
  if(isGN){
    if(isR('cip'))editToR(FQ.filter(([k])=>k!=='cip'),cita('13.5'));
  }else if(isStaph||isPneumo){
    if(isR('lev')||isR('mox'))editToR(FQ.filter(([k])=>abg[k]==='S'),isStaph?cita('13.2'):cita('13.4'));
    else if(isR('cip')&&(abg['lev']||abg['mox']))avisos.push({msg:'Cipro/ofloxacino-R con levo/moxi-S: mutación de PRIMER PASO → riesgo de selección de R a todas las fluoroquinolonas durante el tratamiento.',cita:isStaph?cita('13.1'):cita('13.3')});
  }
  return {edits,avisos};
}

// ── HLAR (resistencia de alto nivel a aminoglucósidos) en enterococo (EUCAST Tabla 12, regla 12.6) ──
// La R de ALTO NIVEL a gentamicina (screen específico, MIC>128) anula la SINERGIA β-lactámico+aminoglucósido
// usada en la endocarditis enterocócica. El panel no incluye el screen de alto nivel, así que se emite un
// AVISO (no un hecho) cuando la gentamicina sale no-S en enterococo → confirmar con el screen HLAR.
function aminoglycosideSynergy(abg,organismo){
  const org=(organismo||'').toLowerCase(); const avisos=[];
  if(!abg||!org)return avisos;
  if(/enterococ|faecium|faecalis/.test(org)&&(abg['gen']==='R'||abg['gen']==='I'))
    avisos.push({msg:'Enterococo con gentamicina no-S: confirmar resistencia de ALTO nivel (HLAR, screen MIC>128). Si HLAR+, se PIERDE la sinergia β-lactámico+aminoglucósido (clave en endocarditis enterocócica).',cita:CITA+' T12 (regla 12.6)'});
  return avisos;
}

export {INTRINSIC_RULES,ABG_PHENO_NOMBRES,intrinsicConflicts,exceptionalPhenotypes,quinoloneCrossResistance,aminoglycosideSynergy};
