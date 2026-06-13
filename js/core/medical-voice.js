// js/core/medical-voice.js — Corrector de transcripción médica (puro, testeable).
//
// Portado y adaptado del sistema de voz de la app de agenda médica del Dr. Rodríguez
// (mismas características y fortalezas). Estrategia de 3 capas, conservadora:
//   1) CONFUSIONES_CONOCIDAS — errores REALES irrecuperables por fonética (frase completa).
//   2) Coincidencia FONÉTICA del español (cefalexina ≡ sefaleksina).
//   3) Distancia de LEVENSHTEIN contra vocabulario médico, con umbral por longitud.
// Solo corrige cuando hay match fonético exacto o distancia muy pequeña, y la palabra
// original NO es de uso común en español. Módulo PURO (sin DOM/estado/Firebase) → vive en
// js/core/* e importado por el módulo principal (patrón de des-monolitización v295+).

/* ── Catálogos médicos (subset PROA-relevante: ATB/antifúngicos/antivirales/ARV/microbiología
 *    + fármacos de comorbilidad más mal transcritos). El motor fonético/Levenshtein generaliza. ── */
export const ANTIBIOTICOS = [
  'penicilina G','penicilina V','penicilina benzatínica','amoxicilina','amoxicilina/clavulanato',
  'ampicilina','ampicilina/sulbactam','dicloxacilina','oxacilina','piperacilina','piperacilina/tazobactam',
  'cefalexina','cefadroxilo','cefazolina','cefuroxima','cefoxitina','cefotaxima','ceftriaxona','ceftazidima',
  'ceftazidima/avibactam','cefepime','ceftarolina','ceftolozano/tazobactam','cefiderocol',
  'ertapenem','imipenem','imipenem/cilastatina','meropenem','meropenem/vaborbactam','doripenem',
  'aztreonam','aztreonam/avibactam','vancomicina','teicoplanina','dalbavancina','linezolid','tedizolid',
  'daptomicina','gentamicina','amikacina','tobramicina','estreptomicina','plazomicina',
  'ciprofloxacino','levofloxacino','moxifloxacino','ofloxacino','norfloxacino','delafloxacino',
  'azitromicina','claritromicina','eritromicina','fidaxomicina',
  'doxiciclina','minociclina','tigeciclina','eravaciclina','omadaciclina','clindamicina',
  'trimetoprim/sulfametoxazol','cotrimoxazol','sulfadiazina','metronidazol','tinidazol',
  'cloranfenicol','rifaximina','rifampicina','nitrofurantoína','fosfomicina','colistina','colistimetato','polimixina B',
];
export const ANTIFUNGICOS = [
  'fluconazol','itraconazol','voriconazol','posaconazol','isavuconazol','ketoconazol','terbinafina',
  'anfotericina B','anfotericina B liposomal','caspofungina','micafungina','anidulafungina','flucitosina','nistatina',
];
export const ANTIVIRALES = [
  'aciclovir','valaciclovir','famciclovir','ganciclovir','valganciclovir','cidofovir','foscarnet','letermovir',
  'oseltamivir','zanamivir','baloxavir','ribavirina','remdesivir','molnupiravir','nirmatrelvir/ritonavir',
];
export const ANTIRRETROVIRALES = [
  'tenofovir disoproxilo','tenofovir alafenamida','emtricitabina','lamivudina','abacavir','zidovudina',
  'efavirenz','rilpivirina','doravirina','lopinavir/ritonavir','atazanavir','darunavir','darunavir/cobicistat',
  'dolutegravir','bictegravir','raltegravir','cabotegravir','maraviroc',
];
export const MICROBIOLOGIA = [
  'Staphylococcus aureus','Staphylococcus epidermidis','Streptococcus pneumoniae','Streptococcus pyogenes',
  'Streptococcus agalactiae','Enterococcus faecalis','Enterococcus faecium','Listeria monocytogenes',
  'Clostridioides difficile','Escherichia coli','Klebsiella pneumoniae','Klebsiella oxytoca','Enterobacter cloacae',
  'Proteus mirabilis','Serratia marcescens','Salmonella typhi','Pseudomonas aeruginosa','Acinetobacter baumannii',
  'Stenotrophomonas maltophilia','Haemophilus influenzae','Moraxella catarrhalis','Neisseria meningitidis',
  'Neisseria gonorrhoeae','Legionella pneumophila','Mycoplasma pneumoniae','Mycobacterium tuberculosis',
  'Mycobacterium avium','Candida albicans','Candida glabrata','Candida krusei','Candida auris','Candida tropicalis',
  'Candida parapsilosis','Cryptococcus neoformans','Histoplasma capsulatum','Coccidioides immitis',
  'Aspergillus fumigatus','Aspergillus flavus','Pneumocystis jirovecii','Toxoplasma gondii','Strongyloides stercoralis',
  'citomegalovirus','virus de Epstein-Barr','virus varicela zóster','virus del herpes simple',
];
export const COMORBILIDAD = [
  'empagliflozina','dapagliflozina','canagliflozina','semaglutida','tirzepatida','liraglutida','sitagliptina',
  'linagliptina','insulina glargina','insulina degludec','metformina','atorvastatina','rosuvastatina',
  'losartán','telmisartán','valsartán','bisoprolol','carvedilol','espironolactona','sacubitrilo/valsartán',
  'apixabán','rivaroxabán','dabigatrán','clopidogrel','ticagrelor','levotiroxina','alopurinol','colchicina',
  'tacrolimus','micofenolato','ciclosporina','everolimus','sirolimus','rituximab','tocilizumab','prednisona',
  'metilprednisolona','hidrocortisona','levetiracetam','pregabalina','furosemida','omeprazol','pantoprazol',
];
export const ABREVIATURAS = {
  BLEE:'BLEE', MRSA:'MRSA', VRE:'VRE', KPC:'KPC', NDM:'NDM', CRE:'CRE', SARM:'SARM',
  PCR:'PCR', PCT:'procalcitonina', TFG:'TFG', qSOFA:'qSOFA', UCI:'UCI', IAAS:'IAAS', ATB:'ATB',
};

