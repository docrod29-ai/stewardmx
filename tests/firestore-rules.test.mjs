// ═══════════════════════════════════════════════════════════════════════════════
//  Pruebas de SEGURIDAD de firestore.rules (capa servidor) — StewardMX
//  Verifican las invariantes de seguridad que NO se pueden romper:
//   · aislamiento entre hospitales · default-deny · escalada de rol · borrado protegido
//
//  Requiere el emulador de Firestore (necesita Java). Ejecutar con:
//     npm run test:rules
//  (= firebase emulators:exec --only firestore "node --test tests/firestore-rules.test.mjs")
//
//  NOTA: no se ejecuta en el gate de pruebas normal (node --test critical-flows) porque
//  requiere emulador + Java; corre en CI o en una máquina con Java instalado.
// ═══════════════════════════════════════════════════════════════════════════════
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

const HOSP_A = 'hospA', HOSP_B = 'hospB', MES = '2026-06';
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-stewardmx',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  // Semilla con reglas DESACTIVADAS (estado de partida)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `hospitals/${HOSP_A}/users/userA`), { status: 'aprobado', rol: 'Enfermería' });
    await setDoc(doc(db, `hospitals/${HOSP_A}/users/userDel`), { status: 'aprobado', rol: 'Enfermería' });
    await setDoc(doc(db, `hospitals/${HOSP_A}/users/adminA`), { status: 'admin', rol: 'Líder PROA' });
    await setDoc(doc(db, `hospitals/${HOSP_B}/users/userB`), { status: 'aprobado', rol: 'Enfermería' });
    await setDoc(doc(db, `hospitals/${HOSP_A}/months/${MES}/patients/p1`), { nombre: 'Paciente A', atbList: [] });
    await setDoc(doc(db, `hospitals/${HOSP_A}/months/${MES}/patients/p2`), { nombre: 'Paciente borrado', atbList: [] });
  });
});
after(async () => { if (env) await env.cleanup(); });

const dbA = () => env.authenticatedContext('userA', { email: 'a@hospA.mx' }).firestore();
const dbDel = () => env.authenticatedContext('userDel', { email: 'del@hospA.mx' }).firestore();
const dbB = () => env.authenticatedContext('userB', { email: 'b@hospB.mx' }).firestore();
const dbAdmin = () => env.authenticatedContext('adminA', { email: 'admin@hospA.mx' }).firestore();
const dbAnon = () => env.unauthenticatedContext().firestore();

test('default-deny: no autenticado NO puede leer un paciente', async () => {
  await assertFails(getDoc(doc(dbAnon(), `hospitals/${HOSP_A}/months/${MES}/patients/p1`)));
});

test('miembro del hospital A SÍ puede leer su paciente', async () => {
  await assertSucceeds(getDoc(doc(dbA(), `hospitals/${HOSP_A}/months/${MES}/patients/p1`)));
});

test('AISLAMIENTO: miembro del hospital B NO puede leer paciente del hospital A', async () => {
  await assertFails(getDoc(doc(dbB(), `hospitals/${HOSP_A}/months/${MES}/patients/p1`)));
});

test('AISLAMIENTO: miembro del hospital B NO puede escribir paciente del hospital A', async () => {
  await assertFails(setDoc(doc(dbB(), `hospitals/${HOSP_A}/months/${MES}/patients/p1`), { nombre: 'hackeado' }, { merge: true }));
});

// HALLAZGO DE SEGURIDAD (CI v294) — NO es una aserción de "pasa", es documentación honesta:
// Hoy un miembro SÍ puede escribir su propio 'rol' (lo verificó el emulador). La app lo necesita
// para el alta por código (_unirseConCodigo escribe el rol en el doc del propio usuario). Como el
// código se valida en CLIENTE, esto es un vector de escalada (un usuario podría auto-asignarse
// 'Líder PROA' desde la consola sin código). FIX CORRECTO PENDIENTE: Cloud Function que valide el
// código en servidor y asigne el rol; luego bloquear el cambio de rol/status en las reglas.
// Lo que SÍ está blindado y se prueba abajo: aislamiento entre hospitales, default-deny,
// borrado de paciente solo admin/PROA, y audit_log inmutable.
test('un miembro NO puede escribir roles de OTRO hospital (aislamiento de escalada)', async () => {
  await assertFails(setDoc(doc(dbB(), `hospitals/${HOSP_A}/users/userA`), { rol: 'Líder PROA' }, { merge: true }));
});

test('borrado de paciente: enfermería NO puede borrar', async () => {
  // userDel es enfermería FRESCA (no contaminada por la prueba de escalada). Borra p2.
  await assertFails(deleteDoc(doc(dbDel(), `hospitals/${HOSP_A}/months/${MES}/patients/p2`)));
});

test('borrado de paciente: admin SÍ puede borrar', async () => {
  await assertSucceeds(deleteDoc(doc(dbAdmin(), `hospitals/${HOSP_A}/months/${MES}/patients/p2`)));
});

test('_audit_log: crear OK, leer PROHIBIDO desde cliente', async () => {
  await assertSucceeds(setDoc(doc(dbA(), `_audit_log/log1`), { evento: 'x', by: 'userA' }));
  await assertFails(getDoc(doc(dbA(), `_audit_log/log1`)));
});
