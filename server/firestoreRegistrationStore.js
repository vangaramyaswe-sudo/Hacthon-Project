import { createHash } from 'node:crypto';

const registrationCollection = 'registrations';
const uniqueKeyCollection = 'registration_unique_keys';

function storageError(error) {
  if (error.statusCode || error.code === 'registration-id-collision') return error;
  return Object.assign(new Error('Registration database is temporarily unavailable.'), {
    statusCode: 503,
    publicMessage: 'Registration database is temporarily unavailable. Please try again.',
    cause: error,
  });
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTeamName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniqueKey(kind, value) {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${kind}_${hash}`;
}

function serializeRegistration(documentId, record) {
  return {
    id: record.registration_id || record.id || documentId,
    registration_id: record.registration_id || record.id || documentId,
    teamName: record.team_name ?? record.teamName ?? '',
    leaderName: record.participant_name ?? record.leaderName ?? '',
    leaderEmail: record.email ?? record.leaderEmail ?? '',
    mobile: record.phone_number ?? record.mobile ?? '',
    organisation: record.college_name ?? record.organisation ?? '',
    city: record.city ?? '',
    course: record.course ?? '',
    members: Array.isArray(record.members) ? record.members : [],
    food: record.food ?? '',
    accessibility: record.accessibility ?? '',
    registrationDate: record.registration_date ?? record.registrationDate ?? '',
    discountEligible: record.discount_eligible ?? record.discountEligible ?? false,
    baseFee: record.registration_fee ?? record.baseFee ?? 0,
    discountAmount: record.discount_amount ?? record.discountAmount ?? 0,
    finalFee: record.final_amount ?? record.finalFee ?? 0,
    paymentStatus: record.payment_status || record.paymentStatus || 'unpaid',
    attended: record.attended === true,
    createdAt: record.created_at ?? record.createdAt ?? record.registration_date ?? record.registrationDate ?? '',
    updatedAt: record.updated_at ?? record.updatedAt ?? '',
  };
}

export function createFirestoreRegistrationStore({ getFirestore }) {
  if (typeof getFirestore !== 'function') {
    throw new TypeError('A Firestore provider is required.');
  }

  let legacyIndexPromise;

  async function ensureLegacyUniqueKeys() {
    if (!legacyIndexPromise) {
      legacyIndexPromise = (async () => {
        const db = getFirestore();
        const registrations = await db.collection(registrationCollection).get();
        let indexed = 0;

        for (const document of registrations.docs) {
          const record = document.data();
          if (record.registration_id) continue;

          const email = normalizeEmail(record.email || record.leaderEmail);
          const teamName = normalizeTeamName(record.team_name || record.teamName);
          const references = [];
          if (email) references.push({
            kind: 'email',
            reference: db.collection(uniqueKeyCollection).doc(uniqueKey('email', email)),
          });
          if (teamName) references.push({
            kind: 'team',
            reference: db.collection(uniqueKeyCollection).doc(uniqueKey('team', teamName)),
          });
          if (references.length === 0) continue;

          await db.runTransaction(async (transaction) => {
            const snapshots = await Promise.all(
              references.map(({ reference }) => transaction.get(reference)),
            );
            references.forEach(({ kind, reference }, index) => {
              if (!snapshots[index].exists) {
                transaction.create(reference, {
                  registration_id: record.id || document.id,
                  kind,
                  created_at: record.registrationDate || new Date().toISOString(),
                });
              }
            });
          });
          indexed += 1;
        }
        return indexed;
      })().catch((error) => {
        legacyIndexPromise = null;
        throw storageError(error);
      });
    }
    return legacyIndexPromise;
  }

  async function createRegistration(record) {
    try {
      await ensureLegacyUniqueKeys();
      const db = getFirestore();
      const registrations = db.collection(registrationCollection);
      const registrationReference = registrations.doc(record.registration_id);
      const email = normalizeEmail(record.email);
      const teamName = normalizeTeamName(record.team_name);
      const emailReference = db.collection(uniqueKeyCollection).doc(uniqueKey('email', email));
      const teamReference = db.collection(uniqueKeyCollection).doc(uniqueKey('team', teamName));

      await db.runTransaction(async (transaction) => {
        const [registrationSnapshot, emailSnapshot, teamSnapshot] = await Promise.all([
          transaction.get(registrationReference),
          transaction.get(emailReference),
          transaction.get(teamReference),
        ]);
        if (registrationSnapshot.exists) {
          throw Object.assign(new Error('Registration ID collision.'), { code: 'registration-id-collision' });
        }
        if (emailSnapshot.exists) {
          throw Object.assign(new Error('This team leader email has already been registered.'), {
            statusCode: 409,
            code: 'duplicate-email',
          });
        }
        if (teamSnapshot.exists) {
          throw Object.assign(new Error('This team name has already been used.'), {
            statusCode: 409,
            code: 'duplicate-team',
          });
        }

        transaction.create(registrationReference, record);
        transaction.create(emailReference, {
          registration_id: record.registration_id,
          kind: 'email',
          created_at: record.created_at,
        });
        transaction.create(teamReference, {
          registration_id: record.registration_id,
          kind: 'team',
          created_at: record.created_at,
        });
      });
      return serializeRegistration(record.registration_id, record);
    } catch (error) {
      throw storageError(error);
    }
  }

  async function listRegistrations() {
    try {
      const snapshot = await getFirestore().collection(registrationCollection).get();
      return snapshot.docs
        .map((document) => serializeRegistration(document.id, document.data()))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    } catch (error) {
      throw storageError(error);
    }
  }

  async function getRegistration(registrationId) {
    try {
      const document = await getFirestore()
        .collection(registrationCollection)
        .doc(registrationId)
        .get();
      return document.exists
        ? serializeRegistration(document.id, document.data())
        : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  async function setAttendance(registrationId, attended) {
    try {
      const reference = getFirestore().collection(registrationCollection).doc(registrationId);
      const document = await reference.get();
      if (!document.exists) return null;
      const updatedAt = new Date().toISOString();
      await reference.update({
        attended,
        updated_at: updatedAt,
      });
      return serializeRegistration(registrationId, {
        ...document.data(),
        attended,
        updated_at: updatedAt,
      });
    } catch (error) {
      throw storageError(error);
    }
  }

  return {
    createRegistration,
    ensureLegacyUniqueKeys,
    getRegistration,
    listRegistrations,
    setAttendance,
  };
}
