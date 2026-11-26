import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DocumentStore } from './documentStore.js';
import { createDocumentPipeline } from './documentPipeline.js';

async function createHarness(t, embeddingService = null) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rag-pipeline-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const documentStore = new DocumentStore(directory);
  await documentStore.initialize();
  const storedChunks = new Map();
  let replacementCount = 0;
  const vectorStore = {
    async replaceDocument(documentId, chunks) {
      replacementCount += 1;
      storedChunks.set(documentId, chunks);
    },
    async deleteDocument(documentId) {
      storedChunks.delete(documentId);
    },
  };
  let embedCount = 0;
  const embeddings = embeddingService || {
    embeddingModel: 'test-embedding-model',
    async embedTexts(texts) {
      embedCount += 1;
      return texts.map((_, index) => [1, index + 1, 0]);
    },
  };
  const pipeline = createDocumentPipeline({ documentStore, vectorStore, embeddingService: embeddings });
  const file = {
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('# Notes\n\nThe answer is 42.\n'),
  };

  return {
    directory,
    documentStore,
    embedCount: () => embedCount,
    file,
    pipeline,
    replacementCount: () => replacementCount,
    storedChunks,
  };
}

test('uploads persist original and cleaned text, chunk, embed, and store before reporting ready', async (t) => {
  const harness = await createHarness(t);
  const result = await harness.pipeline.upload(harness.file);

  assert.equal(result.document.status, 'ready');
  assert.equal(result.document.stage, 'ready');
  assert.ok(result.document.chunk_count > 0);
  assert.equal(harness.embedCount(), 1);
  assert.equal(harness.replacementCount(), 1);
  assert.equal(harness.storedChunks.get(result.document.document_id)[0].source_filename, 'notes.txt');

  const document = harness.documentStore.getDocument(result.document.document_id);
  const original = await readFile(harness.documentStore.getOriginalPath(document), 'utf8');
  const raw = await readFile(path.join(harness.directory, result.document.document_id, 'raw.txt'), 'utf8');
  const cleaned = await readFile(path.join(harness.directory, result.document.document_id, 'cleaned.txt'), 'utf8');
  assert.equal(original, harness.file.buffer.toString());
  assert.equal(raw, harness.file.buffer.toString());
  assert.notEqual(cleaned, raw);
  assert.match(cleaned, /The answer is 42/);
});

test('starts upload processing asynchronously so each pipeline stage can be polled', async (t) => {
  const harness = await createHarness(t);
  const started = await harness.pipeline.startUpload(harness.file);

  assert.equal(started.document.status, 'processing');
  assert.equal(started.document.stage, 'queued');
  await started.processing;
  assert.equal(harness.pipeline.getDocument(started.document.document_id).status, 'ready');
});

test('identical file content reuses the already indexed document', async (t) => {
  const harness = await createHarness(t);
  const first = await harness.pipeline.upload(harness.file);
  const second = await harness.pipeline.upload({ ...harness.file, originalname: 'renamed.txt' });

  assert.equal(second.duplicate, true);
  assert.equal(second.document.document_id, first.document.document_id);
  assert.equal(harness.embedCount(), 1);
  assert.equal(harness.replacementCount(), 1);
});

test('embedding failures are visible in document status and can be retried', async (t) => {
  let shouldFail = true;
  const embeddingService = {
    embeddingModel: 'test-embedding-model',
    async embedTexts(texts) {
      if (shouldFail) throw Object.assign(new Error('Embedding service unavailable.'), { statusCode: 503 });
      return texts.map(() => [1, 0]);
    },
  };
  const harness = await createHarness(t, embeddingService);

  await assert.rejects(harness.pipeline.upload(harness.file), /Embedding service unavailable/);
  const [failedDocument] = harness.pipeline.listDocuments();
  assert.equal(failedDocument.status, 'failed');
  assert.equal(failedDocument.stage, 'failed');
  assert.equal(failedDocument.error, 'Embedding service unavailable.');

  shouldFail = false;
  const retried = await harness.pipeline.reprocess(failedDocument.document_id);
  assert.equal(retried.status, 'ready');
  assert.equal(harness.replacementCount(), 1);
});

test('deleting a document removes its vectors, stored files, and registry entry', async (t) => {
  const harness = await createHarness(t);
  const { document } = await harness.pipeline.upload(harness.file);

  assert.equal(await harness.pipeline.deleteDocument(document.document_id), true);
  assert.equal(harness.pipeline.getDocument(document.document_id), null);
  assert.equal(harness.storedChunks.has(document.document_id), false);
  await assert.rejects(
    readFile(path.join(harness.directory, document.document_id)),
    { code: 'ENOENT' },
  );
});
