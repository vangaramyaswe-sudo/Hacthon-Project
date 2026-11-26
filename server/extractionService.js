import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';

const allowedExtensions = new Set(['.pdf', '.docx', '.txt']);
const acceptedMimeTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/octet-stream',
]);

export function validateUploadedFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw Object.assign(new Error('Choose a document to upload.'), { statusCode: 400 });
  }
  if (file.buffer.length === 0) {
    throw Object.assign(new Error('The uploaded file is empty.'), { statusCode: 400 });
  }
  const extension = path.extname(file.originalname).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw Object.assign(new Error('Choose a PDF, DOCX, or TXT file.'), { statusCode: 415 });
  }
  if (file.mimetype && !acceptedMimeTypes.has(file.mimetype)) {
    throw Object.assign(new Error('The file content type does not match a supported document.'), { statusCode: 415 });
  }
  if (extension === '.pdf' && !file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw Object.assign(new Error('The file does not appear to be a valid PDF.'), { statusCode: 415 });
  }
  if (extension === '.docx' && file.buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    throw Object.assign(new Error('The file does not appear to be a valid DOCX document.'), { statusCode: 415 });
  }
  if (extension === '.txt') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      throw Object.assign(new Error('TXT documents must use valid UTF-8 text.'), { statusCode: 415 });
    }
  }

  return extension;
}

export async function extractDocumentText(buffer, extension) {
  if (extension === '.txt') {
    return {
      rawText: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      pageCount: null,
    };
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return { rawText: result.value, pageCount: null };
  }

  if (extension === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const pages = result.pages || [];
      const rawText = pages.length > 0
        ? pages.map((page) => `Page ${page.num}\n${page.text}`).join('\f')
        : result.text;
      return { rawText, pageCount: pages.length || null };
    } finally {
      await parser.destroy();
    }
  }

  throw Object.assign(new Error('Unsupported document format.'), { statusCode: 415 });
}
