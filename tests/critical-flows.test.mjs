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
import { calcDiaATB, calcDia, calcDiasEstancia, calcDiasPaciente, calcDOT, dotPer1000 } from '../js/core/clinical-days.js';
import { corregirTranscripcionMedica, fonetEs, levenshtein } from '../js/core/medical-voice.js';
import { clasificarMagiorakos, _intrinsicResistanceKeys } from '../js/core/magiorakos.js';
import { cie10DeDx, categorizarDx } from '../js/core/dx-cie10.js';
import { intrinsicConflicts, exceptionalPhenotypes, INTRINSIC_RULES, quinoloneCrossResistance, aminoglycosideSynergy } from '../js/core/abg-phenotype.js';

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

// 11) CIE-10 v222 — ahora función REAL importada de js/core/dx-cie10.js (con la taxonomía COMPLETA),
//     no un espejo simplificado. Los mismos casos siguen verdes contra la lógica que de verdad corre.

test('CIE-10: pielonefritis → N39.0 (UTI)', () => {
  assert.equal(cie10DeDx('Pielonefritis aguda complicada').cie, 'N39.0');
});
test('CIE-10: sepsis → A41.9', () => {
  assert.equal(cie10DeDx('Sepsis (Sepsis-3) — foco en estudio').cie, 'A41.9');
});
test('CIE-10: C. difficile → A04.7', () => {
  assert.equal(cie10DeDx('Colitis por C. difficile').cie, 'A04.7');
});
test('CIE-10: PRIORIDAD — CLABSI gana sobre bacteriemia genérica', () => {
  // "bacteriemia asociada a CVC" matchea BACT y CLABSI → debe ganar CLABSI (más específico)
  const r=cie10DeDx('Bacteriemia asociada a CVC');
  assert.equal(r.cat, 'CLABSI');
  assert.equal(r.cie, 'T80.2');
});
test('CIE-10: dx no infeccioso/desconocido → B99.9 (no inventa)', () => {
  assert.equal(cie10DeDx('Dolor torácico inespecífico').cie, 'B99.9');
});
test('CIE-10: dx vacío → B99.9', () => {
  assert.equal(cie10DeDx('').cie, 'B99.9');
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

/* ═══════════ P0 (auditoría v312): dispositivos.eventos[] / PICC no se pierden al guardar la ficha ═══════════ */
test('BLINDAJE P0: dispositivos.eventos[] (modal 🩺/PICC) se conserva al guardar la ficha', () => {
  // El form reescribe dispositivos.{cvc,foley} SIN eventos → sin blindaje, updateDoc borraría el PICC.
  const data = { dispositivos: { cvc: { presente: false }, foley: { presente: false } } };
  const prev = { dispositivos: { cvc: { presente: false }, foley: { presente: false }, eventos: [{ id: 'dev_1', tipo: 'picc', fechaInsercion: '2026-06-01' }] } };
  const cons = _blindar(data, prev);
  assert.equal((data.dispositivos.eventos || []).length, 1, 'el PICC/eventos[] se perdió al guardar');
  assert.equal(data.dispositivos.eventos[0].tipo, 'picc');
  assert.match(cons.join(','), /dispositivos|PICC/i);
});
test('BLINDAJE P0: eventos[] provistos por data (edición legítima) NO se sobrescriben', () => {
  const data = { dispositivos: { cvc: {}, foley: {}, eventos: [{ id: 'dev_nuevo', tipo: 'cvc' }] } };
  const prev = { dispositivos: { eventos: [{ id: 'dev_viejo', tipo: 'picc' }] } };
  _blindar(data, prev);
  assert.equal(data.dispositivos.eventos[0].id, 'dev_nuevo', 'no debe pisar eventos ya provistos');
});

/* ═══════════ P0 (auditoría v312): mes activo en hora LOCAL (no UTC) ═══════════ */
test('MESLOCAL P0: currentMonth se calcula en hora LOCAL, no en UTC', () => {
  // Bug: new Date().toISOString().slice(0,7) salta de mes la noche de fin de mes (MX UTC-6).
  assert.ok(!/currentMonth=new Date\(\)\.toISOString\(\)\.slice\(0,7\)/.test(_idx), 'currentMonth sigue calculándose en UTC');
  assert.ok(/currentMonth=\(\(\)=>\{const _n=new Date\(\);return _n\.getFullYear\(\)/.test(_idx), 'currentMonth no usa la construcción en hora local');
});

/* ═══════════ P1 (auditoría v313): gate Reserve — clasificación AWaRe por nombre (fail-safe) ═══════════ */
const _mATBX = _idx.match(/const ATBX=\[[\s\S]*?\n\];/);
const _mNormAtb = _idx.match(/function _normAtbNom\(s\)\{[\s\S]*?\.trim\(\);\}/);
const _mCls = _idx.match(/function _clasificarAware\(nombre\)\{[\s\S]*?\n\}/);
let _clasificar = null;
if (_mATBX && _mNormAtb && _mCls) { _clasificar = new Function(_mATBX[0] + '\n' + _mNormAtb[0] + '\n' + _mCls[0] + '\n return _clasificarAware;')(); }
test('GATE Reserve: _clasificarAware deriva aware/pol del catálogo ATBX', () => {
  assert.ok(_clasificar, 'no se extrajo _clasificarAware + ATBX');
  // Carbapenémico Reserve/restringido → el gate DEBE poder dispararse aunque la solicitud no lo trajera.
  assert.equal(_clasificar('Meropenem').aware, 'Reserve', 'Meropenem debe clasificar como Reserve');
  assert.equal(_clasificar('Meropenem').pol, 'restringido', 'Meropenem debe ser restringido');
  // Matching tolerante por primera palabra (slash/acentos normalizados).
  assert.equal(_clasificar('Piperacilina-Tazobactam').aware, 'Reserve', 'pip-tazo debe clasificar como Reserve');
  // Un ATB de menor restricción NO debe quedar como Reserve (no sobre-bloquear el flujo normal).
  assert.notEqual(_clasificar('Ceftriaxona').aware, 'Reserve', 'Ceftriaxona no es Reserve');
  // Vacío → sin clasificación (no rompe).
  assert.equal(_clasificar('').aware, '');
});
test('GATE Reserve: el fail-safe re-deriva aware/pol cuando la solicitud no los trae', () => {
  assert.ok(/if\(!_aw&&!_pol\)\{const _c=_clasificarAware\(s\.antibiotico\|\|s\.atb\)/.test(_idx), 'farmaciaLiberarDirecto no re-deriva aware/pol faltantes');
});
test('GATE Reserve: las 3 creadoras de solicitud estampan aware/pol', () => {
  assert.ok(/antibiotico:atb,dosis,indicacion:ind,aware:_cls\.aware,pol:_cls\.pol/.test(_idx), 'crearSolicitud no estampa aware/pol');
  assert.ok(/servicio:p\?\.servicio\|\|'—',\s*antibiotico:atb,\s*aware:_cls\.aware,pol:_cls\.pol/.test(_idx), 'crearSolicitudPaciente no estampa servicio+aware/pol');
  assert.ok(/antibiotico:atb,atb,aware:_clsU\.aware,pol:_clsU\.pol/.test(_idx), 'guardarSolicitudUrgente no corrige clave/estampa aware/pol');
});

/* ═══════════ P1 (auditoría v314): bloqueo "Total" funcional + sin auto-aprobación en lote ═══════════ */
test('BLOQUEO P1: severidad "total" solo la libera infectología/admin (ya no es decorativa)', () => {
  assert.ok(/_bloq&&_bloq\.severidad==='total'&&!window\._isInfectologo&&!window\._isAdmin/.test(_idx), 'la severidad total no se aplica en liberarBloqueoATB');
  // El botón "Quitar bloqueo total" se oculta a Farmacia cuando el bloqueo es total.
  assert.ok(/\(b\.severidad==='total'\)\?\(window\._isAdmin\|\|window\._isInfectologo\)/.test(_idx), 'el botón total no gatea por severidad');
});
test('BLOQUEO P1: quitar el bloqueo NO auto-aprueba solicitudes en lote (saltaba confirmarRevision)', () => {
  assert.ok(!/motivoDecision:'Auto-aprobado al quitar bloqueo global de '\+atb/.test(_idx), 'sigue la auto-aprobación en lote al desbloquear');
});

/* ═══════════ P1 (auditoría v315): dosis de profilaxis PCP corregida (era contradictoria/sobredosis) ═══════════ */
test('PCP P1: la profilaxis PCP ya no indica una dosis contradictoria ("TID × 3 días/semana")', () => {
  assert.ok(!/TID × 3 días\/semana/.test(_idx), 'sigue la dosis PCP contradictoria "TID × 3 días/semana"');
  assert.ok(!/DS TID 3×\/semana/.test(_idx), 'sigue "DS TID 3×/semana" (Idelalisib)');
  assert.ok(!/en lugar de DS BID/.test(_idx), 'sigue citando "DS BID" como basal de profilaxis (debe ser DS QD)');
  // La forma correcta de profilaxis PCP debe estar presente (diaria o 3×/semana L-M-V).
  assert.ok(/1 tableta VO cada 24h \(diario\)/.test(_idx), 'no aparece la dosis PCP correcta (diaria)');
});

/* ═══════════ P1 (auditoría v316): dictado por voz — selección correcta, no invierte el plan ═══════════ */
const _mSelOpt = _idx.match(/const selOpt=\(id,val\)=>\{[\s\S]*?return false;\};/);
function _mkSel(options) { return { tagName: 'SELECT', value: '', options: options.map(([value, text]) => ({ value, text })), dispatchEvent() {} }; }
test('VOZ P1: selOpt usa match EXACTO primero — "escalar" ya no cae en "desescalar"', () => {
  assert.ok(_mSelOpt, 'no se extrajo selOpt del dictado');
  const sel = _mkSel([['escalar', 'Escalar'], ['desescalar', 'Desescalar'], ['mantener', 'Mantener ATB']]);
  const selOpt = new Function('document', _mSelOpt[0] + '\n return selOpt;')({ getElementById: () => sel });
  selOpt('f-accion', 'escalar');
  assert.equal(sel.value, 'escalar', '"escalar" se mapeó al valor equivocado (¿desescalar?)');
  sel.value = '';
  selOpt('f-accion', 'desescalar');
  assert.equal(sel.value, 'desescalar', '"desescalar" debe seguir funcionando');
});
test('VOZ P1: el dictado mapea nombre de ATB (tolerante), frecuencia y organismo por especie', () => {
  assert.ok(/const _fillAtbNom=\(id,nombre\)=>/.test(_idx), 'falta _fillAtbNom (match tolerante de ATB)');
  assert.ok(/_fillAtbNom\('atb-'\+i\+'-nom',vnom\)\|\|fill/.test(_idx), 'no usa _fillAtbNom para el nombre del ATB');
  assert.ok(/const _dosFull=\(vfrec&&!String\(vdos/.test(_idx), 'la frecuencia no se concatena a la dosis');
  assert.ok(/exigir match de ESPECIE/.test(_idx), 'el organismo no exige match de especie (seguía por género)');
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
const _clasif = clasificarMagiorakos, _intrin = _intrinsicResistanceKeys; // función REAL de js/core/magiorakos.js
test('MAG: funciones Magiorakos importables', () => { assert.equal(typeof clasificarMagiorakos,'function'); assert.equal(typeof _intrinsicResistanceKeys,'function'); });
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
test('MAG v395: MRSA con panel escaso (4 fármacos, todo R) es MDR, NO "Posible PDR"', () => {
  // El bug: con 4 categorías todas R, posPDR se afirmaba aunque no se probaron glucopéptidos/oxazolidinonas/
  // lipopéptidos (las de última línea). Ahora exige cobertura ≥ mitad de categorías.
  const r = _clasif({oxa:'R',cip:'R',ery:'R',cli:'R'}, 'Staphylococcus aureus');
  assert.equal(r.posPDR, false, 'un panel de 4 categorías no puede afirmar Posible PDR');
  assert.equal(r.classification, 'MDR', 'debe degradar a MDR por cobertura insuficiente');
  assert.equal(r.adequatePanel, false, 'el panel escaso no es adecuado para XDR/PDR');
});
test('MAG v395: Pseudomonas pan-R con cobertura adecuada (≥5 categorías) SÍ marca Posible PDR', () => {
  const r = _clasif({gen:'R',imi:'R',ctaz:'R',cip:'R',pitaz:'R',azt:'R'}, 'Pseudomonas aeruginosa');
  assert.equal(r.adequatePanel, true, 'la cobertura debe ser adecuada (≥5 de 9 categorías)');
  assert.equal(r.posPDR, true, 'con cobertura adecuada y todo no-susceptible, Posible PDR es válido');
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
  // v317: el conteo migró de la lectura legacy `_devDays(dev)` a la lista unificada `_devDaysTipos(tipos)`.
  assert.match(_idx, /const _devDaysTipos=\(tipos\)=>/);
  assert.match(_idx, /Razón DOT\/LOT/);
  assert.match(_idx, /VAP no calculable|requiere capturar el dispositivo ventilador/);
});
test('XLSX IAAS P1 (v317): días-dispositivo y CLABSI/CAUTI cuentan eventos[]/PICC (no solo legacy .presente)', () => {
  const blk = _idx.match(/const _devDaysTipos[\s\S]*?_cauti\+\+;\}\);/)[0];
  // Lee desde la lista unificada (incluye eventos[] del botón 🩺 y el PICC).
  assert.match(blk, /_dispositivosDe\(p\)/);
  // PICC cuenta como acceso central junto con CVC para días-catéter y CLABSI.
  assert.match(blk, /\['cvc','picc'\]/);
  assert.match(blk, /e\.tipo==='cvc'\|\|e\.tipo==='picc'/);
  // Ya NO usa la lectura legacy d.cvc.presente para contar.
  assert.ok(!/d\.cvc&&d\.cvc\.presente&&_esBactIAAS/.test(_idx), 'sigue contando CLABSI por la vía legacy .presente');
});

/* ═══════════ P1 (auditoría v318): los CMI (MIC) de la ficha ya no se descartan al guardar ═══════════ */
test('MIC P1: guardar() persiste los CMI de la ficha desde window._abgMICs', () => {
  assert.ok(/abg:getAbg\(\),mic:\(\(\)=>\{const _ag=getAbg\(\)/.test(_idx), 'guardar() no construye mic desde _abgMICs');
});
test('MIC P1: el CMI (mic) se blinda como el antibiograma (no se pierde en ediciones posteriores)', () => {
  const data = { mic: {} };
  const prev = { mic: { mer: '0.25', cro: '>=64' } };
  const cons = _blindar(data, prev);
  assert.equal(Object.keys(data.mic).length, 2, 'el mic no se restauró al editar');
  assert.match(cons.join(','), /CMI|MIC/i);
});

/* ═══════════ P1 (auditoría v319): tarjetas resuelven cama/servicio ACTUAL desde PACS (no stale) ═══════════ */
const _mUbic = _idx.match(/function _ubicacionSol\(s\)\{.*\}/);
test('UBIC P1: _ubicacionSol resuelve la ubicación actual del paciente (no la congelada en la solicitud)', () => {
  assert.ok(_mUbic, 'falta _ubicacionSol');
  const fn = new Function('PACS', _mUbic[0] + '\n return _ubicacionSol;')([{ id: 'p1', cama: 'UCI-4', servicio: 'UCI' }]);
  // Solicitud con cama vieja (paciente trasladado) → devuelve la ACTUAL de PACS.
  const u = fn({ patientId: 'p1', cama: 'MI-210', servicio: 'Medicina Interna' });
  assert.equal(u.cama, 'UCI-4'); assert.equal(u.servicio, 'UCI');
  // Sin paciente en PACS → cae al valor del documento (back-compat).
  const u2 = fn({ patientId: 'zzz', cama: 'X-1', servicio: 'Urgencias' });
  assert.equal(u2.cama, 'X-1'); assert.equal(u2.servicio, 'Urgencias');
  // Las tarjetas principales (PROA/Farmacia/almacén/enfermería) usan el helper.
  assert.ok(/_ubicacionSol\(s\)\.cama/.test(_idx) && /_ubicacionSol\(s\)\.servicio/.test(_idx), 'las tarjetas no usan _ubicacionSol');
});

/* ═══════════ P1 (auditoría v320): el DOT usa calcDOT por-agente (no subcuenta combinación) ═══════════ */
test('DOT P1: el DOT reportado usa calcDOT por-agente; el per-paciente se etiqueta como duración/LOT', () => {
  // kpis muestra el DOT real (calcDOT), no la suma de calcDia (que es LOT/paciente).
  assert.ok(/const dotReal=calcDOT\(p\);/.test(_idx), 'kpis no calcula el DOT real con calcDOT');
  assert.ok(/d:'DOT: '\+dotReal/.test(_idx), 'kpis sigue mostrando el LOT etiquetado como DOT');
  // Acumulación por servicio usa DOT real por-agente (no calcDia/paciente).
  assert.ok(/byService\[svc\]\.dot\+=calcDOT\(\[p2\]\)/.test(_idx), 'byService no acumula con calcDOT');
  assert.ok(/svMap\[sv\]\.dot\+=calcDOT\(\[p\]\)/.test(_idx), 'svMap (CONASABI) no acumula con calcDOT');
  // El reporte CONASABI incluye una fila de DOT real (NHSN-AUR), además del LOT.
  assert.ok(/DOT — días de terapia \(NHSN-AUR\)/.test(_idx), 'falta la fila de DOT real (NHSN) en el reporte');
  // El total-por-paciente del tablero/reporte se relabeló a duración/LOT (ya no "DOT promedio" sin matiz).
  assert.ok(/Duración prom\. \(LOT\)/.test(_idx) && /Duración promedio de terapia \(LOT/.test(_idx), 'no se relabeló la duración promedio (LOT) en tablero/reporte');
});

/* ═══════════ P1 (auditoría v321): retirar un dispositivo resuelve su alarma (no fatiga de alarma) ═══════════ */
test('ALARMA P1: _retirarDispositivo marca la alerta24h como resuelta (ambas ramas)', () => {
  assert.ok(/async function _resolverAlarmaDispositivo\(pid,dispKey\)/.test(_idx), 'falta _resolverAlarmaDispositivo');
  assert.ok(/status:'resuelta',resueltaAt:serverTimestamp\(\)/.test(_idx), 'no marca la alerta como resuelta');
  assert.ok(/_resolverAlarmaDispositivo\(pid,'dispositivo_'\+t\+'_'\+eventoId\)/.test(_idx), 'rama legacy no resuelve la alarma');
  assert.ok(/_resolverAlarmaDispositivo\(pid,'dispositivo_'\+ev\[idx\]\.tipo\+'_'\+eventoId\)/.test(_idx), 'rama eventos no resuelve la alarma');
});

/* ═══════════ P1 (auditoría v322): FC/DDD solo para Farmacéutico titular (UI alineada a firestore.rules) ═══════════ */
test('PERMFARM P1: la UI de FC/DDD se restringe al titular (el Auxiliar ya no falla en silencio)', () => {
  // Flag que espeja isHospFarmaceuticoTitular (admin o rol 'Farmacéutico' exacto; NO Auxiliar).
  assert.ok(/window\._isFarmTitular\s*=window\._isAdmin\|\|_rol==='Farmacéutico'/.test(_idx), 'falta el flag _isFarmTitular');
  // El botón "Reco FC" se gatea por titular.
  assert.ok(/const esFarma=window\._isFarmTitular;/.test(_idx), 'el botón Reco FC no gatea por titular');
  // Guardar DDD: mensaje explícito para el no-titular en vez de fallo silencioso de permisos.
  assert.ok(/if\(!window\._isFarmTitular\)\{toast\('Solo el Farmacéutico titular puede guardar el consumo DDD'/.test(_idx), 'guardarDDDFarmacia no bloquea al Auxiliar con mensaje claro');
  // El subtab DDD se oculta y se redirige al no-titular.
  assert.ok(/data-tab="ddd-farm"\]'\);if\(_dt\)_dt\.style\.display='none'/.test(_idx), 'el subtab DDD no se oculta al Auxiliar');
});

/* ═══════════ P1 (auditoría v323): antibiograma acumulado deduplica por paciente (CLSI M39) ═══════════ */
const _mNormSpec = _idx.match(/function _normalizeSpecimen\(tipo\)\{[\s\S]*?\n\}/);
const _mM39 = _idx.match(/function clsim39Deduplicate\(isolates,opts\)\{[\s\S]*?\n\}/);
let _m39 = null;
if (_mNormSpec && _mM39) _m39 = new Function(_mNormSpec[0] + '\n' + _mM39[0] + '\n return clsim39Deduplicate;')();
test('M39 P1: clsim39Deduplicate cuenta 1 aislamiento por paciente+organismo+muestra', () => {
  assert.ok(_m39, 'no se extrajo clsim39Deduplicate');
  const iso = [
    { patientId: 'p1', organismo: 'E. coli', muestra: 'Hemocultivo', fecha: '2026-06-01' },
    { patientId: 'p1', organismo: 'E. coli', muestra: 'Hemocultivo', fecha: '2026-06-05' }, // duplicado → se descarta
    { patientId: 'p1', organismo: 'E. coli', muestra: 'Urocultivo', fecha: '2026-06-03' },  // otra muestra → cuenta
    { patientId: 'p2', organismo: 'E. coli', muestra: 'Hemocultivo', fecha: '2026-06-02' }, // otro paciente → cuenta
  ];
  assert.equal(_m39(iso).length, 3, 'no deduplicó los cultivos repetidos del mismo paciente');
});
test('M39 P1: renderCumAbg incluye patientId y deduplica antes de calcular %S/R y MIC', () => {
  assert.ok(/allAbgs\.push\(\{patientId:pac\.id/.test(_idx), 'renderCumAbg no incluye patientId en el aislamiento');
  assert.ok(/const allAbgsDedup=window\.clsim39Deduplicate/.test(_idx), 'renderCumAbg no aplica la deduplicación M39');
});

/* ═══════════ P2 (auditoría v324): batch de correctitud — calcDia, analítica, auto-solicitud Reserve ═══════════ */
test('CORR P2: calcDia ignora filas de ATB SIN nombre al fijar la fecha de inicio (no infla días)', () => {
  const fmt = d => d.toISOString().slice(0, 10);
  const hoy = new Date();
  const hace20 = new Date(hoy); hace20.setDate(hoy.getDate() - 20);
  const hace2 = new Date(hoy); hace2.setDate(hoy.getDate() - 2);
  const p = { accion: 'mantener', atbList: [{ nombre: '', fechaInicioIV: fmt(hace20) }, { nombre: 'Meropenem', fechaInicioIV: fmt(hace2) }] };
  const dia = calcDia(p);
  assert.ok(dia >= 2 && dia <= 4, 'calcDia contó la fila sin nombre (esperaba ~3, obtuvo ' + dia + ')');
});
test('CORR P2: analítica 2x2 usa el enum real de acción (mantener / vo), no continuar / switch-vo', () => {
  assert.ok(/if\(varKey==='continuar'\)return p\.accion==='mantener'/.test(_idx), "_anVarBool 'continuar' no compara contra 'mantener'");
  assert.ok(/if\(varKey==='switch_vo'\)return p\.accion==='vo'/.test(_idx), "_anVarBool 'switch_vo' no compara contra 'vo'");
});
test('CORR P2: la auto-solicitud Reserve usa el nombre del ATB real, no el string concatenado', () => {
  assert.ok(/const _atbReserve=\(atbListData\|\|\[\]\)\.find\(a=>a&&a\.nombre&&\(a\.aware==='Reserve'/.test(_idx), 'la auto-solicitud no selecciona el ATB Reserve real');
  assert.ok(/_atbNombreAuto=\(_atbReserve\?\.nombre\|\|/.test(_idx), '_atbNombreAuto no prioriza el ATB Reserve real');
});

/* ═══════════ VOZ (v326): corrector de transcripción médica (portado de agenda médica) ═══════════ */
test('VOZMED: corrige confusiones conocidas (septriasona → ceftriaxona)', () => {
  const r = corregirTranscripcionMedica('inicié septriasona un gramo IV');
  assert.match(r.corregido, /ceftriaxona/i);
});
test('VOZMED: corrige un fármaco mal transcrito por fonética/Levenshtein (meropenen → meropenem)', () => {
  const r = corregirTranscripcionMedica('dejé meropenen para la sepsis');
  assert.match(r.corregido, /meropenem/i);
  assert.ok(r.cambios.length >= 1, 'no registró el cambio');
});
test('VOZMED: NO toca palabras comunes del español (conservador)', () => {
  const r = corregirTranscripcionMedica('el paciente presenta fiebre y dolor');
  assert.equal(r.corregido, 'el paciente presenta fiebre y dolor');
});
test('VOZMED: fonetEs normaliza (c/k seseo) y levenshtein mide edición', () => {
  assert.equal(fonetEs('amikacina'), fonetEs('amicacina'));
  assert.equal(levenshtein('meropenem', 'meropenen'), 1);
});

/* ═══════════ P2 (auditoría v325): clasificación Mis-Solicitudes, guard de stock, crash Pre-TX ═══════════ */
test('MISSOL P2: retenido/sin_stock NO se clasifican como Rechazadas (van a en proceso)', () => {
  assert.ok(/filtro==='denegado'\)return\['denegado','rechazado'\]\.includes/.test(_idx), "'denegado' aún incluye retenido/sin_stock");
  assert.ok(/'solicitado_justif','retenido_farmacia','sin_stock'/.test(_idx), 'retenido/sin_stock no pasaron a pendiente');
  assert.ok(/'liberado_farmacia','en_almacen','entregado'/.test(_idx), 'en_almacen no cuenta como aprobada');
});
test('STOCK P2: farmaciaConfirmarStock tiene guard anti-doble-click', () => {
  assert.ok(/if\(window\._stockBusy\)return; window\._stockBusy=true;/.test(_idx), 'falta el guard _stockBusy');
  assert.ok(/finally\{window\._stockBusy=false;\}/.test(_idx), 'no libera el lock _stockBusy');
});
test('TXCRASH P2: Pre-TX/Profilaxis no crashean sin paciente seleccionado', () => {
  assert.ok(/sub==='tx-pretx'\)cont\.innerHTML=p\?_renderTxPreTx\(p\):/.test(_idx), 'Pre-TX no está guardado contra p null');
  assert.ok(/sub==='tx-profilaxis'\)cont\.innerHTML=p\?_renderTxProfilaxis\(p\):/.test(_idx), 'Profilaxis no está guardada contra p null');
});

/* ═══════════ P2 (auditoría v328): seguridad clínica — fenotipo ESBL + gate qSOFA desde la ficha ═══════════ */
test('ESBL P2: el cribado de BLEE excluye cefepime y usa no-susceptible (R o I) por CLSI', () => {
  // v334: el cribado 3GC se movió a la variable _3gcNoS (R||I, sin cefepime). v342: + cefotaxima (ctx).
  assert.ok(/const _3gcNoS=\['cro','ctx','ctaz','azt'\]\.some\(k=>abg\[k\]==='R'\|\|abg\[k\]==='I'\)/.test(_idx), 'el cribado ESBL no usa cro/ctx/ctaz/azt con no-susceptible');
  assert.ok(!/'cfp'[^\]]*\.some\(k=>abg\[k\]==='R'\)/.test(_idx), 'el cribado ESBL aún incluye cefepime / solo R');
});
test('QSOFA P2: el gate de cultivo (qSOFA≥2) también aplica al solicitar desde la ficha', () => {
  assert.ok(/window\._isUrgencias&&p&&\(\(p\.urgenciasQsofa\|\|p\.sofaScore\|\|0\)>=2\)/.test(_idx), 'falta el gate qSOFA en crearSolicitudPaciente');
  assert.ok(/await window\._checkCultGate\(pid\)/.test(_idx), 'la ficha no consulta _checkCultGate');
});

/* ═══════════ P2 (auditoría v329): integridad — paciente por voz con atbList + vacunación persiste ═══════════ */
test('VOZPAC P2: el paciente creado por voz incluye atbList + inicio + ingreso (no Día 1 congelado)', () => {
  assert.ok(/atbList:\(d\.atb\|\|\[\]\)\.filter\(a=>a&&a\.nombre\)\.map\(a=>\(\{nombre:a\.nombre/.test(_idx), 'el paciente por voz no construye atbList');
  assert.ok(/inicio:new Date\(\)\.toISOString\(\)\.slice\(0,10\),ingreso:new Date\(\)\.toISOString\(\)\.slice\(0,10\)/.test(_idx), 'no setea inicio/ingreso');
});
test('VACPTX P2: los selects de vacunación Pre-TX disparan la persistencia (onchange)', () => {
  assert.ok(/<select id="\$\{id\}" onchange="window\._pretxRecs&&window\._pretxRecs\(\)"/.test(_idx), 'vacc() no dispara _pretxRecs al cambiar');
});

/* ═══════════ P2 (auditoría v330): seguridad/datos — gate de dispensación auxiliar + camas anti lost-update ═══════════ */
test('DISPAUX P2: marcarDispensadoAux tiene gate de rol y esquema de auditoría unificado', () => {
  assert.ok(/if\(!window\._isFarmaceutico&&!window\._isAdmin\)\{toast\('Solo Farmacia puede registrar dispensación'/.test(_idx), 'falta el gate de rol en marcarDispensadoAux');
  assert.ok(/dispensadoPorUid:U\.uid,\s*dispensadoNombre:window\._userName/.test(_idx), 'no unificó el esquema (dispensadoPorUid + dispensadoNombre)');
});
test('CAMAS P2: addCama/delCama refrescan desde Firestore + guard de admin (anti lost-update)', () => {
  assert.ok(/async function _refreshCamas\(\)/.test(_idx), 'falta _refreshCamas');
  assert.ok(/window\.addCama=async svc=>\{if\(!window\._isAdmin\)/.test(_idx), 'addCama sin guard de admin');
  assert.ok(/window\.delCama=async\(svc,cama\)=>\{if\(!window\._isAdmin\)/.test(_idx), 'delCama sin guard de admin');
  assert.ok((_idx.match(/await _refreshCamas\(\)/g) || []).length >= 2, 'addCama/delCama no refrescan antes de mutar');
});

/* ═══════════ v331: la TFG primaria es CKD-EPI 2021 (race-free), Cockcroft solo para dosis ATB ═══════════ */
test('TFG: la función renal usa CKD-EPI 2021 (race-free) como clasificación primaria, no Cockcroft', () => {
  // Coeficientes Inker NEJM 2021 (race-free): 142 · κ 0.7/0.9 · α −0.241/−0.302 · ×1.012 mujer · 0.9938^edad.
  assert.ok(/142\*Math\.pow\(minR,alpha\)\*Math\.pow\(maxR,-1\.200\)\*Math\.pow\(0\.9938,edad\)\*mult/.test(_idx), 'calcTFG no usa la fórmula CKD-EPI 2021');
  assert.ok(/\[CKD-EPI 2021\]/.test(_idx), 'la TFG no se etiqueta como CKD-EPI 2021');
  assert.ok(/Cockcroft — solo dosis ATB/.test(_idx), 'el Cockcroft no se marca como solo-dosis-ATB');
});

/* ═══════════ P2 (auditoría v332): el motor de tratamiento lee el antibiograma estructurado ═══════════ */
const _mDP = _idx.match(/function detectPhenotypes\(abg,organismo\)\{[\s\S]*?\n\}/);
let _detPheno = null;
if (_mDP) _detPheno = new Function('const CLSI_CATEGORIES={PSEUDOMONAS:{}};' + _mDP[0] + '\n return detectPhenotypes;')();
test('MOTOR P2: detectPhenotypes deriva CRE/ESBL/MRSA/VRE del antibiograma (S/I/R)', () => {
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  assert.equal(_detPheno({ mer: 'R' }, 'Klebsiella pneumoniae').CRE, true, 'no detecta CRE por carbapenémico-R');
  assert.equal(_detPheno({ cro: 'R' }, 'E. coli').ESBL, true, 'no detecta ESBL');
  assert.equal(_detPheno({ cro: 'I' }, 'E. coli').ESBL, true, 'no usa no-susceptible (I) para ESBL');
  assert.equal(_detPheno({ cfp: 'R' }, 'E. coli').ESBL, false, 'cefepime-R NO debe marcar ESBL (v328)');
  assert.equal(_detPheno({ oxa: 'R' }, 'S. aureus').MRSA, true, 'no detecta MRSA');
  assert.equal(_detPheno({ van: 'R' }, 'E. faecium').VRE, true, 'no detecta VRE');
});
test('ABGMOTOR v334: AmpC por organismo (EUCAST 9.2/AmpC Primer) + BLEE exige inhibidor-S (EUCAST 9.1)', () => {
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  // AmpC cromosómica = organismo de alto riesgo (no por cefoxitina, que no está en el panel).
  assert.equal(_detPheno({ amp: 'R' }, 'Enterobacter cloacae').AmpC, true, 'no detecta AmpC en E. cloacae');
  assert.equal(_detPheno({ amp: 'R' }, 'Serratia marcescens').AmpC, true, 'no detecta AmpC en S. marcescens');
  assert.equal(_detPheno({ amp: 'R' }, 'Citrobacter koseri').AmpC, false, 'C. koseri NO es AmpC de alto riesgo');
  assert.equal(_detPheno({ amp: 'R' }, 'E. coli').AmpC, false, 'E. coli no tiene AmpC cromosómica inducible');
  // BLEE: con inhibidor probado, exige inhibidor-S (distingue de AmpC); sin inhibidor, cae al cribado 3GC.
  assert.equal(_detPheno({ cro: 'R', pitaz: 'S' }, 'E. coli').ESBL, true, 'no marca BLEE con 3GC-R + pip-tazo-S');
  assert.equal(_detPheno({ cro: 'R', amcl: 'R', pitaz: 'R' }, 'E. coli').ESBL, false, 'marca BLEE pese a inhibidor-R (sería AmpC/carbapenemasa)');
  assert.equal(_detPheno({ cro: 'R' }, 'E. coli').ESBL, true, 'sin inhibidor probado, no cae al cribado 3GC solo');
});
test('ABGMOTOR v335: MRSA por cefoxitina (fox) + clindamicina inducible (iMLSb)', () => {
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  assert.equal(_detPheno({ fox: 'R' }, 'Staphylococcus aureus').MRSA, true, 'no detecta MRSA por cefoxitina');
  assert.equal(_detPheno({ oxa: 'R' }, 'S. aureus').MRSA, true, 'no detecta MRSA por oxacilina');
  assert.equal(_detPheno({ eri: 'R', cli: 'S' }, 'S. aureus').iMLSb, true, 'no detecta clindamicina inducible (D-test)');
  assert.equal(_detPheno({ eri: 'R', cli: 'R' }, 'S. aureus').iMLSb, false, 'cMLSb (cli-R) no es inducible');
  assert.equal(_detPheno({ eri: 'S', cli: 'S' }, 'S. aureus').iMLSb, false, 'sin eritromicina-R no hay iMLSb');
});
test('ABGMOTOR v335: el panel ABG incluye cefoxitina (fox) y eritromicina (eri)', () => {
  assert.ok(/\{k:'fox',n:'Cefoxitina'\}/.test(_idx), 'falta cefoxitina en el panel ABG_ATBS');
  assert.ok(/\{k:'eri',n:'Eritromicina'\}/.test(_idx), 'falta eritromicina en el panel ABG_ATBS');
});
test('ABGMOTOR v336: cefoxitina discrimina BLEE (fox-S) de AmpC (fox-R), incl. AmpC plasmídica', () => {
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  const e = _detPheno({ cro: 'R', fox: 'S', pitaz: 'S' }, 'E. coli');
  assert.equal(e.ESBL, true, 'no detecta BLEE clásica (3GC-R + inhibidor-S + cefoxitina-S)');
  assert.equal(e.AmpC, false, 'marca AmpC en una BLEE cefoxitina-S');
  const a = _detPheno({ cro: 'R', fox: 'R' }, 'E. coli');
  assert.equal(a.AmpC, true, 'no detecta AmpC plasmídica (cefoxitina-R) en E. coli');
  assert.equal(a.ESBL, false, 'marca BLEE pese a cefoxitina-R (es AmpC, no BLEE)');
  assert.equal(_detPheno({ cro: 'R', fox: 'R' }, 'Klebsiella pneumoniae').AmpC, true, 'no detecta AmpC plasmídica en K. pneumoniae (fox-R)');
});
test('ABGMOTOR v337: carbapenem-R NO enzimático — pérdida de porina (Enterobacterales) y OprD (P. aeruginosa)', () => {
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  // Mammeri & Skurnik, PLoS Pathog 2025: pérdida de porina sola NO eleva carbapenémicos; con BLEE/AmpC sí.
  // El ertapenem es el carbapenémico más sensible a la impermeabilidad → ertapenem-R con imi/mer-S = porina.
  const p = _detPheno({ ert: 'R', imi: 'S', mer: 'S' }, 'Klebsiella pneumoniae');
  assert.equal(p.PorinLoss, true, 'no detecta pérdida de porina (ertapenem-R con imi/mer-S)');
  assert.equal(p.CRE, true, 'ertapenem-R debe seguir cumpliendo cribado CRE');
  assert.equal(_detPheno({ ert: 'R', imi: 'R', mer: 'S' }, 'E. coli').PorinLoss, false, 'imipenem-R no es pérdida de porina aislada (sugiere carbapenemasa)');
  assert.equal(_detPheno({ mer: 'R' }, 'Klebsiella pneumoniae').PorinLoss, false, 'meropenem-R sin ertapenem no es el patrón de porina aislada');
  // P. aeruginosa: pérdida de OprD → imipenem-R específico; meropenem-R sugiere eflujo (MexAB)/MBL.
  assert.equal(_detPheno({ imi: 'R', mer: 'S' }, 'Pseudomonas aeruginosa').OprD_PA, true, 'no detecta pérdida de OprD (imipenem-R, meropenem-S)');
  assert.equal(_detPheno({ imi: 'S', mer: 'R' }, 'Pseudomonas aeruginosa').OprD_PA, false, 'meropenem-R con imipenem-S no es OprD (sugiere eflujo)');
});
test('ABGMOTOR v337: elegirTX matiza la rama CRE como porina+BLEE/AmpC cuando el patrón es ertapenem-aislado', () => {
  assert.ok(/_ph\.CRE&&_ph\.PorinLoss&&!_ph\.Carbapenemase/.test(_idx), 'elegirTX no distingue el patrón de pérdida de porina dentro de la rama CRE');
  assert.ok(/pérdida de porina \+ BLEE\/AmpC/i.test(_idx), 'falta el diferencial de pérdida de porina en la rama CRE');
});

/* ═══════════ v338: capa de seguridad EUCAST — resistencia intrínseca + fenotipos excepcionales ═══════════ */
/* Funciones REALES importadas de js/core/abg-phenotype.js (EUCAST Expert Rules, CMI 2013;19:141-160). */
test('ABGSAFE v338: resistencia INTRÍNSECA marca la "S engañosa" (EUCAST Tablas 1-4)', () => {
  // Klebsiella es SIEMPRE ampicilina-R (T1) → una S a ampicilina es no fiable.
  assert.ok(intrinsicConflicts({ amp: 'S' }, 'Klebsiella pneumoniae').some(c => c.k === 'amp'), 'no marca amp-S engañosa en Klebsiella');
  // Proteus/Providencia/Morganella: colistina, tigeciclina y nitrofurantoína intrínsecamente R (trampa clásica).
  assert.ok(intrinsicConflicts({ col: 'S' }, 'Proteus mirabilis').some(c => c.k === 'col'), 'no marca colistina-S engañosa en Proteus');
  assert.ok(intrinsicConflicts({ tig: 'S' }, 'Morganella morganii').some(c => c.k === 'tig'), 'no marca tigeciclina-S engañosa en Morganella');
  // Stenotrophomonas maltophilia: carbapenémicos intrínsecamente R.
  assert.ok(intrinsicConflicts({ mer: 'S' }, 'Stenotrophomonas maltophilia').some(c => c.k === 'mer'), 'no marca meropenem-S engañoso en S. maltophilia');
  // Enterococo: TODAS las cefalosporinas intrínsecamente R.
  assert.ok(intrinsicConflicts({ cro: 'S' }, 'Enterococcus faecium').some(c => c.k === 'cro'), 'no marca ceftriaxona-S engañosa en enterococo');
  // Acinetobacter: NO marcar amp-sulbactam (el sulbactam SÍ es activo) — matiz crítico.
  assert.equal(intrinsicConflicts({ amsul: 'S' }, 'Acinetobacter baumannii').some(c => c.k === 'amsul'), false, 'no debe marcar amp-sulbactam-S en Acinetobacter (sulbactam activo)');
  // Solo marca la "S": un R intrínseco coincide con lo esperado y no se reporta como conflicto.
  assert.equal(intrinsicConflicts({ amp: 'R' }, 'Klebsiella pneumoniae').length, 0, 'no debe marcar conflicto cuando el AST ya reporta R');
  // E. coli no tiene R intrínseca de panel → sin conflictos.
  assert.equal(intrinsicConflicts({ amp: 'S', cro: 'S' }, 'Escherichia coli').length, 0, 'E. coli no debe generar conflictos intrínsecos');
});
test('ABGSAFE v338: fenotipos EXCEPCIONALES = probable error de ID/AST (EUCAST Tablas 5-7)', () => {
  // S. aureus vanco-R es rarísimo (T6 6.1).
  assert.ok(exceptionalPhenotypes({ van: 'R' }, 'Staphylococcus aureus').length >= 1, 'no alerta S. aureus vanco-R');
  // E. faecalis ampicilina-R → sospechar E. faecium (mala ID) (T6 6.7-6.8).
  assert.ok(exceptionalPhenotypes({ amp: 'R' }, 'Enterococcus faecalis').some(e => /faecium/i.test(e.msg)), 'no sugiere E. faecium ante E. faecalis amp-R');
  // P. aeruginosa colistina-R = excepcional/emergente (T5 5.3).
  assert.ok(exceptionalPhenotypes({ col: 'R' }, 'Pseudomonas aeruginosa').length >= 1, 'no alerta colistina-R en P. aeruginosa');
  // Enterobacterales (no Proteae) carbapenem-R → confirmar carbapenemasa (T5 5.1).
  assert.ok(exceptionalPhenotypes({ mer: 'R' }, 'Klebsiella pneumoniae').some(e => /carbapenemasa/i.test(e.msg)), 'no pide confirmar carbapenemasa en Klebsiella mer-R');
  // Proteae están EXCLUIDAS de 5.1 (su carbapenem-R no dispara la misma alerta).
  assert.equal(exceptionalPhenotypes({ mer: 'R' }, 'Proteus mirabilis').some(e => /5\.1/.test(e.cita)), false, 'no debe aplicar 5.1 a Proteae');
  // Sin patrón excepcional → sin alertas.
  assert.equal(exceptionalPhenotypes({ cro: 'S' }, 'Escherichia coli').length, 0, 'no debe alertar un antibiograma normal');
});
test('ABGSAFE v354: "pneumoniae" NO colisiona — Klebsiella pneumoniae ≠ Streptococcus pneumoniae', () => {
  // BUG hallado al generar ejemplos: las reglas de S. pneumoniae (Gram+) con /pneumoniae/ matcheaban
  // Klebsiella pneumoniae (Gram-negativa) → marcaba colistina/aztreonam como R intrínseca (¡la colistina
  // es última línea para CRE Klebsiella!) y disparaba el fenotipo excepcional de neumococo.
  const icK = intrinsicConflicts({ col: 'S', azt: 'S' }, 'Klebsiella pneumoniae');
  assert.ok(!icK.some(c => c.k === 'col' || c.k === 'azt'), 'Klebsiella pneumoniae NO debe marcar colistina/aztreonam como intrínseca (colisión con S. pneumoniae)');
  const exK = exceptionalPhenotypes({ imi: 'R' }, 'Klebsiella pneumoniae');
  assert.ok(!exK.some(e => /S\. pneumoniae/.test(e.msg)), 'Klebsiella pneumoniae NO debe disparar la alerta de S. pneumoniae');
  // Streptococcus pneumoniae REAL: sus reglas deben seguir intactas (sin regresión).
  assert.ok(intrinsicConflicts({ col: 'S', azt: 'S' }, 'Streptococcus pneumoniae').some(c => c.k === 'col'), 'S. pneumoniae real ya no marca colistina intrínseca (regresión)');
  assert.ok(exceptionalPhenotypes({ imi: 'R' }, 'Streptococcus pneumoniae').some(e => /S\. pneumoniae/.test(e.msg)), 'S. pneumoniae real ya no dispara el fenotipo excepcional (regresión)');
});
test('ABGSAFE v338: cada regla intrínseca lleva su cita EUCAST + integración en index/sw', () => {
  // Trazabilidad: toda regla codificada tiene tabla EUCAST.
  assert.ok(INTRINSIC_RULES.length >= 10 && INTRINSIC_RULES.every(r => r.t && r.re && Array.isArray(r.ks)), 'reglas intrínsecas mal formadas');
  assert.ok(intrinsicConflicts({ amp: 'S' }, 'Klebsiella pneumoniae')[0].cita.includes('EUCAST'), 'la cita no referencia EUCAST');
  // index.html importa el módulo y lo persiste; sw.js lo precachea.
  assert.ok(/import \{[^}]*intrinsicConflicts[^}]*exceptionalPhenotypes[^}]*\} from '\.\/js\/core\/abg-phenotype\.js'/.test(_idx), 'index.html no importa abg-phenotype.js');
  assert.ok(/safety=\{intrinsecos:_ic\|\|\[\],excepcionales:_ex\|\|\[\]/.test(_idx), 'no se computa/persiste la capa de seguridad al guardar');
  assert.ok(/_renderAbgInterpretacionHTML/.test(_idx), 'falta el render de la interpretación del motor');
});
test('ABGSAFE v339: cross-resistencia de fluoroquinolonas (EUCAST T13) — edición interpretativa', () => {
  // GN: cipro-R → reportar levo/moxi como R (regla 13.5). Solo edita lo reportado "S".
  const gn = quinoloneCrossResistance({ cip: 'R', lev: 'S', mox: 'S' }, 'Escherichia coli');
  assert.ok(gn.edits.some(e => e.k === 'lev') && gn.edits.some(e => e.k === 'mox'), 'GN cipro-R no propaga R a levo/moxi');
  assert.ok(gn.edits[0].cita.includes('13.5'), 'la cita no es 13.5');
  // GP (S. aureus): levo-R → todas las FQ R (regla 13.2).
  assert.ok(quinoloneCrossResistance({ lev: 'R', cip: 'S' }, 'Staphylococcus aureus').edits.some(e => e.k === 'cip'), 'staph levo-R no propaga R a cipro');
  // GP cipro-R con levo/moxi-S = mutación de primer paso → AVISO, no edición (13.1).
  const fp = quinoloneCrossResistance({ cip: 'R', lev: 'S' }, 'Staphylococcus aureus');
  assert.equal(fp.edits.length, 0, 'no debe editar a R en mutación de primer paso');
  assert.ok(fp.avisos.some(a => /primer paso/i.test(a.msg)), 'no avisa de mutación de primer paso');
  // Sin cipro-R no hay edición.
  assert.equal(quinoloneCrossResistance({ cip: 'S', lev: 'S' }, 'Klebsiella pneumoniae').edits.length, 0, 'no debe editar si cipro es S');
});
test('ABGSAFE v339: HLAR enterococo — aviso de pérdida de sinergia (EUCAST T12 12.6)', () => {
  assert.ok(aminoglycosideSynergy({ gen: 'R' }, 'Enterococcus faecalis').some(a => /sinergia/i.test(a.msg)), 'no avisa pérdida de sinergia en enterococo gen-R');
  assert.equal(aminoglycosideSynergy({ gen: 'S' }, 'Enterococcus faecalis').length, 0, 'no debe avisar con gentamicina S');
  assert.equal(aminoglycosideSynergy({ gen: 'R' }, 'Escherichia coli').length, 0, 'HLAR-synergy es solo de enterococo');
});
test('ABGSAFE v340: el panel muestra la recomendación DIRIGIDA (elegirTX/TX) derivada del mecanismo', () => {
  assert.ok(/const tx=elegirTX\(\{abg,organismo:org\|\|''\}\)/.test(_idx), 'el panel no deriva la recomendación de elegirTX');
  assert.ok(/💊 Recomendación dirigida/.test(_idx), 'falta el bloque de recomendación dirigida en el panel');
  assert.ok(/flags\.length&&typeof elegirTX==='function'/.test(_idx), 'la recomendación no está gated al mecanismo inferido (evita ruido en sensibles)');
  assert.ok(/!\/Empírico\/i\.test\(tx\.title\)/.test(_idx), 'no excluye el fallback empírico del panel dirigido');
});
test('ABGSAFE v352: aislamiento sensible muestra panel afirmativo (no vacío) con mensaje PROA', () => {
  // Antes, sin mecanismo el panel devolvía '' → el usuario veía la rejilla llena pero ninguna
  // interpretación ("nomas sale eso"). Ahora afirma "sin mecanismo" + espectro estrecho + desescala.
  assert.ok(/Sin mecanismo de resistencia detectado/.test(_idx), 'el panel no afirma el caso sensible (sin mecanismo)');
  assert.ok(/espectro más <b>estrecho<\/b> efectivo.*desescala|desescala.*estrecho/s.test(_idx), 'falta el mensaje PROA (espectro estrecho + desescalada) para el aislamiento sensible');
});
test('ABGSAFE v361: el panel de interpretación existe en los DOS formularios de antibiograma', () => {
  // BUG raíz: el panel solo estaba en abrirNuevoAntibiograma (#nabg-interpret). El formulario que usa el
  // médico, abrirFormPaciente ("Nuevo Paciente"), tiene su PROPIA sección de antibiograma (analizarAbgConIA,
  // #abg-ia-status) y NUNCA tuvo panel → "no me sale". Ahora ambos lo tienen y _refreshAbgInterpret sirve a
  // los dos contenedores.
  assert.ok(/id="abg-interpret"/.test(_idx), 'abrirFormPaciente ("Nuevo Paciente") no tiene el panel #abg-interpret');
  assert.ok(/id="nabg-interpret"/.test(_idx), 'abrirNuevoAntibiograma no tiene el panel #nabg-interpret');
  assert.ok(/getElementById\('nabg-interpret'\)\|\|document\.getElementById\('abg-interpret'\)/.test(_idx), '_refreshAbgInterpret no sirve a los dos contenedores');
  assert.ok(/document\.getElementById\('abg-interpret'\)\?\.scrollIntoView/.test(_idx), 'analizarAbgConIA no lleva la vista al panel del form "Nuevo Paciente"');
});
test('CAMAS v362: los controles de editar el mapa de camas (±cama) solo se renderizan para admin', () => {
  // BUG: el ✕ de cama libre (delCama) y la fila "Nueva cama +" (addCama) se MOSTRABAN a todos. Un no-admin
  // (p.ej. Interconsultante) los tocaba y recibía "Solo el administrador puede editar el mapa de camas" en
  // cascada. Los controles de servicio (renombrar/eliminar/+Servicio) ya usaban _isAdmin; a estos por-cama
  // se les escapó. Fix: gatearlos igual. El admin de cada hospital (status==='admin' → isHospAdmin) sí edita.
  assert.ok(/window\._isAdmin\?'<button class="ic-btn del"[^]*?delCama/.test(_idx), 'el ✕ de cama libre (delCama) no está gateado por _isAdmin');
  assert.ok(/if\(window\._isAdmin\)html\+='<div class="add-cama-row"/.test(_idx), 'la fila "Nueva cama +" (addCama) no está gateada por _isAdmin');
});
test('PWA v363: actualización silenciosa — sin recarga automática que reinicie la pantalla', () => {
  // Reportado varias veces: "me sale la ventana de actualizar SIEMPRE que entro y me reinicia la pantalla".
  // Causa: 3 conductas intrusivas (auto-aplicar+reload al abrir, banner en updatefound, controllerchange→reload).
  // Ahora el SW nuevo se activa EN SILENCIO (skipWaiting) y toma efecto en la próxima apertura, sin recargar.
  assert.ok(!/addEventListener\('controllerchange'/.test(_idx), 'sigue el listener controllerchange→reload (reiniciaba la pantalla)');
  assert.ok(!/_swAutoApply/.test(_idx), 'sigue el auto-aplicar+reload en cada apertura');
  assert.ok(/_activarSilencioso/.test(_idx), 'falta la activación silenciosa del SW nuevo (skipWaiting sin recarga)');
  assert.ok(/window\.forzarActualizacion\s*=/.test(_idx), 'se perdió la actualización manual por el badge de versión');
});
test('TX v364: alta de trasplante usa formulario simple (datos generales + enfermedad), no el form completo', () => {
  // El médico pidió una manera DISTINTA de agregar paciente en Trasplante: solo datos generales + la
  // enfermedad. Antes _txNuevoPaciente abría el formulario COMPLETO (abrirFormPaciente). Ahora abre un
  // modal reducido y reusa guardar() (mismo esquema, sin ATB).
  assert.ok(/abrirContenido\('➕ Nuevo paciente de trasplante'/.test(_idx), 'el alta de trasplante no abre el modal simple');
  assert.ok(/id="f-inmuno" value="trasplante"/.test(_idx), 'el alta simple no marca inmuno=trasplante (no aparecería en el módulo)');
  assert.ok(/window\._txNuevoPaciente=function[\s\S]*?buildCombobox\('f-dx'[\s\S]*?abrirContenido\('➕ Nuevo paciente de trasplante'/.test(_idx), 'el alta simple no incluye el diagnóstico (la enfermedad) dentro de _txNuevoPaciente');
  assert.ok(/id="f-atb" value=""/.test(_idx), 'falta el hidden f-atb (evita crash de syncAtbField sin sección ATB)');
  assert.ok(/window\._txGuardarSimple\s*=\s*async/.test(_idx), 'falta _txGuardarSimple');
  assert.ok(/_txGuardarSimple[\s\S]{0,400}await window\.guardar\(\)/.test(_idx), '_txGuardarSimple no reusa guardar() (esquema del censo)');
});
test('VER v365: el badge muestra la versión REAL del SW (leída de stewardmx-vXXX), no "v77" fijo', () => {
  // El badge decía "v77" a mano y _APP_VER "v309" — ninguno coincidía con la versión real (stewardmx-v364+),
  // causando confusión sobre qué versión corría. Ahora se lee de sw.js en runtime.
  assert.ok(!_idx.includes('>v77</span>'), 'el badge sigue con el número fijo viejo v77');
  assert.ok(_idx.includes('match(/stewardmx-v(\\d+)/)'), 'no parsea la versión real del SW desde sw.js');
  assert.ok(_idx.includes("getElementById('app-ver-badge')") && _idx.includes('b.textContent = v'), 'no actualiza el badge con la versión real');
});
test('INMUNO v366: valoración infectológica del inmunocomprometido (historia dirigida + modos + nota)', () => {
  // Nueva sub-pestaña "🧬 Historia clínica ID" en el módulo renombrado a Inmunocomprometido. Cubre SOT/TCMH/
  // VIH/no-VIH, modo Inicial (estudios a solicitar) y Seguimiento (resultados+nota), con recomendaciones
  // citadas. ADITIVO: el Pre-TX queda intacto.
  assert.ok(_idx.includes("{id:'tx-valoracion'"), 'falta la sub-pestaña tx-valoracion');
  assert.ok(_idx.includes('function _renderTxValoracion(p)') && _idx.includes("sub==='tx-valoracion'"), '_renderTxValoracion no está definida/dispatcheada');
  assert.ok(/window\._txValSetModo/.test(_idx) && _idx.includes("window._txValModo='inicial'"), 'falta el toggle de modo Inicial/Seguimiento');
  assert.ok(_idx.includes('hc_padecimiento') && _idx.includes("ta('hc_notas'") && _idx.includes('_txChipsGroupHTML'), 'faltan elementos de la historia clínica dirigida (padecimiento + notas + chips)');
  assert.ok(_idx.includes('function _txValEstudiosHTML') && _idx.includes('const _TX_EST_CATS=') && _idx.includes("igra:'IGRA / PPD'"), 'falta el panel de estudios a solicitar (por categorías)');
  assert.ok(/window\._txValRecs/.test(_idx) && _idx.includes('VIH — profilaxis por CD4') && _idx.includes('Tamizaje según el biológico'), 'faltan recomendaciones por huésped (VIH y no-VIH)');
  assert.ok(/window\._txValGenerarNota/.test(_idx) && _idx.includes("dot['txValoracion.'+el.id]="), 'no genera/persiste la nota de valoración (por dot-paths)');
  assert.ok(_idx.includes("label:'Inmunocomprometido'"), 'la pestaña no se renombró a Inmunocomprometido');
});
test('INMUNO v388 (P0-datos): _txSaveValoracion persiste por DOT-PATHS (no reemplaza el mapa txValoracion)', async () => {
  // Auditoría multi-experta: el guardado hacía read-modify-write sobre _txCurrentPac rancio y escribía
  // {txValoracion:data} → reemplazaba el mapa COMPLETO → última-escritura-gana borraba campos que otro
  // dispositivo había tocado. El fix escribe por dot-paths (`txValoracion.<campo>`) para que Firestore fusione.
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const fakeEls = [ { id:'hc_motivo', type:'text', value:'fiebre' }, { id:'hc_cb_comorb_dm2', type:'checkbox', checked:true } ];
  let captured=null;
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map,
    window:{}, navigator:{}, location:{}, Blob:STUB, URL:STUB,
    document:{ querySelectorAll:(sel)=> (sel&&String(sel).includes('hc_'))?fakeEls:[], getElementById:()=>null, querySelector:()=>null, createElement:()=>STUB, addEventListener(){} },
    PACS:[{id:'p1'}], db:{}, doc:(...a)=>({__ref:a}), _pacPath:()=>['hospitals','H','months','2026-07','patients'],
    updateDoc:(ref,payload)=>{ captured=payload; return Promise.resolve(); },
    setTimeout:(fn)=>{ fn(); return 1; }, clearTimeout:()=>{} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  ctx.window._txCurrentPac = { id:'p1', txValoracion:{ hc_previo_otro_dispositivo:'valor-de-otro' } };
  ctx.window._txSaveValoracion();
  assert.ok(captured, 'no se ejecutó el guardado (updateDoc no fue llamado)');
  assert.equal(captured['txValoracion.hc_motivo'], 'fiebre', 'no persiste hc_motivo por dot-path');
  assert.equal(captured['txValoracion.hc_cb_comorb_dm2'], '1', 'no persiste el checkbox por dot-path');
  assert.ok(captured['txValoracionAt'], 'falta el sello de tiempo');
  assert.ok(!('txValoracion' in captured), 'REGRESIÓN P0-datos: escribe el mapa txValoracion completo (última-escritura-gana)');
  assert.ok(!('txValoracion.hc_previo_otro_dispositivo' in captured), 'no debe reescribir campos que este cliente no tocó (los conserva el servidor)');
});
test('MICRO v388 (P0-datos): guardarReporteMicro relee muestras[] frescas (getDoc) antes de setDoc(merge)', () => {
  // setDoc(...,{merge:true}) NO fusiona arrays: reemplaza muestras[] entero. El fix relee el doc fresco
  // antes de mutar para no pisar cultivos agregados por otro microbiólogo/dispositivo.
  const s = _idx.indexOf('window.guardarReporteMicro=async function');
  const e = _idx.indexOf('{muestras:nuevasMuestras', s);
  assert.ok(s>=0 && e>s, 'no se ubicó guardarReporteMicro / su setDoc de muestras');
  const body = _idx.slice(s, e);
  assert.ok(body.includes('getDoc(doc(db'), 'no relee el paciente con getDoc antes de reescribir muestras[]');
  assert.ok(body.includes('_snapP.data().muestras'), 'no toma las muestras frescas del servidor como base');
});
test('CENSO/TRASPLANTE v389 (pérdida de datos): quick-ATB, suspender e historial releen fresco antes de reescribir el array', () => {
  // Mismo patrón que v388: read-modify-write de un array desde memoria rancia pierde ediciones concurrentes.
  const bodyOf=(a,b)=>{ const s=_idx.indexOf(a); const e=_idx.indexOf(b,s); return (s>=0&&e>s)?_idx.slice(s,e):''; };
  const quick=bodyOf('window._guardarQuickATB=async','await updateDoc(doc(db,..._pacPath(),pid),updates)');
  assert.ok(quick.includes('getDoc(doc(db,..._pacPath(),pid))') && quick.includes('_freshAtb'), 'quick-ATB no relee atbList fresca antes de anexar');
  const susp=bodyOf('window._suspenderATB=async','await updateDoc(doc(db,..._pacPath(),pid),{atbList:lista');
  assert.ok(susp.includes('getDoc(doc(db,..._pacPath(),pid))') && susp.includes('findIndex'), 'suspender no relee fresco / no localiza el ATB por identidad');
  const hist=bodyOf('window._txValGuardarHist=function','txValoracionHistAt:new Date().toISOString()');
  assert.ok(hist.includes('getDoc(_ref)') && hist.includes('snap.data().txValoracionHist'), 'el historial de trasplante no relee fresco antes de anexar');
});
test('FARMACIA v390 (P1 seguridad): la alerta de ATB bloqueado revisa CADA ATB por nombre (no el string concatenado)', () => {
  // Antes comparaba p.atb (todos los ATBs concatenados "A + B") o atbListData[0].n (clave inexistente) contra
  // un bloqueo individual → con ≥2 ATBs la alerta NUNCA disparaba. Ahora itera los nombres de atbListData.
  const s=_idx.indexOf('// ── Alerta de bloqueo farmacia ──');
  assert.ok(s>=0, 'no se ubicó el bloque de alerta de bloqueo');
  const body=_idx.slice(s, s+1400);
  assert.ok(body.includes('const _atbNames=') && body.includes('atbListData.map('), 'la alerta no itera los nombres de atbListData');
  assert.ok(body.includes('_atbNames.some(n=>n.toLowerCase()===b.atb.toLowerCase())'), 'la alerta no compara cada nombre contra el bloqueo');
  assert.ok(!/_atbNombre=\(atb\|\|atbListData\[0\]\?\.n/.test(body), 'sigue usando el string concatenado / la clave .n inexistente');
});
test('SEGURIDAD v392 (P0): la API key sk-ant ya NO se persiste a Firestore (solo memoria de sesión) + purga', () => {
  // La fuga: guardarApiKeyHosp/Global escribían anthropicKey en config/global y hospitals/*/config/main
  // (legible por admin). El proxy la hace innecesaria. Ahora solo se carga en memoria de sesión.
  const s=_idx.indexOf('window.guardarApiKeyHosp=');
  const e=_idx.indexOf('window._purgarAnthropicKeys=');
  assert.ok(s>=0 && e>s, 'no se ubicaron las funciones de API key');
  const body=_idx.slice(s,e);
  assert.ok(!/anthropicKey:k\b/.test(body), 'REGRESIÓN: sigue escribiendo la key (anthropicKey:k) a Firestore');
  assert.ok(!/setDoc\(doc\(db,'config','global'\)/.test(body), 'REGRESIÓN: sigue haciendo setDoc de la key a config/global');
  assert.ok(body.includes('window._abgApiKey=k'), 'debe cargar la key solo en memoria de sesión');
  assert.ok(_idx.includes('window._purgarAnthropicKeys=') && _idx.includes('anthropicKey:deleteField()'), 'falta la purga one-shot de claves ya persistidas');
});
test('SW v393 (P0 version-skew): js/core/*.js se sirve NETWORK-FIRST (no stale-while-revalidate)', () => {
  const _sw = readFileSync(join(__d, '..', 'sw.js'), 'utf8');
  // index.html es network-first; si los módulos ESM fueran stale-while-revalidate, un index NUEVO
  // cargaría el módulo VIEJO del CACHE anterior. Debe existir una rama network-first para /js/core/.
  const i = _sw.indexOf("url.includes('/js/core/')");
  assert.ok(i >= 0, 'el SW no trata js/core como caso especial (network-first)');
  const seg = _sw.slice(i, i + 400);
  assert.ok(seg.includes("cache: 'no-store'") && seg.includes('caches.match(e.request)'), 'js/core no es network-first con fallback a caché');
});
test('WORKLIST v394 (P0 clínico): resolveKey NO colapsa combos β-lactámico/inhibidor a su base', () => {
  // Extrae el bloque REAL (mapa de combos + guardia + resolveKey) de proaWorklist y lo ejecuta.
  const s0 = _idx.indexOf('const _sc=s=>norm(s)');
  const end = 'return best?best.k:null; };';
  const s2 = _idx.indexOf(end, s0);
  assert.ok(s0 >= 0 && s2 > s0, 'no se ubicó el bloque de resolveKey');
  const block = _idx.slice(s0, s2 + end.length);
  const norm = s=>(s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const lookup = [{k:'ctaz',n:'Ceftazidima'},{k:'cazavi',n:'Cef-Avibactam'},{k:'mer',n:'Meropenem'},{k:'pitaz',n:'Pip-Tazobactam'},{k:'amp',n:'Ampicilina'},{k:'amsul',n:'Amp-Sulbactam'}];
  const resolveKey = new Function('norm','lookup', block + '\n;return resolveKey;')(norm, lookup);
  assert.equal(resolveKey('Ceftazidima/avibactam'), 'cazavi', 'CAZ-AVI debe resolver a su propia clave, no a ctaz (ceftazidima sola)');
  assert.equal(resolveKey('Ceftazidima'), 'ctaz', 'ceftazidima sola sigue en ctaz');
  assert.equal(resolveKey('Meropenem/vaborbactam'), null, 'mero-vaborbactam no tiene clave dedicada → null (NO colapsar a mer)');
  assert.equal(resolveKey('Piperacilina/tazobactam'), 'pitaz', 'pip-tazo a su clave, no a amp/ampicilina');
  assert.equal(resolveKey('Ampicilina/sulbactam'), 'amsul', 'amp-sulbactam a su clave, no a amp');
  assert.equal(resolveKey('Meropenem'), 'mer', 'meropenem solo sigue resolviendo a mer');
});
test('MICRO v396 (P1 datos): el updatedAt del reporte de cultivo se escribe en ISO (parseable), no localizado', () => {
  // Una cadena "3/7/2026, 14:30" no es comparable cronológicamente (rompe anti-pisado/CRDT y el formateo).
  const s = _idx.indexOf('const upd={cultResultado:res,updatedAt:');
  assert.ok(s >= 0, 'no se ubicó el upd del reporte de micro');
  const line = _idx.slice(s, s + 120);
  assert.ok(line.includes('new Date().toISOString()'), 'updatedAt debe ser ISO');
  assert.ok(!line.includes("toLocaleString"), 'updatedAt NO debe ser una cadena localizada');
});
test('FARMACIA v397 (P1 datos): bloqueos con ID determinista por ATB + liberar desactiva duplicados', () => {
  // Antes: addDoc (id aleatorio) + dedup solo en memoria → una carrera creaba 2 docs y 'liberar' (por id)
  // dejaba el otro activo (bloqueo fantasma). Ahora id determinista por ATB + liberar barre duplicados.
  const g = _idx.indexOf('window.guardarBloqueoATB=async');
  const ge = _idx.indexOf('window.liberarBloqueoATB=', g);
  assert.ok(g >= 0 && ge > g, 'no se ubicó guardarBloqueoATB');
  const gbody = _idx.slice(g, ge);
  assert.ok(gbody.includes("const _blkId='blk_'+atb.toLowerCase()") && gbody.includes("setDoc(doc(db,'hospitals',HOSP,'atb_blocks',_blkId)"), 'la creación no usa ID determinista por ATB');
  const l = _idx.indexOf('window.liberarBloqueoATB=');
  const le = _idx.indexOf('window.borrarBloqueoATB=', l);
  const lbody = _idx.slice(l, le);
  assert.ok(lbody.includes('const _dups=(BLOQUEOS||[]).filter(') && lbody.includes("(b.atb||'').toLowerCase().trim()===(atb||'').toLowerCase().trim()"), 'liberar no desactiva los duplicados del mismo ATB');
});
test('ABGSAFE v399 (P1 seguridad): el 2º analizador IA avisa las lecturas de baja confianza (needs_review)', () => {
  // Antes descartaba needs_review/conf → lecturas S↔R dudosas se rellenaban en silencio. Ahora las señala.
  const s = _idx.indexOf('window._abgMICs={};');
  const e = _idx.indexOf('if(window._refreshAbgInterpret)', s);
  assert.ok(s >= 0 && e > s, 'no se ubicó el 2º analizador de antibiograma');
  const body = _idx.slice(s, e);
  assert.ok(body.includes("if(r.needs_review||r.conf==='baja')revisar.push(r.antibiotico)"), 'el 2º analizador no recolecta las lecturas de baja confianza');
  assert.ok(body.includes('de baja confianza — VERIFICA'), 'el 2º analizador no muestra el aviso de verificación al clínico');
});
test('ABGSAFE v400 (P1/P2 datos): abrirNuevoAntibiograma resetea _nabgMICs (no arrastra CMI del paciente anterior)', () => {
  const s = _idx.indexOf('window.abrirNuevoAntibiograma=(pid)=>{');
  assert.ok(s >= 0, 'no se ubicó abrirNuevoAntibiograma');
  const body = _idx.slice(s, s + 700);
  assert.ok(body.includes('window._nabgMICs={}'), 'no resetea _nabgMICs al abrir el modal (contaminación entre pacientes)');
});
test('FARMACIA v401 (P2 datos): guardarFCReco escribe la reco y el flag del padre ATÓMICAMENTE (writeBatch)', () => {
  // Antes: addDoc + updateDoc sueltos → si el 2º fallaba, la reco quedaba GUARDADA pero sin badge (invisible).
  assert.ok(_idx.includes(',writeBatch}from'), 'writeBatch no está importado');
  const s = _idx.indexOf('window.guardarFCReco=async');
  const e = _idx.indexOf('cerrarModal();', s);
  assert.ok(s >= 0 && e > s, 'no se ubicó guardarFCReco');
  const body = _idx.slice(s, e);
  assert.ok(body.includes('writeBatch(db)') && body.includes('_fcBatch.set(') && body.includes('_fcBatch.update(') && body.includes('_fcBatch.commit()'), 'guardarFCReco no usa un batch atómico');
  assert.ok(!/await addDoc\(recoRef/.test(body), 'sigue usando addDoc suelto (no atómico)');
});
test('FARMACIA v402 (P0-datos #6 cliente): _precheckTransicion revalida el estado fresco antes de transicionar', async () => {
  const s0 = _idx.indexOf('window._precheckTransicion=async');
  const e0 = _idx.indexOf('window.confirmarRevision=async');
  assert.ok(s0 >= 0 && e0 > s0, 'no se ubicó _precheckTransicion');
  const block = _idx.slice(s0, e0);
  let curStatus='pendiente', shouldThrow=false;
  const getDoc = async()=>{ if(shouldThrow) throw new Error('red'); return { exists:()=>curStatus!=null, data:()=>({status:curStatus}) }; };
  const win = {};
  const fn = new Function('getDoc','doc','db','HOSP','toast','window', block + '\n;return window._precheckTransicion;')(getDoc, ()=>({}), {}, 'H', ()=>{}, win);
  curStatus='dispensado';
  assert.equal(await fn('r','dispensado',['dispensado'],'x'), false, 'debe bloquear el doble-submit al mismo estado destino');
  curStatus='denegado';
  assert.equal(await fn('r','aprobado',['denegado','dispensado'],'aprobar'), false, 'debe bloquear transición desde un estado terminal');
  curStatus='en_revision';
  assert.equal(await fn('r','aprobado',['denegado','dispensado'],'aprobar'), true, 'debe permitir una transición legítima hacia adelante');
  shouldThrow=true;
  assert.equal(await fn('r','aprobado',['denegado'],'x'), true, 'ante error de red debe degradar a permitir (el servidor protege)');
  // wiring
  assert.ok(_idx.includes('const _okRev=await window._precheckTransicion(id,nuevoStatus,'), 'confirmarRevision no usa la guarda');
  assert.ok(_idx.includes("const _okDisp=await window._precheckTransicion(id,'dispensado'"), 'confirmarDispensacion no usa la guarda');
});
test('MW v403 (P3 bioest.): Mann-Whitney corrige la varianza por empates', () => {
  const s = _idx.indexOf('function stat_mannwhitney(group1,group2){');
  const e = _idx.indexOf('\nfunction stat_nnt(', s);
  assert.ok(s>=0 && e>s, 'no se ubicó stat_mannwhitney');
  const fn = new Function(_idx.slice(s,e) + '\n;return stat_mannwhitney;')();
  const r0 = fn([1,2,3,4],[5,6,7,8]);            // sin empates → varianza clásica
  assert.equal(r0.z, -2.31, 'sin empates debe coincidir con la varianza clásica (z≈-2.31)');
  assert.equal(r0.p_approx, '<0.05', 'sin empates, grupos separados → p<0.05');
  const r1 = fn([1,1,2],[2,3,3]);                // con empates → varianza corregida (|z| mayor: -1.75→-1.83)
  assert.equal(r1.z, -1.83, 'con empates la varianza corregida da |z| mayor (z≈-1.83, no el clásico -1.75)');
});
test('RENAL v403 (P3): ruleRenal muestra la TFG con 1 decimal, no redondeada a la frontera 30', async () => {
  const A = await import('../js/core/alerts.js');
  const out = A.ruleRenal({atbList:[{nombre:'Vancomicina'}]}, 29.6);
  assert.ok(out.length===1 && /TFG estimada 29\.6 /.test(out[0].detalle), 'debe mostrar 29.6, no 30');
});
test('CF v404 (P2 datos): limpiarPacientes borra las subcolecciones con nombres REALES (recomendaciones/micro_reports)', () => {
  const _fn = readFileSync(join(__d, '..', 'functions', 'index.js'), 'utf8');
  const s = _fn.indexOf("'visits', 'antibiograms'");
  assert.ok(s >= 0, 'no se ubicó la lista de subcolecciones de limpiarPacientes');
  const line = _fn.slice(s, s + 180);
  assert.ok(line.includes("'recomendaciones'") && line.includes("'micro_reports'"), 'faltan recomendaciones/micro_reports en la limpieza');
  assert.ok(!/'recos'/.test(line), "sigue usando el nombre equivocado 'recos'");
});
test('DATOS v405 (AWaRe OMS 2023): catálogo con clasificación WHO correcta + DDD meropenem 3g', () => {
  // Verificado contra OMS AWaRe 2023 + WHO ATC/DDD index (meropenem J01DH02 = 3 g).
  assert.ok(_idx.includes("n:'Aztreonam',aw:'Reserve',pol:'restringido'"), 'Aztreonam debe ser Reserve (OMS 2023)');
  assert.ok(_idx.includes("n:'Cefuroxima',aw:'Watch',pol:'vigilado'"), 'Cefuroxima debe ser Watch (OMS 2023)');
  assert.ok(_idx.includes("n:'Azitromicina',aw:'Watch',pol:'vigilado'"), 'Azitromicina debe ser Watch (OMS 2023)');
  assert.ok(_idx.includes("n:'Claritromicina',aw:'Watch',pol:'vigilado'") && _idx.includes("n:'Eritromicina',aw:'Watch',pol:'vigilado'"), 'Claritro/Eritro deben ser Watch');
  assert.ok(!_idx.includes("n:'Azitromicina',aw:'Access'") && !_idx.includes("n:'Cefuroxima',aw:'Access'"), 'macrólidos/cefuroxima ya no deben ser Access');
  // meropenem DDD = 3 g (OMS ATC/DDD J01DH02); la tabla espejo ya no debe decir 2.000
  assert.ok(!/'J01DH02','Meropenem','[^']*','Reserve',2\.000/.test(_idx), 'la DDD de meropenem no debe ser 2.000 (OMS = 3 g)');
  assert.ok(/'J01DH02','Meropenem','[^']*','Reserve',3\.000/.test(_idx), 'la DDD de meropenem debe ser 3.000');
});
test('DATOS v406 (AWaRe = solo antibacterianos): antifúngicos/anti-TB fuera de AWaRe + gate por política local', () => {
  // AWaRe (OMS) es SOLO antibacterianos: antifúngicos, anti-TB y antiparasitario → aw:'NoAplica' (no cuentan
  // en Access/Watch/Reserve → dejan de inflar el %Reserve de los reportes).
  assert.ok(_idx.includes("n:'Voriconazol',aw:'NoAplica'") && _idx.includes("n:'Caspofungina',aw:'NoAplica'") && _idx.includes("n:'Bedaquilina',aw:'NoAplica'") && _idx.includes("n:'Ivermectina',aw:'NoAplica'"), 'no-antibacterianos deben quedar fuera de AWaRe (NoAplica)');
  assert.ok(_idx.includes("n:'Rifampicina',aw:'Watch'") && _idx.includes("n:'Fosfomicina',aw:'Access'"), 'antibacterianos del grupo Otros NO deben cambiar');
  // el gate de justificación se dispara por la política local, preservando la restricción de antifúngicos
  assert.ok(_idx.includes("if(atbDef&&(atbDef.pol==='restringido'||atbDef.aw==='Reserve')){"), 'el gate debe dispararse por pol==="restringido"');
  // la derivación de aware ya no fabrica 'Watch'
  assert.ok(_idx.includes("aware:(ATBX.find(a=>a.n===nom)||{}).aw||''"), "la derivación de aware ya no debe caer a 'Watch' falso");
});
test('INMUNO v367: auto-bridge alta→valoración + recomendaciones profundizadas (fase/CD4/asplenia/biológicos)', () => {
  // Auto-bridge: al guardar el alta rápida, abre directo la 🧬 Historia clínica ID del paciente nuevo.
  assert.ok(/_txGuardarSimple[\s\S]{0,1500}window\._txSubTab='tx-valoracion'/.test(_idx), 'el alta rápida no lleva a la valoración (auto-bridge)');
  // Profundización por fase/paciente (v373: redactadas profesionales, sin emojis ni citas):
  assert.ok(_idx.includes('Fase post-trasplante (aproximadamente'), 'falta la fase post-trasplante en las recomendaciones');
  assert.ok(_idx.includes('VIH — profilaxis por CD4') && _idx.includes('M. avium <50'), 'falta el escalón VIH por CD4 (Pneumocystis<200/Toxo<100/MAC<50)');
  assert.ok(_idx.includes("/Asplenia/.test(h)") && _idx.includes('encapsuladas'), 'falta la recomendación de asplenia (encapsulados)');
  assert.ok(_idx.includes('Tamizaje según el biológico') && _idx.includes('Anti-CD20'), 'falta el tamizaje dirigido de biológicos');
});
test('INMUNO v373: recomendaciones por fase/paciente — SIN emojis ni bibliografía, profesionales', () => {
  // Feedback del Dr.: el plan debe ser por fase y por paciente, profesional, sin emojis ni citas.
  // Extraemos el cuerpo de _txValRecs y verificamos que no haya citas ni emojis en sus textos.
  const s = _idx.indexOf('window._txValRecs=function(){');
  const e = _idx.indexOf('// ── Fase 3: redacción por IA', s);  // acota a _txValRecs (excluye el motor IA, cuyo spinner sí usa emojis)
  assert.ok(s >= 0 && e > s, 'no se ubicó _txValRecs');
  const body = _idx.slice(s, e);
  assert.ok(!/\[(AST|DHHS|TTS|Fishman|OMS|IDSA|ECIL|AGA|CDC|Kotton)/.test(body), 'las recomendaciones aún tienen bibliografía entre corchetes');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✅ℹ\u{1F9ED}]/u.test(body), 'las recomendaciones aún contienen emojis');
  assert.ok(body.includes('activeIS') && body.includes('preProto') && body.includes('Define el estado de inmunosupresión'), 'el plan no está gateado por el estado real de inmunosupresión (coherencia)');
});
test('INMUNO v374: historia por chips (sí/no) + un solo texto libre + resultados Pos/Neg, compuestos al Word', async () => {
  // El Dr. pidió marcar antecedentes (DM2/HAS/tabaquismo) con chips, un solo campo de texto, y resultados Pos/Neg.
  assert.ok(_idx.includes('const _TX_CHIPS=') && _idx.includes("dm2:'DM2'") && _idx.includes("tabaco:'Tabaquismo'"), 'falta el catálogo de chips');
  assert.ok(_idx.includes('function _txChipsGroupHTML') && _idx.includes('function _txResHTML'), 'faltan los helpers de chips/resultados');
  assert.ok(/window\._txValCompose=function/.test(_idx) && _idx.includes("ta('hc_notas'"), 'falta _txValCompose o el campo único de notas');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  const got = vm.runInContext(block + '\n;({render:_renderTxValoracion, chips:_txChipsGroupHTML, res:_txResHTML})', ctx);
  const chipHtml = got.chips('comorb', { 'hc_cb_comorb_dm2':'1' });
  assert.ok(chipHtml.includes('DM2') && chipHtml.includes('id="hc_cb_comorb_dm2"') && chipHtml.includes('checked'), 'el chip DM2 no se marca');
  // Los resultados a capturar son EXACTAMENTE los estudios solicitados (hc_est_*), con su valor (hc_res_*).
  const resHtml = got.res({ 'hc_est_cmvpcr':'1', 'hc_res_cmvpcr':'Positivo' });
  assert.ok(resHtml.includes('CMV PCR') && resHtml.includes('Positivo'), 'los resultados Pos/Neg no rinden a partir de los estudios pedidos');
  assert.ok(got.res({}).includes('HBsAg') && got.res({}).includes('Anti-VHC'), 'las serologías basales no están siempre presentes en seguimiento');
  const r = got.render({ id:'p', txValoracion:{ hc_motivo:'fiebre', hc_huesped:'SOT — Renal' } });
  assert.ok(r.includes('Comorbilidades') && r.includes('id="hc_notas"'), 'la historia no muestra chips + el campo de notas');
});
test('INMUNO v375: los chips no marcados quedan documentados como NEGATIVOS (solo grupos mostrados)', async () => {
  // El Dr. pidió que lo no marcado quede plasmado como negativo. Pero solo de los grupos que SÍ se mostraron
  // (no afirmar negativos de algo no evaluado).
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const checked = new Set(['hc_cb_comorb_dm2']);
  const docMock = { getElementById:id=>{ if(id.startsWith('hc_cb_comorb_')) return { checked:checked.has(id) }; if(id.startsWith('hc_cb_')) return null; return null; } };
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:docMock, Blob:STUB, URL:STUB, navigator:{}, location:{}, escHtml:x=>x };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  const out = ctx.window._txValCompose();
  const comorb = out.find(r=>r[0]==='Comorbilidades');
  // Conciso: algo marcado → positivos + "(resto negado)" (no enumera la lista completa, que confunde).
  assert.ok(comorb && comorb[1] === 'Presentes: DM2 (resto negado)', 'no documenta conciso el chip marcado + resto negado: '+(comorb&&comorb[1]));
  assert.ok(!out.some(r=>r[0]==='Dispositivos'), 'documenta un grupo que no se mostró (no evaluado)');
  // Nada marcado → negativo breve (noneL), no la lista completa.
  ctx.document = { getElementById:id=>{ if(id.startsWith('hc_cb_comorb_')) return { checked:false }; return null; } };
  const out0 = ctx.window._txValCompose();
  const comorb0 = out0.find(r=>r[0]==='Comorbilidades');
  assert.ok(comorb0 && comorb0[1] === 'Sin comorbilidades referidas', 'nada marcado no se documenta breve: '+(comorb0&&comorb0[1]));
});
test('INMUNO v376: panel de estudios a solicitar AMPLIO y por categorías (gateado por huésped)', async () => {
  assert.ok(_idx.includes('const _TX_EST_CATS=') && _idx.includes("cat:'Cargas virales / molecular'") && _idx.includes("cat:'Micología (vigilancia)'") && _idx.includes("cat:'Imagen'"), 'falta el panel de estudios por categorías');
  assert.ok(_idx.includes('const _TX_EST_QUANT=') && _idx.includes("adenopcr:'Adenovirus PCR'"), 'falta el set de estudios cuantitativos o las cargas virales ampliadas');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{}, escHtml:x=>x };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  const got = vm.runInContext(block + '\n;({est:_txValEstudiosHTML})', ctx);
  const sot = got.est({ hc_huesped:'SOT — Renal' });
  assert.ok(sot.includes('Serologías del trasplante') && sot.includes('CMV PCR') && sot.includes('TC de tórax'), 'SOT no muestra serologías de trasplante / cargas virales / imagen');
  const vih = got.est({ hc_huesped:'VIH' });
  assert.ok(!vih.includes('Serologías del trasplante') && vih.includes('Antígeno criptocócico'), 'VIH no debería mostrar serologías de trasplante, pero sí CrAg');
});
test('INMUNO v377: COHERENCIA — recomendaciones por estado de IS + dirigidas por resultados + resultados dinámicos', async () => {
  // Feedback del Dr.: no dar "PJP indicada" si no está inmunosuprimido / pre-protocolo / sin resultados.
  // Las recs se gatean por hc_is_estado y por los resultados capturados; los resultados son los estudios pedidos.
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{}, escHtml:x=>x };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  const recsDoc = (vals,chk) => { const cache={}; return { getElementById:id=>{ if(cache[id]) return cache[id]; const el=(id==='hc-recs')?{innerHTML:''}:{value:(vals[id]!=null?vals[id]:''),checked:chk.has(id)}; cache[id]=el; return el; } }; };
  const runRecs = (vals,chk) => { ctx.document=recsDoc(vals,chk||new Set()); ctx.window._txValRecs(); return ctx.document.getElementById('hc-recs').innerHTML; };
  const pre = runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'Va a iniciar (pre-protocolo)' });
  assert.ok(pre.includes('Pre-protocolo') && !pre.includes('Pneumocystis indicada'), 'pre-protocolo no debe recomendar PJP activa');
  const enc = runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'En curso' });
  assert.ok(enc.includes('Profilaxis para Pneumocystis indicada'), 'inmunosupresión en curso sí debe recomendar PJP');
  const unk = runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'' });
  assert.ok(unk.includes('Define el estado') && !unk.includes('Pneumocystis indicada'), 'estado de IS no definido no debe recomendar PJP');
  const resR = runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'En curso', hc_res_cmvpcr:'Positivo' });
  assert.ok(resR.includes('Citomegalovirus detectable'), 'un resultado positivo no genera la rec dirigida');
  const txResHTML = vm.runInContext('_txResHTML', ctx);
  assert.ok(txResHTML({ 'hc_est_cmvpcr':'1','hc_est_hemo':'1' }).includes('CMV PCR') && txResHTML({}).includes('HBsAg'), 'los resultados no incluyen lo solicitado + las serologías basales siempre');
});
test('INMUNO v378: hepatitis B por prueba separada + recomendaciones por patrón serológico (mejor evidencia)', async () => {
  // El Dr. pidió cada prueba de HBV por separado y, en seguimiento, recs por el PATRÓN (reactivación bajo IS).
  assert.ok(_idx.includes("hbsag:'HBsAg'") && _idx.includes("antihbc:'Anti-HBc total'") && _idx.includes("antihbs:'Anti-HBs'") && _idx.includes("hbvdna:'HBV DNA'"), 'el perfil de hepatitis B no está separado por prueba');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{}, escHtml:x=>x };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  const recsDoc = (vals) => { const cache={}; return { getElementById:id=>{ if(cache[id]) return cache[id]; const el=(id==='hc-recs')?{innerHTML:''}:{value:(vals[id]!=null?vals[id]:''),checked:false}; cache[id]=el; return el; } }; };
  const runRecs = (vals) => { ctx.document=recsDoc(vals); ctx.window._txValRecs(); return ctx.document.getElementById('hc-recs').innerHTML; };
  const H = { hc_huesped:'SOT — Renal', hc_is_estado:'En curso' };
  assert.ok(runRecs({ ...H, hc_res_hbsag:'Positivo' }).includes('Hepatitis B activa'), 'HBsAg+ no da hepatitis B activa');
  const oculta = runRecs({ ...H, hc_res_hbsag:'Negativo', hc_res_antihbc:'Positivo' });
  assert.ok(oculta.includes('resuelta u oculta') && oculta.includes('rituximab'), 'anti-HBc+ no advierte reactivación/profilaxis');
  assert.ok(runRecs({ ...H, hc_res_hbsag:'Negativo', hc_res_antihbc:'Negativo', hc_res_antihbs:'Negativo' }).includes('susceptible'), 'los tres negativos no marcan susceptible (vacunar)');
  assert.ok(!runRecs(H).includes('Hepatitis B'), 'sin resultados no debe emitir interpretación de hepatitis B');
});
test('INMUNO v379: CADA serología capturada emite su recomendación (CMV/EBV/HSV/VZV/Toxo/VHC/VDRL)', async () => {
  // El Dr. marcó múltiples serologías positivas y faltaban recomendaciones. Ahora cada resultado emite la suya.
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{}, escHtml:x=>x };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  const recsDoc = (vals) => { const cache={}; return { getElementById:id=>{ if(cache[id]) return cache[id]; const el=(id==='hc-recs')?{innerHTML:''}:{value:(vals[id]!=null?vals[id]:''),checked:false}; cache[id]=el; return el; } }; };
  const runRecs = (vals) => { ctx.document=recsDoc(vals); ctx.window._txValRecs(); return ctx.document.getElementById('hc-recs').innerHTML; };
  const o = runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'En curso', hc_res_cmv:'Positivo', hc_res_ebv:'Positivo', hc_res_hsv:'Positivo', hc_res_vzv:'Positivo', hc_res_toxo:'Positivo', hc_res_hcv:'Positivo', hc_res_sifilis:'Positivo' });
  ['CMV IgG positivo','EBV IgG positivo','HSV seropositivo','VZV seropositivo','Toxoplasma seropositivo','Anti-VHC positivo','VDRL/RPR positivo'].forEach(w=>{
    assert.ok(o.includes(w), 'no emite recomendación para: '+w);
  });
  const negs = runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'En curso', hc_res_cmv:'Negativo', hc_res_vzv:'Negativo' });
  assert.ok(negs.includes('CMV IgG negativo') && negs.includes('VZV seronegativo'), 'no interpreta los serostatus negativos relevantes');
  assert.ok(!/CMV IgG|seropositivo|Anti-VHC positivo|VDRL/.test(runRecs({ hc_huesped:'SOT — Renal', hc_is_estado:'En curso' })), 'inventa serologías sin resultados capturados');
});
test('INMUNO v380: _txResHTML SIEMPRE incluye las serologías basales (hepatitis B) en seguimiento, sin Inicial', async () => {
  // El Dr.: al separar el perfil de HBV cambiaron las claves y desaparecieron de su seguimiento. Ahora son fijas.
  assert.ok(_idx.includes("_TX_EST_CATS.find(c=>c.cat==='Serologías basales')") && _idx.includes('const MAND='), 'el seguimiento no fuerza las serologías basales');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{}, escHtml:x=>x };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  const res = vm.runInContext('_txResHTML', ctx)({});   // sin nada solicitado en Inicial
  ['HBsAg','Anti-HBc total','Anti-HBs','HBV DNA','VIH Ag/Ab','Anti-VHC','VDRL'].forEach(w=>{
    assert.ok(res.includes(w), 'falta en seguimiento (debería estar siempre): '+w);
  });
});
test('INMUNO v381: Fase 3 (IA) — redacta con reglas duras (solo ID, sin citas, sin emojis, no inventa) y reusa el plan', async () => {
  // Híbrido: el motor determinista define el PLAN; la IA SOLO redacta. Verificamos el cableado al proxy seguro.
  assert.ok(_idx.includes('const _IA_SYSTEM_VALORACION_ID=') && _idx.includes('window._txValRedactarIA='), 'falta el motor de redacción IA');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k==='then') return undefined; if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const cap = {};
  const llamar = async (messages,system,maxtok,model) => { Object.assign(cap,{messages,system,maxtok,model}); return { content:[{ text:'NOTA REDACTADA DE PRUEBA' }] }; };
  const notaEl = { innerHTML:'' };
  const docMock = { getElementById:id=>{ if(id==='hc-nota') return notaEl; if(id==='hc-recs') return { innerText:'Impresión y plan — Infectología\nProfilaxis para Pneumocystis indicada', textContent:'' }; if(id==='hc_motivo') return { options:[{text:'Fiebre'}], selectedIndex:0, value:'fiebre' }; if(id&&id.indexOf('hc_cb_')===0) return null; return { value:(id==='hc_huesped'?'SOT — Renal':'') }; }, querySelectorAll:()=>[] };
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, navigator:{}, location:{}, escHtml:x=>x, document:docMock, Blob:STUB, URL:STUB, llamarAnthropicSeguro:llamar, window:{ _anthropicProxyURL:'proxy', _txCurrentPac:{ id:'p', nombre:'Test' } }, toast:()=>{} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  await ctx.window._txValRedactarIA();
  assert.ok(/SOLO infectología/.test(cap.system) && /SIN citas/.test(cap.system) && /SIN emojis/.test(cap.system), 'el system de la IA no impone las reglas duras');
  assert.ok(/NO inventes dosis|requiere validación clínica/.test(cap.system), 'la IA no está restringida a no inventar dosis');
  assert.equal(cap.model, 'claude-sonnet-4-6', 'modelo incorrecto');
  assert.ok(/PLAN DEFINIDO[\s\S]*Pneumocystis indicada/.test(cap.messages[0].content), 'la IA no recibe el plan determinista para redactarlo');
  assert.ok(notaEl.innerHTML.includes('hc-nota-ia') && notaEl.innerHTML.includes('NOTA REDACTADA DE PRUEBA') && notaEl.innerHTML.includes('Descargar Word'), 'no renderiza el borrador editable + descarga');
});
test('INMUNO v382: historial de >2 valoraciones — snapshot fechado, guardado y render acumulado', async () => {
  // El Dr.: "a veces hago más de 2 valoraciones". Cada una se guarda fechada y se acumula (Inicial → Seg 1 → 2 …).
  assert.ok(_idx.includes('window._txValGuardarHist=') && _idx.includes('function _txValHistHTML') && _idx.includes('txValoracionHist'), 'falta el motor del historial de valoraciones');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k==='then') return undefined; if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const cap = {};
  const updateDoc = (ref,data) => { cap.data=data; return Promise.resolve(true); };
  const pac = { id:'p', nombre:'Test', txValoracionHist:[] };
  const getDoc = (ref) => Promise.resolve({ exists:()=>true, data:()=>({ txValoracionHist:(pac.txValoracionHist||[]) }) });
  const docMock = { getElementById:id=>{ if(id==='hc-recs') return { innerText:'Impresión y plan — Infectología\nProfilaxis para Pneumocystis indicada', textContent:'' }; if(id==='hc_motivo') return { options:[{text:'Seguimiento'}], selectedIndex:0, value:'profilaxis' }; if(id&&id.indexOf('hc_cb_')===0) return null; return { value:(id==='hc_huesped'?'SOT — Renal':'') }; }, querySelectorAll:()=>[] };
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, navigator:{}, location:{}, escHtml:x=>x, document:docMock, Blob:STUB, URL:STUB, updateDoc, getDoc, doc:()=>({}), db:{}, _pacPath:()=>['h','H'], PACS:[pac], renderTrasplantePac:()=>{}, toast:()=>{}, window:{ _txValModo:'seguimiento', _txCurrentPac:pac } };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  ctx.window._txValModo='seguimiento';  // el bloque resetea _txValModo='inicial' al cargar; lo fijamos tras ejecutarlo
  ctx.window._txCurrentPac=pac;
  const snap = vm.runInContext('_txValSnapshotText', ctx)();
  assert.ok(/Huésped: SOT/.test(snap) && /Pneumocystis indicada/.test(snap), 'el snapshot no captura huésped + plan');
  ctx.window._txValGuardarHist();
  await new Promise(r=>setTimeout(r,0)); await new Promise(r=>setTimeout(r,0));
  assert.ok(cap.data && Array.isArray(cap.data.txValoracionHist) && cap.data.txValoracionHist.length===1, 'no guarda una entrada en el historial');
  const e0 = cap.data.txValoracionHist[0];
  assert.ok(e0.modo==='seguimiento' && e0.fecha && /Pneumocystis indicada/.test(e0.texto), 'la entrada no lleva modo/fecha/texto');
  const histFn = vm.runInContext('_txValHistHTML', ctx);
  const html = histFn({ txValoracionHist:[ {fecha:'2026-06-01T10:00:00Z',modo:'inicial',huesped:'SOT',texto:'A'}, {fecha:'2026-06-10T10:00:00Z',modo:'seguimiento',huesped:'SOT',texto:'B'}, {fecha:'2026-06-20T10:00:00Z',modo:'seguimiento',huesped:'SOT',texto:'C'} ] });
  assert.ok(html.includes('Valoraciones previas (3)') && html.includes('Inicial') && html.includes('Seguimiento') && html.includes('_txValDescargarHist'), 'no rinde el historial acumulado con descarga');
  assert.equal(histFn({ txValoracionHist:[] }), '', 'sin historial debería ser vacío');
});
test('INMUNO v383: Word PULIDO — membrete del hospital + título por motivo + plan numerado (carta de interconsulta)', async () => {
  assert.ok(_idx.includes('function _txValMembrete') && _idx.includes('function _txValWordBody') && _idx.includes('function _txValDescargarDoc'), 'falta el Word con membrete compartido');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k==='then') return undefined; if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const recDiv = { querySelectorAll:()=>[{textContent:'Pre-protocolo (aún sin inmunosupresión)'},{textContent:'Completar el tamizaje basal.'}] };
  const p = { id:'p', nombre:'Juan Pérez', exp:'123', edad:50, sexo:'M', servicio:'Medicina Interna', cama:'304' };
  const docMock = { getElementById:id=>{ if(id==='hc-recs') return { querySelectorAll:()=>[recDiv] }; if(id==='hc_motivo') return { value:'aptitud_pretx' }; if(id&&id.indexOf('hc_cb_')===0) return null; return { value:(id==='hc_huesped'?'SOT — Renal':'') }; }, querySelectorAll:()=>[] };
  const hi = { nombre:'Hospital General de Prueba' };
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, navigator:{}, location:{}, escHtml:x=>x, document:docMock, Blob:STUB, URL:STUB, HInfo:hi, PACS:[p], window:{ _txCurrentPac:p, _userName:'Dr. Test', HInfo:hi } };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx); vm.runInContext(block, ctx);
  ctx.window._txValModo='inicial';
  const w = vm.runInContext('_txValWordBody', ctx)(p);
  assert.ok(w.includes('Hospital General de Prueba') && w.includes('Programa de Optimización de Antimicrobianos (PROA)'), 'falta el membrete del hospital + PROA');
  assert.ok(w.includes('Valoración de aptitud pretrasplante'), 'el título no se adapta al motivo');
  assert.ok(w.includes('Juan Pérez') && w.includes('Exp. 123') && w.includes('304'), 'falta la ficha de identificación');
  assert.ok(w.includes('<ol') && w.includes('Pre-protocolo') && w.includes('NOM-004'), 'falta el plan numerado / pie NOM-004');
  ctx.document = { getElementById:id=>{ if(id==='hc-recs') return { querySelectorAll:()=>[] }; if(id==='hc_motivo') return { value:'fiebre' }; if(id&&id.indexOf('hc_cb_')===0) return null; return { value:'' }; }, querySelectorAll:()=>[] };
  assert.ok(vm.runInContext('_txValWordBody', ctx)(p).includes('Valoración por fiebre o foco infeccioso'), 'el título no cambia con el motivo');
});
test('INMUNO v368: flujo único — 8 sub-pestañas colapsadas en la Valoración + secciones "A detalle"', () => {
  // El Dr. pidió todo conectado en UNA pantalla (sin pestañas sueltas ni redundancia). Las 8 sub-pestañas
  // se colapsan en la Valoración; su contenido se vuelve secciones colapsables (lazy) que reusan los motores.
  const m=_idx.match(/const _TX_SUBTABS=\[[\s\S]*?\];/);
  assert.ok(m, 'no se encontró _TX_SUBTABS');
  assert.ok(m[0].includes("{id:'tx-valoracion'"), 'falta la sub-pestaña Valoración');
  assert.ok(!m[0].includes("{id:'tx-pretx'") && !m[0].includes("{id:'tx-profilaxis'") && !m[0].includes("{id:'tx-cmv'"), 'las sub-pestañas viejas siguen como tabs (redundancia no eliminada)');
  assert.ok(_idx.includes('function _txValDeepSectionsHTML') && /window\._txValDeep=function/.test(_idx), 'faltan las secciones "A detalle" embebidas');
  assert.ok(/map=\{tipo:_renderTxTipo[\s\S]{0,300}p24:_renderTxProtocolo24h\}/.test(_idx), '_txValDeep no reusa los motores existentes (sin pérdida de funcionalidad)');
  assert.ok(_idx.includes('id="hc-deep"') && /window\._txValRefreshDeep/.test(_idx), 'el flujo no embebe/actualiza las secciones a detalle');
});
test('INMUNO v369: los 8 motores embebidos ("A detalle") CORREN sin tronar + acordeón anti-colisión', async () => {
  // El Dr. exigió cero fallas. Ejecutamos los 8 render en un sandbox (node:vm) con dependencias stubeadas y
  // un paciente simulado: ninguno debe lanzar excepción y todos deben rendir HTML. Además, _txValDeep deja
  // SOLO un motor en el DOM a la vez (acordeón) → sin colisión de IDs si se abren varias secciones.
  const vm = await import('node:vm');
  const start = _idx.indexOf('function _renderTxVacunas(p){');
  const end = _idx.indexOf('\nwindow.sfx=sfx;');
  assert.ok(start >= 0 && end > start, 'no se ubicó el bloque de motores');
  const block = _idx.slice(start, end);
  let STUB;
  STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const docStub = { getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({style:{},dataset:{},appendChild(){},setAttribute(){},addEventListener(){}}), body:{appendChild(){}} };
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, document:docStub, window:{}, navigator:{}, location:{href:''} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  const engines = vm.runInContext(block + '\n;({_renderTxVacunas,_renderTxTipo,_renderTxProfilaxis,_renderTxPatogenos,_renderTxCMV,_renderTxPreTx,_renderTxNeutropenia,_renderTxProtocolo24h})', ctx);
  const mockP = { id:'p1', nombre:'Prueba', edad:55, sexo:'M', exp:'12345', servicio:'Trasplante', cama:'4', inmuno:'trasplante', tipoVisita:'trasplante', organismo:'', dx:'Trasplante renal', atbList:[], abg:{}, muestras:[], eventos:[], txPretx:{}, txValoracion:{hc_huesped:'SOT — Renal'}, riesgo:'alto', inicio:'2026-02-01' };
  for (const [name, fn] of Object.entries(engines)) {
    assert.equal(typeof fn, 'function', name + ' no es función');
    let out;
    assert.doesNotThrow(() => { out = fn(mockP); }, name + ' truena al renderizar embebido');
    assert.ok(typeof out === 'string' && out.length > 0, name + ' no rinde HTML');
  }
  assert.ok(_idx.includes("document.querySelectorAll('[id^=\"hc-deep-\"]')"), 'falta el acordeón (limpiar otras secciones) en _txValDeep');
  assert.ok(_idx.includes('<details name="hc-deep"'), 'falta el cierre exclusivo nativo (name) en las secciones a detalle');
});
test('INMUNO v370: historia completa (datos grales + antecedentes + estado IS) + ligado + Word — y CORREN', async () => {
  // Feedback del Dr.: faltaban datos/antecedentes generales; no todos toman IS; ligar inicial→seguimiento;
  // y un Word completísimo al final. Verificamos los campos + que render y Word corren sin tronar.
  assert.ok(_idx.includes('🪪 Datos generales') && _idx.includes('Editar / completar datos'), 'falta el bloque de datos generales');
  assert.ok(_idx.includes('Va a iniciar (pre-protocolo)') && _idx.includes('Ninguna / suspendida'), 'falta el estado de inmunosupresión (no todos la reciben)');
  assert.ok(_idx.includes('id="hc_is_estado"'), 'falta el estado de inmunosupresión');
  assert.ok(_idx.includes("ta('hc_notas'"), 'falta el campo único de notas / texto libre');
  // v374: antecedentes/hábitos/etc. ahora son chips (sí/no), no campos de texto.
  assert.ok(_idx.includes('📋 Solicitado en la valoración inicial'), 'falta el ligado inicial→seguimiento');
  assert.ok(/window\._txValWordExport=function/.test(_idx) && _idx.includes('function _txValWordBody') && _idx.includes("type:'application/msword'") && _idx.includes("'ValoracionID_'+"), 'falta el Word completo de la valoración');
  assert.ok(_idx.includes('const _TX_EST_LABELS='), 'falta el mapa de etiquetas de estudios compartido');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración');
  const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  assert.ok(start >= 0 && end > start, 'no se ubicó el bloque de valoración');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  const got = vm.runInContext(block + '\n;({render:_renderTxValoracion, word:window._txValWordExport})', ctx);
  const p = { id:'p1', nombre:'Prueba', edad:55, sexo:'M', exp:'123', peso:70, servicio:'Trasplante', cama:'4', txValoracion:{ hc_huesped:'SOT — Renal', hc_est_cmv:'1' } };
  let out;
  assert.doesNotThrow(() => { out = got.render(p); }, '_renderTxValoracion truena');
  assert.ok(typeof out === 'string' && out.length > 1000, '_renderTxValoracion no rinde');
  assert.doesNotThrow(() => { got.word(); }, '_txValWordExport truena');
});
test('INMUNO v371: flujo dirigido por MOTIVO (revelado progresivo) + sin pérdida de datos ocultos', async () => {
  // Fase 2 del loop: el motivo de la interconsulta orienta qué se muestra. Sin motivo → guarda. Y al
  // re-renderizar/guardar NO se pierden los campos ocultos (merge sobre lo guardado).
  assert.ok(_idx.includes('id="hc_motivo"'), 'falta el selector de motivo');
  assert.ok(/window\._txValReRender=function/.test(_idx), 'falta _txValReRender');
  assert.ok(_idx.includes('var data=Object.assign({}, p.txValoracion||{})'), '_txSaveValoracion no fusiona (perdería campos ocultos)');
  assert.ok(_idx.includes('const _txG=grp=>'), 'falta el motor de revelado progresivo (_txG)');
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  const got = vm.runInContext(block + '\n;({render:_renderTxValoracion})', ctx);
  const conMotivo = got.render({ id:'p1', nombre:'X', txValoracion:{ hc_motivo:'fiebre', hc_huesped:'SOT — Renal' } });
  assert.ok(conMotivo.includes('Historia clínica dirigida'), 'con motivo no abre la historia');
  const sinMotivo = got.render({ id:'p2', nombre:'Y', txValoracion:{} });
  assert.ok(sinMotivo.includes('Elige el') && !sinMotivo.includes('Historia clínica dirigida'), 'sin motivo no muestra la guarda');
  const profilaxis = got.render({ id:'p3', nombre:'Z', txValoracion:{ hc_motivo:'profilaxis', hc_huesped:'VIH' } });
  assert.ok(!profilaxis.includes('Exploración física dirigida'), 'el revelado progresivo no oculta lo no relevante (profilaxis no debe pedir exploración)');
});
test('INMUNO v372: el apoyo "A detalle" se filtra por motivo (solo lo relevante, no confunde)', async () => {
  // Feedback del Dr.: las secciones de apoyo no deben salir todas; cada motivo abre solo las suyas.
  const vm = await import('node:vm');
  const start = _idx.indexOf('// ══ v366: Valoración'); const end = _idx.indexOf('\nwindow.renderTrasplante=function(){');
  const block = _idx.slice(start, end);
  let STUB; STUB = new Proxy(function(){}, { get(t,k){ if(k===Symbol.toPrimitive||k==='toString'||k==='valueOf') return ()=>''; if(k===Symbol.iterator) return function*(){}; if(k==='length') return 0; return STUB; }, apply(){return STUB;}, construct(){return STUB;}, has(){return true;} });
  const base = { Math,JSON,Date,parseFloat,parseInt,isNaN,isFinite,String,Number,Boolean,Array,Object,RegExp,console,Intl,Set,Map, window:{}, document:STUB, Blob:STUB, URL:STUB, navigator:{}, location:{} };
  const ctx = new Proxy(base, { has(){return true;}, get(t,k){ if(k===Symbol.unscopables) return undefined; if(k in t) return t[k]; return STUB; }, set(t,k,v){ t[k]=v; return true; } });
  vm.createContext(ctx);
  const got = vm.runInContext(block + '\n;({render:_renderTxValoracion})', ctx);
  const ids = html => ['tipo','patogenos','profilaxis','pretx','cmv','neutro','vacunas','p24'].filter(k => html.includes('hc-deep-' + k)).sort();
  const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b.slice().sort());
  assert.ok(eq(ids(got.render({ id:'p', txValoracion:{ hc_motivo:'vacunacion', hc_huesped:'SOT — Renal' } })), ['vacunas']), 'vacunación debe abrir solo Vacunación');
  assert.ok(eq(ids(got.render({ id:'p', txValoracion:{ hc_motivo:'profilaxis', hc_huesped:'VIH' } })), ['profilaxis']), 'profilaxis+VIH debe abrir solo Profilaxis');
  assert.ok(eq(ids(got.render({ id:'p', txValoracion:{ hc_motivo:'fiebre', hc_huesped:'SOT — Renal' } })), ['cmv','patogenos','profilaxis']), 'fiebre+SOT debe abrir Patógenos/Profilaxis/CMV');
});
test('ABGSAFE v341: la interpretación del motor también se muestra al VER un antibiograma guardado', () => {
  // En la lista de aislamientos guardados (subcolección) — recomputado en vivo desde a.abg + a.organismo.
  assert.ok(/window\._renderAbgInterpretacionHTML\(a\.abg,a\.organismo\|\|''\)/.test(_idx), 'el panel no se renderiza en la lista de aislamientos guardados');
  // En el antibiograma legacy de la ficha (p.abg).
  assert.ok(/window\._renderAbgInterpretacionHTML\(p\.abg,p\.organismo\|\|''\)/.test(_idx), 'el panel no se renderiza en el antibiograma legacy de la ficha');
});
test('ABGVISION v342: cefotaxima (ctx) en el panel y dispara BLEE (CTX-M la hidroliza preferentemente)', () => {
  assert.ok(/\{k:'ctx',n:'Cefotaxima'\}/.test(_idx), 'falta cefotaxima (ctx) en el panel ABG_ATBS');
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  // Cefotaxima-R + inhibidor-S + cefoxitina-S → BLEE (vía el motor REAL).
  assert.equal(_detPheno({ ctx: 'R', pitaz: 'S' }, 'Escherichia coli').ESBL, true, 'cefotaxima-R no dispara el cribado BLEE');
});
test('ABGVISION v342: prompt Vision con reglas de integridad + extracción de baja confianza marcada', () => {
  // El prompt prohíbe inventar/inferir y exige needs_review en lo dudoso (anti-alucinación).
  assert.ok(/REGLAS DE INTEGRIDAD/.test(_idx), 'el prompt Vision no incluye reglas de integridad');
  assert.ok(/NO infieras ni inventes antibióticos/.test(_idx), 'el prompt no prohíbe inventar antibióticos');
  assert.ok(/"needs_review":false/.test(_idx), 'el JSON del prompt no pide needs_review');
  assert.ok(/Cefotaxima→ctx/.test(_idx), 'el mapeo del prompt no incluye Cefotaxima→ctx');
  // El handler avisa de los resultados de baja confianza en vez de darlos por ciertos.
  assert.ok(/if\(r\.needs_review\|\|r\.conf==='baja'\)revisar\.push/.test(_idx), 'el handler no recolecta los resultados de baja confianza');
  assert.ok(/de baja confianza — VERIFICA/.test(_idx), 'el handler no avisa de la baja confianza');
});
test('ABGMOTOR v343: Proteae excluyen imipenem del cribado CRE (imipenem-R intrínseco, Simner CMR 2024)', () => {
  assert.ok(_detPheno, 'no se extrajo detectPhenotypes');
  // Proteus/Morganella/Providencia: imipenem-R intrínseco NO define CRE → usar ert/mer.
  assert.equal(_detPheno({ imi: 'R' }, 'Proteus mirabilis').CRE, false, 'imipenem-R intrínseco NO debe marcar CRE en Proteus');
  assert.equal(_detPheno({ imi: 'R' }, 'Morganella morganii').CRE, false, 'imipenem-R intrínseco NO debe marcar CRE en Morganella');
  assert.equal(_detPheno({ mer: 'R' }, 'Proteus mirabilis').CRE, true, 'meropenem-R SÍ debe marcar CRE en Proteus');
  // En Enterobacterales NO Proteae, el imipenem sigue contando.
  assert.equal(_detPheno({ imi: 'R' }, 'Klebsiella pneumoniae').CRE, true, 'imipenem-R debe marcar CRE en Klebsiella');
});
test('ABGMOTOR v343: el patrón ertapenem-aislado incluye OXA-48-like en el diferencial (no sub-llamar carbapenemasa)', () => {
  assert.ok(/PATRÓN ERTAPENEM-AISLADO/.test(_idx), 'falta el mensaje refinado del patrón ertapenem-aislado');
  assert.ok(/OXA-48-like/.test(_idx) && /CONFIRMAR SIEMPRE por método molecular/.test(_idx), 'el diferencial no incluye OXA-48 ni exige confirmación molecular');
});
test('ABGMOTOR v344: aztreonam conservado (S) en CRE fenotípica → orienta a MBL (Agarwal Curr Med Chem 2022)', () => {
  // Las MBL (NDM/VIM/IMP) hidrolizan todos los β-lactámicos EXCEPTO los monobactámicos: aztreonam-S es la
  // firma de MBL pura (KPC hidroliza aztreonam → R; OXA-48 suele co-portar BLEE → R). Esquema dirigido IDSA
  // AMR 2024: aztreonam + ceftazidima-avibactam; la CAZ-AVI sola es inactiva contra MBL.
  assert.ok(/if\(p\.abg&&p\.abg\['azt'\]==='S'&&!_ph\.PorinLoss\)return/.test(_idx), 'elegirTX no usa aztreonam-S como pista de MBL en la rama CRE fenotípica');
  assert.ok(/AZTREONAM CONSERVADO \(S\)/.test(_idx) && /METALO-β-LACTAMASA/.test(_idx), 'falta el mensaje de orientación a MBL por aztreonam conservado');
  assert.ok(/ceftazidima-avibactam SOLA es INACTIVA contra MBL/i.test(_idx), 'no advierte que CAZ-AVI sola no cubre MBL');
  assert.ok(/Aztreonam-R NO excluye MBL/i.test(_idx), 'no advierte que aztreonam-R no excluye MBL (BLEE/AmpC coexistente)');
});
test('ABGMOTOR v345: CAZ-AVI no-S en CRE → excluye KPC/OXA-48 → MBL (Regla 4 del Dr.; + serina si azt-R)', () => {
  // La ceftazidima-avibactam cubre KPC y OXA-48 (serino-carbapenemasas A/D) pero NO las MBL (clase B). Por
  // eso CAZ-AVI no-S en una CRE excluye KPC/OXA-48 y orienta a metalo-β-lactamasa; si aztreonam también es
  // no-S, hay una serino-β-lactamasa coproducida ("no es una carbapenemasa, son dos" — caso de apertura).
  assert.ok(/if\(p\.abg&&\(p\.abg\['cazavi'\]==='R'\|\|p\.abg\['cazavi'\]==='I'\)\)\{/.test(_idx), 'elegirTX no usa CAZ-AVI no-S como discriminador de clase en la rama CRE');
  assert.ok(/EXCLUYE KPC y OXA-48/.test(_idx) && /orienta a METALO-β-LACTAMASA/.test(_idx), 'falta el mensaje del discriminador por CAZ-AVI');
  assert.ok(/serino-β-lactamasa COPRODUCIDA/.test(_idx) && /son dos/.test(_idx), 'no contempla la serina coproducida cuando aztreonam también es no-S');
});
test('ABGMOTOR v355: epidemiología mexicana REAL del INVIFAR 2024 (59.2% NDM, no ~80%) + aztreonam no disponible', () => {
  // Cifra corregida contra la publicación real: Colín-Castro et al., PLoS One 2025;20(4):e0319441.
  // El 84%/~80% era el reporte 2023; el de 2024 es 59.2% NDM en E. coli no-S a carbapenémicos.
  assert.ok(/59\.2% portan NDM/.test(_idx), 'CRE_PHENO no usa la cifra real INVIFAR 2024 (59.2% NDM)');
  assert.ok(!/~80% de las carbapenemasas en Enterobacterales son NDM/.test(_idx), 'persiste la cifra vieja "~80%" (no respaldada por el artículo)');
  assert.ok(/Colín-Castro et al\., PLoS One 2025;20\(4\):e0319441/.test(_idx), 'falta la cita real del INVIFAR (PLoS One 2025)');
  assert.ok(/NO hay aztreonam NI cefiderocol/.test(_idx), 'no refleja que en México frecuentemente no hay aztreonam NI cefiderocol → susceptibilidad-guiada + Infectología');
  assert.ok(/sospechar MBL primero/.test(_idx), 'no instruye sospechar MBL primero en el contexto mexicano');
  assert.ok(/mCIM\/eCIM/.test(_idx) && /Hodge está obsoleto/.test(_idx), 'no conserva los métodos confirmatorios (mCIM/eCIM/Carba 5/Xpert; Hodge obsoleto)');
});
test('ABGMOTOR v346: imipenem-relebactam como opción de la vía KPC (Lee/Hsueh IJAA 2022)', () => {
  // Imipenem/relebactam cubre KPC (serina A/C) pero NO OXA-48 ni MBL — opción paralela a mero-vaborbactam.
  // No es fiable en Morganellaceae (imipenem-R intrínseco).
  assert.ok(/Imipenem-relebactam.*solo si KPC|Meropenem-vaborbactam o Imipenem-relebactam/.test(_idx), 'CRE_PHENO no ofrece imipenem-relebactam en la vía KPC');
  assert.ok(/NO fiable en Morganella\/Proteus\/Providencia/.test(_idx), 'no advierte que imi-relebactam no es fiable en Morganellaceae (imipenem-R intrínseco)');
  assert.ok(/Int J Antimicrob Agents 2022;59:106528/.test(_idx), 'falta la cita de Lee/Hsueh IJAA 2022');
});
test('ABGMOTOR v347: AmpC advierte que pip-tazo "S" no es fiable (Meini Infection 2019)', () => {
  // Piperacilina es sustrato de AmpC y tazobactam es inductor débil (efecto inóculo) → pip-tazo puede fallar
  // pese a sensibilidad in vitro en organismos AmpC. Preferir cefepime/carbapenémico.
  assert.ok(/Pip-tazo "S" NO es fiable en AmpC/.test(_idx), 'el TX de AmpC no advierte sobre pip-tazo no fiable');
  assert.ok(/Meini et al\., Infection 2019;47:363-75/.test(_idx), 'falta la cita de Meini Infection 2019');
});
test('MOTOR P2: elegirTX consume el fenotipo del antibiograma + existe la rama TX.CRE_PHENO', () => {
  assert.ok(/const _ph=\(p\.abg&&Object\.keys\(p\.abg\)\.length&&typeof detectPhenotypes==='function'\)\?detectPhenotypes\(p\.abg,p\.organismo\|\|''\):null;/.test(_idx), 'elegirTX no deriva el fenotipo del antibiograma');
  assert.ok(/if\(_ph&&\(_ph\.CRE\|\|_ph\.Carbapenemase\)\)\{/.test(_idx), 'elegirTX no rutea CRE fenotípica a la rama CRE_PHENO');
  assert.ok(/return TX\.CRE_PHENO;/.test(_idx), 'elegirTX no devuelve TX.CRE_PHENO');
  assert.ok(/\(_ph&&_ph\.MRSA\)/.test(_idx) && /\(_ph&&_ph\.VRE\)/.test(_idx) && /\(_ph&&_ph\.ESBL\)/.test(_idx), 'elegirTX no usa MRSA/VRE/ESBL fenotípicos');
  assert.ok(/CRE_PHENO:\{title:'Carbapenemasa FENOTÍPICA/.test(_idx), 'falta la rama TX.CRE_PHENO');
});

/* ═══════════ P2 (auditoría v333): antibiograma acumulado del Excel — dedup M39 + precedencia ═══════════ */
test('ANTIBIOG P2: el resumen epidemiológico del Excel deduplica M39 y respeta precedencia subcolección>legacy', () => {
  assert.ok(/const _aisDedup=window\.clsim39Deduplicate\?window\.clsim39Deduplicate\(_allAislamientos\)/.test(_idx), 'el resumen por organismo no deduplica M39');
  assert.ok(/_orgSet=\[\.\.\.new Set\(_aisDedup\.map/.test(_idx), 'el resumen sigue usando _allAislamientos sin dedup');
  assert.ok(/_allAislamientos\.push\(\{\.\.\.a, patientId:p\.id/.test(_idx), 'los aislamientos de subcolección no llevan patientId para deduplicar');
  assert.ok(/if\(\(!_allAbgMap\[p\.id\]\|\|!_allAbgMap\[p\.id\]\.length\)&&p\.abg/.test(_idx), 'falta la precedencia subcolección > p.abg legacy');
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

/* ═══════════ Trasplante Pre-TX (v302): TODO campo de serología EJECUTA en _pretxRecs (AST IDCOP 2019) ═══════════ */
/* Bug reportado: se seleccionaban anticuerpos (p.ej. Coccidioides) y la recomendación no los ejecutaba.
   Causa raíz: el formulario ofrecía campos que el motor _pretxRecs NUNCA leía → selecciones muertas.
   Esta prueba extrae el motor REAL de index.html y lo EJECUTA en un DOM simulado: cada campo antes
   muerto debe producir recomendación, y ningún campo de serología puede quedar sin consumir. */
const _pretxBlock = (() => {
  const s = _idx.indexOf('function g(id){return document.getElementById');
  const e = _idx.indexOf('window._pretxWordExport=function');
  return (s >= 0 && e > s) ? _idx.slice(s, e) : '';
})();
function _runPretx(fields) {
  const recsEl = { innerHTML: '' };
  const document = { getElementById: id => id === 'pretx-recs' ? recsEl : { value: (fields[id] || '') } };
  const win = {};
  new Function('window', 'document', _pretxBlock)(win, document);
  win._pretxRecs();
  return recsEl.innerHTML;
}
test('PRETX: el motor _pretxRecs es extraíble y ejecuta sin error (vacío → pide tipo de TX)', () => {
  assert.ok(_pretxBlock.length > 500, 'no se extrajo el bloque _pretxRecs');
  assert.doesNotThrow(() => _runPretx({}));
  assert.ok(_runPretx({}).includes('Seleccione el tipo de trasplante'));
});
const _PRETX_CASES = [
  ['pt_coccidio', 'Positivo (+)', 'Coccidioides serología POSITIVA'],
  ['pt_vzv', 'Negativo (-)', 'VZV IgG NEGATIVO'],
  ['pt_hsv', 'Positivo (+)', 'HSV IgG POSITIVO'],
  ['pt_hbvdna', 'Detectable', 'HBV DNA DETECTABLE'],
  ['pt_htlv', 'Positivo (+)', 'HTLV-1/2 POSITIVO'],
  ['pd_htlv', 'Positivo (+)', 'HTLV-1/2 POSITIVO (DONANTE)'],
  ['pd_wnv', 'Positivo (+)', 'West Nile Virus POSITIVO'],
  ['pd_hemocult', 'Positivos', 'Hemocultivo del DONANTE'],
  ['pd_bal', 'Positivo', 'Cultivo de BAL del DONANTE'],
  ['pd_urocult', 'Positivo', 'Urocultivo del DONANTE'],
  ['pd_lcr', 'Positivo', 'Cultivo de LCR del DONANTE'],
  ['pt_rxtx', 'Anormal', 'Rx de tórax ANORMAL'],
  ['pt_bcg', 'Sí', 'BCG aplicada'],
  ['pt_tbanterior', 'Sí', 'Historia de TB previa'],
  ['pt_cmv', 'Positivo (+)', 'CMV'],   // regresión: lo que ya funcionaba sigue funcionando
  // v306 — TODO valor emite (no solo la polaridad accionable):
  ['pt_ebv', 'Positivo (+)', 'EBV IgG POSITIVO'],   // la queja: EBV+ ya da recomendación
  ['pt_toxo', 'Positivo (+)', 'Toxoplasma IgG POSITIVO'],
  ['pt_sifilis', 'Reactivo', 'VDRL/RPR REACTIVO'],  // VDRL nuevo
  ['pt_sifilis', 'No reactivo', 'VDRL/RPR no reactivo'],
  ['pt_hsv', 'Negativo (-)', 'HSV IgG NEGATIVO'],
  ['pt_hiv', 'Negativo (-)', 'VIH NEGATIVO'],
  ['pt_chagas', 'Negativo (-)', 'Chagas NEGATIVO'],
];
for (const [id, val, must] of _PRETX_CASES) {
  test('PRETX ejecuta: ' + id + '=' + val + ' → recomendación', () => {
    assert.ok(_runPretx({ [id]: val }).includes(must), 'no apareció la recomendación: ' + must);
  });
}
test('PRETX ejecuta: EBV D+/R- (dos campos) → riesgo de PTLD', () => {
  assert.ok(_runPretx({ pt_ebv: 'Negativo (-)', pd_ebv: 'Positivo (+)' }).includes('PTLD'));
});
test('PRETX anti-selección-muerta: cada serología ofrecida es consumida por _pretxRecs', () => {
  const requeridos = ['pt_coccidio','pt_vzv','pt_hsv','pt_hbvdna','pt_ebv','pt_htlv','pd_ebv','pd_hsv','pd_htlv','pd_wnv','pd_hemocult','pd_bal','pd_urocult','pd_lcr','pt_rxtx','pt_ppd','pt_tbanterior','pt_bcg','pt_cmv','pd_cmv','pt_hbsag','pt_hbc','pt_hbs_t','pt_qft','pt_chagas','pt_toxo','pt_strongy','pt_histo','pt_hiv','pt_hcv','pt_hcvrna','pt_sifilis','pt_g6pd','pt_tipotx'];
  const muertos = requeridos.filter(id => !_pretxBlock.includes("'" + id + "'"));
  assert.deepEqual(muertos, [], 'CAMPOS MUERTOS (no consumidos por _pretxRecs): ' + muertos.join(', '));
});
test('PRETX: el tipo de trasplante MODULA las recomendaciones (v306)', () => {
  // Corazón seronegativo a Toxo → riesgo de toxoplasmosis primaria (pirimetamina)
  assert.ok(_runPretx({ pt_tipotx: 'Cardíaco', pt_toxo: 'Negativo (-)' }).includes('pirimetamina'));
  // TCMH alogénico no relacionado, CMV D+/R- → letermovir hasta día 100
  assert.ok(_runPretx({ pt_tipotx: 'TCMH alogénico no relacionado', pd_cmv: 'Positivo (+)', pt_cmv: 'Negativo (-)' }).includes('Letermovir hasta el día 100'));
  // Pulmón, CMV D+/R- → profilaxis 6–12 meses
  assert.ok(_runPretx({ pt_tipotx: 'Pulmonar', pd_cmv: 'Positivo (+)', pt_cmv: 'Negativo (-)' }).includes('6–12 meses'));
});

/* ═══════════ Trasplante Profilaxis (v303): pf_ebv/pf_hcv/pf_hbv_dna ahora EJECUTAN ═══════════ */
/* Estaban leídos pero sin usar (selección muerta). _txProfRec se extrae, se des-escapan los
   template-literals internos (rec usa backticks) y se ejecuta en DOM simulado. */
const _profBlock = (() => {
  const s = _idx.indexOf('window._txProfRec=function(){');
  const e = _idx.indexOf('window._txProfRec();', s);
  // v310: el bloque ahora contiene la pre-carga `var _tp=${JSON.stringify(p.txPretx||{})}` (interpolación
  // del template-literal externo). Sustituirla por `{}` para que el bloque sea JS válido aislado → la
  // pre-carga no mapea nada y _txProfRec lee los `fields` inyectados como antes.
  return (s >= 0 && e > s) ? _idx.slice(s, e).split('\\`').join('`').split('\\${').join('${').replace('${JSON.stringify(p.txPretx||{})}', '{}') : '';
})();
function _runProf(fields) {
  const recsEl = { innerHTML: '' };
  const document = { getElementById: id => id === 'pf-recs' ? recsEl : { value: (fields[id] || '') } };
  const win = {};
  new Function('window', 'document', _profBlock + '\n window._txProfRec();')(win, document);
  return recsEl.innerHTML;
}
test('PROF: el motor _txProfRec es extraíble y ejecuta sin error', () => {
  assert.ok(_profBlock.length > 500, 'no se extrajo el bloque _txProfRec');
  assert.doesNotThrow(() => _runProf({}));
});
const _PROF_CASES = [
  ['pf_ebv', 'Negativo (-)', 'EBV IgG NEGATIVO'],
  ['pf_hcv', 'HCV RNA detectable', 'HCV RNA DETECTABLE'],
  ['pf_hcv', 'Anti-HCV+ / RNA indetectable', 'Anti-HCV+ con RNA indetectable'],
  ['pf_hbv_dna', 'Detectable', 'HBV DNA DETECTABLE'],
  ['pf_cmv_d', 'Positivo (+)', 'CMV'],   // regresión
];
for (const [id, val, must] of _PROF_CASES) {
  test('PROF ejecuta: ' + id + '=' + val + ' → recomendación', () => {
    const out = id === 'pf_cmv_d' ? _runProf({ pf_cmv_d: 'Positivo (+)', pf_cmv_r: 'Negativo (-)' }) : _runProf({ [id]: val });
    assert.ok(out.includes(must), 'no apareció: ' + must);
  });
}

/* ═══════════ Trasplante (v310): el tab Profilaxis se PRE-CARGA desde la evaluación Pre-TX (txPretx) ═══════════ */
/* "Ligar las pestañas": lo capturado en Pre-TX (campos pt_ y pd_, persistidos en p.txPretx) alimenta los
   campos pf_ del tab Profilaxis al renderizar. Se extrae el bloque REAL, se sustituye la interpolación del
   txPretx por un caso de prueba, y se verifica que el mapeo ocurra (incl. la traducción especial de HCV). */
test('TXLINK: Profilaxis pre-carga serologías desde la evaluación Pre-TX guardada (txPretx)', () => {
  const s = _idx.indexOf('window._txProfRec=function(){');
  const e = _idx.indexOf('window._txProfRec();', s);
  const txPretx = { pt_cmv: 'Positivo (+)', pd_cmv: 'Negativo (-)', pt_toxo: 'Positivo (+)', pt_qft: 'Positivo (+)', pt_g6pd: 'Deficiente', pt_hcvrna: 'Detectable', pt_hcv: 'Positivo (+)' };
  const body = _idx.slice(s, e).split('\\`').join('`').split('\\${').join('${').replace('${JSON.stringify(p.txPretx||{})}', JSON.stringify(txPretx));
  const fields = {};
  const recsEl = { innerHTML: '' };
  const document = { getElementById: id => id === 'pf-recs' ? recsEl : (fields[id] || (fields[id] = { value: '' })) };
  new Function('window', 'document', body + '\n window._txProfRec();')({}, document);
  assert.equal(fields.pf_cmv_r && fields.pf_cmv_r.value, 'Positivo (+)', 'CMV receptor no se pre-cargó');
  assert.equal(fields.pf_cmv_d && fields.pf_cmv_d.value, 'Negativo (-)', 'CMV donante no se pre-cargó');
  assert.equal(fields.pf_toxo && fields.pf_toxo.value, 'Positivo (+)', 'Toxo no se pre-cargó');
  assert.equal(fields.pf_qft && fields.pf_qft.value, 'Positivo (+)', 'QFT/TB no se pre-cargó');
  assert.equal(fields.pf_g6pd && fields.pf_g6pd.value, 'Deficiente', 'G6PD no se pre-cargó');
  assert.equal(fields.pf_hcv && fields.pf_hcv.value, 'HCV RNA detectable', 'HCV no tradujo a "RNA detectable"');
  assert.ok(recsEl.innerHTML.length > 80, '_txProfRec no rindió recomendaciones desde la pre-carga');
});

/* ═══════════ Trasplante (v304): mapa de inmunosupresores/biológicos — agentes críticos + campos completos ═══════════ */
/* inmunoClases alimenta los checkboxes y _txShowInmuno (cada agente ejecuta su tarjeta). Esta prueba
   evalúa el array REAL, exige los agentes de mayor impacto (incl. el hueco de seguridad anti-complemento
   → meningococo) y que NINGÚN agente quede sin los 4 campos que rinde la tarjeta. */
test('TXMAP: inmunoClases parsea, cubre agentes críticos y todos tienen los 4 campos', () => {
  const s = _idx.indexOf('const inmunoClases=[');
  const e = _idx.indexOf('];', s) + 2;
  assert.ok(s >= 0 && e > s, 'no se ubicó inmunoClases');
  const arr = eval('(' + _idx.slice(s + 'const inmunoClases='.length, e - 1) + ')');
  const noms = arr.flatMap(c => c.items.map(i => i.nom)).join(' | ');
  for (const must of ['Eculizumab', 'Ravulizumab', 'Alemtuzumab', 'Infliximab', 'Natalizumab', 'Rituximab', 'Ibrutinib', 'Tacrolimus', 'Timoglobulina (ATG)']) {
    assert.ok(noms.includes(must), 'falta agente crítico en el mapa: ' + must);
  }
  assert.ok(JSON.stringify(arr).includes('MENINGOC'), 'eculizumab/anti-C5 sin la recomendación meningocócica');
  const incompletos = arr.flatMap(c => c.items).filter(i => !i.nom || !i.riesgos || !i.screening || !i.profilaxis || !i.monitoreo).map(i => i.nom || '???');
  assert.deepEqual(incompletos, [], 'agentes sin los 4 campos (no rinden tarjeta completa): ' + incompletos.join(', '));
});

/* ═══════════ Trasplante Vacunación (v305, Fase 2b): subtab nuevo, conectado y renderiza ═══════════ */
test('TXVAC: Vacunación reutilizada y embebida en la Valoración (v368 colapsó las pestañas)', () => {
  // v368: tx-vacunas dejó de ser pestaña; _renderTxVacunas ahora se reusa como sección "A detalle".
  assert.ok(_idx.includes('vacunas:_renderTxVacunas'), 'la vacunación ya no se reutiliza en las secciones a detalle');
  assert.ok(_idx.includes("deep('vacunas'"), 'la sección Vacunación no está embebida en el flujo de valoración');
});
test('TXVAC: _renderTxVacunas ejecuta y produce el contenido clave citado', () => {
  const s = _idx.indexOf('function _renderTxVacunas(p){');
  const e = _idx.indexOf('\nfunction _txCard(', s);
  assert.ok(s >= 0 && e > s, 'no se ubicó _renderTxVacunas');
  const fn = new Function('_txCard', _idx.slice(s, e) + '\n return _renderTxVacunas;')((t, c) => t + '||' + c);
  const out = fn({});
  for (const must of ['VIVAS', 'Shingrix', 'Meningococo', 'MMR', '≥4 semanas', 'Danziger-Isakov']) {
    assert.ok(out.includes(must), 'falta contenido en Vacunación: ' + must);
  }
});

/* ═══════════ Censo v311: dar de alta NO exige ATB (abordaje) — censo general + trasplante ═══════════ */
test('ALTA: dar de alta NO exige antimicrobiano (el candado de ATB se eliminó)', () => {
  // v311: pacientes en abordaje/estudio ingresan sin ATB en TODO el censo (general y trasplante).
  assert.ok(!_idx.includes('!_esInterconsulta&&!_esTx&&!atb&&atbListData.length===0'), 'el candado de ATB sigue presente en guardar()');
  assert.ok(!_idx.includes('Agrega al menos un antimicrobiano'), 'sigue el toast que bloquea por falta de ATB');
  // El nombre sí sigue siendo lo único obligatorio.
  assert.ok(_idx.includes("toast('⚠ El nombre del paciente es obligatorio','rd')"), 'el nombre debe seguir siendo obligatorio');
});
test('TXALTA: hay función + botón para crear paciente desde el módulo (preselecciona trasplante)', () => {
  assert.ok(_idx.includes('window._txNuevoPaciente=function()'), 'falta _txNuevoPaciente');
  assert.ok(_idx.includes('id="f-inmuno" value="trasplante"'), 'el alta no marca Inmunosupresión=trasplante (v364: hidden f-inmuno)');
  assert.ok(_idx.includes('window._txNuevoPaciente&&window._txNuevoPaciente()'), 'falta el botón en el módulo');
});
test('TXPERSIST: la evaluación Pre-TX se guarda al expediente y se pre-carga (v309)', () => {
  assert.ok(_idx.includes('window._txSavePretx='), 'falta _txSavePretx');
  assert.ok(_idx.includes('updateDoc(doc(db,..._pacPath(),p.id),{txPretx:data'), 'no escribe txPretx en el expediente del paciente');
  assert.ok(_idx.includes('var _saved=${JSON.stringify(p.txPretx||{})}'), 'no precarga p.txPretx al seleccionar paciente');
  assert.ok(_idx.includes('window._txPretxLoading'), 'falta el guard de pre-carga (evita guardar durante la carga)');
  assert.ok(_idx.includes('if(window._txSavePretx)window._txSavePretx()'), '_pretxRecs no dispara el guardado');
});
test('W1.1 — pareo de paciente por exp/MRN (prioridad) → fhirId → nombre → null', async () => {
  // Interoperabilidad: las ingestas EHR/LIS deben ligarse al paciente CORRECTO. exp (MRN) es el más seguro.
  const mod = await import('../functions/lib/pairing.js');
  const findExistingPatient = mod.findExistingPatient || (mod.default && mod.default.findExistingPatient);
  const makeDb = (byField = {}, docs = {}) => ({
    doc: (path) => ({ get: async () => ({ exists: !!docs[path], id: path.split('/').pop() }) }),
    collection: () => ({ where: (f, _op, v) => ({ limit: () => ({ get: async () => { const id = byField[f + ':' + JSON.stringify(v)]; return id ? { empty: false, docs: [{ id }] } : { empty: true, docs: [] }; } }) }) }),
  });
  // exp gana sobre nombre
  let db = makeDb({ 'exp:"12345"': 'pac_exp', 'nombre:"Juan Pérez"': 'pac_nombre' });
  assert.equal(await findExistingPatient(db, 'H', '2026-06', { fhirId: 'X', name: 'Juan Pérez', exp: '12345' }), 'pac_exp', 'exp no tuvo prioridad');
  // exp no halla → fhirId
  db = makeDb({}, { 'hospitals/H/months/2026-06/patients/ehr_X': true });
  assert.equal(await findExistingPatient(db, 'H', '2026-06', { fhirId: 'X', name: 'Juan', exp: '999' }), 'ehr_X', 'no cayó a fhirId');
  // sin exp/fhirId → nombre (último recurso)
  db = makeDb({ 'nombre:"Juan Pérez"': 'pac_nombre' });
  assert.equal(await findExistingPatient(db, 'H', '2026-06', { name: 'Juan Pérez' }), 'pac_nombre', 'no cayó a nombre');
  // nada coincide → null
  assert.equal(await findExistingPatient(makeDb({}), 'H', '2026-06', { fhirId: 'Z', name: 'Nadie', exp: '000' }), null, 'debería ser null');
  // exp numérico almacenado → fallback a Number
  db = makeDb({ 'exp:777': 'pac_num' });
  assert.equal(await findExistingPatient(db, 'H', '2026-06', { exp: '777' }), 'pac_num', 'no hizo fallback numérico de exp');
});
test('W1.2 — parser HL7 v2 ORU^R01 → {exp, organismo, antibiograma} (forma que ya consume StewardMX)', async () => {
  const { parseORU } = await import('../functions/lib/hl7.js');
  // Mensaje 1: cultivo + antibiograma (S/I/R en OBX-8, MIC en OBX-5). PID-3 con 2 ids → debe elegir el tipo MR.
  const m1 = [
    'MSH|^~\\&|LIS|LAB|STEWARD|HOSP|20260628100000||ORU^R01|MSG001|P|2.5.1',
    'PID|1||9999^^^X^AN~0012345^^^HOSP^MR||PEREZ^JUAN||19750101|M',
    'PV1|1|I|3A^^304',
    'OBR|1||CX123|600-7^Culture^LN|||20260626080000',
    'OBX|1|ST|ORG^Organism identified^L||Escherichia coli||||||F',
    'OBX|2|NM|CRO^Ceftriaxona^L||>=64|mg/L||R|||F',
    'OBX|3|NM|MEM^Meropenem^L||<=0.25|mg/L||S|||F',
    'OBX|4|NM|CIP^Ciprofloxacino^L||2|mg/L||I|||F',
  ].join('\n');
  const r1 = parseORU(m1);
  assert.equal(r1.messageType, 'ORU^R01', 'tipo de mensaje');
  assert.equal(r1.patient.exp, '0012345', 'no eligió el MRN (tipo MR) sobre el AN');
  assert.equal(r1.patient.name, 'JUAN PEREZ', 'nombre');
  assert.equal(r1.patient.sex, 'M', 'sexo');
  assert.equal(r1.organism, 'Escherichia coli', 'organismo');
  assert.equal(r1.specimen.collectedAt, '2026-06-26T08:00:00', 'fecha de toma OBR-7');
  assert.equal(r1.antibiogram.length, 3, 'núm. de antibióticos');
  const cro = r1.antibiogram.find(a => /Ceftriaxona/.test(a.drug));
  assert.ok(cro && cro.interpretation === 'R' && cro.mic === '>=64', 'ceftriaxona R / MIC');
  assert.ok(r1.antibiogram.find(a => /Meropenem/.test(a.drug) && a.interpretation === 'S'), 'meropenem S');
  assert.ok(r1.antibiogram.find(a => /Ciprofloxacino/.test(a.drug) && a.interpretation === 'I'), 'cipro I');
  // Mensaje 2: hemocultivo, S/I/R directo en OBX-5 (sin MIC).
  const m2 = [
    'MSH|^~\\&|LIS|LAB|STEWARD|HOSP|20260628||ORU^R01|MSG002|P|2.3',
    'PID|1||77777^^^HOSP^MR||LOPEZ^MARIA||19800505|F',
    'OBR|1||BC55|HEMO|||20260627',
    'OBX|1|ST|ORG^Microorganismo^L||Staphylococcus aureus',
    'OBX|2|ST|OXA^Oxacilina^L||R',
    'OBX|3|ST|VAN^Vancomicina^L||S',
  ].join('\n');
  const r2 = parseORU(m2);
  assert.equal(r2.patient.exp, '77777', 'exp msg2');
  assert.equal(r2.organism, 'Staphylococcus aureus', 'organismo msg2');
  assert.ok(r2.antibiogram.find(a => /Oxacilina/.test(a.drug) && a.interpretation === 'R' && a.mic === null), 'oxacilina R sin MIC');
  assert.ok(r2.antibiogram.find(a => /Vancomicina/.test(a.drug) && a.interpretation === 'S'), 'vancomicina S');
  // Robustez: mensaje sin MSH lanza error claro.
  assert.throws(() => parseORU('PID|1||x'), /MSH/, 'debería rechazar lo que no es HL7');
});
test('W1.3 — idempotencia (labIdFor) + normalización LIS (HL7/JSON)', async () => {
  const { labIdFor, normalizeLisInput } = await import('../functions/lib/lis.js');
  // Idempotencia: mismo control id → misma clave (reenviar no duplica).
  assert.equal(labIdFor({ controlId: 'MSG001' }), labIdFor({ controlId: 'MSG001' }), 'control id no es idempotente');
  assert.ok(labIdFor({ controlId: 'MSG001' }).startsWith('LIS_'), 'prefijo LIS_');
  // Sin control id → hash estable de (paciente, organismo, fecha); mismas entradas → misma clave.
  const a = labIdFor({ patientId: 'p', organism: 'E. coli', collectedAt: '2026-06-26' });
  const b = labIdFor({ patientId: 'p', organism: 'E. coli', collectedAt: '2026-06-26' });
  assert.equal(a, b, 'hash no estable');
  assert.notEqual(a, labIdFor({ patientId: 'p', organism: 'K. pneumoniae', collectedAt: '2026-06-26' }), 'distinto organismo debería dar otra clave');
  // Normalización HL7.
  const nh = normalizeLisInput({ hl7: { patient: { exp: '123', name: 'Juan' }, specimen: { type: 'Sangre', collectedAt: '2026-06-26' }, organism: 'E. coli', antibiogram: [{ drug: 'Mero', mic: '<=0.25', interpretation: 'S' }], controlId: 'MSG001' } });
  assert.ok(nh.exp === '123' && nh.organism === 'E. coli' && nh.antibiogram.length === 1 && nh.controlId === 'MSG001' && nh.source === 'LIS-HL7', 'normalización HL7 incorrecta');
  // Normalización JSON.
  const nj = normalizeLisInput({ body: { patientId: 'pac1', organism: 'K. pneumoniae', antibiogram: [], messageId: 'X9' } });
  assert.ok(nj.patientId === 'pac1' && nj.organism === 'K. pneumoniae' && nj.controlId === 'X9' && nj.source === 'LIS', 'normalización JSON incorrecta');
});
test('W1.4 — tubo end-to-end con simulador: HL7 → parse → normaliza → pareo(exp) → labId idempotente', async () => {
  const { buildORU } = await import('../functions/lib/hl7sim.js');
  const { parseORU } = await import('../functions/lib/hl7.js');
  const { normalizeLisInput, labIdFor } = await import('../functions/lib/lis.js');
  const { findExistingPatient } = await import('../functions/lib/pairing.js');
  // Mensaje sintético.
  const msg = buildORU({ controlId: 'E2E1', exp: '55501', family: 'GARCIA', given: 'ANA', sex: 'F', collectedAt: '20260628073000', organism: 'Klebsiella pneumoniae', antibiogram: [{ drug: 'Meropenem', mic: '>=16', interpretation: 'R' }, { drug: 'Amikacina', mic: '<=2', interpretation: 'S' }] });
  // Parse + normaliza.
  const parsed = parseORU(msg);
  assert.equal(parsed.patient.exp, '55501', 'exp del simulador no round-trip');
  assert.equal(parsed.organism, 'Klebsiella pneumoniae', 'organismo no round-trip');
  assert.equal(parsed.antibiogram.length, 2, 'antibiograma no round-trip');
  assert.equal(parsed.specimen.collectedAt, '2026-06-28T07:30:00', 'fecha de toma no round-trip');
  const inp = normalizeLisInput({ hl7: parsed });
  assert.equal(inp.exp, '55501'); assert.equal(inp.controlId, 'E2E1');
  // Pareo por exp contra un Firestore simulado (paciente censado con exp 55501).
  const db = { doc: () => ({ get: async () => ({ exists: false }) }), collection: () => ({ where: (f, _o, v) => ({ limit: () => ({ get: async () => (f === 'exp' && String(v) === '55501') ? { empty: false, docs: [{ id: 'pac_ana' }] } : { empty: true, docs: [] } }) }) }) };
  const pid = await findExistingPatient(db, 'H', '2026-06', { exp: inp.exp, name: inp.name });
  assert.equal(pid, 'pac_ana', 'no pareó el resultado al paciente por exp');
  // Idempotencia: el MISMO mensaje produce el MISMO labId (no duplica).
  const id1 = labIdFor({ controlId: parseORU(msg).controlId, patientId: pid });
  const id2 = labIdFor({ controlId: parseORU(msg).controlId, patientId: pid });
  assert.equal(id1, id2, 'reenviar el mismo mensaje no es idempotente');
});
test('W2 — motor de alertas PROA (reglas deterministas, puro)', async () => {
  const A = await import('../js/core/alerts.js');
  const resolveKey = n => /meropenem/i.test(n) ? 'mem' : (/ceftriaxona/i.test(n) ? 'cro' : null);
  // 1) bug-drug mismatch
  assert.equal(A.ruleMismatch({ atbList: [{ nombre: 'Meropenem 1g' }], abg: { mem: 'R' } }, resolveKey).length, 1, 'no detecta discordancia R');
  assert.equal(A.ruleMismatch({ atbList: [{ nombre: 'Meropenem 1g' }], abg: { mem: 'S' } }, resolveKey).length, 0, 'falso positivo con S');
  // 2) renal
  assert.equal(A.ruleRenal({ atbList: [{ nombre: 'Vancomicina' }] }, 20).length, 1, 'no alerta renal <30');
  assert.equal(A.ruleRenal({ atbList: [{ nombre: 'Vancomicina' }] }, 60).length, 0, 'falso positivo renal ≥30');
  assert.equal(A.ruleRenal({ atbList: [{ nombre: 'Azitromicina' }] }, 10).length, 0, 'ATB no renal no debe alertar');
  // 3) IV→PO
  assert.equal(A.ruleIVtoPO({ atbList: [{ nombre: 'Ceftriaxona', via: 'IV' }] }, 4).length, 1, 'no detecta IV→PO');
  assert.equal(A.ruleIVtoPO({ atbList: [{ nombre: 'Ceftriaxona', via: 'IV' }] }, 2).length, 0, 'IV<3d no debe alertar');
  // 4) duración
  assert.equal(A.ruleDuration({}, 8).length, 1, 'no alerta duración ≥7');
  assert.equal(A.ruleDuration({}, 3).length, 0, 'duración corta no alerta');
  // 5) sin cultivo
  assert.equal(A.ruleNoCulture({ atbList: [{ nombre: 'Meropenem' }] }).length, 1, 'no alerta ATB sin cultivo');
  assert.equal(A.ruleNoCulture({ atbList: [{ nombre: 'Meropenem' }], organismo: 'E. coli' }).length, 0, 'con organismo no debe alertar');
  // 6) MDR
  assert.equal(A.ruleMDR({ organismo: 'K. pneumoniae' }, true).length, 1, 'no alerta MDR');
  assert.equal(A.ruleMDR({}, false).length, 0, 'sin MDR no alerta');
  // 7) desescalada
  assert.equal(A.ruleDeescalation({ atbList: [{ nombre: 'Meropenem' }], organismo: 'E. coli' }).length, 1, 'no detecta desescalada');
  // agregador
  const all = A.proaAlerts({ atbList: [{ nombre: 'Meropenem 1g', via: 'IV' }], abg: { mem: 'R' }, organismo: 'K. pneumoniae' }, { resolveKey, crcl: 20, dot: 9, isMDR: true });
  assert.ok(all.length >= 5, 'el agregador debería combinar varias alertas, dio ' + all.length);
  assert.ok(all.some(x => x.id.startsWith('mismatch')) && all.some(x => x.id === 'mdr') && all.some(x => x.id === 'renal'), 'faltan alertas clave en el agregado');
});
test('W3 — AUC de vancomicina por 2 niveles (PK primer orden) vs caso resuelto', async () => {
  const { vancoAUC2level, vancoSuggestDailyDose } = await import('../js/core/vanco.js');
  // Caso: 1 g c/12h, infusión 1h; pico 30 mg/L a las 2h, valle 10 mg/L a las 11h.
  // ke=ln3/9≈0.1221; Cmax≈33.9; Cmin≈8.85; AUCτ≈226.5; AUC24≈453 (en objetivo 400–600).
  const r = vancoAUC2level({ C1: 30, t1: 2, C2: 10, t2: 11, tau: 12, tinf: 1 });
  assert.ok(r, 'no calculó');
  assert.ok(Math.abs(r.ke - 0.1221) < 0.002, 'ke fuera de rango: ' + r.ke);
  assert.ok(Math.abs(r.thalf - 5.68) < 0.1, 't1/2 fuera de rango: ' + r.thalf);
  assert.ok(Math.abs(r.auc24 - 453) < 4, 'AUC24 fuera de rango: ' + r.auc24);
  assert.equal(r.inTarget, true, 'debería estar en objetivo 400–600');
  // Sugerencia de dosis (lineal) para objetivo 500.
  const nd = vancoSuggestDailyDose(2000, r.auc24, 500);
  assert.ok(Math.abs(nd - 2000 * 500 / r.auc24) < 1, 'sugerencia de dosis incorrecta');
  // Inválidos → null.
  assert.equal(vancoAUC2level({ C1: 10, t1: 2, C2: 30, t2: 11, tau: 12, tinf: 1 }), null, 'C1<C2 (ke<0) debería ser null');
  assert.equal(vancoAUC2level({ C1: 30, t1: 2, C2: 10, t2: 2, tau: 12, tinf: 1 }), null, 't2<=t1 debería ser null');
});
test('W5 — arnés de evidencia: aceptación %, MDR % y comparación antes/después', async () => {
  const E = await import('../js/core/evidence.js');
  const r = E.buildEvidenceReport([], { intervenciones: { total: 20, aceptadas: 17 }, resistencia: { mdr: 3, total: 12 } });
  assert.equal(r.aceptacionPct, 85, 'aceptación %');
  assert.equal(r.mdrPct, 25, 'MDR %');
  assert.equal(r.pacientes, 0, 'pacientes');
  // v390: dotPer1000 debe ser el NÚMERO por1000, no el objeto {dot,diasPaciente,por1000} (que rendía "[object Object]").
  assert.ok(r.dotPer1000 === null || typeof r.dotPer1000 === 'number', 'dotPer1000 debe ser número, no objeto');
  const r2 = E.buildEvidenceReport([], {});
  assert.equal(r2.aceptacionPct, null, 'sin denominador → null');
  assert.equal(r2.mdrPct, null, 'sin aislamientos → null');
  assert.ok(r2.dotPer1000 === null || typeof r2.dotPer1000 === 'number', 'dotPer1000 (r2) debe ser número, no objeto');
  const cmp = E.compareEvidence({ dotPer1000: 800, mdrPct: 30, aceptacionPct: 70 }, { dotPer1000: 600, mdrPct: 24, aceptacionPct: 85 });
  assert.equal(cmp.dotPer1000.deltaPct, -25, 'delta DOT/1000');
  assert.equal(cmp.mdrPct.deltaPct, -20, 'delta MDR%');
  // end-to-end: dos reportes REALES alimentan compareEvidence sin romper (delta numérico o null, nunca objeto/NaN).
  const cmpReal = E.compareEvidence(r, r2);
  assert.ok(cmpReal && (cmpReal.dotPer1000.deltaPct === null || typeof cmpReal.dotPer1000.deltaPct === 'number'), 'compareEvidence sobre reportes reales debe dar delta numérico o null');
});
test('CENSO v387: traspaso de mes — _mesAnterior + _pacsParaTraer (solo activos, sin duplicar) + auto-traspaso protegido', () => {
  // El equipo reportó "se borran los datos al cambiar de mes". No se borran (se guardan por mes); faltaba el
  // traspaso de pacientes AÚN hospitalizados al mes nuevo. Se verifica la lógica REAL extraída de index.html.
  const mMes = _idx.match(/function _mesAnterior\(mes\)\{[^{}]*\}/);
  const mPar = _idx.match(/function _pacsParaTraer\(prevPacs,existingIds\)\{[^{}]*\}/);
  assert.ok(mMes && mPar, 'no se hallaron las funciones de traspaso');
  const _mesAnterior = eval('(' + mMes[0] + ')');
  const _pacsParaTraer = eval('(' + mPar[0] + ')');
  assert.equal(_mesAnterior('2026-07'), '2026-06', 'jul→jun');
  assert.equal(_mesAnterior('2026-01'), '2025-12', 'ene→dic del año previo');
  const r = _pacsParaTraer([{ id:'a', alta:false }, { id:'b', alta:true }, { id:'c' }], new Set(['c']));
  assert.ok(r.length === 1 && r[0].id === 'a', 'debe traer solo el activo que no existe (no altas, no duplicados)');
  assert.equal(_pacsParaTraer([{ id:'x', alta:false }, { id:'y', alta:false }], new Set()).length, 2, 'mes destino vacío trae todos los activos');
  // Salvaguardas del auto-traspaso + botón + que nada se borra al cambiar de mes.
  assert.ok(_idx.includes('window._traerMesAnterior=async') && _idx.includes('function _maybeAutoCarry'), 'falta el motor de traspaso');
  assert.ok(_idx.includes('currentMonth!==_mesLive()') && _idx.includes('snap.size>0'), 'el auto-traspaso no está protegido (solo mes actual en curso + censo vacío)');
  assert.ok(_idx.includes('Traer del mes anterior'), 'falta el botón manual de traspaso');
});
