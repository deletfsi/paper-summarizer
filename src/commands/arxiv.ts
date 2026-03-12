import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { detectError, formatErrorMessage } from '../utils/errors';
import { parsePDF } from '../utils/pdfParser';
import { createSummarizer } from '../services/summarizer';
import { extractFormulas } from '../utils/formulaParser';
import { extractMetadata } from '../utils/metadataExtractor';
import { PaperManager, DEFAULT_PAPER_ROOT } from '../services/paperManager';
import { convertToMarkdown, createImageAnalysisPrompt } from '../utils/paperToMarkdown';
import { extractImages } from '../utils/imageExtractor';

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  pdfUrl: string;
}

export interface ArxivCommandOptions {
  verbose: boolean;
  summarize?: boolean;
}

interface NormalizedArxivId {
  normalized: string;
  original: string;
  version: string | null;
}

/**
 * Normalize arXiv ID to standard format (without version)
 * Supports: 2301.12345, 2301.12345v1, arXiv:2301.12345
 */
function normalizeArxivId(id: string): NormalizedArxivId {
  // Remove "arXiv:" prefix if present
  let normalized = id.trim();
  if (normalized.toLowerCase().startsWith('arxiv:')) {
    normalized = normalized.substring(6);
  }

  // Remove version suffix (e.g., v1) for API query
  // We'll keep the original for display/download
  const versionMatch = normalized.match(/v\d+$/);
  const hasVersion = versionMatch ? versionMatch[0] : null;

  return {
    normalized: normalized.replace(/v\d+$/, ''),
    original: normalized,
    version: hasVersion
  };
}

/**
 * Fetch paper metadata from arXiv API
 */
