import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const appName = 'hackathon-registration-api';

function serviceError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode, publicMessage: message });
}

export function createFirebaseAdminServices({ env = process.env } = {}) {
  let services;

  function getServices() {
    if (services) return services;

    const projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
    const serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const hasApplicationCredentials = Boolean(
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      env.GOOGLE_CLOUD_PROJECT ||
      env.GCLOUD_PROJECT ||
      env.K_SERVICE,
    );

    if (!projectId || (!serviceAccountJson && !hasApplicationCredentials)) {
      throw serviceError(
        'Firebase Admin is not configured. Set FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS.',
        503,
      );
    }

    let credential;
    try {
      credential = serviceAccountJson
        ? cert(JSON.parse(serviceAccountJson))
        : applicationDefault();
    } catch {
      throw serviceError('Firebase Admin credentials are invalid or unavailable.', 503);
    }

    const app = getApps().find((item) => item.name === appName) ||
      initializeApp({ credential, projectId }, appName);
    services = { auth: getAuth(app), db: getFirestore(app) };
    return services;
  }

  async function verifyOrganizerToken(authorizationHeader) {
    const match = typeof authorizationHeader === 'string'
      ? authorizationHeader.match(/^Bearer\s+([^\s]+)$/i)
      : null;
    if (!match) throw serviceError('Sign in as an organiser to access registrations.', 401);

    const { auth } = getServices();
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(match[1], true);
    } catch (error) {
      if ([
        'auth/internal-error',
        'auth/invalid-credential',
        'auth/insufficient-permission',
        'app/network-error',
      ].includes(error.code)) {
        throw serviceError('Firebase Authentication is temporarily unavailable. Please try again.', 503);
      }
      throw serviceError('Your organiser session is invalid or expired. Please sign in again.', 401);
    }

    const allowedEmails = new Set(
      (env.ORGANIZER_EMAILS || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    );
    const hasOrganizerClaim = decodedToken.organizer === true || decodedToken.admin === true;
    const allowedVerifiedEmail = decodedToken.email_verified === true &&
      allowedEmails.has(String(decodedToken.email || '').toLowerCase());
    if (!hasOrganizerClaim && !allowedVerifiedEmail) {
      throw serviceError('This Firebase account is not authorized as an organiser.', 403);
    }
    return decodedToken;
  }

  async function listFeedback() {
    try {
      const snapshot = await getServices().db.collection('feedback').get();
      return snapshot.docs
        .map((document) => document.data())
        .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    } catch (error) {
      if (error.statusCode) throw error;
      throw serviceError('Feedback database is temporarily unavailable. Please try again.', 503);
    }
  }

  return {
    getAuth: () => getServices().auth,
    getFirestore: () => getServices().db,
    listFeedback,
    verifyOrganizerToken,
  };
}
