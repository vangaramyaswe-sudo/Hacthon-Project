import assert from 'node:assert/strict';
import test from 'node:test';
import { createRagService } from './ragService.js';

const firstDocumentId = 'c0a80123-4567-489a-8abc-123456789abc';
const firstChunkId = 'e0a80123-4567-489a-8abc-123456789abc';

function createHarness({
  matches = [],
  generatedAnswer = `[${firstChunkId}] The document says the answer is 42.`,
  threshold = 0.25,
  maximumContextCharacters = 16000,
} = {}) {
  const documents = [
    { document_id: firstDocumentId, status: 'ready' },
  ];
  const embedCalls = [];
  const searchCalls = [];
  const generationCalls = [];
  const documentStore = {
    listDocuments: () => documents,
    getDocument: (id) => documents.find((document) => document.document_id === id) || null,
  };
  const vectorStore = {
    async search(vector, options) {
      searchCalls.push({ vector, options });
      return matches;
    },
  };
  const embeddingService = {
    embeddingModel: 'test-model',
    async embedTexts(texts) {
      embedCalls.push(texts);
      return [[0.1, 0.2, 0.3]];
    },
    async generateAnswer(question, context) {
      generationCalls.push({ question, context });
      return generatedAnswer;
    },
  };
  const service = createRagService({
    documentStore,
    vectorStore,
    embeddingService,
    similarityThreshold: threshold,
    maximumContextCharacters,
  });
  return { embedCalls, generationCalls, searchCalls, service };
}

function createMatch(chunkId = firstChunkId, documentId = firstDocumentId, similarity = 0.9) {
  return {
    chunk_id: chunkId,
    document_id: documentId,
    chunk_index: 0,
    chunk_text: 'The document says the answer is 42.',
    source_filename: 'notes.txt',
    page_start: 2,
    page_end: 2,
    section_name: 'Summary',
    similarity_score: similarity,
  };
}

test('embeds the question, searches selected documents with matching model, and returns cited sources', async () => {
  const harness = createHarness({ matches: [createMatch()] });
  const result = await harness.service.answer({
    question: 'What is the answer?',
    documentIds: [firstDocumentId],
  });

  assert.equal(result.answer, `[${firstChunkId}] The document says the answer is 42.`);
  assert.equal(harness.embedCalls.length, 1);
  assert.deepEqual(harness.embedCalls[0], ['What is the answer?']);
  assert.deepEqual(harness.searchCalls[0].options.documentIds, [firstDocumentId]);
  assert.equal(harness.searchCalls[0].options.embeddingModel, 'test-model');
  assert.match(harness.generationCalls[0].context, /Source: notes.txt/);
  assert.match(harness.generationCalls[0].context, /Page: 2/);
  assert.match(harness.generationCalls[0].context, /Section: Summary/);
  assert.deepEqual(result.sources.map((source) => source.chunk_id), [firstChunkId]);
});

test('returns the exact not-found response and skips the model for low-confidence results', async () => {
  const harness = createHarness({ matches: [createMatch(firstChunkId, firstDocumentId, 0.1)] });
  const result = await harness.service.answer({ question: 'Unrelated question' });

  assert.equal(result.answer, "I couldn't find the answer in the uploaded documents. Please upload a relevant document or ask a question related to the available documents.");
  assert.deepEqual(result.sources, []);
  assert.equal(harness.generationCalls.length, 0);
});

test('rejects unsupported citation IDs instead of returning an uncited answer', async () => {
  const harness = createHarness({
    matches: [createMatch()],
    generatedAnswer: '[aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa] An unsupported answer.',
  });
  const result = await harness.service.answer({ question: 'What is the answer?' });

  assert.match(result.answer, /^I couldn't find the answer/);
  assert.deepEqual(result.sources, []);
});

test('validates empty or malformed chat requests and selected document IDs', async () => {
  const harness = createHarness();
  await assert.rejects(harness.service.answer({ question: '  ' }), { statusCode: 400 });
  await assert.rejects(harness.service.answer(null), { statusCode: 400 });
  await assert.rejects(
    harness.service.answer({ question: 'Question', documentIds: ['not-an-id'] }),
    { statusCode: 400 },
  );
});

test('empty document selection does not search the vector database', async () => {
  const harness = createHarness();
  const result = await harness.service.answer({ question: 'Question', documentIds: [] });

  assert.match(result.answer, /^I couldn't find the answer/);
  assert.equal(harness.embedCalls.length, 0);
  assert.equal(harness.searchCalls.length, 0);
});
