// StewardMX — Pruebas de flujos críticos (especificación ejecutable)
// Correr:  node --test tests/
//
// Estas pruebas contienen ESPEJOS verificados de las funciones puras que hoy
// viven en index.html. Sirven como (1) especificación del comportamiento y
// (2) red de seguridad: al extraer la función real a js/core/*.js, debe pasar
// EXACTAMENTE estas mismas pruebas (importándola en vez del espejo).
//
// Si cambias la lógica en index.html, actualiza el espejo Y la prueba juntos.

import test from 'node:test';
import assert from 'node:assert/strict';
// Módulo extraído del monolito (v295): se prueba la función REAL, no un espejo regex de index.html.
import { chiSquareTest, fisherExact2x2, testAuto2x2, parseMICnum, micStats, cockcroftGault,
         ci95_wilson, ci95_poisson_rate, fmtPropIC, fmtRateIC } from '../js/core/stats.js';
import { calcDiaATB, calcDiasEstancia, calcDiasPaciente, calcDOT, dotPer1000 } from '../js/core/clinical-days.js';

/* ─────────────── ESPEJOS de funciones puras (index.html v217) ─────────────── */

// 1) Regla de fin de semana: viernes ≥14:00, sábado, domingo.
function _esFinDeSemana(now){
  const d=now.getDay(); const h=now.getHours();
  return (d===5&&h>=14)||(d===6)||(d===0);
}

// 2) Cálculo de liberación UCI: 24 h normal; fin de semana → lunes 08:00.
function _calcUCIReleaseAt(now){
  if(_esFinDeSemana(now)){
    const lunes=new Date(now);
    const d=now.getDay();
    const daysToMon=d===0?1:d===6?2:d===5?3:1;
    lunes.setDate(now.getDate()+daysToMon);
    lunes.setHours(8,0,0,0);
    return{ts:lunes.toISOString(),esFinDeSemana:true};
  }
  return{ts:new Date(now.getTime()+24*60*60*1000).toISOString(),esFinDeSemana:false};
}

// 3) CrCl Cockcroft-Gault (mL/min). null si faltan datos. Mujer × 0.85.
function _crClCG(p){
  const edad=parseFloat(p.edad),peso=parseFloat(p.peso),creat=parseFloat(p.creat);
  if(!edad||!peso||!creat||creat<=0)return null;
  let cr=((140-edad)*peso)/(72*creat);
  if(/fem|muj|f/i.test((p.sexo||'').slice(0,3)))cr=((140-edad)*peso)/(72*creat)*0.85;
  return Math.round(cr);
}

// 4) Parser CSV mínimo con autodetección de delimitador y comillas.
const _LAB_DELIMS=[',',';','\t','|'];
function _labDetectDelim(firstLine){let best=',',bestN=-1;for(const d of _LAB_DELIMS){const n=(firstLine.split(d)).length;if(n>bestN){bestN=n;best=d;}}return best;}
function _labParseCSV(text){
  text=String(text||'').replace(/^﻿/,'');
  const firstLine=(text.split(/\r?\n/)[0]||'');const D=_labDetectDelim(firstLine);
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i],nx=text[i+1];
    if(q){if(c==='"'&&nx==='"'){cur+='"';i++;}else if(c==='"'){q=false;}else cur+=c;}
    else{if(c==='"')q=true;else if(c===D){row.push(cur);cur='';}else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';}else if(c==='\r'){}else cur+=c;}
  }
  if(cur!==''||row.length){row.push(cur);rows.push(row);}
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}

// 5) S/I/R normalizer.
function _labSIR(v){const n=(v==null?'':String(v)).toLowerCase().trim();if(!n)return '';if(n==='s'||n.startsWith('sensib'))return 'S';if(n==='r'||n.startsWith('resist'))return 'R';if(n==='i'||n.startsWith('interm'))return 'I';return '';}

// 6) Agregación de antibiograma acumulado (núcleo de _antibiogramaAcumulado).
function _abgOrgNorm(o){o=(o||'').trim();const parts=o.split(/\s+/).slice(0,2).join(' ');return parts.charAt(0).toUpperCase()+parts.slice(1);}
function antibiogramaAcumulado(pacs){
  const isolates=[];
  pacs.forEach(p=>{(p.muestras||[]).forEach(m=>{if(m.rechazada||!m.organismo)return;const abg=m.antibiograma||[];if(!abg.length)return;isolates.push({org:_abgOrgNorm(m.organismo),abg});});});
  const map={};
  isolates.forEach(it=>{if(!map[it.org])map[it.org]={n:0,atbs:{}};map[it.org].n++;it.abg.forEach(a=>{const atb=(a.atb||'').trim();if(!atb)return;if(!map[it.org].atbs[atb])map[it.org].atbs[atb]={s:0,t:0};map[it.org].atbs[atb].t++;if((a.sir||'').toUpperCase()==='S')map[it.org].atbs[atb].s++;});});
  return{map,total:isolates.length};
}

// 7) Día de ATB (simplificado): respeta suspensión usando fechaFinIV más reciente.
function calcDiaSuspender(p, hoy){
  if(p.accion==='suspender'){
    const fines=(p.atbList||[]).map(a=>a.fechaFinIV).filter(Boolean).sort();
    if(fines.length){const fin=new Date(fines[fines.length-1]+'T12:00:00');const ini=new Date(p.inicio+'T12:00:00');return Math.max(1,Math.round((fin-ini)/86400000)+1);}
  }
  const ini=new Date(p.inicio+'T12:00:00');return Math.max(1,Math.round((hoy-ini)/86400000)+1);
}

/* ───────────────────────────── PRUEBAS ───────────────────────────── */

test('weekend: viernes 13:00 NO es fin de semana', () => {
  assert.equal(_esFinDeSemana(new Date('2026-05-29T13:00:00')), false); // viernes
});
test('weekend: viernes 14:00 SÍ es fin de semana', () => {
  assert.equal(_esFinDeSemana(new Date('2026-05-29T14:00:00')), true);
});
test('weekend: sábado y domingo son fin de semana', () => {
  assert.equal(_esFinDeSemana(new Date('2026-05-30T03:00:00')), true); // sábado
  assert.equal(_esFinDeSemana(new Date('2026-05-31T23:00:00')), true); // domingo
});
test('weekend: martes 10:00 NO es fin de semana', () => {
  assert.equal(_esFinDeSemana(new Date('2026-05-26T10:00:00')), false);
});

test('UCI release: entre semana = +24h, no fin de semana', () => {
  const now=new Date('2026-05-26T10:00:00'); // martes
  const r=_calcUCIReleaseAt(now);
  assert.equal(r.esFinDeSemana, false);
  assert.equal(new Date(r.ts).getTime(), now.getTime()+24*3600*1000);
});
test('UCI release: viernes tarde → lunes 08:00', () => {
  const r=_calcUCIReleaseAt(new Date('2026-05-29T15:00:00')); // viernes
  assert.equal(r.esFinDeSemana, true);
  const d=new Date(r.ts);
  assert.equal(d.getDay(), 1);   // lunes
  assert.equal(d.getHours(), 8); // 08:00
});
test('UCI release: domingo → lunes 08:00 (día siguiente)', () => {
  const r=_calcUCIReleaseAt(new Date('2026-05-31T20:00:00')); // domingo
  const d=new Date(r.ts);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 1); // 1 de junio
});

