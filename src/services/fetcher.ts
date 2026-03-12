/**
 * Paper Fetcher - 从多种来源获取论文
 *
 * 支持的来源:
 * - arXiv PDF 直链: https://arxiv.org/pdf/xxx
 * - arXiv 主页: https://arxiv.org/html/xxx 或 https://arxiv.org/abs/xxx
 * - IEEE 付费论文: https://ieeexplore.ieee.org/document/xxx (需要登录)
 * - 本地文件: /path/to/paper.pdf
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { Logger } from '../utils/logger';
import { chromium, Browser, Page } from 'playwright';

// IEEE 登录凭据
const IEEE_EMAIL = 'YNmUGrbc';
const IEEE_PASSWORD = 'fRnh3fPR';

export type SourceType = 'arxiv-pdf' | 'arxiv-html' | 'arxiv-abs' | 'ieee' | 'url' | 'local';

export interface FetchResult {
  buffer: Buffer;
  sourceType: SourceType;
  paperId: string;
  filename: string;
}

export interface FetcherOptions {
  verbose?: boolean;
  outputDir?: string;
}

/**
 * 扩展路径，处理 Windows 路径格式
 * C:\path\to\file -> /mnt/c/path/to/file (在 WSL 环境下)
 */
function expandPath(inputPath: string): string {
  // 如果已经是 Unix 风格路径，直接返回
  if (inputPath.startsWith('/')) {
    return inputPath;
  }

  // Windows 路径: C:\xxx 或 D:\xxx
  const windowsMatch = inputPath.match(/^([A-Za-z]):\\(.+)$/);
  if (windowsMatch) {
    const drive = windowsMatch[1].toLowerCase();
    const restPath = windowsMatch[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${restPath}`;
  }

  return inputPath;
}

// 检测来源类型
export function detectSource(input: string): { type: SourceType; id: string } {
  const trimmed = input.trim();

  // 本地文件 - 支持多种格式
  // Windows: C:\path\to\file.pdf, D:\path\to\file.pdf
  // WSL: /mnt/c/path/to/file.pdf
  // Unix: /path/to/file.pdf
  // 检测是否是本地PDF文件
  const isWindowsPath = /^[A-Za-z]:\\/.test(trimmed);
  const isWslPath = /^\/mnt\/[a-z]\//.test(trimmed);
  const isUnixPath = /^\/[^\/]/.test(trimmed) && !isWslPath;

  if (isWindowsPath || isWslPath || isUnixPath) {
    // 检查文件是否存在
    const expandedPath = expandPath(trimmed);
    if (fs.existsSync(expandedPath) && expandedPath.toLowerCase().endsWith('.pdf')) {
      return { type: 'local', id: path.basename(expandedPath, '.pdf') };
    }
  }

  // 检查不带扩展名的情况
  if ((isWindowsPath || isWslPath || isUnixPath) && fs.existsSync(trimmed)) {
    return { type: 'local', id: path.basename(trimmed) };
  }

  // 相对路径
  if (fs.existsSync(trimmed) && trimmed.toLowerCase().endsWith('.pdf')) {
    return { type: 'local', id: path.basename(trimmed, '.pdf') };
  }

  // arXiv PDF 直链
  const arxivPdfMatch = trimmed.match(/arxiv\.org\/pdf\/(\d+\.\d+)(v\d+)?/i);
  if (arxivPdfMatch) {
    return { type: 'arxiv-pdf', id: arxivPdfMatch[1] + (arxivPdfMatch[2] || '') };
  }

  // arXiv HTML 链接
  const arxivHtmlMatch = trimmed.match(/arxiv\.org\/(html|abs)\/(\d+\.\d+)(v\d+)?/i);
  if (arxivHtmlMatch) {
    return { type: arxivHtmlMatch[1] === 'html' ? 'arxiv-html' : 'arxiv-abs', id: arxivHtmlMatch[2] + (arxivHtmlMatch[3] || '') };
  }

  // arXiv ID 直接输入
  const arxivIdMatch = trimmed.match(/^(\d+\.\d+)(v\d+)?$/);
  if (arxivIdMatch) {
    return { type: 'arxiv-abs', id: arxivIdMatch[1] + (arxivIdMatch[2] || '') };
  }

  // IEEE 付费论文 - 多种格式
  // 格式1: https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=xxx
  // 格式2: https://ieeexplore.ieee.org/document/xxx
  const ieeeMatch1 = trimmed.match(/ieeexplore\.ieee\.org\/stamp\/stamp\.jsp\?.*arnumber=(\d+)/i);
  if (ieeeMatch1) {
    return { type: 'ieee', id: ieeeMatch1[1] };
  }

  const ieeeMatch2 = trimmed.match(/ieeexplore\.ieee\.org\/document\/(\d+)/i);
  if (ieeeMatch2) {
    return { type: 'ieee', id: ieeeMatch2[1] };
  }

  // 其他 URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { type: 'url', id: path.basename(trimmed, '.pdf') };
  }

  // 默认作为 URL 处理
  return { type: 'url', id: trimmed };
}

/**
 * 从 URL 下载文件
 */
function downloadFromUrl(url: string, logger: Logger): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    logger.info(`Downloading from: ${url}`);

    const request = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    }, (response) => {
      // 处理重定向
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        logger.info(`Following redirect to: ${response.headers.location}`);
        downloadFromUrl(response.headers.location, logger).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        logger.info(`Downloaded ${(buffer.length / 1024).toFixed(2)} KB`);
        resolve(buffer);
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * 从 arXiv 下载 PDF
 */
export async function downloadArxivPDF(arxivId: string, logger: Logger): Promise<Buffer> {
  // 尝试多个 PDF URL 格式
  const pdfUrls = [
    `https://arxiv.org/pdf/${arxivId}.pdf`,
    `https://arxiv.org/pdf/${arxivId}`,
  ];

  let lastError: Error | null = null;

  for (const url of pdfUrls) {
    try {
      logger.info(`Trying: ${url}`);
      const buffer = await downloadFromUrl(url, logger);
      // 检查是否是 PDF
      if (buffer.length > 100 && buffer.slice(0, 5).toString() === '%PDF') {
        logger.success(`Successfully downloaded PDF from: ${url}`);
        return buffer;
      }
      logger.warn(`Downloaded content is not a PDF from: ${url}`);
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Failed to download from ${url}: ${lastError.message}`);
    }
  }

  throw lastError || new Error('Failed to download from all URLs');
}

/**
 * 从 arXiv 主页或HTML版本提取PDF并下载
 */
export async function downloadFromArxivHtml(arxivId: string, logger: Logger): Promise<Buffer> {
  // 对于 /html/xxx 链接，直接尝试下载PDF（因为HTML版本是渲染后的）
  // arXiv ID 可能是 2407.12282v2 格式，需要提取纯ID
  const cleanId = arxivId.replace(/v\d+$/, ''); // 去掉版本号
  const versionMatch = arxivId.match(/v(\d+)$/);
  const version = versionMatch ? `v${versionMatch[1]}` : '';

  // 尝试下载PDF
  logger.info(`Attempting to download PDF for arXiv ID: ${arxivId}`);

  try {
    return await downloadArxivPDF(arxivId, logger);
  } catch (e) {
    // 如果失败，尝试获取abs页面
    logger.warn(`Direct PDF download failed, trying abstract page...`);
    const absUrl = `https://arxiv.org/abs/${arxivId}`;
    logger.info(`Fetching arXiv abstract page: ${absUrl}`);

    const html = await downloadFromUrl(absUrl, logger);

    // 提取 PDF 链接 - 支持两种格式: /pdf/xxx.pdf 或 /pdf/xxx
    const htmlText = html.toString('utf-8');
    const pdfLinkMatch = htmlText.match(/href="(\/pdf\/[^"]+)"/);

    if (!pdfLinkMatch) {
      throw new Error('Could not find PDF link on arXiv page');
    }

    const pdfUrl = `https://arxiv.org${pdfLinkMatch[1]}`;
    logger.info(`Found PDF link: ${pdfUrl}`);

    return downloadFromUrl(pdfUrl, logger);
  }
}

/**
 * 使用 Playwright 浏览器自动化登录 IEEE
 * 这是最可靠的方法，因为它可以处理 JavaScript 渲染和 OAuth 流程
 */
async function ieeeLoginWithPlaywright(logger: Logger): Promise<string[]> {
  let browser: Browser | null = null;

  try {
    logger.log('Starting Playwright browser for IEEE login...');

    // 启动浏览器
    browser = await chromium.launch({
      headless: true,  // 无头模式
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // 访问 IEEE 登录页面
    logger.log('Navigating to IEEE Xplore...');
    await page.goto('https://ieeexplore.ieee.org/', { waitUntil: 'networkidle', timeout: 30000 });

    // 等待登录按钮出现并点击
    logger.log('Looking for Sign In button...');

    // 尝试多种选择器来找到登录按钮
    const signInSelectors = [
      'a[href*="login"]',
      'button:has-text("Sign In")',
      'text=Sign In',
      '.sign-in-btn',
      '[data-testid="sign-in"]'
    ];

    let signedIn = false;

    // 检查是否已经登录（可能是之前的会话）
    const pageContent = await page.content();
    if (pageContent.includes('Sign Out') || pageContent.includes('My Settings')) {
      logger.log('Already signed in!');
      signedIn = true;
    }

    if (!signedIn) {
      // 点击登录按钮
      for (const selector of signInSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            logger.log(`Clicked sign in button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // 继续尝试下一个选择器
        }
      }

      // 等待登录表单加载
      await page.waitForTimeout(2000);

      // 尝试找到用户名/邮箱输入框
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[id="email"]',
        'input[placeholder*="email"]',
        'input[placeholder*="Email"]',
        'input[aria-label*="email"]'
      ];

      let emailInput = null;
      for (const selector of emailSelectors) {
        emailInput = await page.$(selector);
        if (emailInput) {
          logger.log(`Found email input with selector: ${selector}`);
          break;
        }
      }

      if (emailInput) {
        // 输入邮箱
        await emailInput.fill(IEEE_EMAIL);
        logger.log('Entered email');

        // 查找密码输入框
        const passwordSelectors = [
          'input[type="password"]',
          'input[name="password"]',
          'input[id="password"]'
        ];

        let passwordInput = null;
        for (const selector of passwordSelectors) {
          passwordInput = await page.$(selector);
          if (passwordInput) {
            logger.log(`Found password input with selector: ${selector}`);
            break;
          }
        }

        if (passwordInput) {
          // 输入密码
          await passwordInput.fill(IEEE_PASSWORD);
          logger.log('Entered password');

          // 查找登录提交按钮
          const submitSelectors = [
            'button[type="submit"]',
            'button:has-text("Sign In")',
            'button:has-text("Login")',
            'input[type="submit"]'
          ];

          for (const selector of submitSelectors) {
            const submitBtn = await page.$(selector);
            if (submitBtn) {
              await submitBtn.click();
              logger.log('Clicked submit button');
              break;
            }
          }

          // 等待登录完成
          await page.waitForTimeout(5000);
        }
      } else {
        logger.log('Could not find email input, page might have changed');
        // 打印页面 URL 看看现在在哪里
        const currentUrl = page.url();
        logger.log(`Current URL: ${currentUrl}`);
      }

      // 检查登录结果
      const finalContent = await page.content();
      if (finalContent.includes('Sign Out') || finalContent.includes('My Settings')) {
        signedIn = true;
        logger.success('Login successful via Playwright!');
      }
    }

    // 获取 cookies
    const cookies = await context.cookies();

    // 过滤出 IEEE 相关的 cookies
    const ieeeCookies = cookies
      .filter(c => c.domain.includes('ieee.org'))
      .map(c => `${c.name}=${c.value}`);

    logger.log(`Got ${ieeeCookies.length} IEEE cookies`);

    await browser.close();

    if (ieeeCookies.length > 0) {
      return ieeeCookies;
    } else {
      throw new Error('No IEEE cookies obtained');
    }

  } catch (error) {
    logger.error(`Playwright login failed: ${(error as Error).message}`);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

/**
 * IEEE 登录并获取 session cookie
 * 尝试多种登录方式
 */
async function ieeeLogin(logger: Logger): Promise<string[]> {
  logger.log(`IEEE credentials: email=${IEEE_EMAIL}, password length=${IEEE_PASSWORD.length}`);

  // 方法1: 首先尝试使用 Playwright 浏览器自动化（最可靠）
  // 注意: Playwright 需要系统依赖库，在某些环境可能无法运行
  logger.log('Method 1: Trying Playwright browser automation...');
  try {
    const cookies = await ieeeLoginWithPlaywright(logger);
    if (cookies.length > 0) {
      logger.success('IEEE login successful via Playwright!');
      return cookies;
    }
  } catch (e) {
    const errMsg = (e as Error).message;
    // 检查是否是环境问题（缺少库）
    if (errMsg.includes('libnspr4') || errMsg.includes('shared object') || errMsg.includes('browserType.launch')) {
      logger.log('Playwright not available in this environment (missing system libraries)');
    } else {
      logger.log(`Playwright login failed: ${errMsg}`);
    }
  }

  // 方法2: 尝试使用 REST API 登录（IEEE Xplore 新版 API）
  logger.log('Method 2: Trying REST API login...');
  try {
    const cookies = await tryIEEELoginV2(logger);
    if (cookies.length > 0) {
      logger.success('IEEE login successful via API!');
      return cookies;
    }
  } catch (e) {
    logger.log(`API v2 login failed: ${(e as Error).message}`);
  }

  // 方法3: 尝试旧版 REST API 登录
  logger.log('Method 3: Trying legacy REST API login...');
  const methods = [
    { url: 'https://ieeexplore.ieee.org/rest/login', data: { email: IEEE_EMAIL, password: IEEE_PASSWORD, rememberMe: true } },
    { url: 'https://ieeexplore.ieee.org/rest/auth/login', data: { email: IEEE_EMAIL, password: IEEE_PASSWORD } },
  ];

  for (const method of methods) {
    if (!method.data) continue;

    try {
      logger.log(`Trying login method: ${method.url}`);
      const cookies = await tryIEEELogin(method.url, method.data, logger);
      if (cookies.length > 0) {
        return cookies;
      }
    } catch (e) {
      logger.log(`Login method failed: ${(e as Error).message}`);
    }
  }

  // 方法4: 尝试通过访问需要认证的页面来获取 cookie
  logger.log('Method 4: Trying cookie-based authentication...');
  try {
    const cookies = await getIEEECookiesFromPage(logger);
    if (cookies.length > 0) {
      logger.log(`Got ${cookies.length} cookies from page`);
      return cookies;
    }
    logger.log('No cookies obtained from page');
  } catch (e) {
    logger.log(`Cookie-based auth failed: ${(e as Error).message}`);
  }

  // 所有方法都失败了 - 提供详细的手动下载指引
  logger.error('IEEE 自动登录失败，请手动下载论文');
  logger.info('='.repeat(50));
  logger.info('手动下载步骤:');
  logger.info(`1. 访问: https://ieeexplore.ieee.org/document/11132593`);
  logger.info('2. 点击右上角 "Sign In" 登录');
  logger.info('3. 登录后回到文档页面');
  logger.info('4. 点击 "Download PDF" 按钮');
  logger.info('5. 保存 PDF 到本地');
  logger.info('6. 使用命令: dele-paper-summarize pdf <本地PDF路径>');
  logger.info('='.repeat(50));
  throw new Error('IEEE authentication failed - please download manually');
}

/**
 * 尝试使用 IEEE Xplore API v2 登录
 */
async function tryIEEELoginV2(logger: Logger): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      username: IEEE_EMAIL,
      password: IEEE_PASSWORD
    });

    const options = {
      hostname: 'ieeexplore.ieee.org',
      port: 443,
      path: '/auth/api/v1/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://ieeexplore.ieee.org',
        'Referer': 'https://ieeexplore.ieee.org/'
      }
    };

    const req = https.request(options, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      logger.debug(`API v2 login response status: ${res.statusCode}`);

      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        logger.debug(`API v2 login response: ${responseData.substring(0, 300)}`);

        if (res.statusCode === 200 || res.statusCode === 201) {
          const cookieStrings = cookies.map((c: string) => c.split(';')[0]);
          if (cookieStrings.length > 0) {
            resolve(cookieStrings);
          } else {
            reject(new Error('No cookies in response'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function tryIEEELogin(loginUrl: string, data: any, logger: Logger): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);

    const urlObj = new URL(loginUrl);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://ieeexplore.ieee.org',
        'Referer': 'https://ieeexplore.ieee.org/'
      }
    };

    const req = https.request(options, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      logger.debug(`Login response status: ${res.statusCode}`);

      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        logger.debug(`Login response: ${responseData.substring(0, 200)}`);

        if (res.statusCode === 200 || res.statusCode === 201) {
          // 检查响应是否表示成功
          if (responseData.includes('success') || responseData.includes('true') || responseData.includes('token')) {
            logger.success('IEEE login successful');
            const cookieStrings = cookies.map((c: string) => c.split(';')[0]);
            resolve(cookieStrings);
          } else {
            reject(new Error('Login response indicates failure'));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * 从页面获取 IEEE cookies
 */
async function getIEEECookiesFromPage(logger: Logger): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'ieeexplore.ieee.org',
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    };

    https.get(options, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      logger.debug(`Got ${cookies.length} cookies from initial visit`);

      // 返回初始 cookies
      const cookieStrings = cookies.map((c: string) => c.split(';')[0]);
      resolve(cookieStrings);
    }).on('error', reject);
  });
}

/**
 * 从 IEEE Xplore 文档页面获取 PDF 下载链接
 */
async function getIEEEPdfUrl(documentNumber: string, cookies: string[], logger: Logger): Promise<string> {
  return new Promise((resolve, reject) => {
    // 首先获取文档页面，找到 PDF 链接
    const docUrl = `https://ieeexplore.ieee.org/document/${documentNumber}`;

    const options = {
      hostname: 'ieeexplore.ieee.org',
      port: 443,
      path: `/document/${documentNumber}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies.join('; '),
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://ieeexplore.ieee.org/'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // 查找 PDF 链接 - 通常在 data-obj="pdf" 或类似的位置
        // IEEE 使用多种方式提供 PDF 下载
        const pdfPatterns = [
          /"pdfUrl"\s*:\s*"([^"]+)"/,
          /data-pdf-url="([^"]+)"/,
          /href="([^"]*\.pdf[^"]*)"/,
          /stamp\/stamp\.jsp\?arnumber=\d+/,
        ];

        let pdfUrl = '';

        // 方法1: 直接从 JSON 数据获取
        const jsonMatch = data.match(/"pdfUrl"\s*:\s*"([^"]+)"/);
        if (jsonMatch) {
          pdfUrl = jsonMatch[1].replace(/\\u0026/g, '&');
        }

        // 方法2: 查找 PDF download link
        if (!pdfUrl) {
          const pdfLinkMatch = data.match(/href="(https:\/\/ieeexplore\.ieee\.org\/stamp[^"]+)"/);
          if (pdfLinkMatch) {
            pdfUrl = pdfLinkMatch[1];
          }
        }

        // 方法3: 使用 API 获取 PDF
        if (!pdfUrl) {
          pdfUrl = `https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=${documentNumber}`;
        }

        // 确保 URL 是完整的
        if (pdfUrl.startsWith('/')) {
          pdfUrl = 'https://ieeexplore.ieee.org' + pdfUrl;
        }

        if (pdfUrl) {
          logger.info(`Found PDF URL: ${pdfUrl}`);
          resolve(pdfUrl);
        } else {
          reject(new Error('Could not find PDF download link'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * 下载 IEEE 论文（使用登录认证）
 */
export async function downloadIEEE(documentNumber: string, logger: Logger): Promise<Buffer> {
  try {
    logger.log(`downloadIEEE called for document: ${documentNumber}`);
    logger.log(`Attempting to download IEEE paper: ${documentNumber}`);

    // Step 1: 登录获取 cookie
    logger.log('Logging into IEEE Xplore...');
    const cookies = await ieeeLogin(logger);

    // Step 2链接: 获取 PDF 下载
    const pdfUrl = await getIEEEPdfUrl(documentNumber, cookies, logger);

    // 验证 PDF URL
    if (!pdfUrl || pdfUrl.trim() === '') {
      throw new Error('Failed to get valid PDF URL from IEEE');
    }

    // Step 3: 下载 PDF
    logger.info(`Downloading PDF from: ${pdfUrl}`);

    return new Promise((resolve, reject) => {
      let urlObj: URL;
      try {
        urlObj = new URL(pdfUrl);
      } catch (e) {
        reject(new Error(`Invalid PDF URL: ${pdfUrl}`));
        return;
      }
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': cookies.join('; '),
          'Accept': 'application/pdf',
          'Referer': `https://ieeexplore.ieee.org/document/${documentNumber}`
        }
      };

      protocol.get(options, (response) => {
        // 处理重定向
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          logger.info(`Following redirect to: ${response.headers.location}`);
          const redirectUrl = response.headers.location;
          return downloadFromUrl(redirectUrl, logger).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // 检查是否是 PDF
        const contentType = response.headers['content-type'] || '';
        logger.debug(`Content-Type: ${contentType}`);

        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);

          // 验证是 PDF
          if (buffer.length > 100 && buffer.slice(0, 5).toString() === '%PDF') {
            logger.success(`Successfully downloaded IEEE PDF (${(buffer.length / 1024).toFixed(2)} KB)`);
            resolve(buffer);
          } else {
            // 可能需要更高级别的认证
            logger.warn(`Downloaded content may not be PDF (length: ${buffer.length})`);
            const textPreview = buffer.slice(0, 200).toString();
            if (textPreview.includes('login') || textPreview.includes('sign in')) {
              reject(new Error('IEEE login may have expired or credentials invalid'));
            } else {
              resolve(buffer);
            }
          }
        });
        response.on('error', reject);
      }).on('error', reject);
    });
  } catch (error) {
    const err = error as Error;
    logger.error(`IEEE download failed: ${err.message}`);
    logger.info('Falling back to manual download instructions...');
    logger.info(`Please manually download the paper from:`);
    logger.info(`1. Visit: https://ieeexplore.ieee.org/document/${documentNumber}`);
    logger.info(`2. Login with your IEEE account`);
    logger.info(`3. Download the PDF`);
    logger.info(`4. Use the 'pdf' command with local file path`);
    throw error;
  }
}

