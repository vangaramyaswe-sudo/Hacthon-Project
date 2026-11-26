import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkCleanedText } from './chunking.js';
import { preprocessExtractedText } from './preprocessing.js';

test('puts a short cleaned document into one chunk', () => {
  const cleanedText = preprocessExtractedText('A short document with one paragraph.').cleanedText;
  const chunks = chunkCleanedText(cleanedText, { documentId: 'short-doc' });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_text, cleanedText);
  assert.equal(chunks[0].document_id, 'short-doc');
});

test('splits a long section into bounded chunks', () => {
  const words = Array.from({ length: 180 }, (_, index) => `term${index}`).join(' ');
  const cleanedText = preprocessExtractedText(`## Long Section\n\n${words}`).cleanedText;
  const chunks = chunkCleanedText(cleanedText, { chunkSize: 120, chunkOverlap: 15 });

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.chunk_text.length <= 120));
});

test('overlaps adjacent chunks by a small amount without repeating whole chunks', () => {
  const words = Array.from({ length: 100 }, (_, index) => `word${index}`).join(' ');
  const chunks = chunkCleanedText(words, { chunkSize: 100, chunkOverlap: 20 });

  assert.ok(chunks.length > 1);
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1].chunk_text;
    const current = chunks[index].chunk_text;
    const maximum = Math.min(previous.length, current.length, 20);
    let sharedSuffixLength = 0;
    for (let length = 1; length <= maximum; length += 1) {
      if (previous.endsWith(current.slice(0, length))) sharedSuffixLength = length;
    }
    assert.ok(sharedSuffixLength > 0 && sharedSuffixLength <= 20);
    assert.notEqual(previous, current);
  }
});

test('returns no chunks for empty or whitespace-only text', () => {
  assert.deepEqual(chunkCleanedText(''), []);
  assert.deepEqual(chunkCleanedText(' \n\t\f\n '), []);
});

test('keeps headings and paragraph content while recording section names', () => {
  const cleanedText = preprocessExtractedText(
    '## Introduction\n\nThe first paragraph explains the project.\n\n## Details\n\nA second paragraph contains details.',
  ).cleanedText;
  const chunks = chunkCleanedText(cleanedText, { chunkSize: 500, chunkOverlap: 0 });

  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map((chunk) => chunk.section_name), ['Introduction', 'Details']);
  assert.match(chunks[0].chunk_text, /## Introduction/);
  assert.match(chunks[0].chunk_text, /first paragraph explains the project/);
  assert.match(chunks[1].chunk_text, /second paragraph contains details/);
});

test('assigns unique IDs and sequential indexes', () => {
  const cleanedText = '## Long Section\n\n'.concat(
    Array.from({ length: 80 }, (_, index) => `item${index}`).join(' '),
  );
  const chunks = chunkCleanedText(cleanedText, { chunkSize: 70, chunkOverlap: 10 });

  assert.ok(chunks.length > 1);
  assert.equal(new Set(chunks.map((chunk) => chunk.chunk_id)).size, chunks.length);
  assert.deepEqual(chunks.map((chunk) => chunk.chunk_index), chunks.map((_chunk, index) => index));
});

test('preserves document, filename, page, and heading metadata when available', () => {
  const cleanedText = preprocessExtractedText(
    '## Overview\n\nPage 7\n\nFirst page text.\f## Next Steps\n\nPage 8\n\nSecond page text.',
  ).cleanedText;
  const chunks = chunkCleanedText(cleanedText, {
    documentId: 'doc-123',
    sourceFilename: 'guide.txt',
    chunkSize: 500,
    chunkOverlap: 0,
  });

  assert.deepEqual(chunks.map((chunk) => ({
    document_id: chunk.document_id,
    source_filename: chunk.source_filename,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    section_name: chunk.section_name,
  })), [
    { document_id: 'doc-123', source_filename: 'guide.txt', page_start: 7, page_end: 7, section_name: 'Overview' },
    { document_id: 'doc-123', source_filename: 'guide.txt', page_start: 8, page_end: 8, section_name: 'Next Steps' },
  ]);
});

test('never returns empty chunks and does not lose meaningful text with overlap disabled', () => {
  const cleanedText = preprocessExtractedText(
    `## Facts\n\n${Array.from({ length: 90 }, (_, index) => `Important fact ${index}.`).join('\n\n')}`,
  ).cleanedText;
  const chunks = chunkCleanedText(cleanedText, { chunkSize: 100, chunkOverlap: 0 });
  const normalizeWhitespace = (value) => value.replace(/\s+/gu, ' ').trim();

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.chunk_text.trim().length > 0));
  assert.equal(normalizeWhitespace(chunks.map((chunk) => chunk.chunk_text).join(' ')), normalizeWhitespace(cleanedText));
});

test('rejects invalid chunk settings', () => {
  assert.throws(() => chunkCleanedText('text', { chunkSize: 0 }), /chunkSize must be a positive integer/);
  assert.throws(() => chunkCleanedText('text', { chunkSize: 10, chunkOverlap: 10 }), /chunkOverlap must be an integer/);
});
