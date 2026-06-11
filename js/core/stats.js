// ═══════════════════════════════════════════════════════════════════════════
//  StewardMX · js/core/stats.js — Núcleo estadístico/clínico PURO (sin estado, sin DOM)
//  Extraído de index.html (v295) — primer módulo del monolito hacia código testeable.
//  Cada función es determinista: mismas entradas → mismas salidas. NO toca PACS/HOSP/db/window.
//  · index.html lo importa y reexpone en window.* (para los onclick).
//  · tests/critical-flows.test.mjs lo importa DIRECTO → prueba la función REAL (no un espejo).
//  Estándares: Fisher exacto (CLSI/GLASS para n<30), χ² (Wilson-Hilferty), MIC50/90 (CLSI M39),
//  Cockcroft-Gault (ajuste de dosis ATB). Verificado vs R y cálculo manual.
// ═══════════════════════════════════════════════════════════════════════════

// ── χ² (tabla de contingencia 2×k) ──────────────────────────────────────────
// Devuelve { chi2, df, pValue, expected, observed, grandTotal }.
export function chiSquareTest(observed){
  const nRows=observed.length;
  if(!nRows)return {chi2:0,df:0,pValue:1,error:'Sin datos'};
  const nCols=observed[0].length;
  if(!nCols)return {chi2:0,df:0,pValue:1,error:'Sin columnas'};
  const rowTotals=observed.map(r=>r.reduce((s,v)=>s+v,0));
  const colTotals=Array(nCols).fill(0).map((_,c)=>observed.reduce((s,r)=>s+r[c],0));
  const grandTotal=rowTotals.reduce((s,v)=>s+v,0);
  if(grandTotal===0)return {chi2:0,df:0,pValue:1,error:'Total=0'};
  const expected=observed.map((r,i)=>r.map((_,c)=>(rowTotals[i]*colTotals[c])/grandTotal));
  let chi2=0;
  for(let i=0;i<nRows;i++){
    for(let c=0;c<nCols;c++){
      if(expected[i][c]>0){
        const diff=observed[i][c]-expected[i][c];
        chi2+=(diff*diff)/expected[i][c];
      }
    }
  }
  const df=(nRows-1)*(nCols-1);
  return {chi2:+chi2.toFixed(4),df,pValue:_chi2ToPvalue(chi2,df),expected,observed,grandTotal};
}

// p-value desde χ² y df (Wilson-Hilferty; suficientemente exacta para df≥1)
function _chi2ToPvalue(chi2,df){
  if(df===0||chi2<=0)return 1;
  const x=Math.pow(chi2/df,1/3);
  const a=1-2/(9*df);
  const b=Math.sqrt(2/(9*df));
  const z=(x-a)/b;
  const p=1-_normCDF(z);
  return +p.toFixed(6);
}
// CDF normal (Abramowitz & Stegun 26.2.17, error máx 7.5e-8)
function _normCDF(z){
  if(z<-6)return 0; if(z>6)return 1;
  const b1=0.319381530,b2=-0.356563782,b3=1.781477937,b4=-1.821255978,b5=1.330274429;
  const p=0.2316419;
  const c=1/Math.sqrt(2*Math.PI);
  const t=1/(1+p*Math.abs(z));
  const v=c*Math.exp(-z*z/2)*(b1*t+b2*t*t+b3*Math.pow(t,3)+b4*Math.pow(t,4)+b5*Math.pow(t,5));
  return z<0?v:1-v;
}