/**
 * 获取当天日期文件夹
 */
export function getDateFolder(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 主下载函数
 */
export async function fetchPaper(input: string, options: FetcherOptions = {}): Promise<FetchResult> {
  const verbose = options.verbose || false;
  const logger = new Logger(verbose);

  logger.log(`Fetching paper: ${input}`);

  // 检测来源
  let type: SourceType;
  let id: string;

  try {
    logger.log(`Running detectSource on: ${input}`);
    const result = detectSource(input);
    type = result.type;
    id = result.id;
    logger.log(`detectSource completed: type=${type}, id=${id}`);
  } catch (e) {
    logger.error(`Error detecting source: ${(e as Error).message}`);
    throw e;
  }

  logger.log(`Detected source type: ${type}, ID: ${id}`);

  let buffer: Buffer;
  let filename: string;

  switch (type) {
    case 'local':
      const expandedInput = expandPath(input);
      logger.info(`Reading local file: ${expandedInput}`);
      buffer = fs.readFileSync(expandedInput);
      filename = `${id}.pdf`;
      break;

    case 'arxiv-pdf':
      buffer = await downloadArxivPDF(id, logger);
      filename = `${id}_arxiv.pdf`;
      break;

    case 'arxiv-html':
    case 'arxiv-abs':
      buffer = await downloadFromArxivHtml(id, logger);
      filename = `${id}_arxiv.pdf`;
      break;

    case 'ieee':
      logger.log(`Starting IEEE download for document: ${id}`);
      try {
        buffer = await downloadIEEE(id, logger);
        filename = `${id}_ieee.pdf`;
      } catch (ieeeErr) {
        logger.error(`IEEE download error: ${(ieeeErr as Error).message}`);
        throw ieeeErr;
      }
      break;

    case 'url':
      buffer = await downloadFromUrl(input, logger);
      filename = `${id}_web.pdf`;
      break;

    default:
      throw new Error(`Unsupported source type: ${type}`);
  }

  logger.success(`Paper fetched successfully: ${filename} (${(buffer.length / 1024).toFixed(2)} KB)`);

  return {
    buffer,
    sourceType: type,
    paperId: id,
    filename,
  };
}
