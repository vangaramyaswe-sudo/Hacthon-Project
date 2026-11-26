import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirebaseAdminServices } from './firebaseAdmin.js';

test('rejects missing bearer credentials before checking Firebase configuration', async () => {
  const firebase = createFirebaseAdminServices({ env: {} });
  await assert.rejects(firebase.verifyOrganizerToken(undefined), { statusCode: 401 });
});

test('fails closed when Firebase Admin credentials are not configured', async () => {
  const firebase = createFirebaseAdminServices({ env: {} });
  await assert.rejects(firebase.verifyOrganizerToken('Bearer token'), {
    statusCode: 503,
    publicMessage: 'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS.',
  });
});
