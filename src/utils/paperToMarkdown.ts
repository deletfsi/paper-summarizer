/**
 * Paper to Markdown converter
 * Converts paper content to optimized markdown format for LLM consumption
 */

import { PDFContent } from './pdfParser';
import { extractFormulas, ParsedFormulas } from './formulaParser';

export interface PaperMarkdown {
  markdown: string;
  images: string[]; // base64 encoded images
  formulas: ParsedFormulas;
  tokenEstimate: number;
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Convert paper content to optimized markdown
 */
export function convertToMarkdown(pdfContent: PDFContent): PaperMarkdown {
  const { text, pageCount, metadata, images } = pdfContent;

  // Extract formulas first
  const formulasResult = extractFormulas(text);

  // Build markdown sections
  const sections: string[] = [];

  // Title section
  if (metadata?.title) {
    sections.push(`# ${metadata.title}\n`);
  }

  // Metadata section
  const metaLines = ['## 元信息\n'];
  if (metadata?.author) {
    metaLines.push(`- **作者**: ${metadata.author}`);
  }
  if (metadata?.creationDate) {
    metaLines.push(`- **发布日期**: ${metadata.creationDate}`);
  }
  metaLines.push(`- **页数**: ${pageCount}`);
  metaLines.push(`- **字符数**: ${text.length.toLocaleString()}`);
  metaLines.push('');
  sections.push(metaLines.join('\n'));

  // Extract abstract (usually at the beginning)
  const abstractMatch = text.match(/(?:abstract|摘要)[\s\n]*([\s\S]{100,2000}?)(?:\n\n|introduction|介绍)/i);
  if (abstractMatch) {
    sections.push(`## 摘要\n${abstractMatch[1].trim()}\n`);
  }

  // Extract main sections
  // Common sections: Introduction, Related Work, Method, Experiments, Results, Conclusion
  const sectionPatterns = [
    /1\s+(?:Introduction|介绍)[\s\n]+([\s\S]{50,5000}?)(?=\n\s*2\s+|Related Work|$)/i,
    /2\s+(?:Related Work|相关工作)[\s\n]+([\s\S]{50,3000}?)(?=\n\s*3\s+|Method|方法|$)/i,
    /3\s+(?:Method|Methods|方法|模型)[\s\n]+([\s\S]{50,8000}?)(?=\n\s*4\s+|Experiment|实验|$)/i,
    /4\s+(?:Experiment|Experiments|实验|结果)[\s\n]+([\s\S]{50,5000}?)(?=\n\s*5\s+|Conclusion|结论|$)/i,
    /5\s+(?:Conclusion|讨论|Conclusion and Discussion)[\s\S]{50,3000}?$/i,
  ];

  const sectionNames = ['Introduction', 'Related Work', 'Method', 'Experiments', 'Conclusion'];

  for (let i = 0; i < sectionPatterns.length; i++) {
    const match = text.match(sectionPatterns[i]);
    if (match) {
      const content = cleanText(match[1]);
      if (content.length > 100) {
        sections.push(`## ${sectionNames[i]}\n${content}\n`);
      }
    }
  }

  // If no clear sections found, add full text (truncated)
  if (sections.length < 3) {
    const clean = cleanText(text);
    // Take first 8000 characters as fallback
    sections.push(`## 全文（部分）\n${clean.substring(0, 8000)}\n...[truncated]`);
  }

  // Add formulas section if found
  if (formulasResult.formulas.length > 0) {
    const formulaList = formulasResult.formulas
      .slice(0, 10) // Limit to 10 formulas
      .map((f, i) => `${i + 1}. $${f.latex}$`)
      .join('\n');
    sections.push(`## 关键公式\n${formulaList}\n`);
  }

  // Add images info
  const imageInfo = images && images.length > 0
    ? `\n**注意**: 论文包含 ${images.length} 张图片，请查看下方图片分析。`
    : '';

  // Build final markdown
  const markdown = sections.join('\n---\n\n');

  // Estimate tokens
  const tokenEstimate = estimateTokens(markdown);

  return {
    markdown,
    images: images || [],
    formulas: formulasResult,
    tokenEstimate,
  };
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  return text
    // Remove page numbers
    .replace(/\n\s*\d+\s*\n/g, '\n')
    // Remove excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    // Remove headers like "Page X of Y"
    .replace(/Page\s+\d+\s+of\s+\d+/gi, '')
    // Clean up formula artifacts
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Create image prompt for vision model
 */
export function createImageAnalysisPrompt(images: string[]): string {
  if (!images || images.length === 0) {
    return '';
  }

  const imageDescriptions = images
    .map((img, i) => `[图片 ${i + 1}]`)
    .join('\n');

  return `
## 图片分析

论文中包含 ${images.length} 张图片，请分析以下图片内容：

${imageDescriptions}

请为每张图片提供：
1. 图片类型（架构图、实验结果图、流程图等）
2. 图片主要展示的内容
3. 图片中的关键信息
`;
}

/**
 * Get truncated content for token limit
 */
export function getTruncatedContent(markdown: string, maxTokens: number = 12000): string {
  const maxChars = maxTokens * 4;

  if (markdown.length <= maxChars) {
    return markdown;
  }

  // Try to cut at section boundary
  const truncated = markdown.substring(0, maxChars);
  const lastSection = truncated.lastIndexOf('\n## ');
  const lastDoubleNewline = truncated.lastIndexOf('\n\n');

  const cutPoint = Math.max(lastSection, lastDoubleNewline) || maxChars;

  return markdown.substring(0, cutPoint) + '\n\n... [内容已截断]';
}
