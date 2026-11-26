import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDocumentText, validateUploadedFile } from './extractionService.js';

test('validates and extracts UTF-8 text without changing its contents', async () => {
  const text = '# Title\n\nA sentence with meaningful content.\n';
  const file = {
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
  };

  assert.equal(validateUploadedFile(file), '.txt');
  assert.deepEqual(await extractDocumentText(file.buffer, '.txt'), {
    rawText: text,
    pageCount: null,
  });
});

test('rejects empty files, unsupported formats, and invalid PDF signatures', () => {
  assert.throws(() => validateUploadedFile({
    originalname: 'empty.txt',
    buffer: Buffer.alloc(0),
  }), { statusCode: 400 });
  assert.throws(() => validateUploadedFile({
    originalname: 'script.exe',
    buffer: Buffer.from('not a document'),
  }), { statusCode: 415 });
  assert.throws(() => validateUploadedFile({
    originalname: 'broken.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('not a PDF'),
  }), { statusCode: 415 });
});
