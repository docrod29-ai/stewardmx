// Auditoría v2 — extrae el módulo por límites de línea reales (L37..L30719)
// y analiza TODO el JS (el v1 cortaba antes por un </script> en un string).
import { readFileSync } from 'node:fs';
const html = readFileSync('index.html', 'utf-8');
const all = html.split('\n');
// localizar apertura módulo y cierre real
let open=-1, close=-1;
for(let i=0;i<all.length;i++){ if(open<0 && all[i].trim()==='<script type="module">'){open=i;} else if(open>=0 && all[i].trim()==='</script>'){close=i;break;} }
const code = all.slice(open+1, close).join('\n');
const L = code.split('\n');
const base = open+2; // nº de línea real en index.html del índice 0 de L

const RED='\x1b[31m',YEL='\x1b[33m',CYN='\x1b[36m',GRN='\x1b[32m',DIM='\x1b[2m',R='\x1b[0m';
const hdr=t=>console.log('\n'+CYN+'━━ '+t+' '+'━'.repeat(Math.max(0,58-t.length))+R);
const realLn = idx => base+idx;

// universo de identificadores definidos
const defined=new Set();
for(const m of code.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for(const m of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
for(const m of code.matchAll(/(?:^|\n|;)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);

/* 1. DUPLICADOS REALES: solo `function NAME(` y `window.NAME=` a nivel de sentencia */
hdr('1. DEFINICIONES DUPLICADAS REALES');
const defLines={};
L.forEach((ln,i)=>{
  let m=ln.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if(m)(defLines[m[1]]=defLines[m[1]]||[]).push(realLn(i));
  m=ln.match(/^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\(?[\w$,\s]*\)?\s*=>)/);
  if(m)(defLines[m[1]]=defLines[m[1]]||[]).push(realLn(i));
});
const realDups=Object.entries(defLines).filter(([,a])=>a.length>1);
if(!realDups.length)console.log(GRN+'  ✓ ninguna'+R);
realDups.forEach(([n,ls])=>console.log(RED+'  ✗ '+n+R+' ×'+ls.length+DIM+' → L'+ls.join(', L')+R));

/* 2. HANDLERS rotos (con universo completo) */
hdr('2. HANDLERS on*= → función inexistente');
const browser=new Set(['if','for','while','switch','return','function','catch','setTimeout','setInterval','requestAnimationFrame','JSON','Math','Array','Object','String','Number','parseInt','parseFloat','document','window','console','event','this','alert','confirm','prompt','encodeURIComponent','decodeURIComponent','Date','Boolean','navigator','location','matchMedia','print','getElementById','querySelector','querySelectorAll','getComputedStyle','URL','Blob','FileReader','Set','Map','Promise','fetch','isNaN','isFinite']);
const called=new Map();
for(const m of html.matchAll(/\son(?:click|change|input|submit|keyup|keydown|mouseenter|mouseleave|focus|blur)\s*=\s*"([^"]*)"/g)){
  for(const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)){
    const inStyleCtx=/(?:var|rgba|rgb|calc|translate|scale|hsl)$/.test(c[1]);
    if(!called.has(c[1])) called.set(c[1], m[1].slice(0,60));
  }
}
const broken=[...called].filter(([n])=>!defined.has(n)&&!browser.has(n)&&!['var','rgba','rgb','calc','translate','scale','hsl','then','catch','matches','reload'].includes(n));
console.log(DIM+'  ('+called.size+' nombres únicos llamados en handlers)'+R);
if(!broken.length)console.log(GRN+'  ✓ todos resuelven'+R);
broken.forEach(([n,ex])=>console.log(RED+'  ✗ '+n+'()'+R+DIM+'  ej: '+ex+R));

/* 3. window.X llamadas que nunca se definen (typos en cross-calls) */
hdr('3. window.X() LLAMADAS PERO NUNCA DEFINIDAS');
const winCalled=new Set();
for(const m of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*\(/g)) winCalled.add(m[1]);
const winMissing=[...winCalled].filter(n=>!defined.has(n));
if(!winMissing.length)console.log(GRN+'  ✓ todas las window.X() están definidas'+R);
winMissing.sort().forEach(n=>console.log(YEL+'  ⚠ window.'+n+'()'+R));

/* 4. Funciones definidas y NUNCA usadas (código muerto candidato) */
hdr('4. POSIBLE CÓDIGO MUERTO (función definida, 0 referencias)');
const funcDefs=[...code.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]);
const winDefs=[...code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m=>m[1]);
const dead=[];
[...new Set([...funcDefs,...winDefs])].forEach(n=>{
  if(n.length<3)return;
  // contar usos como llamada o referencia (excluye la definición)
  const callRe=new RegExp('(?<![\\w$.])'+n.replace(/[$]/g,'\\$')+'\\s*\\(','g');
  const winRefRe=new RegExp('window\\.'+n.replace(/[$]/g,'\\$')+'\\b','g');
  const onRe=new RegExp('on\\w+="[^"]*'+n.replace(/[$]/g,'\\$')+'\\b');
  const calls=(code.match(callRe)||[]).length;
  const winRefs=(html.match(winRefRe)||[]).length;
  const inHandler=onRe.test(html);
  // definición misma cuenta como 1 en winRefs (window.x=) → restar
  if(calls<=0 && winRefs<=1 && !inHandler) dead.push(n);
});
if(!dead.length)console.log(GRN+'  ✓ sin código muerto evidente'+R);
else{console.log(DIM+'  ('+dead.length+' candidatos — revisar, algunos pueden ser entrypoints):'+R);dead.slice(0,40).forEach(n=>console.log(YEL+'  • '+n+R));}

/* 5. SALUD */
hdr('5. RESUMEN');
console.log('  Líneas JS del módulo: '+L.length+DIM+'  (L'+(open+2)+'–L'+close+')'+R);
console.log('  Duplicados reales:    '+(realDups.length?RED+realDups.length+R:GRN+'0'+R));
console.log('  Handlers rotos:       '+(broken.length?RED+broken.length+R:GRN+'0'+R));
console.log('  window.X sin definir: '+(winMissing.length?YEL+winMissing.length+R:GRN+'0'+R));
console.log('  Código muerto cand.:  '+(dead.length?YEL+dead.length+R:GRN+'0'+R));
