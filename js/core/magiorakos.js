// ═══════════════════════════════════════════════════════════════════════════
//  StewardMX · js/core/magiorakos.js — Clasificación MDR/XDR/PDR (PURO, sin estado)
//  4º módulo extraído del monolito (v299). Estándares: Magiorakos et al. 2012 (CMI) +
//  CLSI M100 (categorías por especie) + resistencia INTRÍNSECA EUCAST (se EXCLUYE del cómputo).
//  Determinista; NO toca PACS/HOSP/db/DOM. index.html lo importa y reexpone en window.*.
//  Las pruebas importan la función REAL (tests/critical-flows.test.mjs).
// ═══════════════════════════════════════════════════════════════════════════

// CLSI M100 Categorías de antimicrobianos por especie (Magiorakos 2012, Table)
// Cada especie tiene su panel y su agrupación en CATEGORIES.
export const CLSI_CATEGORIES={
  // Enterobacterales (E. coli, K. pneumoniae, E. cloacae, etc.)
  ENTEROBACTERALES:{
    'Aminoglycosides':['gen','tob','ami','netilmicin'],
    'Antipseudomonal_Penicillins_BLI':['pitaz','ticarcillin-clav'],
    'Carbapenems':['ert','imi','mer','doripenem'],
    'Non-extended_Cephalosporins':['cefa','cfx','cefuroxime'],
    'Extended-spectrum_Cephalosporins':['cro','ctaz','cfp','ceftriaxone','cefotaxime'],
    'Cephamycins':['fox','cefotetan','cefmetazol'],
    'Fluoroquinolones':['cip','lev','mox'],
    'Folate_Pathway_Inhibitors':['tmp','sxt'],
    'Glycylcyclines':['tig'],
    'Monobactams':['azt'],
    'Penicillins':['amp'],
    'Penicillins_BLI':['amsul','amcl'],
    'Phenicols':['chloramphenicol'],
    'Phosphonic_Acids':['fos'],
    'Polymyxins':['col','polymyxin_b'],
    'Tetracyclines':['mino','doxy','tetracycline'],
    'NewBL_BLI':['cazavi','imrel','vaborbactam','cfid'],
  },
  // Pseudomonas aeruginosa
  PSEUDOMONAS:{
    'Aminoglycosides':['gen','tob','ami','netilmicin'],
    'Antipseudomonal_Carbapenems':['imi','mer','doripenem'],
    'Antipseudomonal_Cephalosporins':['ctaz','cfp'],
    'Antipseudomonal_Fluoroquinolones':['cip','lev'],
    'Antipseudomonal_Penicillins_BLI':['pitaz','ticarcillin-clav'],
    'Monobactams':['azt'],
    'Phosphonic_Acids':['fos'],
    'Polymyxins':['col','polymyxin_b'],
    'NewBL_BLI':['cazavi','cfol','imrel','cfid'],
  },
  // Acinetobacter baumannii
  ACINETOBACTER:{
    'Aminoglycosides':['gen','tob','ami','netilmicin'],
    'Antipseudomonal_Carbapenems':['imi','mer','doripenem'],
    'Antipseudomonal_Penicillins_BLI':['pitaz','ticarcillin-clav'],
    'Extended-spectrum_Cephalosporins':['ctaz','cfp'],
    'Fluoroquinolones':['cip','lev'],
    'Folate_Pathway_Inhibitors':['sxt','tmp'],
    'Penicillins_BLI':['amsul'],
    'Polymyxins':['col','polymyxin_b'],
    'Tetracyclines':['mino','doxy','tetracycline'],
    'Glycylcyclines':['tig'],
    'NewBL_BLI':['cfid'],
  },
  // Staphylococcus aureus
  S_AUREUS:{
    'Aminoglycosides':['gen','tob','ami'],
    'Ansamycins':['rifampin','rif'],
    'Anti-MRSA_Cephalosporins':['ceftarolin'],
    'Anti-staph_BL':['oxa','cefoxitin'],
    'Fluoroquinolones':['cip','lev','mox'],
    'Folate_Pathway_Inhibitors':['sxt','tmp'],
    'Fucidanes':['fusidic_acid'],
    'Glycopeptides':['van','tei'],
    'Glycylcyclines':['tig'],
    'Lincosamides':['cli'],
    'Lipopeptides':['dap'],
    'Macrolides':['azith','ery','clari'],
    'Oxazolidinones':['lin'],
    'Phenicols':['chloramphenicol'],
    'Phosphonic_Acids':['fos'],
    'Streptogramins':['quinupristin-dalfopristin','qda'],
    'Tetracyclines':['mino','doxy','tetracycline'],
  },
  // Enterococcus faecium / faecalis
  ENTEROCOCCUS:{
    'Aminoglycosides_HLAR':['gen-high','strep-high'],
    'Carbapenems':['imi','mer'],
    'Fluoroquinolones':['cip','lev'],
    'Glycopeptides':['van','tei'],
    'Glycylcyclines':['tig'],
    'Lincosamides':['cli'],
    'Lipopeptides':['dap'],
    'Oxazolidinones':['lin'],
    'Penicillins':['amp','pen'],
    'Streptogramins':['quinupristin-dalfopristin','qda'],
    'Tetracyclines':['doxy','mino','tetracycline'],
  },
};

