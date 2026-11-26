import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRegistrationPrice, createRegistrationService } from './registrationService.js';

const validRegistration = {
  teamName: 'Hackathon Builders',
  leaderName: 'Riya Sharma',
  leaderEmail: 'RIYA@example.com',
  mobile: '+91 98765 43210',
  organisation: 'Example College',
  city: 'Hyderabad',
  course: 'Artificial Intelligence (AI)',
  members: [
    { name: 'Riya Sharma', age: 20 },
    { name: 'Aman Shah', age: 21 },
    { name: 'Neha Rao', age: 19 },
    { name: 'Ishaan Das', age: 22 },
  ],
  food: '',
  accessibility: '',
  consent: true,
};

function createPersistentStore() {
  const records = new Map();
  const emails = new Set();
  const teams = new Set();
  return {
    records,
    async createRegistration(record) {
      const email = record.email.toLowerCase();
      const team = record.team_name.normalize('NFKC').trim().toLowerCase();
      if (emails.has(email)) {
        throw Object.assign(new Error('This team leader email has already been registered.'), {
          statusCode: 409,
          code: 'duplicate-email',
        });
      }
      if (teams.has(team)) {
        throw Object.assign(new Error('This team name has already been used.'), {
          statusCode: 409,
          code: 'duplicate-team',
        });
      }
      const saved = {
        id: record.registration_id,
        teamName: record.team_name,
        leaderName: record.participant_name,
        leaderEmail: record.email,
        mobile: record.phone_number,
        organisation: record.college_name,
        city: record.city,
        course: record.course,
        members: record.members,
        registrationDate: record.registration_date,
        discountEligible: record.discount_eligible,
        baseFee: record.registration_fee,
        discountAmount: record.discount_amount,
        finalFee: record.final_amount,
        paymentStatus: record.payment_status,
        attended: record.attended,
      };
      records.set(saved.id, saved);
      emails.add(email);
      teams.add(team);
      return saved;
    },
    async getRegistration(id) {
      return records.get(id) || null;
    },
    async listRegistrations() {
      return [...records.values()];
    },
    async setAttendance(id, attended) {
      const record = records.get(id);
      if (!record) return null;
      const updated = { ...record, attended };
      records.set(id, updated);
      return updated;
    },
  };
}

test('calculates the existing INR 1,000 fee and early-bird discount using India time', () => {
  assert.deepEqual(calculateRegistrationPrice(new Date('2026-12-20T18:29:59.000Z')), {
    discountEligible: true,
    baseFee: 1000,
    discountAmount: 100,
    finalFee: 900,
  });
  assert.deepEqual(calculateRegistrationPrice(new Date('2026-12-20T18:30:01.000Z')), {
    discountEligible: false,
    baseFee: 1000,
    discountAmount: 0,
    finalFee: 1000,
  });
  assert.throws(
    () => calculateRegistrationPrice(new Date('2026-12-31T18:30:01.000Z')),
    { statusCode: 409 },
  );
});

test('saves validated registration fields and ignores client-supplied prices', async () => {
  const store = createPersistentStore();
  const service = createRegistrationService({
    store,
    now: () => new Date('2026-11-26T12:00:00.000Z'),
  });
  const registration = await service.register({
    ...validRegistration,
    baseFee: 1,
    discountAmount: 1,
    finalFee: 0,
  });

  assert.match(registration.id, /^HRE-2026-[0-9A-F]{8}$/);
  assert.equal(registration.leaderEmail, 'riya@example.com');
  assert.equal(registration.baseFee, 1000);
  assert.equal(registration.discountAmount, 100);
  assert.equal(registration.finalFee, 900);
  assert.equal(registration.paymentStatus, 'unpaid');
  assert.equal(registration.attended, false);
  assert.equal(store.records.size, 1);
});

test('rejects invalid required data, track names, ages, team sizes, and consent', async () => {
  const service = createRegistrationService({ store: createPersistentStore() });
  await assert.rejects(service.register({ ...validRegistration, leaderEmail: 'bad-email' }), { statusCode: 400 });
  await assert.rejects(service.register({ ...validRegistration, members: validRegistration.members.slice(0, 3) }), { statusCode: 400 });
  await assert.rejects(service.register({
    ...validRegistration,
    members: validRegistration.members.map((member, index) => index === 0 ? { ...member, age: 17 } : member),
  }), { statusCode: 400 });
  await assert.rejects(service.register({ ...validRegistration, course: 'Unknown course' }), { statusCode: 400 });
  await assert.rejects(service.register({ ...validRegistration, consent: false }), { statusCode: 400 });
});

test('keeps records retrievable from the persistent store across service recreation', async () => {
  const store = createPersistentStore();
  const service = createRegistrationService({
    store,
    now: () => new Date('2026-11-26T12:00:00.000Z'),
  });
  const created = await service.register(validRegistration);

  const restartedService = createRegistrationService({ store });
  assert.deepEqual(await restartedService.getRegistration(created.id), created);
  assert.equal((await restartedService.listRegistrations()).length, 1);
});

test('returns a meaningful duplicate error and does not create another record', async () => {
  const store = createPersistentStore();
  const service = createRegistrationService({
    store,
    now: () => new Date('2026-11-26T12:00:00.000Z'),
  });
  await service.register(validRegistration);
  await assert.rejects(
    service.register({ ...validRegistration, leaderEmail: 'riya@example.com', teamName: 'Another Team' }),
    { statusCode: 409, code: 'duplicate-email' },
  );
  assert.equal(store.records.size, 1);
});

test('surfaces database failures instead of returning a success-shaped response', async () => {
  const service = createRegistrationService({
    store: {
      async createRegistration() {
        throw Object.assign(new Error('Firestore unavailable.'), { statusCode: 503 });
      },
    },
  });
  await assert.rejects(service.register(validRegistration), { statusCode: 503 });
});
