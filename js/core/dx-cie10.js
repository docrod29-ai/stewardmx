// ═══════════════════════════════════════════════════════════════════════════
//  StewardMX · js/core/dx-cie10.js — Taxonomía de Dx infecciosos + mapeo a CIE-10 (PURO)
//  5º módulo extraído del monolito (v300). Determinista; NO toca PACS/HOSP/db/DOM.
//  DX_CATEGORIES (40+ categorías, regex; fuentes IDSA/ESCMID/NOM-045/CDC NHSN/AWaRe), categorizarDx,
//  categoriaPrincipal[Code], DX_CIE10 (categoría→código CIE-10, interoperabilidad OMS/GLASS) y
//  cie10DeDx (elige la categoría más específica por _CIE_PRIORIDAD; no-infeccioso → B99.9).
//  index.html lo importa y reexpone en window.*. Las pruebas importan la función REAL.
// ═══════════════════════════════════════════════════════════════════════════

//  DX_CATEGORIES — Taxonomía unificada de Enfermedades Infecciosas
//  Permite filtrar/agrupar TODOS los diagnósticos por categoría epidemiológica.
//  Cada categoría: code, label, icon, patterns (regex). Un dx puede tener varias.
//  Fuentes: IDSA, ESCMID, NOM-045-SSA2, CDC NHSN, ICD-10, AWaRe OMS.
// ══════════════════════════════════════════════════════════════════════════
export const DX_CATEGORIES={
  UTI:{label:'Tracto Urinario',icon:'💧',color:'#f0ad4e',
    patterns:[/\bITU\b/i,/cistit/i,/pielonefr/i,/uros|urin/i,/\bCAUTI\b/i,/prostatit/i,/epididim|orquit/i,/bacteriur/i,/pionefr/i,/candidur/i,/absceso renal|perirrenal/i,/absceso prostát/i,/uretrit/i,/balanit/i]},
  NAC:{label:'Neumonía Comunitaria (NAC)',icon:'🫁',color:'#5cb85c',
    patterns:[/\bNAC\b/i,/neumonía adquirida en comunidad/i,/comunidad.*neumonía/i]},
  HAP:{label:'Neumonía Nosocomial (HAP)',icon:'🏥',color:'#d9534f',
    patterns:[/\bHAP\b/i,/neumonía nosocomial(?!.*VAP)/i,/IAAS.*neumonía no asociada a VM/i]},
  VAP:{label:'Neumonía Asociada a Ventilador (VAP)',icon:'🤖',color:'#c9302c',
    patterns:[/\bVAP\b/i,/\bNAVM\b/i,/neumonía asociada a ventilador/i,/IAAS.*neumonía asociada a VM/i,/traqueobronquitis nosocomial/i]},
  CAPA:{label:'COVID + Aspergilosis (CAPA)',icon:'🦠',color:'#9b59b6',
    patterns:[/\bCAPA\b/i,/COVID.*aspergil/i]},
  PNEU_OTROS:{label:'Otras Neumonías / Pulmonar',icon:'💨',color:'#1abc9c',
    patterns:[/neumonía/i,/absceso pulmonar/i,/empiema pleural/i,/bronquiect|EPOC exacerb|AEPOC/i,/broncoaspiración/i,/PCP|pneumocystis/i,/criptococosis pulmonar/i,/histoplas.*pulmonar/i,/coccidio.*pulmonar/i,/nocardio.*pulmonar/i,/actinomic.*torác|actinomic.*pulmonar/i,/influenza.*complic/i,/COVID.*neumon/i,/VSR.*complic|sincicial.*complic/i,/parainflu|metapneumo/i,/hantavirus/i,/tuberculosis pulmonar|TB pulmonar/i,/mucormicosis pulmonar/i,/aspergilosis pulmonar|API/i,/traqueít|traqueitis/i]},
  BACT:{label:'Bacteriemia / Sepsis',icon:'🩸',color:'#d9534f',
    patterns:[/bacteriemia/i,/candidemia/i,/fungemia/i,/sepsis/i,/choque séptico/i,/fiebre en neutropenia/i,/neutropén.*bacteriemia/i,/FOD/i,/fiebre de origen/i,/SIRI|reconstitución inmune/i]},
  EI:{label:'Endocarditis Infecciosa',icon:'🫀',color:'#c0392b',
    patterns:[/endocarditis/i,/CIED/i,/TAVI/i,/válvula nativa/i,/válvula protés/i,/infección de injerto vascular/i,/aneurisma.*micótico/i,/marcapasos.*infec|DAI.*infec/i]},
  CV_OTROS:{label:'Cardiovascular / Endovascular',icon:'❤️',color:'#e74c3c',
    patterns:[/tromboflebitis séptica/i,/pericarditis bacter/i,/miocarditis infec/i,/mediastinitis/i,/flebitis.*CVC|flebitis.*PICC/i]},
  IAB:{label:'Intraabdominal',icon:'🫃',color:'#f39c12',
    patterns:[/peritonitis/i,/colangit/i,/colecistit/i,/absceso hepá|absceso esplén|absceso intraabdom|absceso pancreát/i,/diverticul/i,/apendicit/i,/tiflit|enterocolitis neutropén/i,/pancreatit.*infec|necrosis infectada/i,/IAAS.*peritonitis/i,/hernia.*infec/i,/DPAP/i]},
  CDI:{label:'C. difficile (CDI)',icon:'💩',color:'#8b4513',
    patterns:[/C\.\s*difficile/i,/CDI/i,/clostridioides difficile/i,/clostridium difficile/i]},
  GI_OTROS:{label:'Gastrointestinal',icon:'🍽️',color:'#e67e22',
    patterns:[/gastroenteritis bacter/i,/diarrea del viajero/i,/yersinia/i,/STEC|O157:H7/i,/H\.\s*pylori|helicobacter/i,/giardiasis|amebiasis/i]},
  SSTI:{label:'Piel y Tejidos Blandos (SSTI)',icon:'🩹',color:'#27ae60',
    patterns:[/impétigo/i,/foliculit|forúnculo|ántrax/i,/hidradenit/i,/erisipela/i,/celulit/i,/fascitis necrot/i,/piomiosit|miositis inflamat/i,/gangrena de fournier/i,/úlcera de decúbito infect/i,/pie diabét/i,/herida quirúrgica.*infec|infección de herida/i,/quemadura infect/i,/piel escaldada|SPES|SSSS/i,/choque tóxico/i,/linfangit|linfadenit/i,/mordedura.*infec/i]},
  OST_ART:{label:'Hueso y Articulación',icon:'🦴',color:'#7f8c8d',
    patterns:[/osteomielit/i,/artritis séptica/i,/espondilodiscit|discit/i,/infección de prótesis articular|IAP/i,/IPP|infección.*prótesis/i,/bursitis sépt/i,/sacroileitis/i]},
  CNS:{label:'Sistema Nervioso (CNS)',icon:'🧠',color:'#9b59b6',
    patterns:[/meningitis/i,/encefalit/i,/absceso cerebral/i,/ventriculit/i,/derivación.*infec|DVE.*infec/i,/empiema subdur|empiema epidur/i,/mielitis/i,/neurosífilis|neurosifil/i,/neurolisteriosis/i,/cerebrit/i,/abscesomédul/i]},
  CLABSI:{label:'IAAS — Bacteriemia por Catéter (CLABSI)',icon:'🚨',color:'#c0392b',
    patterns:[/CLABSI/i,/bacteriemia asociada a CVC/i,/bacteriemia.*catéter central/i,/IAAS.*bacteriemia.*CVC|IAAS.*bacteriemia.*central/i,/línea vascular.*CVC|bacteriemia.*PICC/i]},
  CAUTI:{label:'IAAS — ITU por Catéter (CAUTI)',icon:'🔴',color:'#e74c3c',
    patterns:[/CAUTI/i,/ITU.*catéter urinario/i,/IAAS.*ITU.*catéter/i]},
  SSI:{label:'IAAS — Infección Sitio Quirúrgico (ISQ/SSI)',icon:'🔪',color:'#d35400',
    patterns:[/herida quirúrgica.*infec/i,/infección.*sitio quirúrgico/i,/ISQ/i,/SSI/i,/IAAS.*ISQ|IAAS.*herida quirúrgica/i,/infección.*injerto/i]},
  IAAS_OTROS:{label:'IAAS — Otras (NOM-045)',icon:'🏥',color:'#c0392b',
    patterns:[/IAAS/i,/asociada a la atención/i,/nosocomial/i]},
  NEUTRO:{label:'Neutropenia Febril',icon:'🌡️',color:'#e67e22',
    patterns:[/neutropenia febril/i,/fiebre.*neutrop/i,/MASCC/i,/neutropén/i]},
  IFI:{label:'Infección Fúngica Invasiva (IFI)',icon:'🍄',color:'#8e44ad',
    patterns:[/candidem/i,/candidiasis invasiva|candidiasis sistém/i,/aspergilos.*invas|API/i,/mucormic/i,/criptococ/i,/histoplas.*disemin|coccidio.*disemin/i,/fusariosis/i,/scedosporios/i,/zigomicos/i,/feohifomico|hialohifomico/i,/EORTC/i,/IFI/i]},
  TB:{label:'Tuberculosis',icon:'🦠',color:'#34495e',
    patterns:[/tuberculosis/i,/\bTB\b/i,/Mycobacterium tuberculosis|M\. tuberculosis/i,/TB latente|LTBI/i,/TB extrapulm/i,/TB pulmonar/i,/Pott|mal de pott/i,/escrofulosis|escrófula/i]},
  NTM:{label:'Micobacterias no-TB (NTM)',icon:'🧫',color:'#16a085',
    patterns:[/NTM/i,/mycobacterium avium|MAC/i,/M\. kansasii/i,/M\. abscessus|M\. chelonae|M\. fortuitum/i,/micobacterias no-tubercul/i]},
  VIRAL:{label:'Infecciones Virales',icon:'🦠',color:'#3498db',
    patterns:[/COVID/i,/SARS-CoV/i,/influenza/i,/VSR|virus sincicial/i,/parainflu|metapneumo/i,/hantavirus/i,/CMV|citomegalov/i,/VEB|EBV|epstein/i,/HSV|herpes simplex/i,/VZV|varicela|zóster/i,/dengue/i,/zika/i,/chikung/i,/fiebre amarilla/i,/Mpox|viruela del mono/i,/sarampión/i,/rubéola/i,/parotidit|paperas/i]},
  VIH:{label:'VIH / SIDA',icon:'🎗️',color:'#e74c3c',
    patterns:[/\bVIH\b/i,/\bSIDA\b/i,/HIV/i,/AIDS/i,/CD4/i]},
  TRANS:{label:'Trasplante',icon:'🫀',color:'#9b59b6',
    patterns:[/trasplant/i,/SOT/i,/TCMH/i,/post-trasplante/i,/donador.*receptor/i,/GVHD/i,/post-engraft/i]},
  ITS:{label:'Infecciones de Transmisión Sexual',icon:'❤️‍🩹',color:'#c0392b',
    patterns:[/sífilis/i,/gonorrea|gonocócica/i,/clamidia/i,/tricomon/i,/herpes genital/i,/VPH|virus del papil/i,/chancroide/i,/linfogranuloma/i,/uretrit gono|cervicit/i,/PID|EIP|enfermedad inflamatoria pélvica/i]},
  TROPICALES:{label:'Enfermedades Tropicales / Importadas',icon:'🌴',color:'#27ae60',
    patterns:[/malaria|paludismo|plasmodium/i,/dengue/i,/chikung/i,/zika/i,/leishman/i,/chagas|trypanos/i,/leptospi/i,/brucel/i,/rickettsi|fiebre.*manchada/i,/ébola|ebola|marburg/i,/cólera/i,/peste/i,/tifoidea|paratifoid/i,/borreli|enfermedad de lyme/i]},
  PROF:{label:'Profilaxis',icon:'🛡️',color:'#16a085',
    patterns:[/profilaxis/i,/preexposición|PrEP/i,/postexposición|PEP/i,/descolonización/i,/ITSO|ICSO|profilaxis quirúrgica/i]},
  OBST:{label:'Obstetricia / Ginecología',icon:'🤰',color:'#e91e63',
    patterns:[/corioamnionit/i,/endometr.*post|endometritis puerperal/i,/sepsis puerperal/i,/aborto séptico/i,/EIP|PID|enfermedad inflamatoria pélvica/i,/vagino.*bacter|vagino.*candidi/i,/mastitis puerperal/i]},
  PEDIATRICAS:{label:'Pediátricas / Neonatales',icon:'👶',color:'#ff7043',
    patterns:[/neonat/i,/pediátric/i,/sepsis neonatal/i,/onfalitis/i,/conjuntivit.*neonat/i,/celulit.*neonat/i,/escarlatina/i,/exantema súbito/i,/bronquiolit/i,/laringotraqueít|crup/i,/tos ferina|pertussis/i]},
  ZOO:{label:'Zoonosis',icon:'🐾',color:'#795548',
    patterns:[/rabia/i,/brucel/i,/leptosp/i,/toxoplasm/i,/equinococ|hidatidos/i,/cisticerc/i,/teniasis|tenia/i,/triquin/i,/hantavirus/i,/ornitosis|psitacosis/i,/tularemia|francisella/i,/peste|yersinia pestis/i,/fiebre Q|coxiella/i,/borreli/i,/rickett/i]},
  ENT_ORL:{label:'Otorrinolaringología (ENT)',icon:'👂',color:'#f1c40f',
    patterns:[/otitis (media|externa)/i,/sinusit/i,/faringoamigd|amigdalit/i,/epiglotit/i,/laringit|laringotraqueít/i,/mastoidit/i,/absceso periamigd|absceso retrofar/i,/Ludwig|angina de ludwig/i,/lemierre/i,/parotidit/i]},
  OFT:{label:'Oftalmológicas',icon:'👁️',color:'#3498db',
    patterns:[/celulit.*orbit|celulit.*periorbit/i,/conjuntivit/i,/queratit/i,/endoftalmit/i,/uveit infec/i,/dacriocist/i]},
  ORAL:{label:'Oral / Dental',icon:'🦷',color:'#bdc3c7',
    patterns:[/absceso dental|absceso periodontal/i,/odontogén/i,/celulit facial.*odont/i,/osteomielit.*mandibular|maxilar/i,/Ludwig|angina de ludwig/i]},
  STEW:{label:'Stewardship / PROA',icon:'⚖️',color:'#34495e',
    patterns:[/desescalada/i,/switch IV.*VO/i,/optimización PROA/i,/restricción.*antibiót/i,/discordancia clínica/i,/portador.*MRSA/i,/colonización|colonizac/i,/empírico sin foco/i]},
  PARAS:{label:'Parasitarias',icon:'🪱',color:'#8d6e63',
    patterns:[/parásito|paras/i,/strongyloid/i,/ascaris/i,/giardiasis/i,/amebiasis/i,/malaria|paludismo/i,/leishman/i,/toxoplasm/i,/echinococ|hidatid/i,/cisticerc/i]},
};

