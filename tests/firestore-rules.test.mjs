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
    // v301: usuario PENDIENTE con rol privilegiado — NO debe tener acceso (status manda).
    await setDoc(doc(db, `hospitals/${HOSP_A}/users/pendProa`), { status: 'pendiente', rol: 'PROA' });
    await setDoc(doc(db, `hospitals/${HOSP_B}/users/userB`), { status: 'aprobado', rol: 'Enfermería' });
    // v301: registro central que nombra a 'founderC' como admin de hospC (para la prueba de fundador).
    await setDoc(doc(db, `hospitals_registry/hospC`), { adminUid: 'founderC', nombre: 'Hospital C' });
    await setDoc(doc(db, `hospitals/${HOSP_A}/months/${MES}/patients/p1`), { nombre: 'Paciente A', atbList: [] });
    await setDoc(doc(db, `hospitals/${HOSP_A}/months/${MES}/patients/p2`), { nombre: 'Paciente borrado', atbList: [] });
    // v391: laboratorios firmado (inmutable) vs no firmado (corregible) + solicitudes en estado terminal.
    await setDoc(doc(db, `hospitals/${HOSP_A}/patients/pp/labs/labSigned`), { valor: '1.2', firmado: true });
    await setDoc(doc(db, `hospitals/${HOSP_A}/patients/pp/labs/labUnsigned`), { valor: '3.4', firmado: false });
    await setDoc(doc(db, `hospitals/${HOSP_A}/antibiotic_requests/reqDenied`), { status: 'denegado', atb: 'Meropenem' });
    await setDoc(doc(db, `hospitals/${HOSP_A}/antibiotic_requests/reqPending`), { status: 'pendiente', atb: 'Meropenem' });
  });
});
after(async () => { if (env) await env.cleanup(); });

const dbA = () => env.authenticatedContext('userA', { email: 'a@hospA.mx' }).firestore();
const dbDel = () => env.authenticatedContext('userDel', { email: 'del@hospA.mx' }).firestore();
const dbB = () => env.authenticatedContext('userB', { email: 'b@hospB.mx' }).firestore();
const dbAdmin = () => env.authenticatedContext('adminA', { email: 'admin@hospA.mx' }).firestore();
const dbPendProa = () => env.authenticatedContext('pendProa', { email: 'pp@hospA.mx' }).firestore();
const dbFounderC = () => env.authenticatedContext('founderC', { email: 'f@hospC.mx' }).firestore();
const dbNew = (uid) => env.authenticatedContext(uid, { email: uid + '@x.mx' }).firestore();
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

// ── ESCALADA DE ROL/STATUS — CERRADA en v301 ───────────────────────────────────
// El rol auto-aprobado por código lo asigna la Cloud Function joinWithCode (Admin SDK, ignora
// reglas). El cliente ya NO puede auto-asignarse rol/status privilegiado. Se verifica aquí:
test('un miembro NO puede escribir roles de OTRO hospital (aislamiento)', async () => {
  await assertFails(setDoc(doc(dbB(), `hospitals/${HOSP_A}/users/userA`), { rol: 'Líder PROA' }, { merge: true }));
});
test('ESCALADA: auto-crearse PENDIENTE sí se permite (alta normal → admin aprueba)', async () => {
  await assertSucceeds(setDoc(doc(dbNew('newPend'), `hospitals/${HOSP_A}/users/newPend`), { uid: 'newPend', status: 'pendiente', rol: 'PROA' }));
});
test('ESCALADA: auto-crearse APROBADO → DENEGADO (solo joinWithCode en servidor)', async () => {
  await assertFails(setDoc(doc(dbNew('newApr'), `hospitals/${HOSP_A}/users/newApr`), { uid: 'newApr', status: 'aprobado', rol: 'PROA' }));
});
test('ESCALADA: auto-crearse ADMIN de un hospital ajeno → DENEGADO', async () => {
  await assertFails(setDoc(doc(dbNew('newAdm'), `hospitals/${HOSP_A}/users/newAdm`), { uid: 'newAdm', status: 'admin', rol: 'Líder PROA' }));
});
test('FUNDADOR: auto-crearse ADMIN si el registro central me nombra adminUid → OK', async () => {
  await assertSucceeds(setDoc(doc(dbFounderC(), `hospitals/hospC/users/founderC`), { uid: 'founderC', status: 'admin', rol: 'Admin' }));
});
test('ESCALADA: auto-UPDATE cambiando el propio rol → DENEGADO', async () => {
  await assertFails(updateDoc(doc(dbA(), `hospitals/${HOSP_A}/users/userA`), { rol: 'Líder PROA' }));
});
test('ROL sin status aprobado NO da acceso: pendiente con rol PROA NO borra paciente', async () => {
  await assertFails(deleteDoc(doc(dbPendProa(), `hospitals/${HOSP_A}/months/${MES}/patients/p1`)));
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

// ── v391 SEGURIDAD: inmutabilidad de labs firmados + máquina de estados de solicitudes ──────────
test('LABS inmutable: miembro NO puede ACTUALIZAR un laboratorio FIRMADO', async () => {
  await assertFails(updateDoc(doc(dbA(), `hospitals/${HOSP_A}/patients/pp/labs/labSigned`), { valor: '9.9' }));
});
test('LABS inmutable: miembro NO puede BORRAR un laboratorio FIRMADO', async () => {
  await assertFails(deleteDoc(doc(dbA(), `hospitals/${HOSP_A}/patients/pp/labs/labSigned`)));
});
test('LABS: miembro SÍ puede corregir un laboratorio NO firmado (no rompe la edición normal)', async () => {
  await assertSucceeds(updateDoc(doc(dbA(), `hospitals/${HOSP_A}/patients/pp/labs/labUnsigned`), { valor: '5.5' }));
});
test('SOLICITUDES máquina de estados: miembro NO puede RESUCITAR una solicitud DENEGADA (denegado→aprobado)', async () => {
  await assertFails(updateDoc(doc(dbA(), `hospitals/${HOSP_A}/antibiotic_requests/reqDenied`), { status: 'aprobado' }));
});
test('SOLICITUDES: miembro SÍ puede editar campos de una denegada SIN cambiar el status', async () => {
  await assertSucceeds(updateDoc(doc(dbA(), `hospitals/${HOSP_A}/antibiotic_requests/reqDenied`), { nota: 'aclaración' }));
});
test('SOLICITUDES: miembro SÍ puede AVANZAR una solicitud PENDIENTE (no terminal)', async () => {
  await assertSucceeds(updateDoc(doc(dbA(), `hospitals/${HOSP_A}/antibiotic_requests/reqPending`), { status: 'aprobado' }));
});
