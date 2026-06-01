// StewardMX — Auditoría estática del módulo principal.
// Extrae el <script type="module"> de index.html y busca bugs reales.
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf-8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('NO_MODULE'); process.exit(1); }
const code = m[1];
const lines = code.split('\n');
const htmlLines = html.split('\n');

const RESET='\x1b[0m', RED='\x1b[31m', YEL='\x1b[33m', CYN='\x1b[36m', GRN='\x1b[32m', DIM='\x1b[2m';
function hdr(t){ console.log('\n'+CYN+'━━━ '+t+' '+'━'.repeat(Math.max(0,60-t.length))+RESET); }

/* ───────── 1. Definiciones globales duplicadas (clobbering) ───────── */
hdr('1. FUNCIONES/GLOBALES DUPLICADAS (la última pisa a la anterior)');
const defs = {}; // name -> [lineNo,...]
const defRe = /^\s*(?:window\.)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const winAssignRe = /^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|pid\s*=>|\([^)]*\)=>)/;
lines.forEach((ln, i) => {
  let mm = ln.match(defRe);
  if (mm) { (defs[mm[1]] = defs[mm[1]] || []).push(i+1); }
  mm = ln.match(winAssignRe);
  if (mm) { (defs[mm[1]] = defs[mm[1]] || []).push(i+1); }
});
const dups = Object.entries(defs).filter(([n,ls]) => ls.length > 1);
if (!dups.length) console.log(GRN+'  ✓ sin definiciones duplicadas detectadas'+RESET);
dups.sort((a,b)=>b[1].length-a[1].length).forEach(([n,ls]) => {
  console.log(RED+'  ✗ '+n+RESET+'  ×'+ls.length+DIM+'  líneas '+ls.join(', ')+RESET);
});

/* ───────── 2. onclick/onchange → función inexistente ───────── */
hdr('2. HANDLERS onclick/onchange QUE LLAMAN FUNCIONES INEXISTENTES');
// universo de nombres definidos (window.x, function x, const x=, let x=, var x=)
const defined = new Set(Object.keys(defs));
const declRe = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
lines.forEach(ln => { const d = ln.match(declRe); if (d) defined.add(d[1]); });
// también nombres asignados como window.x dentro de cualquier parte
for (const mm of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(mm[1]);
for (const mm of code.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(mm[1]);

// recolecta llamadas dentro de atributos on*="..."
const handlerCallRe = /on(?:click|change|input|submit|keyup|keydown|mouseenter|mouseleave)\s*=\s*"([^"]*)"/g;
const calledNames = new Map(); // name -> example
let totalHandlers=0;
for (const mm of html.matchAll(handlerCallRe)) {
  const body = mm[1];
  totalHandlers++;
  for (const c of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = c[1];
    if (['if','for','while','switch','return','function','catch','setTimeout','setInterval','JSON','Math','Array','Object','String','Number','parseInt','parseFloat','document','window','console','event','this','alert','confirm','prompt','encodeURIComponent','decodeURIComponent','Date','Boolean'].includes(name)) continue;
    if (!calledNames.has(name)) calledNames.set(name, body.slice(0,70));
  }
}
// Funciones del navegador comunes que sí existen
const browserGlobals = new Set(['getElementById','querySelector','querySelectorAll','remove','focus','blur','classList','toggle','add','contains','stopPropagation','preventDefault','reload','open','toLocaleString','toFixed','push','join','map','filter','forEach','slice','split','replace','test','match','toLowerCase','toUpperCase','trim','includes','find','indexOf','keys','values','entries','assign','stringify','parse','from','now','setProperty','removeProperty','appendChild','removeChild','createElement','setItem','getItem','removeItem','writeText','click','select','scrollIntoView','dispatchEvent','addEventListener','removeEventListener','getAttribute','setAttribute','closest','getTime','toISOString','reduce','some','every','sort','concat','padStart','padEnd','round','max','min','abs','floor','ceil','random','isArray','isNaN','startsWith','endsWith']);
const missing = [];
for (const [name, ex] of calledNames) {
  if (defined.has(name)) continue;
  if (browserGlobals.has(name)) continue;
  if (typeof globalThis[name] === 'function') continue;
  missing.push([name, ex]);
}
console.log(DIM+'  (se inspeccionaron '+totalHandlers+' atributos on*=, '+calledNames.size+' nombres llamados)'+RESET);
if (!missing.length) console.log(GRN+'  ✓ todos los handlers resuelven a una función definida'+RESET);
missing.sort().forEach(([n,ex]) => console.log(RED+'  ✗ '+n+'(…)'+RESET+DIM+'   ej: '+ex+'…'+RESET));

