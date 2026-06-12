# StewardMX — Guía para Claude

Aplicación PROA hospitalaria. SPA en vanilla JS + Firebase Firestore + Anthropic API.
Archivo principal: `index.html` (~29 000 líneas). Service Worker: `sw.js`.
Deploy: `firebase deploy --only hosting` → https://stewardmx-1.web.app

---

## Errores ya cometidos — no repetir

### 1. WhatsApp: `s.antibiotico` puede contener TODOS los ATBs concatenados
`p.atb` en Firestore se guarda como `atbList.map(a=>a.nombre+dosis+via).join(' + ')` (ver línea ~7349).
Si el doctor abre la solicitud desde la ficha del paciente, ese string termina en `s.antibiotico`.
El campo también puede contener el placeholder literal `"OTRO (escribir nombre y dosis)"`.

**Regla:** Antes de poner `s.antibiotico` en cualquier mensaje WA, limpiarlo con este patrón:
```js
const _atbLimpio=(()=>{
  const a=(s.antibiotico||'').trim();
  if(!a||/^otro.*escribir/i.test(a)||/escribir nombre/i.test(a)){
    return (s.dosis||'').split(/\s*[\+\n]\s*/)[0].trim().slice(0,60)||'ATB personalizado';
  }
  if(a.includes('+'))return a.split('+')[0].trim().slice(0,60);
  return a;
})();
```

---

### 2. Cama en solicitudes es stale
`s.cama` se captura cuando se crea la solicitud. Si el paciente cambia de cama después, el WA muestra el número viejo.

**Regla:** Siempre resolver la cama actual desde `PACS` antes de usarla en mensajes:
```js
const _pac=PACS.find(x=>x.id===s.patientId||x.id===s.pacienteId);
const _cama=_pac?.cama||s.cama||'—';
const _svc=_pac?.servicio||s.servicio||'—';
```
Aplica en: `_waTransicion`, `confirmarRevision`, cualquier popup de notificación WA.

---

### 3. No prefill `sol2-dosis` con `p.atb`
`p.atb` es el string concatenado de todos los ATBs del paciente, NO la dosis de un ATB específico.
En `abrirSolicitudDesdeDetalle`, el campo dosis debe quedar vacío (`value=""`).

---

### 4. Script externo vs módulo principal (v198) — matizado en v295
Si se agrega código en un `<script>` regular **separado**, NO tiene acceso a `PACS`, `HOSP`, `db`, `doc`, `collection`, `getDocs`, etc. El error es `"Can't find variable: PACS"`.

**Regla:** Todo código que toque estado/DOM/Firebase (`PACS`, `HOSP`, `db`, `SOLICITUDES`, `document`, …) va dentro del módulo principal. **Nunca agregar un `<script>` extra.**

**EXCEPCIÓN (v295, des-monolitización):** funciones **puras y sin estado** (matemática/estadística determinista, sin tocar PACS/HOSP/db/DOM) SÍ pueden vivir en módulos ESM bajo `js/core/*.js` e importarse con `import {...} from './js/core/xxx.js'` al inicio del módulo principal. Esto NO es el error de arriba: un `<script>` separado no comparte scope, pero un `import` ESM SÍ crea binding de módulo. Patrón establecido en `js/core/stats.js` (Fisher, χ², MIC50/90, Cockcroft-Gault):
- Definir `export function` en `js/core/xxx.js`.
- `import {...}` + reexponer en `window.*` (para los `onclick`) al inicio del módulo.
- Las pruebas importan la función REAL (`tests/critical-flows.test.mjs`) — no un espejo.
- `js/core/*.js` debe añadirse a `SHELL` en `sw.js` (offline) — la invalidación es automática al subir `CACHE`.
- `tests/check-syntax.mjs` ya escanea `js/core/*.js` con `node --check`.

---

### 5. `window.open()` después de `await` es bloqueado por popup blockers
Patrón correcto para abrir WhatsApp / descargar archivos generados con await:
```js
// MAL — el await rompe el user gesture context
const blob = await generarDocumento();
window.open(url); // ← bloqueado

// BIEN — preparar URL, luego mostrar botón que el usuario clickea
const url = URL.createObjectURL(blob);
const btn = document.createElement('button');
btn.onclick = () => window.open(url);
document.body.appendChild(btn);
```