test('CrCl: hombre 70a 70kg creat 1.0 ≈ 68', () => {
  assert.equal(_crClCG({edad:70,peso:70,creat:1.0,sexo:'M'}), 68);
});
test('CrCl: mujer aplica factor 0.85', () => {
  const h=_crClCG({edad:60,peso:60,creat:1.0,sexo:'M'});
  const m=_crClCG({edad:60,peso:60,creat:1.0,sexo:'Femenino'});
  assert.equal(m, Math.round(h*0.85));
});
test('CrCl: datos faltantes → null', () => {
  assert.equal(_crClCG({edad:70,peso:'',creat:1.0}), null);
  assert.equal(_crClCG({edad:70,peso:70,creat:0}), null);
});

test('CSV: autodetecta punto y coma (Excel español)', () => {
  const rows=_labParseCSV('a;b;c\n1;2;3');
  assert.deepEqual(rows[0], ['a','b','c']);
  assert.deepEqual(rows[1], ['1','2','3']);
});
test('CSV: respeta comillas con coma interna', () => {
  const rows=_labParseCSV('nombre,dx\n"Perez, Juan",neumonia');
  assert.deepEqual(rows[1], ['Perez, Juan','neumonia']);
});
test('CSV: ignora filas vacías', () => {
  const rows=_labParseCSV('a,b\n\n1,2\n');
  assert.equal(rows.length, 2);
});

test('SIR: normaliza variantes', () => {
  assert.equal(_labSIR('Sensible'), 'S');
  assert.equal(_labSIR('R'), 'R');
  assert.equal(_labSIR('intermedio'), 'I');
  assert.equal(_labSIR('xyz'), '');
});

test('Antibiograma acumulado: agrega %S por organismo×ATB', () => {
  const pacs=[
    {muestras:[{organismo:'Escherichia coli', antibiograma:[{atb:'Meropenem',sir:'S'},{atb:'Ciprofloxacino',sir:'R'}]}]},
    {muestras:[{organismo:'Escherichia coli grupo', antibiograma:[{atb:'Meropenem',sir:'S'},{atb:'Ciprofloxacino',sir:'S'}]}]},
    {muestras:[{organismo:'Klebsiella pneumoniae', antibiograma:[{atb:'Meropenem',sir:'R'}]}]},
  ];
  const {map,total}=antibiogramaAcumulado(pacs);
  assert.equal(total, 3);
  assert.equal(map['Escherichia coli'].n, 2);
  assert.equal(map['Escherichia coli'].atbs['Meropenem'].s, 2); // 2/2 = 100%
  assert.equal(map['Escherichia coli'].atbs['Ciprofloxacino'].s, 1); // 1/2 = 50%
  assert.equal(map['Klebsiella pneumoniae'].atbs['Meropenem'].t, 1);
});
test('Antibiograma acumulado: ignora muestras rechazadas o sin antibiograma', () => {
  const pacs=[
    {muestras:[{organismo:'E. coli', rechazada:true, antibiograma:[{atb:'X',sir:'S'}]}]},
    {muestras:[{organismo:'E. coli', antibiograma:[]}]},
  ];
  assert.equal(antibiogramaAcumulado(pacs).total, 0);
});

test('calcDia: suspendido usa fechaFinIV más reciente', () => {
  const p={accion:'suspender', inicio:'2026-05-01', atbList:[{fechaFinIV:'2026-05-05'},{fechaFinIV:'2026-05-03'}]};
  // del 1 al 5 = 5 días
  assert.equal(calcDiaSuspender(p, new Date('2026-05-20T12:00:00')), 5);
});
test('calcDia: activo cuenta hasta hoy', () => {
  const p={accion:'mantener', inicio:'2026-05-01', atbList:[]};
  assert.equal(calcDiaSuspender(p, new Date('2026-05-04T12:00:00')), 4);
});

// 8) Fases canónicas v219 — mapea ~15 estados internos a 5 fases + denegada.
function _faseDeStatus(st){
  st=(st||'').toLowerCase();
  if(/rechaz|deneg|sin_stock/.test(st)) return {idx:-1, deneg:true};
  if(/administrado|seguimiento|cerrado/.test(st)) return {idx:4};
  if(/en_almacen|entregado|recibido_enfermeria|liberado_farmacia|dispensado|farmacia_ok/.test(st)) return {idx:3};
  if(/^aprobad|en_farmacia/.test(st)) return {idx:2};
  if(/en_revision|retenido_farmacia|solicitado_justif|pendiente_farmacia/.test(st)) return {idx:1};
  return {idx:0};
}

test('fase: pendiente → fase 0 (solicitada)', () => {
  assert.equal(_faseDeStatus('pendiente').idx, 0);
});
test('fase: en_revision y retenido → fase 1 (revisión)', () => {
  assert.equal(_faseDeStatus('en_revision').idx, 1);
  assert.equal(_faseDeStatus('retenido_farmacia').idx, 1);
});
test('fase: aprobado → fase 2', () => {
  assert.equal(_faseDeStatus('aprobado').idx, 2);
  assert.equal(_faseDeStatus('en_farmacia').idx, 2);
});
test('fase: en_almacen/entregado/farmacia_ok → fase 3 (farmacia)', () => {
  assert.equal(_faseDeStatus('en_almacen').idx, 3);
  assert.equal(_faseDeStatus('entregado').idx, 3);
  assert.equal(_faseDeStatus('liberado_farmacia').idx, 3);
});
test('fase: administrado → fase 4 (final)', () => {
  assert.equal(_faseDeStatus('administrado').idx, 4);
});
test('fase: denegado/rechazado/sin_stock → rama denegada', () => {
  assert.equal(_faseDeStatus('denegado').deneg, true);
  assert.equal(_faseDeStatus('rechazado').deneg, true);
  assert.equal(_faseDeStatus('sin_stock').deneg, true);
});
test('fase: status desconocido → fase 0 (no se pierde)', () => {
  assert.equal(_faseDeStatus('xyz_raro').idx, 0);
});

// 9) calcDiaATB v220 — días EXACTOS de cada antibiótico individual.
//     Se prueba la función REAL importada de js/core/clinical-days.js (arriba), no un espejo.
test('calcDiaATB: ATB activo, inicio hoy = día 1 (inclusivo)', () => {
  const r=calcDiaATB({fechaInicioIV:'2026-05-29'}, new Date('2026-05-29T12:00:00'));
  assert.equal(r.dias, 1); assert.equal(r.activo, true);
});
test('calcDiaATB: ATB activo, 5 días corridos', () => {
  // del 25 al 29 inclusive = 5 días
  const r=calcDiaATB({fechaInicioIV:'2026-05-25'}, new Date('2026-05-29T12:00:00'));
  assert.equal(r.dias, 5); assert.equal(r.activo, true);
});
test('calcDiaATB: ATB suspendido cuenta inicio→fin propio (no hasta hoy)', () => {
  // inició 01, suspendido 05 → 5 días, aunque hoy sea 29
  const r=calcDiaATB({fechaInicioIV:'2026-05-01', fechaFinIV:'2026-05-05'}, new Date('2026-05-29T12:00:00'));
  assert.equal(r.dias, 5); assert.equal(r.activo, false);
});
test('calcDiaATB: dos ATB del mismo paciente cuentan independiente', () => {
  const hoy=new Date('2026-05-29T12:00:00');
  const mero=calcDiaATB({fechaInicioIV:'2026-05-20'}, hoy);            // activo, 10 días
  const vanco=calcDiaATB({fechaInicioIV:'2026-05-25',fechaFinIV:'2026-05-27'}, hoy); // 3 días susp
  assert.equal(mero.dias, 10);
  assert.equal(vanco.dias, 3);
});
test('calcDiaATB: sin fecha de inicio → dias null (no rompe)', () => {
  const r=calcDiaATB({nombre:'Meropenem'}, new Date('2026-05-29T12:00:00'));
  assert.equal(r.dias, null);
});
test('calcDiaATB: fin antes que inicio (dato malo) → mínimo 1 día', () => {
  const r=calcDiaATB({fechaInicioIV:'2026-05-10', fechaFinIV:'2026-05-05'}, new Date('2026-05-29T12:00:00'));
  assert.equal(r.dias, 1);
});

