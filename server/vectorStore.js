import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';

const TABLE_NAME = 'document_chunks';

export function createVectorStore(databasePath = process.env.LANCEDB_PATH || 'data/lancedb') {
  const resolvedPath = path.resolve(databasePath);
  let connectionPromise;
  let tablePromise;

  async function getConnection() {
    if (!connectionPromise) {
      connectionPromise = (async () => {
        await mkdir(resolvedPath, { recursive: true });
        return connect(resolvedPath);
      })();
    }
    return connectionPromise;
  }

  async function getTable(seedRows = null) {
    if (tablePromise) return tablePromise;

    tablePromise = (async () => {
      const database = await getConnection();
      const names = await database.tableNames();
      if (names.includes(TABLE_NAME)) return database.openTable(TABLE_NAME);
      if (!seedRows?.length) return null;
      return database.createTable(TABLE_NAME, seedRows, { mode: 'create', existOk: true });
    })();

    try {
      return await tablePromise;
    } catch (error) {
      tablePromise = null;
      throw error;
    }
  }

  async function deleteDocument(documentId) {
    const table = await getTable();
    if (!table) return;
    await table.delete(`document_id = '${documentId}'`);
  }

  async function replaceDocument(documentId, chunks, embeddingModel) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error('Cannot store a document without chunks.');
    }
    const rows = chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      chunk_text: chunk.chunk_text,
      vector: chunk.embedding,
      source_filename: chunk.source_filename || '',
      chunk_index: chunk.chunk_index,
      page_start: chunk.page_start ?? -1,
      page_end: chunk.page_end ?? -1,
      section_name: chunk.section_name || '',
      embedding_model: embeddingModel,
    }));

    const table = await getTable(rows);
    if (!table) throw new Error('The local vector table could not be opened.');
    await table.delete(`document_id = '${documentId}'`);
    await table.add(rows);
  }

  async function search(vector, { documentIds = null, embeddingModel = null, limit = 15 } = {}) {
    const table = await getTable();
    if (!table) return [];

    let query = table.vectorSearch(vector).distanceType('cosine').limit(limit);
    const filters = [];
    if (documentIds) {
      if (documentIds.length === 0) return [];
      const literals = documentIds.map((id) => `'${id}'`).join(', ');
      filters.push(`document_id IN (${literals})`);
    }
    if (embeddingModel) filters.push(`embedding_model = '${embeddingModel.replace(/'/g, "''")}'`);
    if (filters.length > 0) query = query.where(filters.join(' AND '));
    const rows = await query.toArray();
    return rows.map((row) => {
      const distance = Number(row._distance);
      const score = Number.isFinite(distance) ? Math.max(-1, Math.min(1, 1 - distance)) : -1;
      return {
        chunk_id: row.chunk_id,
        document_id: row.document_id,
        chunk_index: row.chunk_index,
        chunk_text: row.chunk_text,
        source_filename: row.source_filename || null,
        page_start: row.page_start < 0 ? null : row.page_start,
        page_end: row.page_end < 0 ? null : row.page_end,
        section_name: row.section_name || null,
        embedding_model: row.embedding_model,
        similarity_score: score,
      };
    });
  }

  return { deleteDocument, replaceDocument, search };
}