---

### 6. Edit button: siempre cerrarModal ANTES de abrir el editor
```js
// MAL
abrirEditar(pid);
cerrarModal();  // ← cierra el editor recién abierto

// BIEN
cerrarModal();
setTimeout(()=>abrirEditar(pid), 50);
```

---

### 7. Reserve ATB GATE: no bloquear ATBs ya prescritos (v201)
El GATE que pide justificación para ATBs Reserve debe verificar si el ATB ya estaba en `atbList` ANTES de la edición actual.
Usar `_prevAtbNames` Set construido de la versión anterior de `atbList`. Solo bloquear ATBs Reserve que son NUEVOS (no en el Set previo).

---

### 8. `calcDia` con `accion==='suspender'`
Si `p.accion==='suspender'`, calcDia debe retornar días hasta la fecha más reciente en `fechaFinIV` de atbList, no seguir contando.
```js
if(p.accion==='suspender'){
  const fines=p.atbList.map(a=>a.fechaFinIV).filter(Boolean);
  if(fines.length){ /* usar latest fin date */ }
}
```

---

### 9. `verAltas` busca en TODOS los meses
La función `verAltas()` debe buscar en los últimos 12 meses en paralelo, no solo en `currentMonth`.
```js
const monthsSnap=await getDocs(collection(db,'hospitals',HOSP,'months'));
const meses=monthsSnap.docs.map(d=>d.id).sort().reverse().slice(0,12);
await Promise.all(meses.map(async mes=>{
  const snap=await getDocs(query(collection(db,'hospitals',HOSP,'months',mes,'patients'),where('alta','==',true)));
  snap.docs.forEach(d=>allAltas.push({id:d.id,_mes:mes,...d.data()}));
}));
```

---

### 10. Modelo de Anthropic: siempre `claude-sonnet-4-6`
Cualquier referencia a `claude-sonnet-4-5` debe ser `claude-sonnet-4-6`.
Revisar: `llamarAnthropicSeguro`, dictado por voz, cualquier otra llamada a la API.

---

### 11. AbortError timeout: "160 s — verifica tu conexión"
El mensaje de timeout del AbortController es `160 s`, no `45 s`.

---

## Arquitectura rápida

| Concepto | Detalle |
|---|---|
| Pacientes del mes | `hospitals/{HOSP}/months/{currentMonth}/patients` |
| Solicitudes ATB | `hospitals/{HOSP}/antibiotic_requests` (colección global) |
| Bloqueos ATB | `hospitals/{HOSP}/bloqueos_atb` |
| Historial | `hospitals/{HOSP}/months/{currentMonth}/history` |
| Info hospital | `HInfo` (objeto en memoria, cargado de Firestore al init) |
| Pacientes en memoria | `PACS` (array, sincronizado por onSnapshot) |
| Solicitudes en memoria | `SOLICITUDES` (array, sincronizado por onSnapshot) |
| Usuario actual | `U` (Firebase Auth user) |
| Rol | `window._isAdmin`, `window._isPROA`, `window._isFarmaceutico`, etc. |

## Funciones clave

| Función | Qué hace |
|---|---|
| `_pacPath()` | Retorna array con ruta a la colección de pacientes del mes actual |
| `calcDia(p)` | Días de ATB activo (respeta suspensión) |
| `escHtml(s)` | Escapa HTML (usar SIEMPRE en innerHTML) |
| `escJs(s)` | Escapa para usar dentro de strings en atributos onclick |
| `proaLider()` | Nombre del líder PROA para firmar mensajes |
| `toast(msg, tipo)` | Notificación visual — tipos: `''`, `'am'` (amber), `'rd'` (red), `'tl'` |
| `abrirContenido(titulo, html)` | Abre el modal principal con contenido HTML |
| `cerrarModal()` | Cierra el modal principal |
| `buildCombobox(id, list, val)` | Combobox con autocompletado (usa DX_LIST para diagnósticos) |

## Versiones del Service Worker

Incrementar `CACHE = 'stewardmx-vXXX'` en `sw.js` con cada deploy que cambia lógica importante.
Documentar el cambio en el bloque de comentarios al inicio de `sw.js`.
Versión actual: **v310**

## Deploy

```bash
firebase deploy --only hosting
```

No hay paso de build — index.html se sirve directamente.
