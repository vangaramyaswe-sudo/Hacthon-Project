import { createFirebaseAdminServices } from './firebaseAdmin.js';
import { createFirestoreRegistrationStore } from './firestoreRegistrationStore.js';

const firebaseAdmin = createFirebaseAdminServices();
const registrationStore = createFirestoreRegistrationStore({
  getFirestore: firebaseAdmin.getFirestore,
});

const indexed = await registrationStore.ensureLegacyUniqueKeys();
console.log(`Registration uniqueness migration complete. Indexed ${indexed} legacy records.`);
