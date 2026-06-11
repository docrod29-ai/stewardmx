// Verifica la SINTAXIS del módulo principal de index.html + sw.js (sin ejecutarlos).
// Extrae el único <script type="module">, neutraliza imports estáticos / import.meta y
// corre `node --check`. Falla (exit 1) si hay un error de sintaxis. Usado por `npm run check`
// y por el gate de CI antes de desplegar.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const html = readFileSync('index.html', 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('✗ No se encontró <script type="module"> en index.html'); process.exit(1); }
const code = m[1].replace(/^\s*import[^;]*;/gm, '').replace(/import\.meta/g, '({})');
writeFileSync('/tmp/_mod_check.mjs', code);

// Módulos extraídos del monolito (js/core/*.js): se checan tal cual (son ESM reales).
const coreMods = existsSync('js/core')
  ? readdirSync('js/core').filter(f => f.endsWith('.js')).map(f => 'js/core/' + f)
  : [];

try {
  execSync('node --check /tmp/_mod_check.mjs', { stdio: 'inherit' });
  execSync('node --check sw.js', { stdio: 'inherit' });
  for (const mod of coreMods) execSync('node --check ' + mod, { stdio: 'inherit' });
  console.log('✓ Sintaxis OK (módulo de index.html + sw.js' + (coreMods.length ? ' + ' + coreMods.length + ' módulo(s) js/core' : '') + ')');
} catch (e) {
  console.error('✗ Error de sintaxis');
  process.exit(1);
}
