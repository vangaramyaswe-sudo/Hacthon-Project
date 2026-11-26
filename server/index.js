import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocumentPipeline } from './documentPipeline.js';
import { DocumentStore } from './documentStore.js';
import { createEmbeddingService } from './embeddingService.js';
import { createFirebaseAdminServices } from './firebaseAdmin.js';
import { createFirestoreRegistrationStore } from './firestoreRegistrationStore.js';
import { createRagService } from './ragService.js';
import { createRegistrationService } from './registrationService.js';
import { createVectorStore } from './vectorStore.js';

const maximumUploadSize = 10 * 1024 * 1024;
const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const registrationIdPattern = /^HRE-\d{4}-[0-9a-f]{8}$/i;

function isLocalOrigin(request) {
  const origin = request.get('origin');
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const hostname = parsedOrigin.hostname.toLowerCase();
    return ['http:', 'https:'].includes(parsedOrigin.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

export function createApp({
  pipeline,
  ragService,
  registrationService = null,
  feedbackService = null,
  verifyOrganizerToken = null,
}) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maximumUploadSize, files: 1 },
  });

  app.use(express.json({ limit: '64kb' }));
  app.use((request, response, next) => {
    if (!isLocalOrigin(request)) {
      response.status(403).json({ error: 'This local-only service accepts requests only from localhost.' });
      return;
    }
    next();
  });

  const uploadHandler = (request, response, next) => {
    upload.single('document')(request, response, async (uploadError) => {
      if (uploadError) {
        next(uploadError);
        return;
      }
      try {
        const result = await pipeline.startUpload(request.file);
        if (result.processing) {
          result.processing.catch((error) => {
            console.error(`Document processing failed (${result.document.document_id}): ${error.message}`);
          });
        }
        response.status(result.duplicate ? 200 : 202).json({
          document: result.document,
          duplicate: result.duplicate,
        });
      } catch (error) {
        next(error);
      }
    });
  };
  app.post(['/api/documents/upload', '/api/uploads'], uploadHandler);

  app.get('/api/documents', (_request, response) => {
    response.json({ documents: pipeline.listDocuments() });
  });

  app.get('/api/documents/:documentId/status', (request, response) => {
    if (!documentIdPattern.test(request.params.documentId)) {
      response.status(400).json({ error: 'Invalid document ID.' });
      return;
    }
    const document = pipeline.getDocument(request.params.documentId);
    if (!document) {
      response.status(404).json({ error: 'Document not found.' });
      return;
    }
    response.json({ document });
  });

  app.post('/api/documents/:documentId/reprocess', async (request, response, next) => {
    if (!documentIdPattern.test(request.params.documentId)) {
      response.status(400).json({ error: 'Invalid document ID.' });
      return;
    }
    try {
      response.json({ document: await pipeline.reprocess(request.params.documentId) });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/documents/:documentId', async (request, response, next) => {
    if (!documentIdPattern.test(request.params.documentId)) {
      response.status(400).json({ error: 'Invalid document ID.' });
      return;
    }
    try {
      const deleted = await pipeline.deleteDocument(request.params.documentId);
      if (!deleted) {
        response.status(404).json({ error: 'Document not found.' });
        return;
      }
      response.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/chat', async (request, response, next) => {
    try {
      response.json(await ragService.answer(request.body));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/registrations', async (request, response, next) => {
    if (!registrationService) {
      next(Object.assign(new Error('Registration storage is not configured.'), {
        statusCode: 503,
        publicMessage: 'Registration storage is not configured. Configure Firebase Admin credentials.',
      }));
      return;
    }
    try {
      const registration = await registrationService.register(request.body);
      response.status(201).json({
        registration: {
          id: registration.id,
          teamName: registration.teamName,
          registrationDate: registration.registrationDate,
          baseFee: registration.baseFee,
          discountAmount: registration.discountAmount,
          finalFee: registration.finalFee,
          paymentStatus: registration.paymentStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  const requireOrganizer = async (request, _response, next) => {
    if (typeof verifyOrganizerToken !== 'function') {
      next(Object.assign(new Error('Organiser authentication is not configured.'), {
        statusCode: 503,
        publicMessage: 'Organiser authentication is not configured. Configure Firebase Admin credentials.',
      }));
      return;
    }
    try {
      request.organizer = await verifyOrganizerToken(request.get('authorization'));
      next();
    } catch (error) {
      next(error);
    }
  };

  app.get('/api/registrations', requireOrganizer, async (_request, response, next) => {
    if (!registrationService) {
      next(Object.assign(new Error('Registration storage is not configured.'), {
        statusCode: 503,
        publicMessage: 'Registration storage is not configured. Configure Firebase Admin credentials.',
      }));
      return;
    }
    try {
      response.json({ registrations: await registrationService.listRegistrations() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/feedback', requireOrganizer, async (_request, response, next) => {
    if (!feedbackService) {
      next(Object.assign(new Error('Feedback storage is not configured.'), {
        statusCode: 503,
        publicMessage: 'Feedback storage is not configured. Configure Firebase Admin credentials.',
      }));
      return;
    }
    try {
      response.json({ feedback: await feedbackService.list() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/registrations/:registrationId', requireOrganizer, async (request, response, next) => {
    if (!registrationIdPattern.test(request.params.registrationId)) {
      response.status(400).json({ error: 'Invalid registration ID.' });
      return;
    }
    if (!registrationService) {
      next(Object.assign(new Error('Registration storage is not configured.'), {
        statusCode: 503,
        publicMessage: 'Registration storage is not configured. Configure Firebase Admin credentials.',
      }));
      return;
    }
    try {
      const registration = await registrationService.getRegistration(request.params.registrationId);
      if (!registration) {
        response.status(404).json({ error: 'Registration not found.' });
        return;
      }
      response.json({ registration });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/registrations/:registrationId/attendance', requireOrganizer, async (request, response, next) => {
    if (!registrationIdPattern.test(request.params.registrationId)) {
      response.status(400).json({ error: 'Invalid registration ID.' });
      return;
    }
    if (typeof request.body?.attended !== 'boolean') {
      response.status(400).json({ error: 'Attendance must be a boolean value.' });
      return;
    }
    if (!registrationService) {
      next(Object.assign(new Error('Registration storage is not configured.'), {
        statusCode: 503,
        publicMessage: 'Registration storage is not configured. Configure Firebase Admin credentials.',
      }));
      return;
    }
    try {
      const registration = await registrationService.markAttendance(
        request.params.registrationId,
        request.body.attended,
      );
      if (!registration) {
        response.status(404).json({ error: 'Registration not found.' });
        return;
      }
      response.json({ registration });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'API route not found.' });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({ error: 'The file must be 10 MB or smaller.' });
      return;
    }
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: 'Upload one document at a time.' });
      return;
    }

    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const document = error.documentId ? pipeline.getDocument(error.documentId) : null;
    response.status(statusCode).json({
      error: error.publicMessage || (statusCode >= 500
        ? 'The request could not be completed. Check the server configuration and try again.'
        : error.message),
      ...(document ? { document } : {}),
    });
  });

  return app;
}

export async function startServer() {
  const dataDirectory = path.resolve(process.env.RAG_DATA_DIR || 'data/rag');
  const documentStore = new DocumentStore(dataDirectory);
  await documentStore.initialize();

  const embeddingService = createEmbeddingService();
  const vectorStore = createVectorStore(process.env.LANCEDB_PATH || path.join(dataDirectory, 'vectors'));
  const pipeline = createDocumentPipeline({ documentStore, vectorStore, embeddingService });
  const ragService = createRagService({ documentStore, vectorStore, embeddingService });
  const firebaseAdmin = createFirebaseAdminServices();
  const registrationStore = createFirestoreRegistrationStore({
    getFirestore: firebaseAdmin.getFirestore,
  });
  const registrationService = createRegistrationService({ store: registrationStore });
  const app = createApp({
    pipeline,
    ragService,
    registrationService,
    feedbackService: { list: firebaseAdmin.listFeedback },
    verifyOrganizerToken: firebaseAdmin.verifyOrganizerToken,
  });
  const port = Number(process.env.API_PORT || 3001);

  return app.listen(port, '127.0.0.1', () => {
    console.log(`Local document RAG API listening on http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
}
