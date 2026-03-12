import * as fs from 'fs';
import * as path from 'path';

export class Logger {
  private verbose: boolean;
  private logFile: string;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
    // Create log file in current directory
    this.logFile = path.join(process.cwd(), 'dele-paper-summarize.log');
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: string, message: string): string {
    return `[${this.getTimestamp()}] [${level}] ${message}`;
  }

  private writeToFile(message: string): void {
    try {
      fs.appendFileSync(this.logFile, message + '\n');
    } catch (error) {
      // Silently fail if we can't write to log file
      console.error('Failed to write to log file:', error);
    }
  }

  log(message: string): void {
    const formatted = this.formatMessage('INFO', message);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  info(message: string): void {
    if (this.verbose) {
      const formatted = this.formatMessage('INFO', message);
      console.log(formatted);
    }
    this.writeToFile(this.formatMessage('INFO', message));
  }

  warn(message: string): void {
    const formatted = this.formatMessage('WARN', message);
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  error(message: string): void {
    const formatted = this.formatMessage('ERROR', message);
    console.error(formatted);
    this.writeToFile(formatted);
  }

  debug(message: string): void {
    if (this.verbose) {
      const formatted = this.formatMessage('DEBUG', message);
      console.log(formatted);
    }
    this.writeToFile(this.formatMessage('DEBUG', message));
  }

  success(message: string): void {
    const formatted = this.formatMessage('SUCCESS', message);
    console.log(formatted);
    this.writeToFile(formatted);
  }
}

// Default logger instance (verbose: false)
export const logger = new Logger();
