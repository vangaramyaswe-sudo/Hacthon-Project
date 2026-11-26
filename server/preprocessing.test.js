import assert from 'node:assert/strict';
import test from 'node:test';
import { preprocessExtractedText } from './preprocessing.js';

test('normalizes text and preserves its original value, structure, and page numbers', () => {
  const rawText = '\uFEFF## Cafe\u0301\r\nThis   is a wrapped\r\nparagraph with an\u00a0extra space.\r\n\r\n- First   item\r\n| Name | Value |\r\n| --- | --- |\r\nPage 3\r\n';
  const result = preprocessExtractedText(rawText);

  assert.equal(result.rawText, rawText);
  assert.match(result.cleanedText, /## Café/);
  assert.match(result.cleanedText, /This is a wrapped paragraph with an extra space\./);
  assert.match(result.cleanedText, /- First item/);
  assert.match(result.cleanedText, /\| Name \| Value \|/);
  assert.match(result.cleanedText, /Page 3/);
  assert.doesNotMatch(result.cleanedText, /\r|\u00a0/);
  assert.notEqual(result.cleanedText, result.rawText);
});

test('removes exact repeated page-edge headers but keeps page numbers and body text', () => {
  const repeatedHeader = 'Report generated for internal review';
  const repeatedFooter = 'Confidential copy for staff';
  const repeatedBodyLine = 'Policy details continue here';
  const rawText = [
    `${repeatedHeader}\nExecutive Summary\n\n${repeatedBodyLine}\nEnd of first page.\n${repeatedFooter}\nPage 1`,
    `${repeatedHeader}\nContinued material.\n${repeatedBodyLine}\nEnd of second page.\n${repeatedFooter}\nPage 2`,
  ].join('\f');
  const result = preprocessExtractedText(rawText);

  assert.equal(result.rawText, rawText);
  assert.equal(result.removedRepeatedLines, 4);
  assert.equal(result.cleanedText.includes(repeatedHeader), false);
  assert.equal(result.cleanedText.includes(repeatedFooter), false);
  assert.equal(result.cleanedText.split(repeatedBodyLine).length - 1, 2);
  assert.match(result.cleanedText, /Executive Summary/);
  assert.match(result.cleanedText, /Page 1/);
  assert.match(result.cleanedText, /Page 2/);
  assert.equal(result.cleanedText.split('\f').length, 2);
});

test('does not remove repeated lines without explicit page breaks', () => {
  const repeatedLine = 'Report generated for internal review';
  const result = preprocessExtractedText(`${repeatedLine}\nBody text.\n${repeatedLine}`);

  assert.equal(result.removedRepeatedLines, 0);
  assert.equal(result.cleanedText.split(repeatedLine).length - 1, 2);
});

test('rejects non-string input instead of silently returning empty text', () => {
  assert.throws(() => preprocessExtractedText(null), {
    name: 'TypeError',
    message: 'Raw extracted text must be a string.',
  });
});