/* ── Motor fonético + Levenshtein ─────────────────────────────────────────────── */
export function fonetEs(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')   // sin acentos
    .replace(/v/g,'b').replace(/ll/g,'y').replace(/x/g,'ks').replace(/y/g,'i').replace(/z/g,'s')
    .replace(/c([eéií])/g,'s$1').replace(/g([eéií])/g,'j$1')
    .replace(/qu([eéií])/g,'k$1').replace(/qu/g,'k').replace(/c([aoouú])/g,'k$1').replace(/c$/,'k')
    .replace(/h/g,'').replace(/ñ/g,'ni').replace(/[-/.,'`´']/g,'').replace(/\s+/g,' ').trim();
}
export function levenshtein(a,b){
  if(a===b)return 0; if(!a)return b.length; if(!b)return a.length;
  const dp=Array(b.length+1).fill(0).map((_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=b.length;j++){
      const tmp=dp[j];
      dp[j]=a[i-1]===b[j-1]?prev:Math.min(prev,dp[j],dp[j-1])+1;
      prev=tmp;
    }
  }
  return dp[b.length];
}

const TODOS_LOS_TERMINOS=[
  ...ANTIBIOTICOS,...ANTIFUNGICOS,...ANTIVIRALES,...ANTIRRETROVIRALES,...MICROBIOLOGIA,...COMORBILIDAD,
  ...Object.values(ABREVIATURAS),...Object.keys(ABREVIATURAS),
];
const INDICE_FONETICO=(()=>{const m=new Map();for(const t of TODOS_LOS_TERMINOS){const f=fonetEs(t);if(!m.has(f))m.set(f,t);}return m;})();
const TERMINOS_LEV=TODOS_LOS_TERMINOS.filter(t=>!t.includes(' ')&&!t.includes('/')&&t.length>=5).map(t=>({term:t,fonet:fonetEs(t)}));
const PALABRAS_COMUNES=new Set(['paciente','consulta','tratamiento','dolor','fiebre','dosis','medicamento','clinico','antecedente','examen','laboratorio','imagen','estudio','diagnostico','plan','mismo','antes','despues','desde','hasta','para','porque','sobre','tambien','entre','cuando','donde','este','esta','estos','estas','algunos','algunas','varios','siempre','nunca','luego','presenta','refiere','tiene','tomar','tomando','toma','hace','dias','meses','años','semanas','aumenta','disminuye','mejora','empeora','positivo','negativo','grave','leve','cama','servicio','urgencias']);

function distAceptable(d,n){ if(n<=4)return d===0; if(n<=7)return d<=1; if(n<=11)return d<=2; return d<=3; }