// Map nombre organismo → especie CLSI key
export function _organismToSpeciesKey(org){
  if(!org)return null;
  const s=org.toLowerCase();
  if(/coli|klebsi|enterobacter|serratia|prote|morganella|citrobacter|salmonel|shigella|providencia|raoultella|kluyvera|edwardsiella|hafnia|cronobacter|leclercia/.test(s))return 'ENTEROBACTERALES';
  if(/aeruginosa|pseudomonas/.test(s))return 'PSEUDOMONAS';
  if(/acinetobacter|baumannii/.test(s))return 'ACINETOBACTER';
  if(/staphylococcus aureus|s\. aureus|aureus|mrsa|mssa/.test(s))return 'S_AUREUS';
  if(/enterococ|faecium|faecalis|vre/.test(s))return 'ENTEROCOCCUS';
  return null;
}

// ── Resistencia INTRÍNSECA (EUCAST Expert Rules — tabla de resistencia intrínseca) ──────
// Devuelve un Set de claves de ATB a las que el organismo es INTRÍNSECAMENTE resistente.
// La resistencia intrínseca NO es resistencia adquirida → se EXCLUYE del cálculo Magiorakos,
// de lo contrario se sobre-clasifica (p.ej. Klebsiella saldría "MDR" solo por ampicilina).
export function _intrinsicResistanceKeys(org){
  const s=(org||'').toLowerCase(); const R=new Set();
  const add=(...k)=>k.forEach(x=>R.add(x));
  // Klebsiella / Raoultella: ampicilina intrínseca
  if(/klebsiella|raoultella/.test(s))add('amp');
  // AmpC cromosómica desreprimible: amino-penicilinas (± BLI), cefalosporina 1G y cefamicina
  if(/enterobacter|klebsiella aerogenes|k\. aerogenes|citrobacter freundii|hafnia|serratia|providencia|morganella/.test(s))
    add('amp','amcl','amsul','cefa','fox');
  // Serratia, Proteus, Morganella, Providencia: colistina/polimixina intrínseca
  if(/serratia|proteus|morganella|providencia/.test(s))add('col','polymyxin_b');
  // Proteae (Proteus, Morganella, Providencia): tigeciclina y tetraciclinas intrínsecas
  if(/proteus|morganella|providencia/.test(s))add('tig','tetracycline','doxy');
  if(/citrobacter koseri/.test(s))add('amp');
  // Enterococcus: clindamicina (y TMP-SMX in vivo) intrínsecas; E. faecalis → quinupristina-dalfopristina
  if(/enterococ|faecium|faecalis/.test(s))add('cli','sxt','tmp');
  if(/faecalis/.test(s))add('quinupristin-dalfopristin','qda');
  // Stenotrophomonas maltophilia: carbapenémicos intrínsecos
  if(/stenotrophomonas|maltophilia/.test(s))add('imi','mer','ert','doripenem');
  return R;
}

