/**
 * Metadata Extractor - Extracts extended information from academic papers
 *
 * Extracts:
 * - Code URLs (GitHub, GitLab, etc.)
 * - Dataset URLs
 * - Model weights URLs (Hugging Face, etc.)
 * - References (DOI, arXiv, etc.)
 * - Author information and affiliations
 */

export interface AuthorInfo {
  name: string;
  affiliation?: string;
  email?: string;
}

export interface PaperMetadata {
  codeUrls: string[];
  datasetUrls: string[];
  modelUrls: string[];
  references: string[];
  authors: AuthorInfo[];
  contactEmail?: string;
}

// Regular expressions for URL matching
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;

// GitHub patterns
const GITHUB_REGEX = /github\.com\/[\w-]+\/[\w-]+/gi;

// GitLab patterns
const GITLAB_REGEX = /gitlab\.com\/[\w-]+\/[\w-]+/gi;

// Hugging Face model patterns
const HUGGINGFACE_MODEL_REGEX = /huggingface\.co\/models?\/[\w-]+/gi;

// Dataset patterns
const HUGGINGFACE_DATASET_REGEX = /huggingface\.co\/datasets\/[\w-]+/gi;
const KAGGLE_DATASET_REGEX = /kaggle\.com\/datasets\/[\w-]+/gi;

// DOI pattern
const DOI_REGEX = /10\.\d{4,}\/[^\s]+/gi;

// arXiv pattern
const ARXIV_REGEX = /arXiv:\s*\d{4}\.\d{4,5}(?:v\d+)?/gi;

// Email pattern
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/gi;

// Common institution keywords
const INSTITUTION_KEYWORDS = [
  'university', 'institute', 'college', 'school', 'lab', 'laboratory',
  'research', 'center', 'centre', 'department', 'dept', 'faculty',
  'technology', 'tech', 'innovation', 'company', 'inc', 'corp',
  'google', 'microsoft', 'amazon', 'meta', 'apple', 'nvidia', 'deepmind',
  'stanford', 'mit', 'cmu', 'berkeley', 'oxford', 'cambridge',
  'tsinghua', 'peking', 'beijing', 'shanghai', 'zhejiang'
];

// Author name patterns - looks for typical academic names
const AUTHOR_NAME_REGEX = /(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;

// Common code keywords for detection
const CODE_KEYWORDS = ['code', 'github', 'gitlab', 'repository', 'repo', 'implementation', 'source code'];
const DATASET_KEYWORDS = ['dataset', 'data', 'corpus', 'benchmark', 'collection'];
const MODEL_KEYWORDS = ['model', 'pretrained', 'weights', 'checkpoint', 'huggingface', 'checkpoint'];

/**
 * Extract all URLs from text
 */
function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) || [];
  return [...new Set(matches)];
}

/**
 * Check if URL matches a specific pattern with context keywords
 */
function isContextMatch(url: string, text: string, keywords: string[]): boolean {
  // Get surrounding context (expand search area)
  const urlIndex = text.indexOf(url);
  if (urlIndex === -1) return false;

  const contextStart = Math.max(0, urlIndex - 100);
  const contextEnd = Math.min(text.length, urlIndex + url.length + 100);
  const context = text.substring(contextStart, contextEnd).toLowerCase();

  return keywords.some(keyword => context.includes(keyword.toLowerCase()));
}

/**
 * Extract code URLs (GitHub, GitLab, etc.)
 */
function extractCodeUrls(text: string): string[] {
  const urls = extractUrls(text);
  const codeUrls: string[] = [];

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();

    // Priority: GitHub, GitLab, Bitbucket - these are always code URLs
    if (lowerUrl.includes('github.com') ||
        lowerUrl.includes('gitlab.com') ||
        lowerUrl.includes('bitbucket.org')) {
      codeUrls.push(url);
      continue;
    }

    // Check if URL is in code context (source code, implementation, etc.)
    if (isContextMatch(url, text, CODE_KEYWORDS)) {
      // Exclude HuggingFace model/dataset URLs from code
      if (!lowerUrl.includes('huggingface.co') &&
          !lowerUrl.includes('kaggle.com/datasets')) {
        codeUrls.push(url);
      }
    }
  }

  // Also match GitHub patterns directly (even without https://)
  const githubMatches = text.match(GITHUB_REGEX) || [];
  for (const match of githubMatches) {
    const fullUrl = `https://${match}`;
    if (!codeUrls.includes(fullUrl)) {
      codeUrls.push(fullUrl);
    }
  }

  return [...new Set(codeUrls)];
}