// 10) IC95% de proporción por Wilson (v221) — ahora función REAL importada de js/core/stats.js.
test('Wilson: 50/100 ≈ 50% con IC simétrico ~40–60', () => {
  const c=ci95_wilson(50,100);
  assert.equal(c.pct, 50);
  assert.ok(c.loPct>=39 && c.loPct<=41, 'lo ~40, fue '+c.loPct);
  assert.ok(c.hiPct>=59 && c.hiPct<=61, 'hi ~60, fue '+c.hiPct);
});
test('Wilson: proporción extrema 0/20 → lo=0, hi>0 (no negativo)', () => {
  const c=ci95_wilson(0,20);
  assert.equal(c.pct, 0);
  assert.equal(c.loPct, 0);
  assert.ok(c.hiPct>0, 'hi debe ser >0 (Wilson no colapsa a 0), fue '+c.hiPct);
});
test('Wilson: 20/20 = 100% → hi=100, lo<100', () => {
  const c=ci95_wilson(20,20);
  assert.equal(c.pct, 100);
  assert.equal(c.hiPct, 100);
  assert.ok(c.loPct<100, 'lo debe ser <100, fue '+c.loPct);
});
test('Wilson: n=0 → null (no rompe)', () => {
  assert.equal(ci95_wilson(0,0).pct, null);
});
test('Wilson: IC más ancho con n pequeña que con n grande', () => {
  const chico=ci95_wilson(5,10);   // 50% n=10
  const grande=ci95_wilson(500,1000); // 50% n=1000
  const anchoChico=chico.hiPct-chico.loPct;
  const anchoGrande=grande.hiPct-grande.loPct;
  assert.ok(anchoChico>anchoGrande, 'IC de n chica debe ser más ancho');
});

// 11) CIE-10 v222 — mapeo categoría → código, con prioridad de especificidad.
const DX_CATEGORIES_T={
  UTI:{patterns:[/\bITU\b/i,/cistit/i,/pielonefr/i,/uros|urin/i,/\bCAUTI\b/i]},
  BACT:{patterns:[/bacteriemia/i,/sepsis/i,/choque séptico/i,/candidemia/i]},
  CDI:{patterns:[/C\.\s*difficile/i,/CDI/i,/clostridioides difficile/i]},
  CLABSI:{patterns:[/CLABSI/i,/bacteriemia asociada a CVC/i]},
  EI:{patterns:[/endocarditis/i]},
  NAC:{patterns:[/\bNAC\b/i,/neumonía adquirida en comunidad/i]},
};
function categorizarDxT(dx){if(!dx)return[];const s=String(dx);const c=[];for(const[k,d] of Object.entries(DX_CATEGORIES_T)){if(d.patterns.some(re=>re.test(s)))c.push(k);}return c;}
const DX_CIE10_T={UTI:{cie:'N39.0'},BACT:{cie:'A41.9'},CDI:{cie:'A04.7'},CLABSI:{cie:'T80.2'},EI:{cie:'I33.0'},NAC:{cie:'J18.9'}};
const _PRIOR_T=['CDI','CLABSI','EI','NEUTRO','BACT','UTI','NAC'];
function cie10DeDxT(dx){
  const cats=categorizarDxT(dx);
  if(!cats.length)return{cie:'B99.9',cat:'OTRO'};
  for(const code of _PRIOR_T){if(cats.includes(code)&&DX_CIE10_T[code])return{...DX_CIE10_T[code],cat:code};}
  return DX_CIE10_T[cats[0]]?{...DX_CIE10_T[cats[0]],cat:cats[0]}:{cie:'B99.9',cat:cats[0]};
}

test('CIE-10: pielonefritis → N39.0 (UTI)', () => {
  assert.equal(cie10DeDxT('Pielonefritis aguda complicada').cie, 'N39.0');
});
test('CIE-10: sepsis → A41.9', () => {
  assert.equal(cie10DeDxT('Sepsis (Sepsis-3) — foco en estudio').cie, 'A41.9');
});
test('CIE-10: C. difficile → A04.7', () => {
  assert.equal(cie10DeDxT('Colitis por C. difficile').cie, 'A04.7');
});
test('CIE-10: PRIORIDAD — CLABSI gana sobre bacteriemia genérica', () => {
  // "bacteriemia asociada a CVC" matchea BACT y CLABSI → debe ganar CLABSI (más específico)
  const r=cie10DeDxT('Bacteriemia asociada a CVC');
  assert.equal(r.cat, 'CLABSI');
  assert.equal(r.cie, 'T80.2');
});
test('CIE-10: dx no infeccioso/desconocido → B99.9 (no inventa)', () => {
  assert.equal(cie10DeDxT('Dolor torácico inespecífico').cie, 'B99.9');
});
test('CIE-10: dx vacío → B99.9', () => {
  assert.equal(cie10DeDxT('').cie, 'B99.9');
});

/* ═══════════ VOZ — Validaciones clínicas de seguridad (v270) ═══════════ */
// Extrae la función REAL window._vaSafetyChecks de index.html (no un espejo) y la prueba
// con 15 conversaciones clínicas simuladas. Garantiza que el código en producción funciona.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __d = dirname(fileURLToPath(import.meta.url));
const _idx = readFileSync(join(__d, '..', 'index.html'), 'utf8');
const _mSafety = _idx.match(/window\._vaSafetyChecks=function\(d\)\{[\s\S]*?\n\};/);
let _vaSafetyChecks = () => [];
if (_mSafety) {
  // eslint-disable-next-line no-new-func
  _vaSafetyChecks = new Function(_mSafety[0].replace('window._vaSafetyChecks=function', 'return function') + '\nreturn window._vaSafetyChecks;'.replace('window._vaSafetyChecks', '') )();
  // construir de forma robusta: evaluar el cuerpo y devolver la función
  const _fn = new Function('const window={}; ' + _mSafety[0] + ' return window._vaSafetyChecks;');
  _vaSafetyChecks = _fn();
}
const _hasCrit = (r) => r.some(x => x.sev === 'critico');
const _hasAny = (r) => r.length > 0;
const _msgs = (r) => r.map(x => x.msg).join(' || ');

test('VOZ extracción: _vaSafetyChecks existe en index.html', () => {
  assert.ok(_mSafety, 'la función _vaSafetyChecks debe existir en index.html');
  assert.equal(typeof _vaSafetyChecks, 'function');
});

// Caso 1 — IVU simple, sin banderas
test('VOZ caso 1: IVU simple con nitrofurantoína → sin alertas críticas', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'cistitis no complicada' }, atb:[{nombre:'Nitrofurantoína'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 2 — Neumonía con ATB previo
test('VOZ caso 2: neumonía + ceftriaxona → sin crítico (β-lactámico sin alergia)', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'neumonía adquirida en comunidad' }, atb:[{nombre:'Ceftriaxona'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 3 — Alergia a penicilina + β-lactámico (CRÍTICO)
test('VOZ caso 3: alergia penicilina + piperacilina-tazobactam → ALERTA CRÍTICA de alergia', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'paciente alérgico a la penicilina' }, atb:[{nombre:'Piperacilina/tazobactam'}] });
  assert.ok(_hasCrit(r), 'debe alertar alergia: '+_msgs(r));
  assert.match(_msgs(r), /ALERGIA/);
});