async function fetchArxivMetadata(arxivId: string): Promise<ArxivPaper> {
  const { normalized } = normalizeArxivId(arxivId);

  const apiUrl = `https://export.arxiv.org/api/query?id_list=${normalized}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(apiUrl);
    const protocol = urlObj.protocol === 'https:' ? https : require('http');

    const req = protocol.get(urlObj, (res: any) => {
      let data = '';

      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        try {
          // Check for HTTP errors
          if (res.statusCode !== 200) {
            reject(new Error(`arXiv API returned status code: ${res.statusCode}`));
            return;
          }

          // Parse XML response
          const paper = parseArxivXml(data, arxivId);
          if (!paper) {
            reject(new Error(`Paper not found: ${arxivId}`));
            return;
          }

          resolve(paper);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error: Error) => {
      reject(new Error(`Failed to fetch from arXiv API: ${error.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Parse arXiv API XML response
 */
function parseArxivXml(xml: string, originalId: string): ArxivPaper | null {
  // Extract entry section
  const entryMatch = xml.match(/<entry[^>]*>([\s\S]*?)<\/entry>/);
  if (!entryMatch) {
    return null;
  }

  const entry = entryMatch[1];

  // Extract ID
  const idMatch = entry.match(/<id>([^<]+)<\/id>/);
  const id = idMatch ? idMatch[1] : `http://arxiv.org/abs/${originalId}`;

  // Extract title (remove newlines and extra whitespace)
  const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Untitled';

  // Extract summary/abstract
  const summaryMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
  const summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim() : '';

  // Extract authors
  const authorMatches = entry.match(/<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g);
  const authors: string[] = [];
  if (authorMatches) {
    for (const author of authorMatches) {
      const nameMatch = author.match(/<name>([^<]+)<\/name>/);
      if (nameMatch) {
        authors.push(nameMatch[1]);
      }
    }
  }

  // Extract published date
  const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
  const published = publishedMatch ? publishedMatch[1] : '';

  // Extract PDF link
  const pdfLinkMatch = entry.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"[^>]*>/);
  let pdfUrl = pdfLinkMatch ? pdfLinkMatch[1] : '';

  // Fallback: construct PDF URL from ID
  if (!pdfUrl) {
    const { normalized, version } = normalizeArxivId(originalId);
    const ver = version || 'v1';
    pdfUrl = `https://arxiv.org/pdf/${normalized}${ver}`;
  }

  return {
    id,
    title,
    summary,
    authors,
    published,
    pdfUrl
  };
}

/**
 * Download PDF file from URL
 */
async function downloadPdf(url: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : require('http');

    const req = protocol.get(urlObj, (res: any) => {
      // Check for redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          downloadPdf(redirectUrl, filePath)
            .then(resolve)
            .catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        reject(new Error(`PDF download failed with status code: ${res.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(filePath);

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err: Error) => {
        fs.unlink(filePath, () => {}); // Clean up
        reject(err);
      });
    });

    req.on('error', (error: Error) => {
      reject(new Error(`Failed to download PDF: ${error.message}`));
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
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
 * Sanitize filename (remove invalid characters)
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
}

export async function arxivCommand(id: string, options: ArxivCommandOptions): Promise<void> {
  const logger = new Logger(options.verbose);
  const shouldSummarize = options.summarize || false;

  // 初始化论文管理器
  const paperManager = new PaperManager({ verbose: options.verbose });

  logger.info(`Processing arXiv ID: ${id}`);

  // Validate arXiv ID format
  if (!id || id.trim() === '') {
    logger.error('arXiv ID cannot be empty');
    process.exit(1);
  }

  try {
    // Step 1: Fetch metadata from arXiv API
    logger.log(`Fetching paper metadata from arXiv...`);
    const paper = await fetchArxivMetadata(id);

    logger.success(`Found paper: ${paper.title}`);
    logger.info(`Authors: ${paper.authors.join(', ')}`);
    logger.info(`Published: ${paper.published}`);
    logger.info(`PDF URL: ${paper.pdfUrl}`);

    // Step 2: Download PDF
    logger.log(`Downloading PDF...`);

    // 使用 paperManager 保存 PDF
    const downloadsDir = ensureDownloadsDir();
    const { original } = normalizeArxivId(id);
    const sanitizedTitle = sanitizeFilename(paper.title);
    const pdfFileName = `${original.replace(/[^\w-]/g, '_')}.pdf`;
    const tempPdfPath = path.join(downloadsDir, pdfFileName);

    await downloadPdf(paper.pdfUrl, tempPdfPath);

    // 验证下载
    if (!fs.existsSync(tempPdfPath)) {
      throw new Error('PDF file was not created');
    }

    // 复制到论文管理目录
    const paperId = original.replace(/[^\w-]/g, '_');
    const finalPdfPath = paperManager.savePDF(fs.readFileSync(tempPdfPath), paperId, 'arxiv');

    const stats = fs.statSync(finalPdfPath);
    logger.success(`PDF saved to: ${finalPdfPath}`);
    logger.info(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // 打印基本信息
    console.log('\n=== 论文详情 ===');
    console.log(`ID: ${paper.id}`);
    console.log(`标题: ${paper.title}`);
    console.log(`作者: ${paper.authors.join(', ')}`);
    console.log(`发布日期: ${paper.published}`);
    console.log(`\nPDF 保存位置: ${finalPdfPath}`);
    console.log(`文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`\n论文目录: ${paperManager.getPaperPaths(paperId, 'arxiv').paperDir}`);

    // Step 3: Parse PDF and extract content
    if (shouldSummarize) {
      logger.log(`Parsing PDF content...`);
      const pdfContent = await parsePDF(finalPdfPath, { verbose: options.verbose });
      logger.success(`Extracted ${pdfContent.text.length} characters from ${pdfContent.pageCount} pages`);

      // Step 3.1: 转换为 Markdown
      logger.log(`Converting to Markdown...`);
      const markdownResult = convertToMarkdown(pdfContent);

      // 保存 Markdown 文件
      const mdContent = markdownResult.markdown;
      const mdPath = paperManager.saveMarkdown(mdContent, paperId, 'arxiv');
      logger.success(`Markdown saved to: ${mdPath}`);

      // 提取图片
      if (pdfContent.images && pdfContent.images.length > 0) {
        logger.info(`Extracting ${pdfContent.images.length} images...`);
        const imagesDir = paperManager.ensureImagesDir(paperId);
        for (let i = 0; i < pdfContent.images.length; i++) {
          const base64Data = pdfContent.images[i].replace(/^data:image\/\w+;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');
          paperManager.saveImage(imageBuffer, paperId, i + 1);
        }
        logger.success(`Images saved to: ${imagesDir}`);
      }

      console.log(`\nMarkdown 保存位置: ${mdPath}`);

      // Extract formulas
      const formulasResult = extractFormulas(pdfContent.text);
      if (formulasResult.formulas.length > 0) {
        logger.info(`Found ${formulasResult.formulas.length} formulas`);
      }

      // Extract metadata (code URLs, etc.)
      const metadata = extractMetadata(pdfContent.text);
      if (metadata.codeUrls.length > 0) {
        logger.info(`Found ${metadata.codeUrls.length} code URL(s)`);
      }
      if (metadata.datasetUrls.length > 0) {
        logger.info(`Found ${metadata.datasetUrls.length} dataset URL(s)`);
      }

      // Step 4: Generate summary using LLM
      logger.log(`Generating paper summary (this may take a while)...`);
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
          metadata.codeUrls.forEach(url => console.log(`- ${url}`));
        }

        if (metadata.datasetUrls.length > 0) {
          console.log('\n=== Dataset Resources ===');
          metadata.datasetUrls.forEach(url => console.log(`- ${url}`));
        }

        if (metadata.modelUrls.length > 0) {
          console.log('\n=== Model Resources ===');
          metadata.modelUrls.forEach(url => console.log(`- ${url}`));
        }

        logger.success('Paper summary generated successfully!');
      } catch (llmError) {
        logger.warn(`Failed to generate summary: ${(llmError as Error).message}`);
        console.log('\nNote: LLM summarization failed. Install and run Ollama to enable AI summarization.');
        console.log('Run: curl -fsSL https://ollama.com/install.sh | sh');
      }
    }

    // Log success
    logger.success(`Successfully processed paper: ${paper.title}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch paper: ${errorMessage}`);

    // Use error detection utility
    const errorResult = detectError(1, errorMessage);
    const formattedError = formatErrorMessage(errorResult, false);
    if (formattedError) {
      console.log(formattedError);
    }

    process.exit(1);
  }
}