// ── Algoritmo Magiorakos 2012 — Clasifica como S/MDR/posXDR/XDR/posPDR ────
// abg: object { keyABX: 'S'|'I'|'R' }
// devuelve: { mdr, posXDR, xdr, posPDR, pdr, nonSuscCategoriesCount, totalCategories, panelComplete }
export function clasificarMagiorakos(abg,organismo){
  const speciesKey=_organismToSpeciesKey(organismo);
  if(!speciesKey||!abg||!Object.keys(abg).length){
    return {classification:'Indeterminado',mdr:false,posXDR:false,xdr:false,posPDR:false,pdr:false,categories:{},summary:'Sin datos suficientes'};
  }
  const cats=CLSI_CATEGORIES[speciesKey];
  // Fase 0.3 — EXCLUIR resistencia intrínseca: un ATB al que el organismo es intrínsecamente
  // resistente NO se considera resistencia adquirida (Magiorakos/EUCAST) → se ignora.
  const intrinsic=_intrinsicResistanceKeys(organismo);
  const results={};
  let totalCats=Object.keys(cats).length;
  let nonSuscCats=0;
  let categoriesWithData=0;
  Object.entries(cats).forEach(([catName,drugKeys])=>{
    // ¿Hay datos para alguno de los ATB de esta categoría (excluyendo los intrínsecos)?
    let tested=false;
    let nonSuscInCat=false;
    drugKeys.forEach(d=>{
      if(intrinsic.has(d))return;            // resistencia intrínseca: no cuenta como adquirida
      if(abg[d]){
        tested=true;
        // Magiorakos 2012: "no-susceptible" = R o I (definición publicada del algoritmo).
        // Esto NO es "sumar I a R" en el reporte de %R (ahí van separados, ver Fase 0.4);
        // es la categorización de no-susceptibilidad para MDR/XDR/PDR.
        if(abg[d]==='R'||abg[d]==='I')nonSuscInCat=true;
      }
    });
    if(tested)categoriesWithData++;
    results[catName]={tested,nonSusc:nonSuscInCat};
    if(nonSuscInCat)nonSuscCats++;
  });
  // Magiorakos 2012:
  // MDR: non-susc to ≥1 agent in ≥3 categories
  const mdr=nonSuscCats>=3;
  // posible XDR: non-susc to ≥1 in all but ≤2 categories (panel incompleto)
  // XDR: full data confirming above
  const susceptibleCats=categoriesWithData-nonSuscCats;
  // v395 (P1 clínico): XDR/PDR exigen cobertura ADECUADA de categorías. Con un panel de 3-4 fármacos
  //   (p.ej. MRSA/VRE de rutina) NO se puede afirmar "Posible PDR/XDR": las categorías de última línea
  //   (glucopéptidos, oxazolidinonas, lipopéptidos…) simplemente no se probaron. Magiorakos 2012 exige
  //   probar todas (o casi todas) las categorías. Requerimos ≥ la mitad (y ≥4) de las categorías para
  //   posXDR/posPDR; por debajo se degrada a MDR (evita el falso "Posible PDR" alarmante en MRSA/VRE).
  const minCoverage=Math.max(4,Math.ceil(totalCats/2));
  const adequatePanel=categoriesWithData>=minCoverage;
  const posXDR=mdr&&susceptibleCats<=2&&categoriesWithData<totalCats&&adequatePanel;
  const xdr=mdr&&susceptibleCats<=2&&categoriesWithData===totalCats;
  // posible PDR: non-susc to all in all TESTED categories (panel incompleto) — CON cobertura adecuada
  // PDR: non-susc to all agents in all categories (panel completo)
  const posPDR=nonSuscCats===categoriesWithData&&categoriesWithData>0&&categoriesWithData<totalCats&&adequatePanel;
  const pdr=nonSuscCats===totalCats&&categoriesWithData===totalCats;
  let classification='Sensible';
  if(pdr)classification='PDR';
  else if(xdr)classification='XDR';
  else if(posPDR)classification='Posible PDR';
  else if(posXDR)classification='Posible XDR';
  else if(mdr)classification='MDR';
  return {
    classification,mdr,posXDR,xdr,posPDR,pdr,
    categories:results,
    nonSuscCategoriesCount:nonSuscCats,
    totalCategories:totalCats,
    categoriesWithData,
    panelComplete:categoriesWithData===totalCats,
    adequatePanel,minCoverage,
    summary:`${nonSuscCats}/${categoriesWithData} categorías no-susceptibles (panel ${categoriesWithData===totalCats?'completo':'incompleto'}${(mdr&&!adequatePanel)?`; cobertura insuficiente para XDR/PDR: ${categoriesWithData}/${totalCats} categorías`:''})`
  };
}