// Clasificador: devuelve array de category codes para un diagnóstico
export function categorizarDx(dx){
  if(!dx)return [];
  const s=String(dx);
  const cats=[];
  for(const [code,def] of Object.entries(DX_CATEGORIES)){
    if(def.patterns.some(re=>re.test(s)))cats.push(code);
  }
  return cats;
}

// Devuelve label legible de la primera categoría (o "Otro")
export function categoriaPrincipal(dx){
  const cats=categorizarDx(dx);
  return cats.length?DX_CATEGORIES[cats[0]].label:'Otro / No clasificado';
}
export function categoriaPrincipalCode(dx){
  const cats=categorizarDx(dx);
  return cats.length?cats[0]:'OTRO';
}

/* ═══════════ CIE-10 v222 — mapeo de categoría → código CIE-10 (interoperabilidad OMS/GLASS) ═══════════ */
/* Cada categoría de DX_CATEGORIES se mapea a su código CIE-10 representativo (capítulo I y
   específicos). No reemplaza el dx clínico libre; lo CODIFICA para reportes estándar. Cuando un
   dx cae en varias categorías, se toma la más específica (primera coincidencia priorizada). */
export const DX_CIE10={
  CDI:{cie:'A04.7', desc:'Enterocolitis por Clostridioides difficile'},
  CLABSI:{cie:'T80.2', desc:'Infección consecutiva a infusión/cateterización vascular'},
  CAUTI:{cie:'T83.5', desc:'Infección por dispositivo protésico urinario'},
  SSI:{cie:'T81.4', desc:'Infección de sitio quirúrgico (post-procedimiento)'},
  CAUTI_DUP:{cie:'',desc:''},
  UTI:{cie:'N39.0', desc:'Infección de vías urinarias, sitio no especificado'},
  NAC:{cie:'J18.9', desc:'Neumonía adquirida en comunidad, no especificada'},
  HAP:{cie:'J15.9', desc:'Neumonía bacteriana nosocomial, no especificada'},
  VAP:{cie:'J95.851', desc:'Neumonía asociada a ventilador'},
  CAPA:{cie:'B44.0', desc:'Aspergilosis pulmonar invasiva (con COVID U07.1)'},
  PNEU_OTROS:{cie:'J18.9', desc:'Neumonía, organismo no especificado'},
  BACT:{cie:'A41.9', desc:'Sepsis, no especificada (bacteriemia)'},
  EI:{cie:'I33.0', desc:'Endocarditis infecciosa aguda y subaguda'},
  CV_OTROS:{cie:'I80.9', desc:'Tromboflebitis/infección endovascular'},
  IAB:{cie:'K65.9', desc:'Peritonitis / infección intraabdominal'},
  GI_OTROS:{cie:'A09', desc:'Gastroenteritis infecciosa'},
  SSTI:{cie:'L08.9', desc:'Infección de piel y tejido celular subcutáneo'},
  OST_ART:{cie:'M86.9', desc:'Osteomielitis / artritis séptica (M00.9)'},
  CNS:{cie:'G00.9', desc:'Meningitis/infección del SNC, no especificada'},
  IAAS_OTROS:{cie:'Y95', desc:'Afección nosocomial (IAAS, NOM-045)'},
  NEUTRO:{cie:'D70', desc:'Neutropenia febril (agranulocitosis)'},
  IFI:{cie:'B49', desc:'Micosis invasiva, no especificada'},
  TB:{cie:'A15.9', desc:'Tuberculosis respiratoria/diseminada'},
  NTM:{cie:'A31.9', desc:'Infección por micobacteria no tuberculosa'},
  VIRAL:{cie:'B34.9', desc:'Infección viral, no especificada'},
  VIH:{cie:'B20', desc:'Enfermedad por VIH'},
  TRANS:{cie:'T86.9', desc:'Complicación infecciosa de órgano/tejido trasplantado'},
  ITS:{cie:'A64', desc:'Infección de transmisión sexual, no especificada'},
  TROPICALES:{cie:'B54', desc:'Enfermedad tropical/importada (malaria u otra)'},
  PROF:{cie:'Z29.2', desc:'Profilaxis antimicrobiana'},
  OBST:{cie:'O85', desc:'Sepsis puerperal / infección obstétrica'},
  PEDIATRICAS:{cie:'P36.9', desc:'Sepsis neonatal / infección pediátrica'},
  ZOO:{cie:'A28.9', desc:'Zoonosis bacteriana, no especificada'},
  ENT_ORL:{cie:'H66.9', desc:'Otitis/infección ORL'},
  OFT:{cie:'H44.0', desc:'Endoftalmitis/infección oftálmica'},
  ORAL:{cie:'K12.2', desc:'Celulitis/absceso de boca (odontogénico)'},
  STEW:{cie:'Z51.8', desc:'Atención de optimización antimicrobiana (PROA)'},
  PARAS:{cie:'B89', desc:'Enfermedad parasitaria, no especificada'},
};
// Prioridad de especificidad: las IAAS y síndromes específicos ganan sobre los genéricos.
const _CIE_PRIORIDAD=['CDI','CLABSI','CAUTI','SSI','EI','VAP','HAP','CAPA','NEUTRO','IFI','TB','NTM','VIH','TRANS','CNS','BACT','UTI','NAC','IAB','SSTI','OST_ART','ITS','OBST','PEDIATRICAS','ZOO','TROPICALES','VIRAL','ENT_ORL','OFT','ORAL','GI_OTROS','CV_OTROS','PNEU_OTROS','IAAS_OTROS','PARAS','PROF','STEW'];
export function cie10DeDx(dx){
  const cats=categorizarDx(dx);
  if(!cats.length)return{cie:'B99.9', desc:'Enfermedad infecciosa, no especificada', cat:'OTRO'};
  // Elegir la categoría más específica presente según prioridad
  for(const code of _CIE_PRIORIDAD){
    if(cats.includes(code)&&DX_CIE10[code])return{...DX_CIE10[code], cat:code};
  }
  const c=cats[0];
  return DX_CIE10[c]?{...DX_CIE10[c],cat:c}:{cie:'B99.9',desc:'Enfermedad infecciosa, no especificada',cat:c};
}

// ══════════════════════════════════════════════════════════════════════════
