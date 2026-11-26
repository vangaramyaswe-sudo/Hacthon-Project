const unicodeSpaces = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu;
const pageNumber = /^(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;
const pageLabel = /^page\s+[ivxlcdm]+(?:\s*(?:of|\/)\s*[ivxlcdm]+)?$/i;
const listLine = /^\s*(?:[-*+•‣▪]\s+|\d+[.)]\s+|[a-z][.)]\s+)/i;
const separatorLine = /^\s*(?:[-_=*~]){3,}\s*$/;

function normalizeRawText(rawText) {
  if (typeof rawText !== 'string') {
    throw new TypeError('Raw extracted text must be a string.');
  }

  return rawText
    .normalize('NFC')
    .replace(/\uFEFF/g, '')
    .replace(/\u200B/g, '')
    .replace(unicodeSpaces, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, (character) =>
      character === '\n' || character === '\t' || character === '\f' ? character : '');
}

function isPageNumber(line) {
  const value = line.trim();
  return pageNumber.test(value) || pageLabel.test(value);
}

function isTableLine(line) {
  return line.includes('\t') || line.includes('|') || /\S {2,}\S.*\S {2,}\S/.test(line);
}

export function isHeadingLine(line) {
  if (isPageNumber(line) || listLine.test(line) || isTableLine(line)) return false;

  const value = line.trim();
  if (
    /^#{1,6}\s/.test(value) ||
    /^(?:chapter|section|appendix|part|article)\b/i.test(value) ||
    /^\d+(?:\.\d+)*[.)]?\s+\S/.test(value) ||
    value.endsWith(':')
  ) {
    return true;
  }

  const words = value.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  return words.length > 0 && words.every((word) => {
    const firstLetter = word.match(/\p{L}/u)?.[0];
    return firstLetter === firstLetter.toLocaleUpperCase();
  });
}

function isStructuralLine(line) {
  return isHeadingLine(line) || listLine.test(line) || isTableLine(line) || isPageNumber(line);
}

function comparableLine(line) {
  return line.trim().replace(/\s+/g, ' ');
}

function findRepeatedBoundaryLines(pages) {
  const removedLines = new Set();
  if (pages.length < 2) return removedLines;

  for (const edge of ['header', 'footer']) {
    const occurrences = new Map();
    pages.forEach((page, pageIndex) => {
      const lines = page.split('\n');
      const nonEmptyIndexes = lines
        .map((line, index) => line.trim() ? index : -1)
        .filter((index) => index >= 0);
      const boundaryIndexes = edge === 'header'
        ? nonEmptyIndexes.slice(0, 2)
        : nonEmptyIndexes.slice(-2);

      for (const lineIndex of boundaryIndexes) {
        const line = lines[lineIndex];
        const value = comparableLine(line);
        if (
          value.length < 8 ||
          isStructuralLine(line) ||
          /[.!?;:]$/.test(value)
        ) {
          continue;
        }

        if (!occurrences.has(value)) occurrences.set(value, new Map());
        const pagesForLine = occurrences.get(value);
        if (!pagesForLine.has(pageIndex)) pagesForLine.set(pageIndex, []);
        pagesForLine.get(pageIndex).push(lineIndex);
      }
    });

    for (const pagesForLine of occurrences.values()) {
      if (pagesForLine.size < 2) continue;
      for (const [pageIndex, lineIndexes] of pagesForLine) {
        for (const lineIndex of lineIndexes) {
          removedLines.add(`${pageIndex}:${lineIndex}`);
        }
      }
    }
  }

  return removedLines;
}

function joinWrappedLines(lines) {
  return lines.reduce((joined, line) => {
    if (!joined) return line;
    return /[-\u2010]$/u.test(joined) ? `${joined}${line}` : `${joined} ${line}`;
  }, '');
}

function formatStructuralLine(line) {
  if (isTableLine(line)) return line.trim();
  const indentation = line.match(/^[ \t]*/)?.[0] ?? '';
  return `${indentation}${line.trim().replace(/ {2,}/g, ' ')}`;
}

function cleanPage(page, pageIndex, removedLines) {
  const output = [];
  let paragraph = [];

  const addBlankLine = () => {
    if (output.length > 0 && output[output.length - 1] !== '') output.push('');
  };
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(joinWrappedLines(paragraph));
      paragraph = [];
    }
  };

  page.split('\n').forEach((rawLine, lineIndex) => {
    if (removedLines.has(`${pageIndex}:${lineIndex}`)) return;

    const trimmed = rawLine.trim();
    if (!trimmed || separatorLine.test(trimmed)) {
      flushParagraph();
      addBlankLine();
      return;
    }

    if (isStructuralLine(rawLine)) {
      flushParagraph();
      addBlankLine();
      output.push(formatStructuralLine(rawLine));
      addBlankLine();
      return;
    }

    paragraph.push(rawLine.replace(/[ \t]+$/g, '').trim().replace(/ {2,}/g, ' '));
  });

  flushParagraph();
  while (output[0] === '') output.shift();
  while (output[output.length - 1] === '') output.pop();
  return output.join('\n');
}

export function preprocessExtractedText(rawText) {
  const normalizedText = normalizeRawText(rawText);
  const pages = normalizedText.split('\f');
  const removedLines = findRepeatedBoundaryLines(pages);
  const cleanedPages = pages.map((page, index) => cleanPage(page, index, removedLines));

  return {
    rawText,
    cleanedText: cleanedPages.join('\f'),
    removedRepeatedLines: removedLines.size,
  };
}
