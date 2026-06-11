// ═══════════════════════════════════════════════════════════════════════════
//  StewardMX · js/core/clinical-days.js — Días de terapia / estancia / DOT (PURO, sin estado)
//  2º módulo extraído del monolito (v296). Determinista: mismas entradas → mismas salidas.
//  NO toca PACS/HOSP/db/DOM. index.html lo importa y reexpone en window.* (onclick + IAAS).
//  Las pruebas importan la función REAL (tests/critical-flows.test.mjs).
//  Estándar: conteo inclusivo (día 1 = día de inicio); DOT/días-paciente = NHSN-AUR (CDC).
//  NOTA: calcDiasPaciente/dotPer1000 referencian a sus hermanas DIRECTO (no vía window) para que
//        el módulo sea autocontenido y testeable en Node. En el navegador el resultado es idéntico.
// ═══════════════════════════════════════════════════════════════════════════

// Interno: parsea 'YYYY-MM-DD' → Date local a medianoche (o null). Solo lo usa calcDiaATB.
function _parseFecha(f){
  if(!f||typeof f!=='string')return null;
  const d=new Date(f.slice(0,10)+'T00:00:00');
  return isNaN(d.getTime())?null:d;
}

// Días de terapia de UN antibiótico. Devuelve {dias, activo, inicio, fin}. Inclusivo, mín 1.
// FIX v297 (zona horaria): el corte `hoy` como string solo-fecha se parsea a medianoche LOCAL
// (igual que _parseFecha de las fechas de inicio). Antes `new Date('YYYY-MM-DD')` daba medianoche
// UTC → en zonas detrás de UTC (México) el DOT de ATB activos sub-contaba 1 día. Entradas Date
// no cambian (los tests usan Date con T12:00:00 → mismo resultado que antes).
export function calcDiaATB(a, hoy){
  let hoyLocal;
  if(hoy){
    hoyLocal=(typeof hoy==='string')?new Date(hoy.slice(0,10)+'T00:00:00'):new Date(hoy);
    if(isNaN(hoyLocal.getTime()))hoyLocal=new Date(); // guarda contra 'YYYY-MM' u otros inválidos
  }else hoyLocal=new Date();
  hoyLocal.setHours(0,0,0,0);
  const ini=_parseFecha(a&&(a.fechaInicioIV||a.inicio));
  if(!ini)return {dias:null, activo:!(a&&a.fechaFinIV), inicio:null, fin:null};
  const finRaw=a&&a.fechaFinIV?_parseFecha(a.fechaFinIV):null;
  const activo=!finRaw;
  // Día de corte: fin (si suspendido) o hoy (si activo). Nunca antes del inicio.
  let corte=finRaw||hoyLocal;
  if(corte<ini)corte=ini;
  const dias=Math.floor((corte.getTime()-ini.getTime())/86400000)+1;
  return {dias:Math.max(1,dias), activo, inicio:ini, fin:finRaw};
}

// Resumen legible "Día N" o "N días · suspendido" para mostrar junto a cada ATB.
export function diaATBLabel(a, hoy){
  const r=calcDiaATB(a, hoy);
  if(r.dias==null)return r.activo?'sin fecha de inicio':'suspendido';
  return r.activo?('Día '+r.dias):(r.dias+' día'+(r.dias!==1?'s':'')+' · suspendido');
}

