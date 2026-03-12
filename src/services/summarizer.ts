/**
 * Paper summarization service using LLM API or local model
 */

import { getLLMConfig, LLMConfig, validateLLMConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { localCompletion, initLocalModel, isLocalModelAvailable } from './localModel';
import { convertToMarkdown, createImageAnalysisPrompt, getTruncatedContent, PaperMarkdown } from '../utils/paperToMarkdown';
import { PDFContent } from '../utils/pdfParser';

export interface PaperSummary {
  oneLineSummary: string;
  taskAndProblem: string;
  coreInnovation: string;
  sotaComparison: string;
  researchProblem: string;
  dataFlowAndArchitecture: string;
  trainingAndTesting: string;
  computeAndDeployment: string;
  ablationStudy: string;
  failureCases: string;
  assumptionsAndLimitations: string;
  terminologyExplanation: string;
  prosAndCons: string;
  imageAnalysis?: string;
}

export interface SummarizerOptions {
  stream?: boolean;
  verbose?: boolean;
  maxTokens?: number;
  includeImages?: boolean;
}

/**
 * Build prompt for paper summarization (optimized for markdown input)
 */
function buildSummarizationPrompt(paperMarkdown: PaperMarkdown, includeImages: boolean = true): string {
  const imagePrompt = includeImages && paperMarkdown.images.length > 0
    ? createImageAnalysisPrompt(paperMarkdown.images)
    : '';

  // Truncate if too long
  let content = getTruncatedContent(paperMarkdown.markdown, 15000);

  return `你是一位专业的学术论文审稿人。请分析以下论文内容，生成结构化总结。

## 论文内容（Markdown格式）
${content}
${imagePrompt}

## 输出要求
请按以下结构生成总结（使用中文）：

### 一句话概括论文核心
用一句话（不超过50字）概括论文的核心贡献。

### 任务与问题
明确论文针对的具体任务（如分类、检测、生成、翻译等），以及该任务存在的具体问题或挑战。

### 核心创新
用直白语言解释论文的最大改动点，不要使用专业术语堆砌，让非该领域的人也能理解。

### SOTA 对比
列出论文与当前最先进方法（SOTA）的性能对比，包括具体数值和提升幅度。

### 研究问题
详细描述论文要解决的具体问题，为什么这个问题重要，当前方法的不足之处。

### 数据流与架构
描述模型的整体架构和关键组件，包括输入输出维度、关键公式（如果适用）。

### 训练与测试环境
描述使用的数据集、训练细节、评估指标等。

### 算力与部署
包括参数量、FLOPs、推理延迟、是否支持边缘设备部署等。

### 消融实验
列出各模块的消融实验结果，说明哪个模块贡献最大。

### 边界与失败案例
描述模型在哪些场景下可能失败或表现不佳。

### 假设与局限
列出论文的假设条件和局限性。

### 术语解释通俗化
将专业术语用通俗易懂的语言解释。

### 优劣势分析
分析论文方法的优点和缺点。

${includeImages && paperMarkdown.images.length > 0 ? '### 图片分析\n描述图片中展示的关键信息。' : ''}
`;
}

/**
 * Parse LLM response into structured summary
 */
function parseSummaryResponse(response: string): Partial<PaperSummary> {
  const sections: Partial<PaperSummary> = {};

  const patterns = {
    oneLineSummary: /###\s*一句话概括论文核心\s*\n([^#\n]+)/i,
    taskAndProblem: /###\s*任务与问题\s*\n([^#\n]+)/i,
    coreInnovation: /###\s*核心创新\s*\n([^#\n]+)/i,
    sotaComparison: /###\s*SOTA\s*对比\s*\n([^#\n]+)/i,
    researchProblem: /###\s*研究问题\s*\n([^#\n]+)/i,
    dataFlowAndArchitecture: /###\s*数据流与架构\s*\n([^#\n]+)/i,
    trainingAndTesting: /###\s*训练与测试环境\s*\n([^#\n]+)/i,
    computeAndDeployment: /###\s*算力与部署\s*\n([^#\n]+)/i,
    ablationStudy: /###\s*消融实验\s*\n([^#\n]+)/i,
    failureCases: /###\s*边界与失败案例\s*\n([^#\n]+)/i,
    assumptionsAndLimitations: /###\s*假设与局限\s*\n([^#\n]+)/i,
    terminologyExplanation: /###\s*术语解释通俗化\s*\n([^#\n]+)/i,
    prosAndCons: /###\s*优劣势分析\s*\n([^#\n]+)/i,
    imageAnalysis: /###\s*图片分析\s*\n([^#]+)/i,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = response.match(pattern);
    if (match) {
      (sections as any)[key] = match[1].trim();
    }
  }

  return sections;
}

/**
 * Call remote LLM API with retry mechanism
 */
async function callRemoteLLMApi(
  config: LLMConfig,
  prompt: string,
  options: SummarizerOptions = {}
): Promise<string> {
  const { verbose = false } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      if (verbose) {
        logger.info(`Calling remote LLM API (attempt ${attempt}/${config.maxRetries})`);
      }

      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          prompt: prompt,
          stream: false,
        }),
        signal: AbortSignal.timeout(config.timeout),
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { response?: string; text?: string };
      return data.response || data.text || JSON.stringify(data);
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Remote LLM API call failed (attempt ${attempt}/${config.maxRetries}): ${(error as Error).message}`);

      if (attempt < config.maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Remote LLM API call failed after ${config.maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Paper summarizer service class
 */
export class PaperSummarizer {
  private config: LLMConfig;
  private verbose: boolean;
  private useLocal: boolean;

  constructor(config?: Partial<LLMConfig>, verbose: boolean = false) {
    this.config = { ...getLLMConfig(), ...config };
    this.verbose = verbose;
    this.useLocal = this.config.useLocal;

    // Validate configuration
    if (!this.useLocal) {
      const validation = validateLLMConfig(this.config);
      if (!validation.valid) {
        throw new Error(`Invalid LLM configuration: ${validation.errors.join(', ')}`);
      }
    }

    if (this.verbose) {
      logger.info(`PaperSummarizer initialized`);
      logger.info(`Using: ${this.useLocal ? 'Local model' : 'Remote API'}`);
      if (this.useLocal) {
        logger.info(`Local model path: ${this.config.localModelPath}`);
      } else {
        logger.info(`API URL: ${this.config.apiUrl}`);
        logger.info(`Model: ${this.config.model}`);
      }
    }
  }

  /**
   * Summarize a paper from PDF content
   */
  async summarizeFromPDF(pdfContent: PDFContent, options: SummarizerOptions = {}): Promise<PaperSummary> {
    const includeImages = options.includeImages !== false;

    if (this.verbose) {
      logger.info('Converting paper to markdown...');
    }

    // Convert to markdown (reduces token count significantly)
    const paperMarkdown = convertToMarkdown(pdfContent);

    if (this.verbose) {
      logger.info(`Markdown token estimate: ${paperMarkdown.tokenEstimate}`);
      logger.info(`Images: ${paperMarkdown.images.length}`);
      logger.info(`Formulas: ${paperMarkdown.formulas.formulas.length}`);
    }

    const prompt = buildSummarizationPrompt(paperMarkdown, includeImages);

    if (this.verbose) {
      logger.info('Starting paper summarization...');
    }

    let response: string;

    if (this.useLocal) {
      // Use local model
      try {
        if (!isLocalModelAvailable()) {
          if (this.verbose) {
            logger.info('Initializing local model...');
          }
          await initLocalModel();
        }

        response = await localCompletion(prompt, {
          maxTokens: options.maxTokens || 4096,
          temperature: 0.7,
        });
      } catch (error) {
        logger.error(`Local model failed: ${(error as Error).message}`);
        throw new Error(`Local model failed: ${(error as Error).message}. Please install node-llama-cpp or use remote API.`);
      }
    } else {
      // Use remote API
      response = await callRemoteLLMApi(this.config, prompt, {
        verbose: this.verbose,
      });
    }

    const parsedSummary = parseSummaryResponse(response);

    // Validate that we got meaningful content
    if (!parsedSummary.oneLineSummary && !parsedSummary.coreInnovation) {
      throw new Error('Failed to parse summary from LLM response');
    }

    if (this.verbose) {
      logger.success('Paper summarization completed');
    }

    return parsedSummary as PaperSummary;
  }

  /**
   * Summarize from raw text (legacy support)
   */
  async summarize(paperContent: string, options: SummarizerOptions = {}): Promise<PaperSummary> {
    // Convert raw text to PDF content format
    const pdfContent: PDFContent = {
      text: paperContent,
      pageCount: 1,
    };

    return this.summarizeFromPDF(pdfContent, options);
  }
}

/**
 * Create a default paper summarizer instance
 */
export function createSummarizer(verbose: boolean = false): PaperSummarizer {
  return new PaperSummarizer(undefined, verbose);
}