/**
 * Extract dataset URLs
 */
function extractDatasetUrls(text: string): string[] {
  const urls = extractUrls(text);
  const datasetUrls: string[] = [];

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();

    // Check HuggingFace datasets
    if (lowerUrl.includes('huggingface.co/datasets')) {
      datasetUrls.push(url);
      continue;
    }

    // Check Kaggle datasets
    if (lowerUrl.includes('kaggle.com/datasets')) {
      datasetUrls.push(url);
      continue;
    }

    // Check other common dataset sources
    if (lowerUrl.includes('dataset') || lowerUrl.includes('data.')) {
      if (isContextMatch(url, text, DATASET_KEYWORDS)) {
        datasetUrls.push(url);
      }
    }
  }

  // Match HuggingFace dataset patterns directly
  const hfMatches = text.match(HUGGINGFACE_DATASET_REGEX) || [];
  for (const match of hfMatches) {
    const fullUrl = `https://${match}`;
    if (!datasetUrls.includes(fullUrl)) {
      datasetUrls.push(fullUrl);
    }
  }

  // Match Kaggle dataset patterns
  const kaggleMatches = text.match(KAGGLE_DATASET_REGEX) || [];
  for (const match of kaggleMatches) {
    const fullUrl = `https://${match}`;
    if (!datasetUrls.includes(fullUrl)) {
      datasetUrls.push(fullUrl);
    }
  }

  return [...new Set(datasetUrls)];
}

/**
 * Extract model URLs (Hugging Face models, etc.)
 */
function extractModelUrls(text: string): string[] {
  const urls = extractUrls(text);
  const modelUrls: string[] = [];

  for (const url of urls) {
    const lowerUrl = url.toLowerCase();

    // Check HuggingFace models - specifically model URLs
    if (lowerUrl.includes('huggingface.co/models') ||
        (lowerUrl.includes('huggingface.co/') && !lowerUrl.includes('datasets'))) {
      modelUrls.push(url);
      continue;
    }

    // Check if URL is explicitly in model context (checkpoints, weights, pretrained)
    if (isContextMatch(url, text, ['model', 'checkpoint', 'weights', 'pretrained'])) {
      if (lowerUrl.includes('huggingface.co') || lowerUrl.includes('model')) {
        modelUrls.push(url);
      }
    }
  }

  // Match HuggingFace model patterns directly (exclude datasets)
  const hfMatches = text.match(HUGGINGFACE_MODEL_REGEX) || [];
  for (const match of hfMatches) {
    const fullUrl = `https://${match}`;
    if (!modelUrls.includes(fullUrl)) {
      modelUrls.push(fullUrl);
    }
  }

  return [...new Set(modelUrls)];
}

/**
 * Extract references (DOI, arXiv, etc.)
 */
function extractReferences(text: string): string[] {
  const references: string[] = [];

  // Extract DOIs
  const dois = text.match(DOI_REGEX) || [];
  references.push(...dois.map(doi => `https://doi.org/${doi}`));

  // Extract arXiv IDs
  const arxivIds = text.match(ARXIV_REGEX) || [];
  references.push(...arxivIds.map(id => `https://arxiv.org/abs/${id.replace('arXiv:', '').trim()}`));

  return [...new Set(references)];
}

// Words that should NOT be author names
const NON_AUTHOR_WORDS = [
  'abstract', 'introduction', 'related', 'work', 'method', 'approach',
  'experiment', 'result', 'conclusion', 'reference', 'figure', 'table',
  'section', 'chapter', 'paper', 'learning', 'network', 'model', 'neural',
  'attention', 'translation', 'language', 'image', 'vision', 'training',
  'dataset', 'performance', 'state', 'art', 'proposed', 'results', 'based'
];