function mejorCandidato(palabra){
  const limpia=String(palabra||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  if(PALABRAS_COMUNES.has(limpia)||limpia.length<5)return null;
  const upper=String(palabra).toUpperCase();
  if(ABREVIATURAS[upper])return {term:upper,motivo:'abreviatura'};
  const fon=fonetEs(palabra);
  const mf=INDICE_FONETICO.get(fon);
  if(mf&&fonetEs(mf)===fon&&mf.toLowerCase()!==limpia)return {term:mf,motivo:'fonético'};
  let mejor=null;
  for(const {term,fonet} of TERMINOS_LEV){
    if(Math.abs(fonet.length-fon.length)>3)continue;
    const d=levenshtein(fonet,fon);
    if(!distAceptable(d,Math.max(fonet.length,fon.length)))continue;
    if(!mejor||d<mejor.dist)mejor={term,dist:d};
    if(mejor.dist===0)break;
  }
  if(mejor&&mejor.term.toLowerCase()!==limpia)return {term:mejor.term,motivo:'levenshtein'};
  return null;
}

/* ── Confusiones conocidas (errores irrecuperables por fonética; frase completa, primero) ── */
export const CONFUSIONES_CONOCIDAS={
  // Gliflozinas (las más destrozadas por Whisper)
  'empaq linfocina':'empagliflozina','empac linfocina':'empagliflozina','empa glifocina':'empagliflozina',
  'empagli fozina':'empagliflozina','dag glifos inna':'dapagliflozina','dap glifos':'dapagliflozina',
  'dapa glifo sina':'dapagliflozina','plátano pros':'latanoprost','platano pros':'latanoprost',
  // Antimicrobianos PROA mal oídos
  'septriasona':'ceftriaxona','sef triaxona':'ceftriaxona','amigacina':'amikacina','ami kacina':'amikacina',
  'pip tazo':'piperacilina/tazobactam','pipe tazo':'piperacilina/tazobactam','tazo cin':'piperacilina/tazobactam',
  'mero penem':'meropenem','vanco micina':'vancomicina','line solid':'linezolid','dapto micina':'daptomicina',
  'cefta vidime':'ceftazidima','ceftas idima':'ceftazidima','colis tina':'colistina','tigi ciclina':'tigeciclina',
};

const REGEX_PALABRA=/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9-]*)/g;

/**
 * Corrige una transcripción médica. Devuelve {corregido, cambios:[{original,corregido,motivo}]}.
 * Conservador: no toca palabras comunes ni cortas; aplica confusiones conocidas primero.
 */
export function corregirTranscripcionMedica(texto){
  let t=String(texto||''); const cambios=[];
  // 1) Confusiones conocidas (frase completa, sin acentos, límites de palabra)
  const sinAc=s=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  for(const [malo,bueno] of Object.entries(CONFUSIONES_CONOCIDAS)){
    const re=new RegExp('\\b'+malo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')+'\\b','gi');
    if(re.test(sinAc(t))||re.test(t)){
      t=t.replace(re,bueno);
      cambios.push({original:malo,corregido:bueno,motivo:'diccionario'});
    }
  }
  // 2) Palabra por palabra: fonético → Levenshtein
  t=t.replace(REGEX_PALABRA,(w)=>{
    const c=mejorCandidato(w);
    if(c&&c.term.toLowerCase()!==w.toLowerCase()){
      cambios.push({original:w,corregido:c.term,motivo:c.motivo});
      return c.term;
    }
    return w;
  });
  return {corregido:t,cambios};
}

// Prompt médico para el modelo de transcripción (Whisper usa solo los últimos ~224 tokens →
// aquí van SOLO los fármacos/términos más mal transcritos; el vocabulario completo vive arriba).
export const WHISPER_PROMPT_MEDICO=[
  'Consulta de infectología/PROA en México. Fármacos:',
  'meropenem, ertapenem, piperacilina/tazobactam, ceftriaxona, cefepime, ceftazidima/avibactam,',
  'vancomicina, linezolid, daptomicina, amikacina, levofloxacino, colistina, tigeciclina,',
  'trimetoprim/sulfametoxazol, fluconazol, voriconazol, caspofungina, anfotericina B,',
  'aciclovir, valganciclovir, letermovir, tacrolimus, micofenolato, rituximab,',
  'empagliflozina, dapagliflozina, atorvastatina, losartán, levotiroxina.',
  'Términos: procalcitonina, hemocultivo, antibiograma, BLEE, MRSA, KPC, carbapenemasa, qSOFA, desescalada.',
].join(' ');
