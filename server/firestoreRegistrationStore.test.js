import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirestoreRegistrationStore } from './firestoreRegistrationStore.js';

class FakeDocumentReference {
  constructor(database, collectionName, id) {
    this.database = database;
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    const data = this.database.records.get(`${this.collectionName}/${this.id}`);
    return { exists: Boolean(data), id: this.id, data: () => data };
  }

  async update(fields) {
    const key = `${this.collectionName}/${this.id}`;
    const data = this.database.records.get(key);
    if (!data) throw new Error('Document does not exist.');
    this.database.records.set(key, { ...data, ...fields });
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
    this.writes = [];
  }

  async get(reference) {
    const data = this.database.records.get(`${reference.collectionName}/${reference.id}`);
    return { exists: Boolean(data), id: reference.id, data: () => data };
  }

  create(reference, data) {
    this.writes.push({ reference, data });
  }
}

class FakeCollectionReference {
  constructor(database, name) {
    this.database = database;
    this.name = name;
  }

  doc(id) {
    return new FakeDocumentReference(this.database, this.name, id);
  }

  async get() {
    const prefix = `${this.name}/`;
    const docs = [...this.database.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, data]) => ({
        id: key.slice(prefix.length),
        data: () => data,
      }));
    return { docs };
  }
}

class FakeFirestore {
  constructor() {
    this.records = new Map();
    this.transactionQueue = Promise.resolve();
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  runTransaction(operation) {
    const result = this.transactionQueue.then(async () => {
      const transaction = new FakeTransaction(this);
      const value = await operation(transaction);
      for (const { reference, data } of transaction.writes) {
        const key = `${reference.collectionName}/${reference.id}`;
        if (this.records.has(key)) throw new Error('Document already exists.');
        this.records.set(key, data);
      }
      return value;
    });
    this.transactionQueue = result.catch(() => {});
    return result;
  }
}

function makeRecord(overrides = {}) {
  return {
    registration_id: 'HRE-2026-1234ABCD',
    team_name: 'Hackathon Builders',
    participant_name: 'Riya Sharma',
    email: 'riya@example.com',
    phone_number: '+91 98765 43210',
    college_name: 'Example College',
    city: 'Hyderabad',
    course: 'Artificial Intelligence (AI)',
    members: [{ name: 'Riya Sharma', age: 20 }],
    food: '',
    accessibility: '',
    registration_date: '2026-11-26T12:00:00.000Z',
    registration_fee: 1000,
    discount_eligible: true,
    discount_amount: 100,
    final_amount: 900,
    payment_status: 'unpaid',
    attended: false,
    created_at: '2026-11-26T12:00:00.000Z',
    ...overrides,
  };
}

test('writes the registration and unique keys atomically and prevents duplicate email/team submissions', async () => {
  const database = new FakeFirestore();
  const store = createFirestoreRegistrationStore({ getFirestore: () => database });
  const registration = makeRecord();
  const saved = await store.createRegistration(registration);

  assert.equal(saved.id, registration.registration_id);
  assert.equal(saved.finalFee, 900);
  assert.equal(database.records.get(`registrations/${registration.registration_id}`).payment_status, 'unpaid');
  assert.equal([...database.records.keys()].filter((key) => key.startsWith('registration_unique_keys/')).length, 2);

  await assert.rejects(
    store.createRegistration(makeRecord({ registration_id: 'HRE-2026-5678EFGH', email: 'RIYA@example.com' })),
    { statusCode: 409, code: 'duplicate-email' },
  );
  await assert.rejects(
    store.createRegistration(makeRecord({ registration_id: 'HRE-2026-8765IJKL', email: 'other@example.com' })),
    { statusCode: 409, code: 'duplicate-team' },
  );
  assert.equal([...database.records.keys()].filter((key) => key.startsWith('registrations/')).length, 1);
});

test('indexes legacy Firestore registrations and reads them alongside new records after store recreation', async () => {
  const database = new FakeFirestore();
  database.records.set('registrations/OLD-REGISTRATION', {
    id: 'OLD-REGISTRATION',
    teamName: 'Legacy Team',
    leaderName: 'Legacy Person',
    leaderEmail: 'LEGACY@example.com',
    mobile: '1234567890',
    finalFee: 900,
    registrationDate: '2026-01-01T00:00:00.000Z',
  });

  const firstStore = createFirestoreRegistrationStore({ getFirestore: () => database });
  assert.equal(await firstStore.ensureLegacyUniqueKeys(), 1);
  await assert.rejects(
    firstStore.createRegistration(makeRecord({ email: 'legacy@example.com' })),
    { statusCode: 409, code: 'duplicate-email' },
  );

  const secondStore = createFirestoreRegistrationStore({ getFirestore: () => database });
  const registrations = await secondStore.listRegistrations();
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, 'OLD-REGISTRATION');
  assert.equal(registrations[0].leaderEmail, 'LEGACY@example.com');
});

test('allows concurrent requests only one registration for a unique email', async () => {
  const database = new FakeFirestore();
  const store = createFirestoreRegistrationStore({ getFirestore: () => database });
  const results = await Promise.allSettled([
    store.createRegistration(makeRecord({ team_name: 'Team One' })),
    store.createRegistration(makeRecord({
      registration_id: 'HRE-2026-5678EFGH',
      team_name: 'Team Two',
    })),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected')[0].reason.code, 'duplicate-email');
});

test('authorised attendance changes persist and unknown registrations return null', async () => {
  const database = new FakeFirestore();
  const store = createFirestoreRegistrationStore({ getFirestore: () => database });
  const record = makeRecord();
  await store.createRegistration(record);

  const updated = await store.setAttendance(record.registration_id, true);
  assert.equal(updated.attended, true);
  assert.equal(database.records.get(`registrations/${record.registration_id}`).attended, true);
  assert.equal(await store.setAttendance('HRE-2026-FFFFFFFF', true), null);
});
