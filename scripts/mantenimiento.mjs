#!/usr/bin/env node
// scripts/mantenimiento.mjs — Chequeo de salud READ-ONLY de StewardMX.
//
// No modifica NADA: solo corre verificaciones que detectan "drift" (deuda que se acumula con el
// tiempo) y reporta ✓/⚠/✗. Pensado para correr seguido — `npm run mantenimiento` — y desde la
// tarea agendada. Sale con código ≠0 solo si hay un fallo CRÍTICO, para que un humano lo note.
//
// Las pruebas del emulador (reglas + Cloud Function) NO se corren aquí (necesitan Java + Firebase
// y son lentas); el CI ya las ejecuta en cada push. Este chequeo es rápido y local.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import https from 'node:https';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OK = 'ok', WARN = 'warn', FAIL = 'fail';

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function fetchText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

// ── Verificaciones (cada una devuelve {status, detail}) ────────────────────────

function checkSyntax() {
  try { sh('node tests/check-syntax.mjs'); return { status: OK, detail: 'index.html + sw.js + js/core' }; }
  catch (e) { return { status: FAIL, detail: ((e.stdout || e.message) + '').trim().split('\n').pop() }; }
}

function checkTests() {
  try {
    const out = sh('node --test tests/critical-flows.test.mjs');
    const pass = (out.match(/(?:ℹ|#)\s*pass\s+(\d+)/) || [])[1] || '?';
    return { status: OK, detail: pass + ' pruebas en verde' };
  } catch (e) {
    const fail = ((e.stdout || '') + '').match(/(?:ℹ|#)\s*fail\s+(\d+)/);
    return { status: FAIL, detail: (fail ? fail[1] : '?') + ' prueba(s) fallando' };
  }
}

function checkModel() {
  // Regla #10 de CLAUDE.md: el modelo siempre debe ser claude-sonnet-4-6, nunca -4-5.
  const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const malo = (idx.match(/claude-sonnet-4-5(?!\d)/g) || []).length;
  if (malo) return { status: FAIL, detail: malo + ' ref. a claude-sonnet-4-5 (debe ser -4-6)' };
  return idx.includes('claude-sonnet-4-6')
    ? { status: OK, detail: 'claude-sonnet-4-6' }
    : { status: WARN, detail: 'no se halló claude-sonnet-4-6' };
}

function checkSecretos() {
  // Defensa en profundidad: ningún token de GitHub/clave de API en archivos RASTREADOS por git.
  // El patrón se arma en partes para que los prefijos de token de GitHub NO aparezcan literales en este
  // archivo (si no, este mismo script daría un falso positivo en cualquier grep/escáner de secretos).
  const gh = ['ghp', 'gho', 'ghs'].map(p => p + '_[A-Za-z0-9]{30,}').join('|');
  const pat = gh + '|sk-ant-[A-Za-z0-9_-]{20,}';
  try {
    const hits = sh('git grep -nIE "' + pat + '" -- . ":(exclude).env*" || true');
    const lines = hits.split('\n').filter(Boolean);
    return lines.length
      ? { status: FAIL, detail: 'posible secreto en ' + lines[0].split(':')[0] }
      : { status: OK, detail: 'sin tokens en archivos rastreados' };
  } catch { return { status: OK, detail: 'sin coincidencias' }; }
}

function checkSwVersion() {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const cache = (sw.match(/const CACHE\s*=\s*'stewardmx-v(\d+)'/) || [])[1];
  if (!cache) return { status: FAIL, detail: 'no se halló const CACHE' };
  const max = Math.max(0, ...[...sw.matchAll(/v(\d+)/g)].map(m => +m[1]));
  return (+cache >= max)
    ? { status: OK, detail: 'CACHE v' + cache + ' (la más alta)' }
    : { status: WARN, detail: 'CACHE v' + cache + ' pero hay v' + max + ' mencionada' };
}

function checkAudit() {
  // App estática: las deps de npm son herramientas dev (no se sirven al cliente) → informativo (máx WARN).
  let json;
  try { json = sh('npm audit --json 2>/dev/null'); }
  catch (e) { json = (e.stdout || '') + ''; }   // npm audit sale ≠0 si hay vulnerabilidades
  try {
    const v = JSON.parse(json).metadata?.vulnerabilities || {};
    const crit = v.critical || 0, high = v.high || 0;
    return (crit || high)
      ? { status: WARN, detail: crit + ' crít., ' + high + ' altas (dev, no se sirven) — `npm audit fix`' }
      : { status: OK, detail: '0 crít/altas (' + (v.total || 0) + ' total)' };
  } catch { return { status: WARN, detail: 'npm audit sin red o sin lockfile' }; }
}

function checkActions() {
  // ¿Las actions ancladas siguen siendo el major más reciente? (la deprecación de Node de GitHub).
  let yml;
  try { yml = sh('cat .github/workflows/ci.yml .github/workflows/deploy.yml'); }
  catch { return { status: WARN, detail: 'no se leyeron los workflows' }; }
  const pins = [...yml.matchAll(/actions\/([\w-]+)@v(\d+)/g)];
  const repos = [...new Set(pins.map(m => m[1]))];
  const atrasadas = []; let consultadas = 0;
  for (const repo of repos) {
    try {
      const latest = sh('gh api repos/actions/' + repo + '/releases/latest -q .tag_name 2>/dev/null').trim();
      const latestMajor = +((latest.match(/v(\d+)/) || [])[1]);
      if (!latestMajor) continue;
      consultadas++;
      const pinned = Math.min(...pins.filter(m => m[1] === repo).map(m => +m[2]));
      if (latestMajor > pinned) atrasadas.push(repo + ' v' + pinned + '→v' + latestMajor);
    } catch { /* gh sin red/credencial: se omite ese repo */ }
  }
  if (!consultadas) return { status: WARN, detail: 'no se pudo consultar (gh sin red/credencial)' };
  return atrasadas.length
    ? { status: WARN, detail: 'actualizar: ' + atrasadas.join(', ') }
    : { status: OK, detail: consultadas + '/' + repos.length + ' actions al día' };
}

async function checkProd() {
  try {
    const local = (readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/stewardmx-v(\d+)/) || [])[1];
    const prod = (((await fetchText('https://stewardmx-1.web.app/sw.js')).match(/stewardmx-v(\d+)/)) || [])[1];
    if (!prod) return { status: WARN, detail: 'prod no devolvió CACHE' };
    if (+prod < +local) return { status: WARN, detail: 'prod v' + prod + ' < local v' + local + ' (cambios sin desplegar)' };
    return { status: OK, detail: 'prod v' + prod };
  } catch (e) { return { status: WARN, detail: 'prod inalcanzable (' + e.message + ')' }; }
}

// ── Runner ──────────────────────────────────────────────────────────────────

const ICON = { ok: '✓', warn: '⚠', fail: '✗' };
const CHECKS = [
  ['Sintaxis (node --check)', checkSyntax],
  ['Pruebas críticas', checkTests],
  ['Modelo Anthropic (-4-6)', checkModel],
  ['Sin secretos rastreados', checkSecretos],
  ['Versión del Service Worker', checkSwVersion],
  ['Dependencias (npm audit)', checkAudit],
  ['GitHub Actions al día', checkActions],
  ['Producción desplegada', checkProd],
];

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
console.log('\n  StewardMX — Chequeo de mantenimiento   ' + stamp + ' UTC\n');
let fails = 0, warns = 0;
for (const [name, fn] of CHECKS) {
  let r;
  try { r = await fn(); } catch (e) { r = { status: FAIL, detail: e.message }; }
  if (r.status === FAIL) fails++;
  if (r.status === WARN) warns++;
  console.log('  ' + ICON[r.status] + ' ' + name.padEnd(30) + ' ' + (r.detail || ''));
}
const resumen = fails ? ('✗ ' + fails + ' fallo(s) crítico(s)') : warns ? ('⚠ ' + warns + ' aviso(s)') : '✓ Todo en orden';
console.log('\n  ' + resumen + (fails || warns ? ' — revisa arriba.' : '.') + '\n');
process.exit(fails ? 1 : 0);