// ── Test EXACTO de Fisher 2×2 (Fase 0.5) — p-value exacto para tablas pequeñas ──
// Con log-factoriales (sin overflow) y bilateral por suma de tablas con prob ≤ la observada.
// Devuelve { p (bilateral), pLeft, pRight, n }.
function _logFactorial(n){ if(n<2)return 0; let s=0; for(let i=2;i<=n;i++)s+=Math.log(i); return s; }
function _logHyper2x2(a,b,c,d){
  const r1=a+b,r2=c+d,c1=a+c,c2=b+d,n=a+b+c+d;
  return _logFactorial(r1)+_logFactorial(r2)+_logFactorial(c1)+_logFactorial(c2)
        -_logFactorial(n)-_logFactorial(a)-_logFactorial(b)-_logFactorial(c)-_logFactorial(d);
}
export function fisherExact2x2(a,b,c,d){
  a=Math.max(0,Math.round(a));b=Math.max(0,Math.round(b));c=Math.max(0,Math.round(c));d=Math.max(0,Math.round(d));
  const n=a+b+c+d;
  if(n===0)return {p:1,pLeft:1,pRight:1,n:0,error:'Total=0'};
  const r1=a+b,c1=a+c;
  const pObs=Math.exp(_logHyper2x2(a,b,c,d));
  const aMin=Math.max(0,r1+c1-n),aMax=Math.min(r1,c1);
  let pTwo=0,pLeft=0,pRight=0; const EPS=1e-7;
  for(let x=aMin;x<=aMax;x++){
    const px=Math.exp(_logHyper2x2(x,r1-x,c1-x,n-r1-c1+x));
    if(px<=pObs*(1+EPS))pTwo+=px;
    if(x<=a)pLeft+=px;
    if(x>=a)pRight+=px;
  }
  return {p:Math.min(1,+pTwo.toFixed(6)),pLeft:Math.min(1,+pLeft.toFixed(6)),pRight:Math.min(1,+pRight.toFixed(6)),n};
}
// Selección automática del test 2×2 (CLSI/epi): n<30 o esperado<5 → Fisher exacto; si no → χ².
export function testAuto2x2(a,b,c,d){
  const n=a+b+c+d; if(!n)return {test:'—',p:1,n:0};
  const r1=a+b,r2=c+d,c1=a+c,c2=b+d;
  const minExp=Math.min(r1*c1,r1*c2,r2*c1,r2*c2)/n;
  if(n<30||minExp<5){const f=fisherExact2x2(a,b,c,d);return {test:'Fisher exacto',p:f.p,n,minExp:+minExp.toFixed(2)};}
  const ch=chiSquareTest([[a,b],[c,d]]);return {test:'χ²',p:ch.pValue,n,minExp:+minExp.toFixed(2)};
}

// ── MIC50 / MIC90 (Fase 0.4) — percentiles de CMI por método CLSI M39 ───────
// parseMICnum: convierte "16","<=0.12",">=32","0,25","≤4" a número (censuras → valor del límite).
export function parseMICnum(v){
  if(v==null)return null;
  let s=String(v).trim().replace(',','.').replace(/≤/g,'<=').replace(/≥/g,'>=');
  s=s.replace(/[<>]=?/g,'').trim();
  const n=parseFloat(s);
  return isFinite(n)?n:null;
}
// micStats: MIC50 = menor CMI con % acumulado ≥50; MIC90 = menor con ≥90 (nearest-rank, CLSI).
export function micStats(values){
  const nums=(values||[]).map(parseMICnum).filter(v=>v!=null).sort((a,b)=>a-b);
  const n=nums.length;
  if(!n)return {n:0,mic50:null,mic90:null};
  const at=q=>nums[Math.max(0,Math.min(n-1,Math.ceil(q*n)-1))];
  return {n,mic50:at(0.5),mic90:at(0.9)};
}

// ── Cockcroft-Gault (Fase 4.8) — aclaramiento de creatinina (mL/min) ────────
// CrCl = ((140 − edad) × peso × (0.85 si mujer)) / (72 × Cr). null si faltan datos. SIN redondear.
export function cockcroftGault(edad, peso, creat, sexo){
  edad=parseFloat(edad)||0; peso=parseFloat(peso)||0; creat=parseFloat(creat)||0;
  if(!edad||!peso||!creat||creat<=0)return null;
  const female=(String(sexo||'').toUpperCase()==='F');
  return ((140-edad)*peso*(female?0.85:1))/(72*creat);
}