/**
 * Extract author information
 */
function extractAuthors(text: string): AuthorInfo[] {
  const authors: AuthorInfo[] = [];

  // Extract emails first (they often appear near author names)
  const emails = text.match(EMAIL_REGEX) || [];

  // Extract potential author names - look for patterns in typical author line format
  // Authors usually appear in first few lines after title
  const titleIndex = text.search(/#+\s+\w/); // Find title marker
  const authorSectionEnd = titleIndex !== -1 ? titleIndex + 500 : 500;
  const authorSection = text.substring(0, Math.min(authorSectionEnd, text.length));

  // Match author names: Capitalized words, typically 2-3 words, separated by commas or newlines
  const authorLinePattern = /(?:^|\n|\s)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s*[,;]|\s+(?:and|&\s))/gm;
  const potentialNames = authorSection.match(authorLinePattern) || [];

  for (let name of potentialNames) {
    name = name.trim().replace(/[,;&\s]+$/, '').replace(/^[,\s]+/, '');

    // Skip if it looks like a non-author
    if (name.length < 3 || name.length > 40) continue;
    if (NON_AUTHOR_WORDS.some(w => name.toLowerCase() === w)) continue;
    if (/\d/.test(name)) continue;
    if (name.split(/\s+/).length > 4) continue; // Too many parts

    // Check if already added
    if (authors.some(a => a.name === name)) continue;

    // Look for affiliation in surrounding context
    let affiliation: string | undefined;
    const nameIndex = text.indexOf(name);
    if (nameIndex !== -1) {
      const contextStart = Math.max(0, nameIndex - 150);
      const contextEnd = Math.min(text.length, nameIndex + name.length + 300);
      const context = text.substring(contextStart, contextEnd);

      // Look for institution keywords
      for (const keyword of INSTITUTION_KEYWORDS) {
        if (context.toLowerCase().includes(keyword)) {
          const keywordIndex = context.toLowerCase().indexOf(keyword);
          const affStart = Math.max(0, keywordIndex - 40);
          const affEnd = Math.min(context.length, keywordIndex + keyword.length + 50);
          affiliation = context.substring(affStart, affEnd).trim().replace(/\s+/g, ' ');
          break;
        }
      }

      // Look for email near the name
      let email: string | undefined;
      for (const em of emails) {
        const emIndex = text.indexOf(em);
        if (Math.abs(emIndex - nameIndex) < 150) {
          email = em;
          break;
        }
      }

      authors.push({
        name: name.trim(),
        affiliation,
        email
      });
    }
  }

  return authors;
}

/**
 * Extract contact email from text
 */
function extractContactEmail(text: string): string | undefined {
  const emails = text.match(EMAIL_REGEX) || [];

  // Look for corresponding author or contact email patterns
  const contactPatterns = [
    /corresponding.*?email:?\s*([\w.+-]+@[\w-]+\.[\w.-]+)/gi,
    /contact.*?email:?\s*([\w.+-]+@[\w-]+\.[\w.-]+)/gi,
    /email:?\s*([\w.+-]+@[\w-]+\.[\w.-]+)/gi
  ];

  for (const pattern of contactPatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      const emailMatch = matches[0].match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);
      if (emailMatch) {
        return emailMatch[1];
      }
    }
  }

  // Return first email if no specific contact found
  return emails.length > 0 ? emails[0] : undefined;
}

/**
 * Extract all metadata from paper text
 */
export function extractMetadata(text: string): PaperMetadata {
  const codeUrls = extractCodeUrls(text);
  const datasetUrls = extractDatasetUrls(text);
  const modelUrls = extractModelUrls(text);
  const references = extractReferences(text);
  const authors = extractAuthors(text);
  const contactEmail = extractContactEmail(text);

  return {
    codeUrls,
    datasetUrls,
    modelUrls,
    references,
    authors,
    contactEmail
  };
}

export default extractMetadata;
