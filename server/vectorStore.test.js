import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createVectorStore } from './vectorStore.js';

const firstDocumentId = 'c0a80123-4567-489a-8abc-123456789abc';
const secondDocumentId = 'd0a80123-4567-489a-8abc-123456789abc';
const firstChunkId = 'e0a80123-4567-489a-8abc-123456789abc';
const secondChunkId = 'f0a80123-4567-489a-8abc-123456789abc';

async function createStore(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rag-vectors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createVectorStore(directory) };
}

function makeChunk(documentId, chunkId, chunkText, embedding, index = 0) {
  return {
    chunk_id: chunkId,
    document_id: documentId,
    chunk_index: index,
    chunk_text: chunkText,
    source_filename: 'source.txt',
    embedding,
    page_start: 3,
    page_end: 3,
    section_name: 'Heading',
  };
}

test('persists vectors, filters by document and embedding model, and returns metadata with scores', async (t) => {
  const { directory, store } = await createStore(t);
  await store.replaceDocument(firstDocumentId, [
    makeChunk(firstDocumentId, firstChunkId, 'First source', [1, 0]),
  ], 'test-model');
  await store.replaceDocument(secondDocumentId, [
    makeChunk(secondDocumentId, secondChunkId, 'Second source', [0, 1]),
  ], 'test-model');

  const selected = await store.search([1, 0], {
    documentIds: [firstDocumentId],
    embeddingModel: 'test-model',
    limit: 5,
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].chunk_id, firstChunkId);
  assert.equal(selected[0].document_id, firstDocumentId);
  assert.equal(selected[0].source_filename, 'source.txt');
  assert.equal(selected[0].page_start, 3);
  assert.equal(selected[0].section_name, 'Heading');
  assert.ok(selected[0].similarity_score > 0.99);

  const mismatchedModel = await store.search([1, 0], {
    embeddingModel: 'different-model',
    limit: 5,
  });
  assert.deepEqual(mismatchedModel, []);

  const reopened = createVectorStore(directory);
  const persisted = await reopened.search([1, 0], { embeddingModel: 'test-model', limit: 5 });
  assert.equal(persisted.length, 2);
});

test('replacing and deleting a document avoids stale duplicate chunks', async (t) => {
  const { store } = await createStore(t);
  await store.replaceDocument(firstDocumentId, [
    makeChunk(firstDocumentId, firstChunkId, 'Old content', [1, 0]),
  ], 'test-model');
  await store.replaceDocument(firstDocumentId, [
    makeChunk(firstDocumentId, secondChunkId, 'Updated content', [0, 1]),
  ], 'test-model');

  const replaced = await store.search([0, 1], { documentIds: [firstDocumentId], limit: 5 });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].chunk_id, secondChunkId);
  assert.equal(replaced[0].chunk_text, 'Updated content');

  await store.deleteDocument(firstDocumentId);
  assert.deepEqual(await store.search([0, 1], { limit: 5 }), []);
});
