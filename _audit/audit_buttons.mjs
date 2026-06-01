// Auditoría determinista de botones/handlers de StewardMX.
// Verifica que CADA onclick/onchange/etc. apunte a una función realmente accesible.
// En un <script type="module">, las funciones SOLO son llamables desde HTML si están
// asignadas a window.* (las `function X(){}` de módulo NO son globales).
import fs from 'fs';
const FILE='/Users/davidrdz/Desktop/PROA/stewardmx/index.html';
const src=fs.readFileSync(FILE,'utf8');

// ── 1) Nombres asignados a window (lo único llamable desde onclick) ──
const winNames=new Set();
for(const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g))winNames.add(m[1]);
for(const m of src.matchAll(/window\[['"]([A-Za-z_$][\w$]*)['"]\]\s*=/g))winNames.add(m[1]);

// ── 2) Funciones de módulo (NO globales salvo que haya bridge) ──
const moduleFns=new Set();
for(const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g))moduleFns.add(m[1]);
for(const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/g))moduleFns.add(m[1]);

// ── 3) Handlers en HTML (dentro de strings JS; comillas escapadas o no) ──
const EVT='click|change|input|submit|keyup|keydown|keypress|focus|blur|mouseover|mouseout|mousedown|mouseup|dblclick|paste|wheel|toggle';
const reqd=new Map(); // fn -> count   (onclick="fn(")
const reqdWin=new Map(); // fn -> count (onclick="window.fn(")
const reqRe=new RegExp('on(?:'+EVT+')\\s*=\\s*\\\\?["\']\\s*([A-Za-z_$][\\w$]*)\\s*\\(','g');
const reqWinRe=new RegExp('on(?:'+EVT+')\\s*=\\s*\\\\?["\']\\s*window\\.([A-Za-z_$][\\w$]*)\\s*\\(','g');
for(const m of src.matchAll(reqRe))reqd.set(m[1],(reqd.get(m[1])||0)+1);
for(const m of src.matchAll(reqWinRe))reqdWin.set(m[1],(reqdWin.get(m[1])||0)+1);

// Builtins / palabras que NO son funciones de la app
const builtins=new Set(['alert','confirm','prompt','print','open','reload','history','location','event','console','window','document','setTimeout','setInterval','clearTimeout','requestAnimationFrame','this','return','if','for','while','navigator','parseInt','parseFloat','JSON','Math','Array','Object','String','Number','Boolean','Date','localStorage','sessionStorage','fetch']);

// ── 4) Clasificar ──
const MISSING=[];     // ni window ni módulo → botón muerto seguro
const SUSPECT=[];     // solo módulo, NO window → probablemente muerto (scope de módulo)
for(const [name,count] of reqd){
  if(builtins.has(name))continue;
  if(winNames.has(name))continue;            // OK: global
  if(moduleFns.has(name))SUSPECT.push({name,count});
  else MISSING.push({name,count});
}
for(const [name,count] of reqdWin){
  if(winNames.has(name))continue;
  MISSING.push({name:'window.'+name,count});
}

// ── 5) Definiciones duplicadas window.X=function (la última gana → posible bug) ──
const dupCount={};
for(const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function/g))dupCount[m[1]]=(dupCount[m[1]]||0)+1;
const DUPS=Object.entries(dupCount).filter(([,c])=>c>1).sort((a,b)=>b[1]-a[1]);

// ── salida ──
let out='════ AUDITORÍA DE BOTONES / HANDLERS ════\n';
out+=`window.* asignados: ${winNames.size} · funciones de módulo: ${moduleFns.size}\n`;
out+=`handlers distintos (plain): ${reqd.size} · (window.X): ${reqdWin.size}\n\n`;
out+=`╔═ BOTONES MUERTOS — función NO existe en ningún lado [${MISSING.length}]\n`;
MISSING.sort((a,b)=>b.count-a.count).forEach(m=>out+=`   ✗ ${m.name}  (usado ×${m.count})\n`);
out+=`\n╔═ SOSPECHOSOS — función existe pero NO en window (scope módulo, probablemente muerto) [${SUSPECT.length}]\n`;
SUSPECT.sort((a,b)=>b.count-a.count).forEach(m=>out+=`   ⚠ ${m.name}  (usado ×${m.count})\n`);
out+=`\n╔═ window.X=function DUPLICADOS (última gana) [${DUPS.length}]\n`;
DUPS.forEach(([n,c])=>out+=`   ⚠ ${n}  ×${c}\n`);

fs.writeFileSync('/tmp/audit_buttons.txt',out);
console.log('AUDIT_DONE missing='+MISSING.length+' suspect='+SUSPECT.length+' dups='+DUPS.length);
