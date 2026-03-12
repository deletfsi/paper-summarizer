import * as fs from 'fs';
import { Logger } from './logger';

export interface PDFContent {
  text: string;
  pageCount: number;
  metadata?: {
    title?: string;
    author?: string;
    creationDate?: string;
  };
  images?: string[]; // base64 encoded images
}

export interface PDFParserOptions {
  verbose?: boolean;
  maxPages?: number; // Limit number of pages to parse
}

// Custom error class for PDF parsing errors
export class PDFParseError extends Error {
  constructor(message: string, public readonly code: 'FILE_NOT_FOUND' | 'INVALID_PDF' | 'PARSE_ERROR') {
    super(message);
    this.name = 'PDFParseError';
  }
}

/**
 * Parse PDF file and extract text, metadata, and optionally images
 * @param filePath - Path to the PDF file
 * @param options - Parser options (verbose, maxPages)
 * @returns Promise<PDFContent> - Extracted PDF content
 */
export async function parsePDF(filePath: string, options: PDFParserOptions = {}): Promise<PDFContent> {
  const { verbose = false, maxPages } = options;

  // Create logger instance
  const logger = new Logger(verbose);

  logger.info(`Starting PDF parsing: ${filePath}`);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    throw new PDFParseError(`File not found: ${filePath}`, 'FILE_NOT_FOUND');
  }

  // Check file extension
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    logger.warn(`File does not have .pdf extension: ${filePath}`);
  }

  let parser: InstanceType<typeof import('pdf-parse').PDFParse> | null = null;

  try {
    // Read PDF file
    const pdfBuffer = fs.readFileSync(filePath);
    logger.debug(`PDF file size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);

    // Import pdf-parse and create parser
    const { PDFParse } = await import('pdf-parse');

    // Create parser
    parser = new PDFParse({ data: pdfBuffer });

    // Get info to get total pages
    const infoResult = await parser.getInfo();
    const totalPages = infoResult.total || 0;

    logger.info(`PDF parsed successfully`);
    logger.debug(`Number of pages: ${totalPages}`);

    // Extract metadata if available
    const metadata: PDFContent['metadata'] = {};

    if (infoResult.info) {
      const info = infoResult.info as Record<string, unknown>;

      if (info.Title && typeof info.Title === 'string' && info.Title.trim()) {
        metadata.title = info.Title.trim();
        logger.debug(`Found title: ${metadata.title}`);
      }

      if (info.Author && typeof info.Author === 'string' && info.Author.trim()) {
        metadata.author = info.Author.trim();
        logger.debug(`Found author: ${metadata.author}`);
      }

      if (info.CreationDate && typeof info.CreationDate === 'string') {
        metadata.creationDate = info.CreationDate;
        logger.debug(`Found creation date: ${metadata.creationDate}`);
      }
    }

    // Extract text with optional page limit
    const textOptions: { first?: number; last?: number } = {};
    if (maxPages !== undefined && maxPages > 0) {
      textOptions.first = 1;
      textOptions.last = Math.min(maxPages, totalPages);
      logger.debug(`Limiting text extraction to pages 1-${textOptions.last}`);
    }

    const textResult = await parser.getText(textOptions);
    const text = textResult.text || '';

    // Try to extract images (best effort)
    const images: string[] = [];
    try {
      const imageResult = await parser.getImage({
        imageDataUrl: true,
        imageThreshold: 0
      });

      if (imageResult && imageResult.pages) {
        for (const pageImages of imageResult.pages) {
          if (pageImages.images) {
            for (const img of pageImages.images) {
              if (img.dataUrl) {
                images.push(img.dataUrl);
              }
            }
          }
        }
      }

      if (images.length > 0) {
        logger.info(`Extracted ${images.length} image(s)`);
      }
    } catch {
      // Image extraction is best-effort
      logger.debug(`Image extraction not available`);
    }

    // Build result
    const result: PDFContent = {
      text,
      pageCount: totalPages,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      images: images.length > 0 ? images : undefined
    };

    // Log text extraction summary
    const textLength = result.text.length;
    logger.info(`Extracted ${textLength.toLocaleString()} characters from ${result.pageCount} pages`);

    return result;

  } catch (error) {
    // Check if it's already a custom error
    if (error instanceof PDFParseError) {
      throw error;
    }

    // Check if it's a PDF parsing error (invalid PDF)
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('PDF') || errorMessage.includes('parse') || errorMessage.includes('Invalid')) {
      logger.error(`Invalid or corrupted PDF: ${errorMessage}`);
      throw new PDFParseError(`Invalid or corrupted PDF: ${errorMessage}`, 'INVALID_PDF');
    }

    logger.error(`Failed to parse PDF: ${errorMessage}`);
    throw new PDFParseError(`Failed to parse PDF: ${errorMessage}`, 'PARSE_ERROR');
  } finally {
    // Clean up parser
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Quick text extraction (for when you only need text, not metadata)
 * @param filePath - Path to the PDF file
 * @returns Promise<string> - Extracted text
 */
export async function extractText(filePath: string, options: PDFParserOptions = {}): Promise<string> {
  const result = await parsePDF(filePath, options);
  return result.text;
}

/**
 * Get PDF metadata without full text extraction
 * @param filePath - Path to the PDF file
 * @returns Promise<PDFContent['metadata']> - PDF metadata
 */
export async function extractMetadata(filePath: string, options: PDFParserOptions = {}): Promise<PDFContent['metadata']> {
  const { verbose = false } = options;

  // Create logger instance
  const logger = new Logger(verbose);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    throw new PDFParseError(`File not found: ${filePath}`, 'FILE_NOT_FOUND');
  }

  let parser: InstanceType<typeof import('pdf-parse').PDFParse> | null = null;

  try {
    // Read PDF file
    const pdfBuffer = fs.readFileSync(filePath);

    // Import pdf-parse
    const { PDFParse } = await import('pdf-parse');

    // Create parser and get info
    parser = new PDFParse({ data: pdfBuffer });
    const infoResult = await parser.getInfo();

    // Build metadata
    const metadata: PDFContent['metadata'] = {};

    if (infoResult.info) {
      const info = infoResult.info as Record<string, unknown>;

      if (info.Title && typeof info.Title === 'string' && info.Title.trim()) {
        metadata.title = info.Title.trim();
      }

      if (info.Author && typeof info.Author === 'string' && info.Author.trim()) {
        metadata.author = info.Author.trim();
      }

      if (info.CreationDate && typeof info.CreationDate === 'string') {
        metadata.creationDate = info.CreationDate;
      }
    }

    return metadata;

  } catch (error) {
    if (error instanceof PDFParseError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to extract metadata: ${errorMessage}`);
    throw new PDFParseError(`Failed to extract metadata: ${errorMessage}`, 'PARSE_ERROR');
  } finally {
    // Clean up parser
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