// Día de terapia GLOBAL del paciente (ATB más antiguo). Respeta accion='suspender' (FIX v201):
// si está suspendido, cuenta hasta la fechaFinIV más reciente, no hasta hoy.
export function calcDia(p){
  const hoyLocal=new Date();hoyLocal.setHours(0,0,0,0);
  let fechaRef=null;
  let fechaFin=hoyLocal; // por defecto: hasta hoy
  if(p.accion==='suspender'){
    if(p.atbList&&p.atbList.length){
      const fines=p.atbList.map(a=>a.fechaFinIV).filter(Boolean);
      if(fines.length){
        const ultimaFin=fines.reduce((max,f)=>f>max?f:max);
        const dFin=new Date(ultimaFin+'T00:00:00');
        if(!isNaN(dFin.getTime())&&dFin<=hoyLocal)fechaFin=dFin;
      }
    }
  }
  if(p.atbList&&p.atbList.length){
    const fechasInicio=p.atbList.map(a=>a.fechaInicioIV).filter(Boolean);
    if(fechasInicio.length)fechaRef=fechasInicio.reduce((min,f)=>f<min?f:min);
    // Si TODOS los ATB con nombre están suspendidos, detener en la fechaFinIV más reciente.
    const conNombre=p.atbList.filter(a=>a.nombre&&a.nombre.trim());
    const activos=conNombre.filter(a=>!a.fechaFinIV||a.fechaFinIV.trim()==='');
    if(conNombre.length>0&&activos.length===0){
      const fines=p.atbList.map(a=>a.fechaFinIV).filter(Boolean);
      if(fines.length){
        const ultimaFin=fines.reduce((max,f)=>f>max?f:max);
        const dFin=new Date(ultimaFin+'T00:00:00');
        if(!isNaN(dFin.getTime())&&dFin<=hoyLocal)fechaFin=dFin;
      }
    }
  }
  if(!fechaRef)fechaRef=p.inicio; // fallback al campo clásico
  if(fechaRef){
    const inicio=new Date(fechaRef+'T00:00:00');
    const d=Math.floor((fechaFin.getTime()-inicio.getTime())/86400000)+1;
    if(d>0)return d;
  }
  return p.dia||1;
}

// Parsea string | Timestamp Firestore {seconds}/{toDate}/{toMillis} | Date → Date (o null).
// EXPORTADA: la usan calcDiasEstancia y el cálculo de días-dispositivo (IAAS) en index.html.
export function _fechaADate(v){
  if(!v)return null;
  if(typeof v==='string'){const d=new Date(v.length<=10?v+'T00:00:00':v);return isNaN(d.getTime())?null:d;}
  if(v.toDate)try{return v.toDate();}catch(_){}
  if(v.toMillis)try{return new Date(v.toMillis());}catch(_){}
  if(v.seconds!=null)return new Date(v.seconds*1000);
  if(v instanceof Date)return v;
  return null;
}

// Días de estancia de UN paciente: ingreso → (alta | corte), inclusivo, mín 1, sin pasar del corte.
export function calcDiasEstancia(p, hasta){
  const ini=_fechaADate(p&&p.ingreso); if(!ini)return 0;
  const corte=_fechaADate(hasta)||new Date();
  let fin=(p&&p.alta&&p.fechaAlta)?_fechaADate(p.fechaAlta):corte;
  if(!fin)fin=corte;
  if(fin>corte)fin=corte;
  const dias=Math.floor((fin.getTime()-ini.getTime())/86400000)+1;
  return dias>0?dias:(fin>=ini?1:0);
}

// Días-paciente del censo completo (denominador NHSN).
export function calcDiasPaciente(pacs, hasta){
  return (pacs||[]).reduce((s,p)=>s+calcDiasEstancia(p,hasta),0);
}

// DOT correcto (NHSN): Σ paciente, Σ antibiótico, de los días activos de ESE agente.
// Terapia combinada de 2 ATB × 5 días = 10 DOT (cada agente cuenta por separado).
export function calcDOT(pacs, hasta){
  const hoyISO=(typeof hasta==='string'?hasta:new Date().toISOString().slice(0,10));
  return (pacs||[]).reduce((s,p)=>{
    const items=(p&&Array.isArray(p.atbList)&&p.atbList.length)?p.atbList
      :(p&&p.atb?[{nombre:p.atb,fechaInicioIV:p.inicio,fechaFinIV:p.fechaFinIV}]:[]);
    return s+items.filter(a=>a&&a.nombre).reduce((ss,a)=>{const r=calcDiaATB(a,hoyISO);return ss+((r&&r.dias)?r.dias:0);},0);
  },0);
}

// DOT por 1000 días-paciente (NHSN-AUR). Devuelve {dot, diasPaciente, por1000}.
export function dotPer1000(pacs, hasta){
  const dot=calcDOT(pacs,hasta);
  const dp=calcDiasPaciente(pacs,hasta);
  return {dot, diasPaciente:dp, por1000: dp>0?+(dot/dp*1000).toFixed(1):0};
}
