import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmbeddingService } from './embeddingService.js';

test('batches embeddings and restores provider result order', async () => {
  const calls = [];
  const client = {
    embeddings: {
      async create({ input }) {
        calls.push(input);
        return {
          data: input.map((text, index) => ({
            index: input.length - index - 1,
            embedding: [text.length, 1],
          })),
        };
      },
    },
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'Answer [id]' } }] }) } },
  };
  const service = createEmbeddingService({ client, batchSize: 2, embeddingModel: 'test-model' });
  const vectors = await service.embedTexts(['a', 'bb', 'ccc']);

  assert.deepEqual(calls, [['a', 'bb'], ['ccc']]);
  assert.deepEqual(vectors, [[2, 1], [1, 1], [3, 1]]);
});

test('missing API key is returned as an explicit configuration error', async () => {
  const service = createEmbeddingService({ apiKey: '' });
  await assert.rejects(service.embedTexts(['text']), {
    statusCode: 503,
    publicMessage: 'OPENAI_API_KEY is missing. Add it to the server-side .env.local file to enable embeddings and chat.',
  });
});
