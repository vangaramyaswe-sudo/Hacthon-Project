import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const documentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedExtensions = new Set(['.pdf', '.docx', '.txt']);

export class DocumentStore {
  constructor(rootDirectory) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.indexPath = path.join(this.rootDirectory, 'documents.json');
    this.documents = new Map();
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.rootDirectory, { recursive: true });

    try {
      const contents = await readFile(this.indexPath, 'utf8');
      const storedDocuments = JSON.parse(contents);
      if (!Array.isArray(storedDocuments)) {
        throw new Error('Document index must contain a JSON array.');
      }
      for (const document of storedDocuments) {
        if (!documentIdPattern.test(document.document_id)) {
          throw new Error('Document index contains an invalid document ID.');
        }
        this.documents.set(document.document_id, document);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const interruptedDocuments = [...this.documents.values()]
      .filter((document) => document.status === 'processing');
    for (const document of interruptedDocuments) {
      this.documents.set(document.document_id, {
        ...document,
        status: 'failed',
        stage: 'failed',
        error: 'Processing was interrupted when the server stopped. Retry processing to continue.',
        updated_at: new Date().toISOString(),
      });
    }
    if (interruptedDocuments.length > 0) await this.persist();
  }

  enqueueWrite(operation) {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.catch(() => {});
    return result;
  }

  async persist() {
    const temporaryPath = `${this.indexPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify([...this.documents.values()], null, 2), {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      await rename(temporaryPath, this.indexPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async saveDocument(document) {
    return this.enqueueWrite(async () => {
      const previous = this.documents.get(document.document_id);
      this.documents.set(document.document_id, document);
      try {
        await this.persist();
      } catch (error) {
        if (previous) this.documents.set(document.document_id, previous);
        else this.documents.delete(document.document_id);
        throw error;
      }
      return { ...document };
    });
  }

  async updateDocument(documentId, updates) {
    return this.enqueueWrite(async () => {
      const previous = this.documents.get(documentId);
      if (!previous) return null;
      const updated = { ...previous, ...updates };
      this.documents.set(documentId, updated);
      try {
        await this.persist();
      } catch (error) {
        this.documents.set(documentId, previous);
        throw error;
      }
      return { ...updated };
    });
  }

  getDocument(documentId) {
    const document = this.documents.get(documentId);
    return document ? { ...document } : null;
  }

  listDocuments() {
    return [...this.documents.values()]
      .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at))
      .map((document) => ({ ...document }));
  }

  findByHash(sha256) {
    const document = [...this.documents.values()].find((item) => item.sha256 === sha256);
    return document ? { ...document } : null;
  }

  getDocumentDirectory(documentId) {
    if (!documentIdPattern.test(documentId)) throw new TypeError('Invalid document ID.');
    return path.join(this.rootDirectory, documentId);
  }

  getOriginalPath(document) {
    if (!allowedExtensions.has(document.extension)) throw new TypeError('Invalid stored document extension.');
    return path.join(this.getDocumentDirectory(document.document_id), `original${document.extension}`);
  }

  async saveOriginal(documentId, extension, buffer) {
    if (!allowedExtensions.has(extension)) throw new TypeError('Invalid document extension.');
    const directory = this.getDocumentDirectory(documentId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `original${extension}`), buffer, { flag: 'wx' });
  }

  async readOriginal(document) {
    return readFile(this.getOriginalPath(document));
  }

  async saveTextArtifacts(documentId, rawText, cleanedText) {
    const directory = this.getDocumentDirectory(documentId);
    await mkdir(directory, { recursive: true });
    const rawPath = path.join(directory, `raw.${randomUUID()}.tmp`);
    const cleanedPath = path.join(directory, `cleaned.${randomUUID()}.tmp`);
    await writeFile(rawPath, rawText, 'utf8');
    await writeFile(cleanedPath, cleanedText, 'utf8');
    try {
      await rename(rawPath, path.join(directory, 'raw.txt'));
      await rename(cleanedPath, path.join(directory, 'cleaned.txt'));
    } catch (error) {
      await rm(rawPath, { force: true });
      await rm(cleanedPath, { force: true });
      throw error;
    }
  }

  async removeDocumentFiles(documentId) {
    await rm(this.getDocumentDirectory(documentId), { recursive: true, force: true });
  }

  async deleteDocumentRecord(documentId) {
    return this.enqueueWrite(async () => {
      const previous = this.documents.get(documentId);
      if (!previous) return false;
      this.documents.delete(documentId);
      try {
        await this.persist();
      } catch (error) {
        this.documents.set(documentId, previous);
        throw error;
      }
      return true;
    });
  }
}