/* ───────── 3. Reglas de CLAUDE.md ───────── */
hdr('3. REGLAS CRÍTICAS DE CLAUDE.md');
const checks = [];
// R10: modelo siempre claude-sonnet-4-6
const wrong45 = [...code.matchAll(/claude-sonnet-4-5/g)].length;
checks.push([wrong45===0, 'Modelo: sin referencias a claude-sonnet-4-5 (debe ser 4-6)', wrong45+' encontradas']);
// R4: ¿algún <script> regular extra fuera del módulo?
const scriptTags = [...html.matchAll(/<script(\s[^>]*)?>/g)].map(s=>s[0]);
const nonModule = scriptTags.filter(s=>!/type="module"/.test(s) && !/src=/.test(s));
checks.push([nonModule.length===0, 'Sin <script> inline extra fuera del módulo', nonModule.length+' inline: '+nonModule.join(' ')]);
// R11: timeout 160 s
const has160 = /160\s*s/.test(code) || /160000/.test(code);
checks.push([has160, 'Timeout AbortController documentado en 160 s', has160?'ok':'no encontrado']);
// SUPER_ADMIN hardcode
const saCount=[...code.matchAll(/docrod29@gmail\.com/g)].length;
checks.push([true, 'SUPER_ADMIN hardcodeado (informativo)', saCount+' apariciones']);
checks.forEach(([ok,desc,info]) => console.log((ok?GRN+'  ✓ ':RED+'  ✗ ')+desc+RESET+DIM+'  ['+info+']'+RESET));

/* ───────── 4. Posibles fugas: addEventListener sin remove, console.log ───────── */
hdr('4. HIGIENE DE CÓDIGO');
const consoleLogs = [...code.matchAll(/console\.log\(/g)].length;
const consoleWarn = [...code.matchAll(/console\.(warn|error)\(/g)].length;
console.log(DIM+'  console.log: '+consoleLogs+' · console.warn/error: '+consoleWarn+RESET);
const innerHTMLnoEsc = [];
// onclick que arma con + p.nombre sin escJs (heurístico simple)
let tabsHard=0;
for (const mm of code.matchAll(/onclick="[^"]*'\s*\+\s*p\.(nombre|dx|atb)\s*\+/g)) tabsHard++;
if (tabsHard) console.log(YEL+'  ⚠ '+tabsHard+' onclick concatenan p.nombre/dx/atb directo — revisar escJs (XSS/comillas)'+RESET);
else console.log(GRN+'  ✓ no se detectaron onclick con concatenación cruda obvia'+RESET);

/* ───────── 5. TODOs / FIXMEs / parches ───────── */
hdr('5. TODO / FIXME / HACK / parches pendientes');
let todos=0;
lines.forEach((ln,i)=>{ if(/\b(TODO|FIXME|HACK|XXX|BUG)\b/.test(ln)){todos++; if(todos<=15) console.log(YEL+'  L'+(i+1)+': '+ln.trim().slice(0,90)+RESET);} });
if(!todos) console.log(GRN+'  ✓ sin marcadores TODO/FIXME'+RESET);
else console.log(DIM+'  total: '+todos+RESET);

console.log('\n'+CYN+'━━━ RESUMEN '+'━'.repeat(54)+RESET);
console.log('  Definiciones duplicadas: '+(dups.length?RED+dups.length+RESET:GRN+'0'+RESET));
console.log('  Handlers rotos:          '+(missing.length?RED+missing.length+RESET:GRN+'0'+RESET));
console.log('  Reglas CLAUDE.md fallidas:'+(checks.filter(c=>!c[0]).length?RED+checks.filter(c=>!c[0]).length+RESET:GRN+'0'+RESET));
console.log('  Líneas del módulo:        '+lines.length);
