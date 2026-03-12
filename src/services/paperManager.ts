/**
 * Paper Manager - 论文文件管理
 *
 * 功能:
 * - 按日期创建论文存储目录
 * - 保存论文 PDF 和 Markdown
 * - 管理图片目录
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

// 默认论文存储根目录
export const DEFAULT_PAPER_ROOT = 'D:\\0VibeCoding\\000000000arxiv\\test-result';

export interface PaperManagerOptions {
  verbose?: boolean;
  paperRoot?: string;
}

export interface PaperPaths {
  paperDir: string;
  pdfPath: string;
  mdPath: string;
  imagesDir: string;
}

/**
 * Paper Manager 类
 */
export class PaperManager {
  private logger: Logger;
  private paperRoot: string;

  constructor(options: PaperManagerOptions = {}) {
    this.logger = new Logger(options.verbose || false);
    let root = options.paperRoot || DEFAULT_PAPER_ROOT;
    // 转换 Windows 路径到 WSL 路径
    root = this.convertToWslPath(root);
    this.paperRoot = root;
  }

  /**
   * 转换 Windows 路径到 WSL 路径
   * D:\xxx -> /mnt/d/xxx
   */
  private convertToWslPath(inputPath: string): string {
    // 检查是否是 Windows 路径 (D:\xxx 或 D:/xxx)
    const windowsMatch = inputPath.match(/^([A-Za-z]):[\\\/](.+)$/);
    if (windowsMatch) {
      const drive = windowsMatch[1].toLowerCase();
      const restPath = windowsMatch[2].replace(/\\/g, '/');
      return `/mnt/${drive}/${restPath}`;
    }
    return inputPath;
  }

  /**
   * 获取当天日期文件夹路径
   */
  private getDateFolder(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 确保论文目录存在
   */
  ensurePaperDir(paperId?: string): string {
    const dateFolder = this.getDateFolder();
    const paperDir = paperId
      ? path.join(this.paperRoot, dateFolder, this.sanitizeFilename(paperId))
      : path.join(this.paperRoot, dateFolder);

    if (!fs.existsSync(paperDir)) {
      this.logger.info(`Creating paper directory: ${paperDir}`);
      fs.mkdirSync(paperDir, { recursive: true });
    }

    return paperDir;
  }

  /**
   * 确保图片目录存在
   */
  ensureImagesDir(paperId: string): string {
    const paperDir = this.ensurePaperDir(paperId);
    const imagesDir = path.join(paperDir, 'images');

    if (!fs.existsSync(imagesDir)) {
      this.logger.info(`Creating images directory: ${imagesDir}`);
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    return imagesDir;
  }

  /**
   * 保存论文 PDF - 每个论文一个文件夹
   */
  savePDF(buffer: Buffer, paperId: string, source: string): string {
    const dateFolder = this.getDateFolder();
    const paperFolder = this.sanitizeFilename(paperId);
    const filename = `${paperFolder}.pdf`;

    // 保存到论文自己的文件夹
    const paperDir = path.join(this.paperRoot, dateFolder, paperFolder);
    const pdfPath = path.join(paperDir, filename);

    if (!fs.existsSync(paperDir)) {
      fs.mkdirSync(paperDir, { recursive: true });
    }

    this.logger.info(`Saving PDF: ${pdfPath}`);
    fs.writeFileSync(pdfPath, buffer);

    return pdfPath;
  }

  /**
   * 保存 Markdown 文件 - 每个论文一个文件夹
   */
  saveMarkdown(content: string, paperId: string, source: string): string {
    const dateFolder = this.getDateFolder();
    const paperFolder = this.sanitizeFilename(paperId);
    const filename = `${paperFolder}.md`;

    // 保存到论文自己的文件夹
    const paperDir = path.join(this.paperRoot, dateFolder, paperFolder);
    const mdPath = path.join(paperDir, filename);

    // 确保目录存在
    const dir = path.dirname(mdPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.logger.info(`Saving Markdown: ${mdPath}`);
    fs.writeFileSync(mdPath, content, 'utf-8');

    return mdPath;
  }

  /**
   * 保存图片
   */
  saveImage(buffer: Buffer, paperId: string, imageIndex: number): string {
    const imagesDir = this.ensureImagesDir(paperId);
    const filename = `image_${String(imageIndex).padStart(3, '0')}.png`;
    const imagePath = path.join(imagesDir, filename);

    this.logger.debug(`Saving image: ${imagePath}`);
    fs.writeFileSync(imagePath, buffer);

    return imagePath;
  }

  /**
   * 获取论文的所有路径
   */
  getPaperPaths(paperId: string, source: string): PaperPaths {
    const dateFolder = this.getDateFolder();
    const paperDir = path.join(this.paperRoot, dateFolder, this.sanitizeFilename(paperId));
    const pdfPath = path.join(this.paperRoot, dateFolder, `${this.sanitizeFilename(paperId)}_${source}.pdf`);
    const mdPath = path.join(this.paperRoot, dateFolder, `${this.sanitizeFilename(paperId)}_${source}.md`);
    const imagesDir = path.join(paperDir, 'images');

    return {
      paperDir,
      pdfPath,
      mdPath,
      imagesDir,
    };
  }

  /**
   * 获取当天论文目录
   */
  getTodayDir(): string {
    const dateFolder = this.getDateFolder();
    return path.join(this.paperRoot, dateFolder);
  }

  /**
   * 检查论文是否已存在
   */
  paperExists(paperId: string, source: string): boolean {
    const { pdfPath } = this.getPaperPaths(paperId, source);
    return fs.existsSync(pdfPath);
  }

  /**
   * 清理文件名中的非法字符
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100); // 限制长度
  }
}

// 默认实例
export const paperManager = new PaperManager();
