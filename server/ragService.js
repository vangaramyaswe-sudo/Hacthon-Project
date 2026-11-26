const NO_ANSWER = "I couldn't find the answer in the uploaded documents. Please upload a relevant document or ask a question related to the available documents.";
const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createServiceError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function wordShingles(text) {
  const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 4) return new Set(words);
  return new Set(words.slice(0, -2).map((_word, index) =>
    `${words[index]} ${words[index + 1]} ${words[index + 2]}`));
}

function isNearDuplicate(candidate, existing) {
  const normalized = candidate.chunk_text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
  for (const prior of existing) {
    const priorNormalized = prior.chunk_text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    if (normalized === priorNormalized) return true;

    const candidateShingles = wordShingles(normalized);
    const priorShingles = wordShingles(priorNormalized);
    const smaller = Math.min(candidateShingles.size, priorShingles.size);
    if (smaller === 0) continue;
    let shared = 0;
    for (const shingle of candidateShingles) {
      if (priorShingles.has(shingle)) shared += 1;
    }
    const union = candidateShingles.size + priorShingles.size - shared;
    if (union > 0 && shared / union >= 0.9) return true;
  }
  return false;
}

function formatSource(chunk) {
  const page = chunk.page_start === null
    ? 'Not available'
    : chunk.page_start === chunk.page_end
      ? String(chunk.page_start)
      : `${chunk.page_start}-${chunk.page_end}`;
  return [
    `Source: ${chunk.source_filename || 'Unknown filename'}`,
    `Page: ${page}`,
    `Section: ${chunk.section_name || 'Not available'}`,
    `Chunk ID: ${chunk.chunk_id}`,
    'Content:',
    chunk.chunk_text,
  ].join('\n');
}

function buildContext(chunks, maximumCharacters) {
  const included = [];
  let context = '';

  for (const chunk of chunks) {
    const section = formatSource(chunk);
    const separator = included.length > 0 ? '\n\n---\n\n' : '';
    if (context.length + separator.length + section.length > maximumCharacters) continue;
    context += `${separator}${section}`;
    included.push(chunk);
  }
  return { context, included };
}

export function createRagService({
  documentStore,
  vectorStore,
  embeddingService,
  topK = Number(process.env.RAG_TOP_K || 5),
  similarityThreshold = Number(process.env.RAG_SIMILARITY_THRESHOLD || 0.25),
  maximumContextCharacters = Number(process.env.RAG_MAX_CONTEXT_CHARS || 16000),
} = {}) {
  if (!documentStore || !vectorStore || !embeddingService) {
    throw new TypeError('Document store, vector store, and embedding service are required.');
  }
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw new RangeError('RAG_TOP_K must be an integer from 1 to 20.');
  }
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < -1 || similarityThreshold > 1) {
    throw new RangeError('RAG_SIMILARITY_THRESHOLD must be between -1 and 1.');
  }
  if (!Number.isInteger(maximumContextCharacters) || maximumContextCharacters < 1) {
    throw new RangeError('RAG_MAX_CONTEXT_CHARS must be a positive integer.');
  }

  async function answer(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw createServiceError('The chat request must be a JSON object.', 400);
    }
    const { question, documentIds, limit = topK } = input;
    if (typeof question !== 'string' || !question.trim()) {
      throw createServiceError('Enter a question about the uploaded documents.', 400);
    }
    if (question.length > 2000) {
      throw createServiceError('Questions must be 2,000 characters or fewer.', 400);
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw createServiceError('The retrieval limit must be an integer from 1 to 20.', 400);
    }
    if (documentIds !== undefined && (
      !Array.isArray(documentIds) ||
      documentIds.length > 100 ||
      documentIds.some((id) => typeof id !== 'string' || !documentIdPattern.test(id))
    )) {
      throw createServiceError('Selected document IDs are invalid.', 400);
    }

    const readyDocuments = documentStore.listDocuments().filter((document) => document.status === 'ready');
    let selectedIds = readyDocuments.map((document) => document.document_id);
    if (documentIds !== undefined) {
      const requestedIds = [...new Set(documentIds)];
      const found = requestedIds.map((id) => documentStore.getDocument(id));
      if (found.some((document) => !document)) {
        throw createServiceError('One or more selected documents were not found.', 404);
      }
      if (found.some((document) => document.status !== 'ready')) {
        throw createServiceError('One or more selected documents are not ready for chat.', 409);
      }
      selectedIds = requestedIds;
    }
    if (selectedIds.length === 0) return { answer: NO_ANSWER, sources: [] };

    const [questionEmbedding] = await embeddingService.embedTexts([question.trim()]);
    if (!Array.isArray(questionEmbedding) || questionEmbedding.length === 0 ||
      questionEmbedding.some((value) => !Number.isFinite(value))) {
      throw new Error('Question embedding generation returned an invalid vector.');
    }

    const matches = await vectorStore.search(questionEmbedding, {
      documentIds: selectedIds,
      embeddingModel: embeddingService.embeddingModel,
      limit: limit * 4,
    });
    const relevant = [];
    for (const match of matches) {
      if (!Number.isFinite(match.similarity_score) || match.similarity_score < similarityThreshold) continue;
      if (isNearDuplicate(match, relevant)) continue;
      relevant.push(match);
      if (relevant.length === limit) break;
    }
    if (relevant.length === 0) return { answer: NO_ANSWER, sources: [] };

    const { context, included } = buildContext(relevant, maximumContextCharacters);
    if (included.length === 0) return { answer: NO_ANSWER, sources: [] };

    const generatedAnswer = await embeddingService.generateAnswer(question.trim(), context);
    const validChunks = new Map(included.map((chunk) => [chunk.chunk_id.toLowerCase(), chunk]));
    const citations = [...generatedAnswer.matchAll(/\[([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]/gi)]
      .map((match) => match[1].toLowerCase());
    if (citations.length === 0 || citations.some((chunkId) => !validChunks.has(chunkId))) {
      return { answer: NO_ANSWER, sources: [] };
    }

    const citedIds = [...new Set(citations)];
    return {
      answer: generatedAnswer,
      sources: citedIds.map((chunkId) => {
        const chunk = validChunks.get(chunkId);
        return {
          chunk_id: chunk.chunk_id,
          document_id: chunk.document_id,
          source_filename: chunk.source_filename,
          page_start: chunk.page_start,
          page_end: chunk.page_end,
          section_name: chunk.section_name,
          similarity_score: chunk.similarity_score,
        };
      }),
    };
  }

  return { answer };
}