// Caso 4 — Bacteriemia por Klebsiella KPC (carbapenémico → cultivo + reserve)
test('VOZ caso 4: Klebsiella KPC + meropenem CON cultivo → precaución, no bloquea', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'bacteriemia por klebsiella productora de KPC, hemocultivos positivos' }, atb:[{nombre:'Meropenem'}], micro:{cult:'positivo'} });
  assert.ok(_hasAny(r));
  assert.match(_msgs(r), /CARBAPEN/);
});

// Caso 5 — Pseudomonas MDR + cefepime + renal
test('VOZ caso 5: Pseudomonas MDR + cefepime + ERC → precaución renal', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'pseudomonas multirresistente, enfermedad renal crónica' }, labs:{creatinina:2.4}, atb:[{nombre:'Cefepime'}] });
  assert.match(_msgs(r), /RENAL/);
});

// Caso 6 — Stenotrophomonas + TMP/SMX
test('VOZ caso 6: Stenotrophomonas + cotrimoxazol → sin crítico de alergia', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'stenotrophomonas maltophilia' }, atb:[{nombre:'Trimetoprim/sulfametoxazol'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 7 — Candidemia + caspofungina (sin alertas ATB bacterianas)
test('VOZ caso 7: candidemia + caspofungina → sin alertas de antibiótico', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'candidemia' }, atb:[{nombre:'Caspofungina'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 8 — VIH en Biktarvy (sin alertas PROA bacterianas)
test('VOZ caso 8: VIH en Biktarvy → sin alertas de seguridad antibiótica', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'VIH en tratamiento con Biktarvy, carga viral indetectable' }, atb:[{nombre:'Biktarvy'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 9 — Cambio a Dovato (sin alertas)
test('VOZ caso 9: cambio a Dovato → sin alertas críticas', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'se solicita cambio a Dovato' }, atb:[{nombre:'Dovato'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 10 — TB latente (isoniazida, sin alertas de las reglas actuales)
test('VOZ caso 10: TB latente + isoniazida → sin crítico', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'tuberculosis latente' }, atb:[{nombre:'Isoniazida'}] });
  assert.equal(_hasCrit(r), false);
});

// Caso 11 — Infección periprotésica + vancomicina (monitoreo)
test('VOZ caso 11: infección periprotésica + vancomicina → precaución monitoreo', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'infección periprotésica de rodilla' }, atb:[{nombre:'Vancomicina'}] });
  assert.match(_msgs(r), /VANCOMICINA/);
});

// Caso 12 — C. difficile + clindamicina (precaución)
test('VOZ caso 12: C. difficile → alerta de evitar ATB de riesgo', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'colitis por Clostridioides difficile' }, atb:[{nombre:'Clindamicina'}] });
  assert.match(_msgs(r), /DIFFICILE/);
});

// Caso 13 — Función renal alterada + meropenem
test('VOZ caso 13: creatinina 3.1 + meropenem → precaución renal + carbapenémico', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'lesión renal aguda' }, labs:{creatinina:3.1}, atb:[{nombre:'Meropenem'}], micro:{cult:'positivo'} });
  assert.match(_msgs(r), /RENAL/);
  assert.match(_msgs(r), /CARBAPEN/);
});

// Caso 14 — Conversación con paja: solo dato clínico relevante (amikacina)
test('VOZ caso 14: aminoglucósido detectado pese a ruido → precaución toxicidad', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'el paciente platica del clima pero tiene urosepsis' }, atb:[{nombre:'Amikacina'}] });
  assert.match(_msgs(r), /AMINOGLUC/);
});

// Caso 15 — Reserve (ceftazidima/avibactam) → exige antibiograma
test('VOZ caso 15: ceftazidima/avibactam (Reserve) → alerta documentar antibiograma', () => {
  const r = _vaSafetyChecks({ paciente:{ notas:'CRE por OXA-48' }, atb:[{nombre:'Ceftazidima/avibactam'}], micro:{cult:'positivo'} });
  assert.match(_msgs(r), /RESERVE|antibiograma/i);
});

