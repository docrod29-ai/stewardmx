// ═══════════════════════════════════════════════════════════════════════════════
//  Prueba de la Cloud Function joinWithCode (alta server-side) — StewardMX
//  Valida que el rol lo asigna el SERVIDOR a partir del código (cierra la escalada):
//   · código de rol válido → rol del código + auto-aprobado + doc del usuario escrito
//   · código inválido → error (not-found)
//   · código = ID de hospital → status pendiente
//  Requiere emuladores (firestore+functions+auth, necesitan Java). Ejecutar con:
//     npm run test:emu
// ═══════════════════════════════════════════════════════════════════════════════
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const PROJECT = 'demo-stewardmx';
let env, app, fns, auth;

before(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  // Semilla (reglas desactivadas): un código de rol + el doc del hospital
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospital_role_codes/hgene_abc'), { hospitalId: 'hgene', rol: 'Farmacéutico' });
    await setDoc(doc(db, 'hospitals/hgene/info/main'), { nombre: 'Hospital General' });
  });
  app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key' }, 'fns-test');
  auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  fns = getFunctions(app, 'us-central1'); connectFunctionsEmulator(fns, '127.0.0.1', 5001);
});
after(async () => { try { if (app) await deleteApp(app); } catch (_) {} if (env) await env.cleanup(); });

test('joinWithCode: código de rol válido → rol del SERVIDOR + auto-aprobado + doc escrito', async () => {
  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;
  const join = httpsCallable(fns, 'joinWithCode');
  const res = await join({ code: 'hgene_abc', nombre: 'Test User' });
  assert.equal(res.data.ok, true);
  assert.equal(res.data.hospitalId, 'hgene');
  assert.equal(res.data.rol, 'Farmacéutico');
  assert.equal(res.data.autoAprobado, true);
  // el doc del usuario lo escribió el SERVIDOR con el rol confiable
  await env.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), `hospitals/hgene/users/${uid}`));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().rol, 'Farmacéutico');
    assert.equal(snap.data().status, 'aprobado');
  });
});

test('joinWithCode: código inválido → error (not-found)', async () => {
  if (!auth.currentUser) await signInAnonymously(auth);
  const join = httpsCallable(fns, 'joinWithCode');
  await assert.rejects(() => join({ code: 'noexiste_xyz' }));
});

test('joinWithCode: código = ID de hospital → status pendiente (no auto-aprobado)', async () => {
  if (!auth.currentUser) await signInAnonymously(auth);
  const join = httpsCallable(fns, 'joinWithCode');
  const res = await join({ code: 'hgene', nombre: 'Otro' });
  assert.equal(res.data.ok, true);
  assert.equal(res.data.autoAprobado, false);
});
