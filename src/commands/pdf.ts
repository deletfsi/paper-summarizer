import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { Logger } from '../utils/logger';
import { parsePDF } from '../utils/pdfParser';
import { createSummarizer } from '../services/summarizer';
import { extractFormulas } from '../utils/formulaParser';
import { extractMetadata } from '../utils/metadataExtractor';
import { PaperManager } from '../services/paperManager';
import { convertToMarkdown } from '../utils/paperToMarkdown';
import { fetchPaper } from '../services/fetcher';

export interface PdfCommandOptions {
  verbose: boolean;
  summarize?: boolean;
}

/**
 * Check if the input is a local file path (Windows or Unix)
 */
function isLocalFilePath(input: string): boolean {
  // Check if file exists directly
  if (fs.existsSync(input)) {
    return true;
  }

  // Handle Windows paths: C:\, D:\, etc.
  if (/^[a-zA-Z]:\\/.test(input)) {
    return fs.existsSync(input);
  }

  // Handle Unix paths
  if (input.startsWith('/')) {
    return fs.existsSync(input);
  }

  // Handle paths with forward slashes on Windows
  if (input.includes('/') && !input.startsWith('http')) {
    const convertedPath = input.replace(/\//g, path.sep);
    return fs.existsSync(convertedPath);
  }

  return false;
}

/**
 * Convert various path formats to local path
 */
function convertToLocalPath(input: string): string {
  // If already exists, return as-is
  if (fs.existsSync(input)) {
    return input;
  }

  // Handle Windows paths: C:\, D:\, etc.
  if (/^[a-zA-Z]:\\/.test(input)) {
    return input;
  }

  // Handle paths with forward slashes on Windows
  if (input.includes('/') && !input.startsWith('http')) {
    const convertedPath = input.replace(/\//g, path.sep);
    if (fs.existsSync(convertedPath)) {
      return convertedPath;
    }
  }

  // Handle Unix paths
  if (input.startsWith('/')) {
    return input;
  }

  return input;
}

/**
 * Extract filename from URL path
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = path.basename(pathname);

    // If filename has extension and is not empty, use it
    if (filename && filename.includes('.')) {
      return filename;
    }
  } catch {
    // Invalid URL, fall through to default
  }
  return 'download.pdf';
}

/**
 * Ensure downloads directory exists
 */
function ensureDownloadsDir(): string {
  const downloadsDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  return downloadsDir;
}

/**
 * Download file from URL using Node.js http/https modules
 */
function downloadFile(url: string, logger: Logger): Promise<{ filePath: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const fileName = extractFilenameFromUrl(url);
    const downloadsDir = ensureDownloadsDir();
    const filePath = path.join(downloadsDir, fileName);

    logger.info(`Downloading PDF from: ${url}`);
    logger.info(`Saving to: ${filePath}`);

    const request = protocol.get(url, {
      timeout: 30000 // 30 second timeout
    }, (response) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          // Build full URL from redirect location
          let fullRedirectUrl: string;
          try {
            fullRedirectUrl = new URL(redirectUrl, url).href;
          } catch {
            // If relative URL fails, use original URL
            fullRedirectUrl = redirectUrl;
          }
          logger.info(`Following redirect to: ${fullRedirectUrl}`);
          // Recursively handle the redirect - return to stop current execution
          return downloadFile(fullRedirectUrl, logger).then(resolve).catch(reject);
        }
      }

      // Check status code
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP Error: ${response.statusCode} ${response.statusMessage}`));
        return;
      }

      // Check Content-Type to verify it's a PDF
      const contentType = response.headers['content-type'] || '';
      logger.debug(`Content-Type: ${contentType}`);

      // Some servers don't set content-type correctly, so we also check the file extension
      const isPdfContentType = contentType.includes('application/pdf');
      const isPdfExtension = fileName.toLowerCase().endsWith('.pdf');

      if (!isPdfContentType && !isPdfExtension) {
        logger.warn(`Content-Type is "${contentType}", expected "application/pdf"`);
        logger.warn('Proceeding with download anyway (some servers may not set correct Content-Type)');
      }

      // Create write stream
      const fileStream = fs.createWriteStream(filePath);

      // Handle errors on the response
      response.on('error', (err) => {
        fileStream.close();
        fs.unlink(filePath, () => {}); // Clean up partial file
        reject(new Error(`Response error: ${err.message}`));
      });

      // Pipe the response to file
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        logger.success(`PDF downloaded successfully: ${fileName}`);
        resolve({ filePath, fileName });
      });

      fileStream.on('error', (err) => {
        fileStream.close();
        fs.unlink(filePath, () => {}); // Clean up partial file
        reject(new Error(`File write error: ${err.message}`));
      });
    });

    // Handle request errors
    request.on('error', (err) => {
      reject(new Error(`Request error: ${err.message}`));
    });

    // Handle timeout
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timeout (30 seconds)'));
    });
  });
}

export async function pdfCommand(url: string, options: PdfCommandOptions): Promise<void> {
  // Create logger instance for this module
  const verboseLogger = new Logger(options.verbose);
  const shouldSummarize = options.summarize || false;

  verboseLogger.log(`Processing PDF: ${url}`);

  // Validate input
  if (!url || url.trim() === '') {
    verboseLogger.error('PDF path/URL cannot be empty');
    process.exit(1);
  }

  // Check if it's a local file path
  let filePath: string;
  let fileName: string;

  // Try to detect if it's a local file
  const isLocal = isLocalFilePath(url);
  verboseLogger.info(`isLocalFilePath result: ${isLocal} for input: ${url}`);

  if (isLocal) {
    // Local file path
    filePath = convertToLocalPath(url);
    fileName = path.basename(filePath);
    verboseLogger.log(`Using local PDF file: ${filePath}`);

    // Verify it's a PDF
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      verboseLogger.warn('File does not have .pdf extension, proceeding anyway');
    }
  } else {
    // Assume it's a URL - validate URL format
    try {
      new URL(url);
    } catch {
      verboseLogger.error('Invalid URL format or file does not exist');
      process.exit(1);
    }

    // Check if URL uses http or https
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        verboseLogger.error('URL must start with http:// or https://');
        process.exit(1);
      }
    } catch {
      verboseLogger.error('Invalid URL format');
      process.exit(1);
    }

    // Download the file - use fetcher to support IEEE and other sources
    try {
      verboseLogger.log(`Fetching PDF from URL: ${url}`);
      const fetchResult = await fetchPaper(url, { verbose: options.verbose });
      // Save the fetched buffer to a temp file
      const downloadsDir = ensureDownloadsDir();
      fileName = fetchResult.filename;
      filePath = path.join(downloadsDir, fileName);
      fs.writeFileSync(filePath, fetchResult.buffer);
      verboseLogger.success(`PDF downloaded successfully: ${fileName}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      verboseLogger.error(`Failed to download PDF: ${errorMessage}`);
      process.exit(1);
    }
  }

  // Initialize paper manager
  const paperManager = new PaperManager({ verbose: options.verbose });

  // Save PDF to paper directory
  const paperId = path.basename(fileName, '.pdf').replace(/[^a-zA-Z0-9_-]/g, '_');
  const source = url.startsWith('http') ? 'web' : 'local';
  const pdfBuffer = fs.readFileSync(filePath);
  const savedPdfPath = paperManager.savePDF(pdfBuffer, paperId, source);
  verboseLogger.success(`PDF saved to: ${savedPdfPath}`);

  // Print file info
  console.log(`\n文件: ${fileName}`);
  console.log(`原始路径: ${filePath}`);
  console.log(`保存位置: ${savedPdfPath}`);

  // Verify the file exists and has content
  const stats = fs.statSync(savedPdfPath);
  if (stats.size > 0) {
    verboseLogger.info(`File size: ${(stats.size / 1024).toFixed(2)} KB`);
  } else {
    verboseLogger.warn('File is empty');
  }

  console.log(`\n论文目录: ${paperManager.getPaperPaths(paperId, source).paperDir}`);

  // Parse PDF and generate summary if requested
  if (shouldSummarize) {
    verboseLogger.log(`Parsing PDF content...`);
    const pdfContent = await parsePDF(savedPdfPath, { verbose: options.verbose });
    verboseLogger.success(`Extracted ${pdfContent.text.length} characters from ${pdfContent.pageCount} pages`);

    // Convert to Markdown
    verboseLogger.log(`Converting to Markdown...`);
    const markdownResult = convertToMarkdown(pdfContent);
    const mdPath = paperManager.saveMarkdown(markdownResult.markdown, paperId, source);
    verboseLogger.success(`Markdown saved to: ${mdPath}`);
    console.log(`\nMarkdown 保存位置: ${mdPath}`);

    // Extract images
    if (pdfContent.images && pdfContent.images.length > 0) {
      verboseLogger.info(`Extracting ${pdfContent.images.length} images...`);
      for (let i = 0; i < pdfContent.images.length; i++) {
        const base64Data = pdfContent.images[i].replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        paperManager.saveImage(imageBuffer, paperId, i + 1);
      }
      verboseLogger.success(`Images saved to: ${paperManager.getPaperPaths(paperId, source).imagesDir}`);
    }

    // Extract formulas
    const formulasResult = extractFormulas(pdfContent.text);
    if (formulasResult.formulas.length > 0) {
      verboseLogger.info(`Found ${formulasResult.formulas.length} formulas`);
    }

    // Extract metadata
    const metadata = extractMetadata(pdfContent.text);
    if (metadata.codeUrls.length > 0) {
      verboseLogger.info(`Found ${metadata.codeUrls.length} code URL(s)`);
    }

    // Generate summary using LLM
    verboseLogger.log(`Generating paper summary (this may take a while)...`);
    const summarizer = createSummarizer(options.verbose);

    try {
      const summary = await summarizer.summarize(pdfContent.text, { verbose: options.verbose });

      console.log('\n=== Paper Summary ===');
      console.log(`\n一句话概括: ${summary.oneLineSummary}`);
      console.log(`\n任务与问题: ${summary.taskAndProblem}`);
      console.log(`\n核心创新: ${summary.coreInnovation}`);
      console.log(`\nSOTA对比: ${summary.sotaComparison}`);
      console.log(`\n数据流与架构: ${summary.dataFlowAndArchitecture}`);
      console.log(`\n训练与测试环境: ${summary.trainingAndTesting}`);
      console.log(`\n算力与部署: ${summary.computeAndDeployment}`);
      console.log(`\n消融实验: ${summary.ablationStudy}`);
      console.log(`\n边界与失败案例: ${summary.failureCases}`);
      console.log(`\n假设与局限: ${summary.assumptionsAndLimitations}`);
      console.log(`\n术语解释: ${summary.terminologyExplanation}`);
      console.log(`\n优劣势分析: ${summary.prosAndCons}`);

      // Print references
      if (metadata.codeUrls.length > 0) {
        console.log('\n=== Code Resources ===');
        metadata.codeUrls.forEach(codeUrl => console.log(`- ${codeUrl}`));
      }

      if (metadata.datasetUrls.length > 0) {
        console.log('\n=== Dataset Resources ===');
        metadata.datasetUrls.forEach(url => console.log(`- ${url}`));
      }

      if (metadata.modelUrls.length > 0) {
        console.log('\n=== Model Resources ===');
        metadata.modelUrls.forEach(url => console.log(`- ${url}`));
      }

      verboseLogger.success('Paper summary generated successfully!');
    } catch (llmError) {
      verboseLogger.warn(`Failed to generate summary: ${(llmError as Error).message}`);
      console.log('\nNote: LLM summarization failed. Install and run Ollama to enable AI summarization.');
      console.log('Run: curl -fsSL https://ollama.com/install.sh | sh');
    }
  }
}