/* ═══════════ VOZ — Normalizador médico post-transcripción (v272) ═══════════ */
// Extrae la función REAL window._vaNormalizeMedical (con su diccionario) de index.html.
const _mNorm = _idx.match(/const _MED_DICT=\[[\s\S]*?window\._vaNormalizeMedical=function\(text\)\{[\s\S]*?\n\};/);
let _vaNormalizeMedical = (t) => ({ text: t, changes: [] });
if (_mNorm) {
  const _fnN = new Function('const window={};' + _mNorm[0] + ' return window._vaNormalizeMedical;');
  _vaNormalizeMedical = _fnN();
}
const _norm = (t) => _vaNormalizeMedical(t).text;

test('VOZ norm: existe _vaNormalizeMedical', () => {
  assert.ok(_mNorm); assert.equal(typeof _vaNormalizeMedical, 'function');
});
test('VOZ norm: erta pe nem → ertapenem', () => assert.match(_norm('le dimos erta pe nem'), /ertapenem/));
test('VOZ norm: imi pe nem → imipenem', () => assert.match(_norm('cambio a imi pe nem'), /imipenem/));
test('VOZ norm: mero pe nem → meropenem', () => assert.match(_norm('mero pe nem c8h'), /meropenem/));
test('VOZ norm: uve de erre ele → VDRL', () => assert.match(_norm('pedir uve de erre ele'), /VDRL/));
test('VOZ norm: banco micina → vancomicina', () => assert.match(_norm('banco micina iv'), /vancomicina/));
test('VOZ norm: mersa → MRSA', () => assert.match(_norm('aisló mersa'), /MRSA/));
test('VOZ norm: piper tazo → piperacilina/tazobactam', () => assert.match(_norm('piper tazo 4.5g'), /piperacilina\/tazobactam/));
test('VOZ norm: cef tria xona → ceftriaxona', () => assert.match(_norm('cef tria xona 2g'), /ceftriaxona/));
test('VOZ norm: clebsiela → Klebsiella pneumoniae', () => assert.match(_norm('creció clebsiela'), /Klebsiella pneumoniae/));
test('VOZ norm: ka pe ce → KPC', () => assert.match(_norm('productora de ka pe ce'), /KPC/));
test('VOZ norm: caz avi → ceftazidima/avibactam', () => assert.match(_norm('inicio caz avi'), /ceftazidima\/avibactam/));
test('VOZ norm: anfo tericina be liposomal → sin "Bbe"', () => {
  const r = _norm('anfo tericina be liposomal');
  assert.match(r, /anfotericina B liposomal/);
  assert.doesNotMatch(r, /Bbe/);
});
test('VOZ norm: TRAMPA "comió pera" → NO inventa antibiótico', () => {
  assert.doesNotMatch(_norm('comió pera y manzana'), /ertapenem|meropenem/i);
});
test('VOZ norm: TRAMPA "sala de espera" → NO inventa', () => {
  assert.doesNotMatch(_norm('la sala de espera'), /ertapenem|VDRL/i);
});

/* ═══════════ ATB — Terapia combinada (v279) ═══════════ */
const _mTC = _idx.match(/window\.calcTerapiaCombinada=function\(p, hoy\)\{[\s\S]*?\n\};/);
let _calcTC = () => ({combinada:false,n:0,nombres:[]});
if (_mTC) { _calcTC = new Function('const window={};' + _mTC[0] + ' return window.calcTerapiaCombinada;')(); }
test('ATB combinada: existe calcTerapiaCombinada', () => { assert.ok(_mTC); });
test('ATB combinada: 2 activos → combinada', () => {
  assert.equal(_calcTC({atbList:[{nombre:'Meropenem',fechaFinIV:''},{nombre:'Vancomicina',fechaFinIV:''}]},'2026-06-01').combinada, true);
});
test('ATB combinada: 1 activo + 1 suspendido → NO combinada', () => {
  assert.equal(_calcTC({atbList:[{nombre:'Meropenem',fechaFinIV:''},{nombre:'Ceftriaxona',fechaFinIV:'2026-05-20'}]},'2026-06-01').combinada, false);
});
test('ATB combinada: 1 solo activo → NO combinada', () => {
  assert.equal(_calcTC({atbList:[{nombre:'Nitrofurantoína',fechaFinIV:''}]},'2026-06-01').combinada, false);
});
test('ATB combinada: sin ATB → n=0', () => {
  assert.equal(_calcTC({},'2026-06-01').n, 0);
});

/* ═══════════ BLINDAJE anti-borrado de datos clínicos (v281) ═══════════ */
const _mBl = _idx.match(/window\._blindarCamposClinicos=function\(data, prev\)\{[\s\S]*?\n\};/);
let _blindar = () => [];
if (_mBl) { _blindar = new Function('const window={};' + _mBl[0] + ' return window._blindarCamposClinicos;')(); }
test('BLINDAJE: existe _blindarCamposClinicos', () => { assert.ok(_mBl); });

test('BLINDAJE: atbList vacío + prev con ATB → restaura (caso San Luis generalizado)', () => {
  const data = { atbList: [] };
  const prev = { atbList: [{ nombre: 'Meropenem' }, { nombre: 'Vancomicina' }] };
  const cons = _blindar(data, prev);
  assert.equal(data.atbList.length, 2);
  assert.match(cons.join(','), /antibi/i);
});

test('BLINDAJE: atbList con datos NO se sobrescribe (edición legítima respetada)', () => {
  const data = { atbList: [{ nombre: 'Ceftriaxona' }] };
  const prev = { atbList: [{ nombre: 'Meropenem' }, { nombre: 'Vancomicina' }] };
  const cons = _blindar(data, prev);
  assert.equal(data.atbList.length, 1);
  assert.equal(data.atbList[0].nombre, 'Ceftriaxona');
  assert.equal(cons.length, 0);
});

test('BLINDAJE: muestras vacío + prev con cultivos → restaura cultivos', () => {
  const data = { muestras: [] };
  const prev = { muestras: [{ tipo: 'Hemocultivo', organismo: 'E. coli' }] };
  _blindar(data, prev);
  assert.equal(data.muestras.length, 1);
});

test('BLINDAJE: abg objeto vacío {} + prev con antibiograma → restaura', () => {
  const data = { abg: {} };
  const prev = { abg: { meropenem: 'S', ceftriaxona: 'R' } };
  const cons = _blindar(data, prev);
  assert.equal(Object.keys(data.abg).length, 2);
  assert.match(cons.join(','), /antibiograma/i);
});

test('BLINDAJE: abgFoto vacía + prev con foto → restaura foto', () => {
  const data = { abgFoto: null };
  const prev = { abgFoto: 'data:image/png;base64,AAAA' };
  _blindar(data, prev);
  assert.equal(data.abgFoto, 'data:image/png;base64,AAAA');
});

test('BLINDAJE: charlsonItems restaurados también restauran charlsonScore', () => {
  const data = { charlsonItems: [], charlsonScore: null };
  const prev = { charlsonItems: [{ k: 'icc' }], charlsonScore: 3 };
  _blindar(data, prev);
  assert.equal(data.charlsonItems.length, 1);
  assert.equal(data.charlsonScore, 3);
});

test('BLINDAJE: comorbilidades vacías + prev con datos → restaura', () => {
  const data = { comorbilidades: [] };
  const prev = { comorbilidades: ['DM2', 'ERC'] };
  _blindar(data, prev);
  assert.equal(data.comorbilidades.length, 2);
});

test('BLINDAJE: atbPrevios vacíos + prev con datos → restaura', () => {
  const data = { atbPrevios: [] };
  const prev = { atbPrevios: [{ nombre: 'Piperacilina' }] };
  _blindar(data, prev);
  assert.equal(data.atbPrevios.length, 1);
});

test('BLINDAJE: paciente nuevo (prev null) → no protege, permite vacío', () => {
  const data = { atbList: [], muestras: [] };
  const cons = _blindar(data, null);
  assert.equal(cons.length, 0);
  assert.equal(data.atbList.length, 0);
});

test('BLINDAJE: prev vacío + data vacío → no hay falso positivo', () => {
  const data = { atbList: [], muestras: [] };
  const prev = { atbList: [], muestras: [] };
  const cons = _blindar(data, prev);
  assert.equal(cons.length, 0);
});

test('BLINDAJE: campos escalares editables (notas, alergias) NUNCA se tocan', () => {
  const data = { notas: '', alergias: '', atbList: [{ nombre: 'X' }] };
  const prev = { notas: 'nota vieja', alergias: 'penicilina', atbList: [{ nombre: 'X' }] };
  const cons = _blindar(data, prev);
  assert.equal(data.notas, '');        // el médico puede borrar notas a propósito
  assert.equal(data.alergias, '');     // y corregir alergias
  assert.equal(cons.length, 0);
});

test('BLINDAJE: múltiples campos vacíos → conserva todos y los reporta', () => {
  const data = { atbList: [], muestras: [], comorbilidades: [] };
  const prev = { atbList: [{ nombre: 'A' }], muestras: [{ tipo: 'B' }], comorbilidades: ['C'] };
  const cons = _blindar(data, prev);
  assert.equal(cons.length, 3);
});

/* ═══════════ Fisher's Exact Test 2×2 (Fase 0.5) — vs valores de R ═══════════ */
/* Se prueba la función REAL importada de js/core/stats.js (ya no un espejo regex de index.html). */
const _fisher = fisherExact2x2;
const _near = (x, y, tol=0.001) => Math.abs(x - y) <= tol;
test('FISHER: existe fisherExact2x2', () => { assert.equal(typeof fisherExact2x2, 'function'); });
test('FISHER: c(3,1,1,3) → p≈0.4857 (R)', () => { assert.ok(_near(_fisher(3,1,1,3).p, 0.4857), 'p='+_fisher(3,1,1,3).p); });
test('FISHER: c(2,3,3,2) simétrica → p=1', () => { assert.ok(_near(_fisher(2,3,3,2).p, 1.0), 'p='+_fisher(2,3,3,2).p); });
test('FISHER: c(0,5,5,0) → p≈0.007937 (R)', () => { assert.ok(_near(_fisher(0,5,5,0).p, 0.007937), 'p='+_fisher(0,5,5,0).p); });
test('FISHER: c(10,0,0,10) → p muy pequeño (<0.0001)', () => { assert.ok(_fisher(10,0,0,10).p < 0.0001, 'p='+_fisher(10,0,0,10).p); });
test('FISHER: tabla grande balanceada c(20,20,20,20) → p=1', () => { assert.ok(_near(_fisher(20,20,20,20).p, 1.0), 'p='+_fisher(20,20,20,20).p); });
test('FISHER: n=0 → p=1 sin crash', () => { assert.equal(_fisher(0,0,0,0).p, 1); });
test('FISHER: selector testAuto2x2 → Fisher para n<30, χ² para n grande', () => {
  assert.equal(testAuto2x2(3,1,1,3).test, 'Fisher exacto');   // n=8 (<30) → exacto
  assert.equal(testAuto2x2(20,20,20,20).test, 'χ²');          // n=80, esperado≥5 → χ²
});
test('χ²: independiente → p alto; asociación fuerte → p bajo', () => {
  assert.ok(chiSquareTest([[10,10],[10,10]]).pValue > 0.9, 'indep');     // chi²=0 → p=1
  assert.ok(chiSquareTest([[40,10],[10,40]]).pValue < 0.001, 'asociada'); // chi²=36,df=1
});

/* ═══════════ IC95% Wilson (proporciones) y Poisson/Byar (tasas) — v298 ═══════════ */
/* Función REAL importada de js/core/stats.js; valores vs literatura publicada. */
test('Wilson: 5/10 → 50% (IC95% 23.7–76.3) [valor publicado]', () => {
  const c=ci95_wilson(5,10);   // ancla un valor exacto de literatura (los demás casos: tests v221)
  assert.equal(c.pct, 50); assert.equal(c.loPct, 23.7); assert.equal(c.hiPct, 76.3);
});
test('Poisson/Byar: 5 eventos /1000 → tasa 5 (IC95% ~1.6–11.7)', () => {
  const r=ci95_poisson_rate(5,1000);
  assert.equal(r.tasa, 5); assert.ok(Math.abs(r.lo-1.61)<0.05); assert.ok(Math.abs(r.hi-11.67)<0.05);
});
test('Poisson: 0 eventos → tasa 0, lo 0 (límite inferior válido)', () => {
  const r=ci95_poisson_rate(0,500);
  assert.equal(r.tasa, 0); assert.equal(r.lo, 0); assert.ok(r.hi>0);
});
test('Poisson: persona-tiempo 0 → null (sin dividir por cero)', () => { assert.equal(ci95_poisson_rate(5,0).tasa, null); });
test('Formato: fmtPropIC/fmtRateIC arman la celda legible', () => {
  assert.equal(fmtPropIC(5,10), '50% (IC95% 23.7–76.3)');
  assert.equal(fmtRateIC(5,1000), '5 (IC95% 1.61–11.67) /1000 pac-día');
  assert.equal(fmtPropIC(0,0), '—');  // sin datos → guion, no '0%'
});

/* ═══════════ MIC50 / MIC90 (Fase 0.4) ═══════════ */
const _parseMIC = parseMICnum, _micStats = micStats;   // función REAL importada de js/core/stats.js
test('MIC: existe parseMICnum/micStats', () => { assert.equal(typeof parseMICnum, 'function'); assert.equal(typeof micStats, 'function'); });
test('MIC: parse "16" → 16', () => assert.equal(_parseMIC('16'), 16));
test('MIC: parse "<=0.12" → 0.12', () => assert.equal(_parseMIC('<=0.12'), 0.12));
test('MIC: parse ">=32" → 32', () => assert.equal(_parseMIC('>=32'), 32));
test('MIC: parse "0,25" (coma) → 0.25', () => assert.equal(_parseMIC('0,25'), 0.25));
test('MIC: parse "≤4" (símbolo) → 4', () => assert.equal(_parseMIC('≤4'), 4));
test('MIC: basura → null', () => assert.equal(_parseMIC('ND'), null));
test('MIC50/90: serie dilución estándar n=10', () => {
  const r = _micStats(['0.5','1','2','4','8','16','32','64','128','256']);
  assert.equal(r.n, 10); assert.equal(r.mic50, 8); assert.equal(r.mic90, 128);
});
test('MIC50/90: ignora valores no numéricos', () => {
  const r = _micStats(['<=1','2','ND','4','>=8','']);
  assert.equal(r.n, 4);
});
test('MIC50/90: sin datos → null', () => {
  const r = _micStats([]);
  assert.equal(r.n, 0); assert.equal(r.mic50, null);
});

/* ═══════════ Días-paciente reales / DOT NHSN (Fase 0.2) ═══════════ */
const _diasEst = calcDiasEstancia, _diasPac = calcDiasPaciente;   // función REAL importada de js/core/clinical-days.js
test('DIASPAC: existe calcDiasEstancia/calcDiasPaciente', () => { assert.equal(typeof calcDiasEstancia,'function'); assert.equal(typeof calcDiasPaciente,'function'); });
test('DIASPAC: ingreso→corte = días inclusivos', () => {
  assert.equal(_diasEst({ingreso:'2026-06-01'}, '2026-06-10'), 10);
});
test('DIASPAC: alta antes del corte usa fechaAlta', () => {
  assert.equal(_diasEst({ingreso:'2026-06-01', alta:true, fechaAlta:'2026-06-05'}, '2026-06-10'), 5);
});
test('DIASPAC: fechaAlta como Timestamp {seconds}', () => {
  const secs = Math.floor(new Date('2026-06-05T00:00:00').getTime()/1000);
  assert.equal(_diasEst({ingreso:'2026-06-01', alta:true, fechaAlta:{seconds:secs}}, '2026-06-10'), 5);
});
test('DIASPAC: no cuenta más allá del corte (alta futura clamp)', () => {
  assert.equal(_diasEst({ingreso:'2026-06-01', alta:true, fechaAlta:'2026-06-20'}, '2026-06-10'), 10);
});
test('DIASPAC: sin ingreso → 0', () => { assert.equal(_diasEst({}, '2026-06-10'), 0); });
test('DIASPAC: suma del censo', () => {
  const pacs = [{ingreso:'2026-06-01'},{ingreso:'2026-06-06'},{}];
  assert.equal(_diasPac(pacs, '2026-06-10'), 10 + 5 + 0);
});
test('DOT NHSN: corte string LOCAL (FIX v297) → conteo determinista + cada agente cuenta', () => {
  // ATB activo 06-01, corte string '2026-06-05' → 5 días inclusive. Determinista en CUALQUIER
  // zona horaria gracias al fix v297 (antes, en zonas detrás de UTC, daba 4 → DOT sub-contado).
  assert.equal(calcDiaATB({fechaInicioIV:'2026-06-01'}, '2026-06-05').dias, 5);
  const dosATB=[{ingreso:'2026-06-01', atbList:[
    {nombre:'Meropenem',   fechaInicioIV:'2026-06-01'},
    {nombre:'Vancomicina', fechaInicioIV:'2026-06-01'}]}];
  assert.equal(calcDOT(dosATB,'2026-06-05'), 10);   // 2 agentes × 5 días (cada agente cuenta: NHSN)
  const r=dotPer1000(dosATB,'2026-06-05');
  assert.equal(r.dot, 10); assert.equal(r.diasPaciente, 5); assert.equal(r.por1000, 2000); // 10/5×1000
});

/* ═══════════ Magiorakos + intrínsecos (Fase 0.3) ═══════════ */
const _mMag = _idx.match(/const CLSI_CATEGORIES=\{[\s\S]*?\n\}\nwindow\._intrinsicResistanceKeys=_intrinsicResistanceKeys;[\s\S]*?\n\}\n\n\/\/ ── Estandarización NHSN/);
let _clasif = () => ({mdr:false}), _intrin = () => new Set();
if (_mMag) {
  const blk = _mMag[0].replace(/\n\/\/ ── Estandarización NHSN/, '');
  _clasif = new Function('const window={};' + blk + ' return clasificarMagiorakos;')();
  _intrin = new Function('const window={};' + blk + ' return _intrinsicResistanceKeys;')();
}
test('MAG: bloque Magiorakos extraíble', () => { assert.ok(_mMag); });
test('MAG: intrínseco Klebsiella incluye ampicilina', () => { assert.ok(_intrin('Klebsiella pneumoniae').has('amp')); });
test('MAG: E. coli NO tiene ampicilina intrínseca', () => { assert.ok(!_intrin('Escherichia coli').has('amp')); });
test('MAG: Klebsiella solo ampicilina-R → NO MDR (intrínseco excluido)', () => {
  assert.equal(_clasif({amp:'R'}, 'Klebsiella pneumoniae').mdr, false);
});
test('MAG: Klebsiella amp-R + 3 categorías adquiridas R → MDR', () => {
  assert.equal(_clasif({amp:'R',cip:'R',gen:'R',cro:'R'}, 'Klebsiella pneumoniae').mdr, true);
});
test('MAG: E. coli R en 3 categorías → MDR', () => {
  assert.equal(_clasif({cip:'R',gen:'R',cro:'R'}, 'Escherichia coli').mdr, true);
});
test('MAG: "I" cuenta como no-susceptible (Magiorakos)', () => {
  assert.equal(_clasif({cip:'I',gen:'I',cro:'I'}, 'Escherichia coli').mdr, true);
});
test('MAG: E. coli R en 2 categorías → NO MDR', () => {
  assert.equal(_clasif({cip:'R',gen:'R'}, 'Escherichia coli').mdr, false);
});
test('MAG: isMDR unificado llama a clasificarMagiorakos', () => {
  assert.match(_idx, /function isMDR\(p\)\{[\s\S]{0,400}clasificarMagiorakos\(abg/);
});

/* ═══════════ Renderer ExcelJS — Fase 1 (guardas de presencia) ═══════════ */
/* Verificación funcional profunda hecha en Node con exceljs (datos intactos + XML con
   pane/autoFilter/dataValidation/conditionalFormatting/colorScale/dataBar/hyperlinks).
   Estas guardas protegen contra borrado accidental de las piezas clave. */
test('XLSX ExcelJS: existe _buildExcelJSWorkbook y wrapper de descarga', () => {
  assert.match(_idx, /async function _buildExcelJSWorkbook\(opts\)\{/);
  assert.match(_idx, /window\._renderXLSXWithExcelJS=async function/);
});
test('XLSX ExcelJS: cargado por <script src> en head', () => {
  assert.match(_idx, /exceljs(@[\d.]+)?\/dist\/exceljs(\.min)?\.js/);
});
test('XLSX ExcelJS: branch con fallback a SheetJS en __XLSX__', () => {
  assert.match(_idx, /typeof ExcelJS!=='undefined'[\s\S]{0,400}_renderXLSXWithExcelJS/);
  assert.match(_idx, /usando SheetJS/); // mensaje de fallback presente
});
test('XLSX ExcelJS: features clave en el renderer', () => {
  const blk = _idx.match(/async function _buildExcelJSWorkbook[\s\S]*?\n  return wb;\n\}/)[0];
  assert.match(blk, /state:'frozen'/);          // freeze panes
  assert.match(blk, /autoFilter/);              // autofilter
  assert.match(blk, /dataValidation=\{type:'list'/); // dropdowns
  assert.match(blk, /addConditionalFormatting/); // formato condicional
  assert.match(blk, /colorScale/);              // heatmap
  assert.match(blk, /dataBar/);                 // data bars
  assert.match(blk, /hyperlink/);               // portada + ↩ links
  assert.match(blk, /_dashFx/);                 // fórmulas vivas dashboard
});
test('XLSX ExcelJS: consume el MISMO writeData (no pierde hojas)', () => {
  const blk = _idx.match(/async function _buildExcelJSWorkbook[\s\S]*?\n  return wb;\n\}/)[0];
  assert.match(blk, /writeData\.find/);
  assert.match(blk, /sheetDefs\.forEach/);
});

/* ═══════════ Hojas nuevas WHONET/GLASS/QC/Scripts — Fase 3 (guardas) ═══════════ */
test('XLSX nuevas hojas: registradas en sheetDefs', () => {
  assert.match(_idx, /title:'\\u\{1F9EB\} WHONET'/);
  assert.match(_idx, /GLASS-AMR \(OMS\)/);
  assert.match(_idx, /Control de Calidad/);
  assert.match(_idx, /Scripts \(SPSS-R-Python\)/);
});
test('XLSX nuevas hojas: row-arrays en _newSheets', () => {
  assert.match(_idx, /whonetRows,\s*\/\/.*WHONET/);
  assert.match(_idx, /glassRows,\s*\/\/.*GLASS/);
  assert.match(_idx, /qcRows,\s*\/\/.*Calidad/);
  assert.match(_idx, /scriptsRows,\s*\/\/.*Scripts/);
});
test('XLSX WHONET: usa aislamientos deduplicados CLSI M39 + códigos WHONET', () => {
  const blk = _idx.match(/const whonetRows=\[[\s\S]*?if\(whonetRows\.length===1\)/)[0];
  assert.match(blk, /_isolatesDedup\.forEach/);
  assert.match(blk, /_whoOrg/);   // código de organismo WHONET
});
test('XLSX GLASS: agregado RIS por espécimen×patógeno×antibiótico', () => {
  const blk = _idx.match(/const glassRows=\[[\s\S]*?if\(glassRows\.length===1\)/)[0];
  assert.match(blk, /n_tested/); assert.match(blk, /pct_R/);
});
test('XLSX Portada: columna CONTENIDO con descripciones (no vacía)', () => {
  const blk = _idx.match(/async function _buildExcelJSWorkbook[\s\S]*?\n  return wb;\n\}/)[0];
  assert.match(blk, /_descDe\(sd\.title\)/);
  assert.match(blk, /formato compatible WHONET/);
});

/* ═══════════ Gráficas embebidas — Fase 2 (guardas; embedding verificado en Node) ═══════════ */
test('XLSX gráficas: _chartToPNG existe y está protegido (browser-only)', () => {
  assert.match(_idx, /function _chartToPNG\(config, w, h\)\{/);
  assert.match(_idx, /typeof Chart==='undefined'\|\|typeof document==='undefined'\)return null/);
});
test('XLSX gráficas: el renderer embebe opts.charts con addImage', () => {
  const blk = _idx.match(/async function _buildExcelJSWorkbook[\s\S]*?\n  return wb;\n\}/)[0];
  assert.match(blk, /Array\.isArray\(opts\.charts\)/);
  assert.match(blk, /wb\.addImage\(\{base64/);
  assert.match(blk, /ws\.addImage\(imgId/);
});
test('XLSX gráficas: builder genera AWaRe/política/DOT/organismos', () => {
  assert.match(_idx, /typeof Chart!=='undefined'[\s\S]{0,1600}Distribución AWaRe/);
  assert.match(_idx, /DOT por antibiótico \(top 10\)/);
  assert.match(_idx, /Microorganismos \(top 10\)/);
});

/* ═══════════ Tasas IAAS por densidad — Fase 4 (guardas) ═══════════ */
test('XLSX IAAS: hoja Tasas IAAS registrada + row-array', () => {
  assert.match(_idx, /Tasas IAAS \(densidad\)/);
  assert.match(_idx, /iaasDensRows,\s*\/\/.*IAAS/);
});
test('XLSX IAAS: CLABSI/CAUTI por 1000 días-dispositivo con IC Poisson', () => {
  const blk = _idx.match(/const iaasDensRows=\[[\s\S]*?\n  \];/)[0];
  assert.match(blk, /CLABSI/); assert.match(blk, /CAUTI/);
  assert.match(blk, /fmtRateIC\(_clabsi,_cvcDays/);
  assert.match(blk, /fmtRateIC\(_cauti,_foleyDays/);
  assert.match(blk, /inferido/);   // numeradores etiquetados como inferidos (honestidad)
});
test('XLSX IAAS: días-dispositivo reales (inserción→retiro) + LOT/DOT', () => {
  assert.match(_idx, /const _devDays=\(dev\)=>/);
  assert.match(_idx, /Razón DOT\/LOT/);
  assert.match(_idx, /VAP no calculable|requiere capturar el dispositivo ventilador/);
});

/* ═══════════ Cockcroft-Gault — Fase 4.8 ═══════════ */
const _cg = cockcroftGault;   // función REAL importada de js/core/stats.js
test('CG: existe cockcroftGault', () => assert.equal(typeof cockcroftGault, 'function'));
test('CG: 60a/70kg/Cr1.0 hombre ≈ 77.8 mL/min', () => assert.ok(Math.abs(_cg(60,70,1.0,'M')-77.78)<0.5, _cg(60,70,1.0,'M')));
test('CG: mujer aplica factor 0.85', () => assert.ok(Math.abs(_cg(60,70,1.0,'F')-66.1)<0.5, _cg(60,70,1.0,'F')));
test('CG: sin peso → null', () => assert.equal(_cg(60,0,1.0,'M'), null));
test('CG: Cr inválida → null', () => assert.equal(_cg(60,70,0,'M'), null));
test('IAAS: días libres de antibiótico + % exposición', () => {
  assert.match(_idx, /Días libres de antibiótico/);
  assert.match(_idx, /% días con exposición antibiótica/);
});

/* ═══════════ FIX v291: agregar/modificar ATB en pacientes existentes (GATE Reserve) ═══════════ */
test('GATE Reserve: usa prev ROBUSTO (no solo PACS.find)', () => {
  assert.match(_idx, /const _prevForGate=prev\|\|\(editId\?\(PACS\.find/);
});
test('GATE Reserve: NO bloquea — confirma y permite guardar igual', () => {
  // ya no debe existir el return duro que abortaba el guardado por Reserve
  assert.match(_idx, /Guardar igual \(justifico después\)/);
  assert.match(_idx, /reserveJusPendiente=true/);
  // el flujo usa confirm en vez de cortar
  assert.match(_idx, /_decision==='volver'/);
});
test('Resumen: marca Justificación Reserve PENDIENTE', () => {
  assert.match(_idx, /Justificación Reserve PENDIENTE \(documentar\)/);
});
test('Excel Historial ATBs: columna Justificación Reserve', () => {
  assert.match(_idx, /'Indicación Clínica','Justificación Reserve'/);
  assert.match(_idx, /\?'Documentada':'⚠ PENDIENTE'/);
});

/* ═══════════ v292: micro/cama + preliminares PROA ═══════════ */
test('MICRO: guardarPacienteMicro enlaza al paciente existente (no duplica)', () => {
  // matching robusto por cama+servicio o nombre+servicio
  assert.match(_idx, /_norm\(p\.servicio\)===_norm\(svc\) && _norm\(p\.cama\)===_norm\(cama\)/);
  // adjunta muestras al existente con merge (no addDoc nuevo)
  assert.match(_idx, /Muestras agregadas a '\+\(existe\.nombre/);
});
test('MICRO: cama del formulario micro YA no se deshabilita', () => {
  const blk = _idx.match(/const sel=document\.getElementById\('mic-cama'\);[\s\S]*?\n};/)[0];
  assert.doesNotMatch(blk, /disabled/);
  assert.match(blk, /_ocup\[b\]/);
});
test('GUARDAR: cama ocupada ofrece abrir ficha del ocupante (no callejón)', () => {
  assert.match(_idx, /¿Querías agregarle un resultado\/preliminar a ESE paciente\?/);
  assert.match(_idx, /abrirReporteMicro\(_camaRobadaLocal\.id\)/);
});
test('PRELIM: sello de origen (fuente/capturadoPor/rol/fecha)', () => {
  assert.match(_idx, /preliminar:\(res==='positivo_preliminar'\)\?\{/);
  assert.match(_idx, /fuente:_fuente,capturadoPor:U\.uid/);
  assert.match(_idx, /const _fuente=window\._isMicrobiologo\?'micro':'proa'/);
});
test('PRELIM: micro reemplaza a PROA; PROA no pisa a micro', () => {
  assert.match(_idx, /_bloqueaProa=\(res==='positivo_preliminar'\)&&_fuente==='proa'&&_targetM&&_targetM\.preliminar&&_targetM\.preliminar\.fuente==='micro'/);
});
test('PRELIM: PROA puede capturar desde la ficha (botón)', () => {
  assert.match(_idx, /_isMicrobiologo\|\|window\._isPROA\)html\+='<button[\s\S]*?Capturar preliminar/);
});
test('PRELIM: UI muestra el origen (Micro/PROA)', () => {
  assert.match(_idx, /_pf==='micro'\?' · 🔬Micro':_pf==='proa'\?' · ⭐PROA'/);
});

/* ═══════════ PARIDAD handler↔window — guard PERMANENTE de botones muertos (v293) ═══════════ */
/* Riesgo sistémico: en un <script type="module">, todo handler inline (onclick/oninput/…) corre
   en alcance GLOBAL → la función debe estar en window. Esta prueba extrae todos los handlers y
   todos los nombres expuestos, y FALLA si algún handler referencia algo no expuesto. */
test('NO hay botones muertos (handlers inline sin función en window)', () => {
  const EXCL = new Set([
    // keywords / control
    'if','for','while','return','typeof','function','new','switch','catch','else','do','delete','void','await','yield','in','of','instanceof','throw',
    // globals seguros
    'event','window','document','this','true','false','null','undefined','console',
    'Math','JSON','Number','String','Array','Object','Boolean','Date','RegExp','Map','Set','Promise','parseInt','parseFloat','isNaN','setTimeout','setInterval','clearTimeout','alert','confirm','prompt','encodeURIComponent','decodeURIComponent','escape','unescape','fetch','requestAnimationFrame',
    // funciones CSS que aparecen dentro de strings de estilo en los handlers
    'rgba','rgb','var','calc','url','translate','translateX','translateY','translateZ','translate3d','scale','scaleX','scaleY','rotate','rotateX','rotateY','skew','linear','radial','hsl','hsla','blur','brightness','cubic','matrix','perspective','repeat','minmax','clamp','attr','counter','env','min','max',
  ]);
  const called = new Map();
  const hRe = /\bon[a-z]+\s*=\s*"([^"]*)"/g; let m;
  while ((m = hRe.exec(_idx))) {
    const body = m[1];
    const cRe = /(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g; let c;
    while ((c = cRe.exec(body))) { const fn = c[1]; if (!EXCL.has(fn)) called.set(fn, (called.get(fn)||0)+1); }
  }
  const exposed = new Set();
  let e; const wRe = /window\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((e = wRe.exec(_idx))) exposed.add(e[1]);
  const wRe2 = /window\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]\s*=/g;
  while ((e = wRe2.exec(_idx))) exposed.add(e[1]);
  const dead = [...called.keys()].filter(fn => !exposed.has(fn));
  assert.deepEqual(dead, [], 'BOTONES MUERTOS (handler inline sin window.fn): ' + dead.map(f=>f+'×'+called.get(f)).join(', '));
});

/* ═══════════ v293: gate de sepsis no bloquea el guardado al cancelar ═══════════ */
test('GATE sepsis: libera _guardarBusy ANTES de abrir el gate (cancelar no bloquea)', () => {
  // el reset debe ocurrir antes de _mostrarGateSepsis, no solo dentro del callback
  assert.match(_idx, /window\._guardarBusy=false;\s*\n\s*if\(btnGuardar\)\{btnGuardar\.disabled=false;btnGuardar\.style\.opacity='';\}\s*\n\s*_mostrarGateSepsis\(\(\)=>\{ guardar\(\); \}\)/);
});
