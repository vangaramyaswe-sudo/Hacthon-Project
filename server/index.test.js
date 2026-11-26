import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './index.js';

async function startTestServer(t) {
  const document = {
    document_id: 'c0a80123-4567-489a-8abc-123456789abc',
    filename: 'notes.txt',
    status: 'ready',
  };
  const pipeline = {
    listDocuments: () => [document],
    getDocument: (documentId) => documentId === document.document_id ? document : null,
    async startUpload(file) {
      return {
        document: { ...document, filename: file.originalname, status: 'processing', stage: 'queued' },
        duplicate: false,
        processing: Promise.resolve(document),
      };
    },
    async reprocess() {
      return document;
    },
    async deleteDocument(documentId) {
      return documentId === document.document_id;
    },
  };
  const ragService = {
    async answer(input) {
      return { answer: `Answered: ${input.question}`, sources: [] };
    },
  };
  const registration = {
    id: 'HRE-2026-1234ABCD',
    teamName: 'Hackathon Builders',
    leaderName: 'Riya Sharma',
    leaderEmail: 'riya@example.com',
    mobile: '+91 98765 43210',
    finalFee: 900,
    paymentStatus: 'unpaid',
    attended: false,
  };
  const registrationService = {
    async register(input) {
      if (input.teamName === 'Database failure') {
        throw Object.assign(new Error('Database connection failed.'), {
          statusCode: 503,
          publicMessage: 'Registration database is unavailable.',
        });
      }
      return registration;
    },
    async listRegistrations() {
      return [registration];
    },
    async getRegistration(id) {
      return id === registration.id ? registration : null;
    },
    async markAttendance(id, attended) {
      if (id !== registration.id) return null;
      return { ...registration, attended };
    },
  };
  const feedbackService = {
    async list() {
      return [{ rating: 5, comments: 'Great event.' }];
    },
  };
  const verifyOrganizerToken = async (authorization) => {
    if (authorization === 'Bearer valid-token') return { email: 'organiser@example.com' };
    throw Object.assign(new Error('Organiser access denied.'), {
      statusCode: authorization ? 403 : 401,
      publicMessage: authorization ? 'Not an authorised organiser.' : 'Sign in as an organiser.',
    });
  };
  const server = createApp({
    pipeline,
    ragService,
    registrationService,
    feedbackService,
    verifyOrganizerToken,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    documentId: document.document_id,
  };
}

test('serves document and chat APIs to localhost browser origins', async (t) => {
  const { baseUrl, documentId } = await startTestServer(t);
  const documentResponse = await fetch(`${baseUrl}/api/documents`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  assert.equal(documentResponse.status, 200);
  assert.deepEqual(await documentResponse.json(), {
    documents: [{
      document_id: documentId,
      filename: 'notes.txt',
      status: 'ready',
    }],
  });

  const upload = new FormData();
  upload.append('document', new Blob(['Test content'], { type: 'text/plain' }), 'notes.txt');
  const uploadResponse = await fetch(`${baseUrl}/api/documents/upload`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173' },
    body: upload,
  });
  assert.equal(uploadResponse.status, 202);
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.document.filename, 'notes.txt');
  assert.equal(uploaded.document.status, 'processing');

  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'What is in the document?' }),
  });
  assert.equal(chatResponse.status, 200);
  assert.deepEqual(await chatResponse.json(), {
    answer: 'Answered: What is in the document?',
    sources: [],
  });
});

test('rejects non-local browser origins', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/documents`, {
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /localhost/);
});

test('validates document IDs for status requests', async (t) => {
  const { baseUrl, documentId } = await startTestServer(t);
  const response = await fetch(`${baseUrl}/api/documents/not-an-id/status`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Invalid document ID.');

  const found = await fetch(`${baseUrl}/api/documents/${documentId}/status`);
  assert.equal(found.status, 200);
  assert.equal((await found.json()).document.filename, 'notes.txt');
});

test('creates registrations only after save and returns a limited confirmation receipt', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const success = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName: 'Hackathon Builders' }),
  });
  assert.equal(success.status, 201);
  const receipt = (await success.json()).registration;
  assert.equal(receipt.id, 'HRE-2026-1234ABCD');
  assert.equal(receipt.finalFee, 900);
  assert.equal(receipt.paymentStatus, 'unpaid');
  assert.equal('leaderEmail' in receipt, false);

  const failed = await fetch(`${baseUrl}/api/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName: 'Database failure' }),
  });
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, 'Registration database is unavailable.');
});

test('protects registration list, detail, and attendance routes with organiser authentication', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const denied = await fetch(`${baseUrl}/api/registrations`);
  assert.equal(denied.status, 401);

  const wrongAccount = await fetch(`${baseUrl}/api/registrations`, {
    headers: { Authorization: 'Bearer invalid-token' },
  });
  assert.equal(wrongAccount.status, 403);

  const authorized = await fetch(`${baseUrl}/api/registrations`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).registrations[0].leaderEmail, 'riya@example.com');

  const feedback = await fetch(`${baseUrl}/api/feedback`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(feedback.status, 200);
  assert.equal((await feedback.json()).feedback[0].rating, 5);

  const detail = await fetch(`${baseUrl}/api/registrations/HRE-2026-1234ABCD`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
  assert.equal(detail.status, 200);

  const attendance = await fetch(`${baseUrl}/api/registrations/HRE-2026-1234ABCD/attendance`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ attended: true }),
  });
  assert.equal(attendance.status, 200);
  assert.equal((await attendance.json()).registration.attended, true);

  const malformedAttendance = await fetch(`${baseUrl}/api/registrations/HRE-2026-1234ABCD/attendance`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ attended: 'yes' }),
  });
  assert.equal(malformedAttendance.status, 400);
});
