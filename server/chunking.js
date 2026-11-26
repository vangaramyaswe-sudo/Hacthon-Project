import { randomUUID } from 'node:crypto';
import { isHeadingLine } from './preprocessing.js';

const DEFAULT_CHUNK_SIZE = 2000;
const DEFAULT_CHUNK_OVERLAP = 200;
const sentenceAbbreviations = /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|fig|no)\.$/i;

function collectBoundaries(text) {
  const paragraph = [];
  const sentence = [];
  const line = [];
  const word = [];

  for (const match of text.matchAll(/\n[ \t]*\n+|\f/g)) {
    paragraph.push(match.index + match[0].length);
  }
  for (const match of text.matchAll(/\n+|\f/g)) {
    line.push(match.index + match[0].length);
  }
  for (const match of text.matchAll(/\s+/gu)) {
    word.push(match.index + match[0].length);
  }

  for (let index = 0; index < text.length; index += 1) {
    if (!'.!?'.includes(text[index])) continue;

    let boundary = index + 1;
    while (/[)"'”’\]}]/u.test(text[boundary] || '')) boundary += 1;
    if (boundary < text.length && !/\s/u.test(text[boundary])) continue;

    if (text[index] === '.') {
      const previous = text.slice(Math.max(0, index - 12), index + 1);
      if (/\d\.\d$/.test(previous) || sentenceAbbreviations.test(previous)) continue;
    }

    while (boundary < text.length && /\s/u.test(text[boundary])) boundary += 1;
    sentence.push(boundary);
  }

  return { paragraph, sentence, line, word };
}

function lastBoundaryInRange(boundaries, minimum, maximum) {
  let selected = null;
  for (const boundary of boundaries) {
    if (boundary > maximum) break;
    if (boundary >= minimum) selected = boundary;
  }
  return selected;
}

function safeCut(text, index) {
  if (
    index > 0 &&
    index < text.length &&
    text.charCodeAt(index - 1) >= 0xd800 &&
    text.charCodeAt(index - 1) <= 0xdbff &&
    text.charCodeAt(index) >= 0xdc00 &&
    text.charCodeAt(index) <= 0xdfff
  ) {
    return index - 1;
  }
  return index;
}

function chooseChunkEnd(text, start, sectionEnd, chunkSize, boundaries) {
  const limit = Math.min(start + chunkSize, sectionEnd);
  if (limit === sectionEnd) return limit;

  const minimum = start + Math.max(1, Math.floor(chunkSize / 2));
  for (const priority of [boundaries.paragraph, boundaries.sentence, boundaries.line, boundaries.word]) {
    const boundary = lastBoundaryInRange(priority, minimum, limit);
    if (boundary !== null) return boundary;
  }

  const wordBoundary = lastBoundaryInRange(boundaries.word, start + 1, limit);
  return safeCut(text, wordBoundary ?? limit);
}

function chooseNextStart(start, end, overlap, wordBoundaries) {
  if (overlap === 0) return end;

  const target = Math.max(start + 1, end - overlap);
  for (const boundary of wordBoundaries) {
    if (boundary >= target && boundary < end) return boundary;
  }
  return end;
}

function getHeadingMarkers(text) {
  const markers = [];
  let start = 0;

  while (start < text.length) {
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\f') end += 1;
    const line = text.slice(start, end).trim();
    if (line && isHeadingLine(line)) {
      markers.push({
        start,
        name: line.replace(/^#{1,6}\s*/, '').trim(),
      });
    }
    start = end < text.length ? end + 1 : text.length;
  }

  return markers;
}

function getSections(text) {
  const sections = [];
  let start = 0;
  let sectionName = null;

  for (const heading of getHeadingMarkers(text)) {
    if (heading.start > start) {
      sections.push({ start, end: heading.start, sectionName });
    }
    start = heading.start;
    sectionName = heading.name;
  }

  if (start < text.length) sections.push({ start, end: text.length, sectionName });
  return sections;
}

function getVisiblePageNumber(pageText) {
  const lines = pageText.split('\n').map((line) => line.trim()).filter(Boolean);
  const boundaryLines = [...lines.slice(0, 2), ...lines.slice(-2)];

  for (const line of boundaryLines) {
    const match = line.match(/^page\s+(\d+)(?:\s*(?:of|\/)\s*\d+)?$/i);
    if (match) return Number(match[1]);
  }
  for (const line of boundaryLines) {
    if (/^\d+$/.test(line)) return Number(line);
  }
  return null;
}

function getPageRanges(text) {
  if (!text.includes('\f')) return [];

  const pages = [];
  let start = 0;
  let pageIndex = 1;
  for (const match of text.matchAll(/\f/g)) {
    if (match.index > start) {
      const pageText = text.slice(start, match.index);
      pages.push({
        start,
        end: match.index,
        number: getVisiblePageNumber(pageText) ?? pageIndex,
      });
    }
    start = match.index + 1;
    pageIndex += 1;
  }
  if (start < text.length) {
    const pageText = text.slice(start);
    pages.push({
      start,
      end: text.length,
      number: getVisiblePageNumber(pageText) ?? pageIndex,
    });
  }
  return pages;
}

function getPageMetadata(start, end, pages) {
  const touchedPages = pages.filter((page) => start < page.end && end > page.start);
  if (touchedPages.length === 0) return { page_start: null, page_end: null };
  return {
    page_start: touchedPages[0].number,
    page_end: touchedPages[touchedPages.length - 1].number,
  };
}

function splitSection(text, section, options, boundaries, pages, documentId, sourceFilename) {
  const chunks = [];
  let start = section.start;

  while (start < section.end) {
    if (!text.slice(start, section.end).trim()) break;

    const end = chooseChunkEnd(text, start, section.end, options.chunkSize, boundaries);
    const rawChunkText = text.slice(start, end);
    const leadingWhitespace = rawChunkText.length - rawChunkText.trimStart().length;
    const trailingWhitespace = rawChunkText.length - rawChunkText.trimEnd().length;
    const contentStart = start + leadingWhitespace;
    const contentEnd = end - trailingWhitespace;
    const chunkText = text.slice(contentStart, contentEnd);

    if (chunkText.trim()) {
      chunks.push({
        chunk_text: chunkText,
        contentStart,
        contentEnd,
        sectionName: section.sectionName,
        ...getPageMetadata(contentStart, contentEnd, pages),
      });
    }

    if (end >= section.end) break;
    const nextStart = chooseNextStart(start, end, options.chunkOverlap, boundaries.word);
    start = nextStart > start && nextStart < end ? nextStart : end;
  }

  return chunks.map((chunk) => ({
    chunk_id: randomUUID(),
    document_id: documentId,
    chunk_index: 0,
    chunk_text: chunk.chunk_text,
    source_filename: sourceFilename,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    section_name: chunk.sectionName,
  }));
}

export function chunkCleanedText(cleanedText, options = {}) {
  if (typeof cleanedText !== 'string') {
    throw new TypeError('Cleaned text must be a string.');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Chunking options must be an object.');
  }

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const documentId = options.documentId ?? randomUUID();
  const sourceFilename = options.sourceFilename ?? null;

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError('chunkSize must be a positive integer.');
  }
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new RangeError('chunkOverlap must be an integer from 0 up to (but not including) chunkSize.');
  }
  if (typeof documentId !== 'string' || !documentId.trim()) {
    throw new TypeError('documentId must be a non-empty string.');
  }
  if (sourceFilename !== null && typeof sourceFilename !== 'string') {
    throw new TypeError('sourceFilename must be a string or null.');
  }

  const boundaries = collectBoundaries(cleanedText);
  const pages = getPageRanges(cleanedText);
  const chunks = getSections(cleanedText).flatMap((section) =>
    splitSection(
      cleanedText,
      section,
      { chunkSize, chunkOverlap },
      boundaries,
      pages,
      documentId,
      sourceFilename,
    ));

  return chunks.map((chunk, index) => ({ ...chunk, chunk_index: index }));
}
