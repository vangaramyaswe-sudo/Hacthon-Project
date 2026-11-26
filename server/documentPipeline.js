import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { chunkCleanedText } from './chunking.js';
import { extractDocumentText, validateUploadedFile } from './extractionService.js';
import { preprocessExtractedText } from './preprocessing.js';

const maximumExtractedCharacters = 5_000_000;

function publicDocument(document) {
  if (!document) return null;
  return {
    document_id: document.document_id,
    filename: document.filename,
    status: document.status,
    stage: document.stage,
    uploaded_at: document.uploaded_at,
    updated_at: document.updated_at,
    chunk_count: document.chunk_count,
    page_count: document.page_count,
    error: document.error,
  };
}

function createPipelineError(error, documentId, defaultStatus = 500) {
  return Object.assign(new Error(error.message || 'Document processing failed.'), {
    statusCode: error.statusCode || defaultStatus,
    publicMessage: error.publicMessage,
    documentId,
    cause: error,
  });
}

function safeFilename(filename) {
  const basename = path.basename(String(filename).replace(/\\/g, '/'));
  const cleaned = [...basename]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f);
    })
    .join('')
    .slice(0, 255);
  return cleaned || 'uploaded-document';
}

function isValidVector(vector) {
  return Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite);
}

export function createDocumentPipeline({
  documentStore,
  vectorStore,
  embeddingService,
  extractText = extractDocumentText,
  preprocessText = preprocessExtractedText,
  createChunks = chunkCleanedText,
  chunkSize = Number(process.env.RAG_CHUNK_SIZE_CHARS || 2000),
  chunkOverlap = Number(process.env.RAG_CHUNK_OVERLAP_CHARS || 200),
} = {}) {
  if (!documentStore || !vectorStore || !embeddingService) {
    throw new TypeError('Document store, vector store, and embedding service are required.');
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('RAG_CHUNK_SIZE_CHARS must be a positive integer.');
  }
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new RangeError('RAG_CHUNK_OVERLAP_CHARS must be less than RAG_CHUNK_SIZE_CHARS.');
  }

  let uploadQueue = Promise.resolve();
  const embeddingModel = embeddingService.embeddingModel;

  function serializeUpload(operation) {
    const result = uploadQueue.then(operation);
    uploadQueue = result.catch(() => {});
    return result;
  }

  async function runProcessing(documentId) {
    const document = documentStore.getDocument(documentId);
    if (!document) throw Object.assign(new Error('Document not found.'), { statusCode: 404 });

    let vectorWriteAttempted = false;
    try {
      await documentStore.updateDocument(documentId, {
        status: 'processing',
        stage: 'extracting',
        error: null,
        updated_at: new Date().toISOString(),
      });

      const original = await documentStore.readOriginal(document);
      let extraction;
      try {
        extraction = await extractText(original, document.extension);
      } catch (error) {
        throw Object.assign(new Error(`Text extraction failed: ${error.message}`), {
          statusCode: 422,
          cause: error,
        });
      }
      if (typeof extraction.rawText !== 'string' || !extraction.rawText.trim()) {
        throw Object.assign(new Error('Text extraction returned no readable text.'), { statusCode: 422 });
      }
      if (extraction.rawText.length > maximumExtractedCharacters) {
        throw Object.assign(new Error('Extracted text exceeds the 5 MB text processing limit.'), {
          statusCode: 413,
        });
      }
      await documentStore.saveTextArtifacts(documentId, extraction.rawText, '');

      await documentStore.updateDocument(documentId, {
        stage: 'preprocessing',
        page_count: extraction.pageCount ?? null,
        updated_at: new Date().toISOString(),
      });
      let preprocessing;
      try {
        preprocessing = preprocessText(extraction.rawText);
      } catch (error) {
        throw Object.assign(new Error(`Text preprocessing failed: ${error.message}`), {
          statusCode: 422,
          cause: error,
        });
      }
      if (!preprocessing.cleanedText.trim()) {
        throw Object.assign(new Error('Text preprocessing returned no usable text.'), { statusCode: 422 });
      }
      await documentStore.saveTextArtifacts(documentId, extraction.rawText, preprocessing.cleanedText);

      await documentStore.updateDocument(documentId, {
        stage: 'chunking',
        updated_at: new Date().toISOString(),
      });
      let chunks;
      try {
        chunks = createChunks(preprocessing.cleanedText, {
          documentId,
          sourceFilename: document.filename,
          chunkSize,
          chunkOverlap,
        });
      } catch (error) {
        throw Object.assign(new Error(`Document chunking failed: ${error.message}`), {
          statusCode: 422,
          cause: error,
        });
      }
      if (!chunks.length) {
        throw Object.assign(new Error('Document chunking produced no usable chunks.'), { statusCode: 422 });
      }

      await documentStore.updateDocument(documentId, {
        stage: 'embedding',
        chunk_count: chunks.length,
        updated_at: new Date().toISOString(),
      });
      const embeddings = await embeddingService.embedTexts(chunks.map((chunk) => chunk.chunk_text));
      if (embeddings.length !== chunks.length || !embeddings.every(isValidVector)) {
        throw new Error('The embedding service returned missing or invalid vectors.');
      }
      const dimensions = embeddings[0].length;
      if (embeddings.some((vector) => vector.length !== dimensions)) {
        throw new Error('The embedding service returned vectors with inconsistent dimensions.');
      }

      await documentStore.updateDocument(documentId, {
        stage: 'vector_storage',
        updated_at: new Date().toISOString(),
      });
      vectorWriteAttempted = true;
      await vectorStore.replaceDocument(
        documentId,
        chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })),
        embeddingModel,
      );

      return publicDocument(await documentStore.updateDocument(documentId, {
        status: 'ready',
        stage: 'ready',
        error: null,
        updated_at: new Date().toISOString(),
      }));
    } catch (error) {
      let failure = error;
      if (vectorWriteAttempted) {
        try {
          await vectorStore.deleteDocument(documentId);
        } catch (cleanupError) {
          failure = new Error(`${error.message} Vector cleanup also failed: ${cleanupError.message}`, {
            cause: error,
          });
        }
      }
      await documentStore.updateDocument(documentId, {
        status: 'failed',
        stage: 'failed',
        error: failure.message,
        updated_at: new Date().toISOString(),
      });
      throw createPipelineError(failure, documentId);
    }
  }

  async function startUpload(file) {
    const extension = validateUploadedFile(file);
    const filename = safeFilename(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const initial = await serializeUpload(async () => {
      const existing = documentStore.findByHash(sha256);
      if (existing?.status === 'ready') {
        return { document: existing, duplicate: true, process: false };
      }
      if (existing?.status === 'processing') {
        throw Object.assign(new Error('This document is already being processed.'), {
          statusCode: 409,
          documentId: existing.document_id,
        });
      }

      const document = existing || {
        document_id: randomUUID(),
        filename,
        extension,
        sha256,
        size: file.buffer.length,
        uploaded_at: new Date().toISOString(),
        chunk_count: 0,
        page_count: null,
      };
      if (!existing) await documentStore.saveOriginal(document.document_id, extension, file.buffer);
      await documentStore.saveDocument({
        ...document,
        status: 'processing',
        stage: 'queued',
        error: null,
        updated_at: new Date().toISOString(),
      });
      return { document, duplicate: false, process: true };
    });

    if (!initial.process) {
      return {
        document: publicDocument(initial.document),
        duplicate: true,
        processing: null,
      };
    }
    const processing = runProcessing(initial.document.document_id);
    return {
      document: publicDocument(documentStore.getDocument(initial.document.document_id)),
      duplicate: false,
      processing,
    };
  }

  async function upload(file) {
    const started = await startUpload(file);
    if (started.processing) await started.processing;
    return {
      document: started.processing
        ? publicDocument(documentStore.getDocument(started.document.document_id))
        : started.document,
      duplicate: started.duplicate,
    };
  }

  async function reprocess(documentId) {
    const document = documentStore.getDocument(documentId);
    if (!document) throw Object.assign(new Error('Document not found.'), { statusCode: 404 });
    if (document.status === 'processing') {
      throw Object.assign(new Error('This document is already being processed.'), { statusCode: 409 });
    }
    await documentStore.updateDocument(documentId, {
      status: 'processing',
      stage: 'queued',
      error: null,
      updated_at: new Date().toISOString(),
    });
    return runProcessing(documentId);
  }

  async function deleteDocument(documentId) {
    const document = documentStore.getDocument(documentId);
    if (!document) return false;
    if (document.status === 'processing') {
      throw Object.assign(new Error('Wait for document processing to finish before deleting it.'), {
        statusCode: 409,
      });
    }
    await vectorStore.deleteDocument(documentId);
    await documentStore.removeDocumentFiles(documentId);
    return documentStore.deleteDocumentRecord(documentId);
  }

  return {
    deleteDocument,
    getDocument: (documentId) => publicDocument(documentStore.getDocument(documentId)),
    listDocuments: () => documentStore.listDocuments().map(publicDocument),
    reprocess,
    startUpload,
    upload,
  };
}
