import { Command } from 'commander';
import chalk from 'chalk';
import { arxivCommand } from './commands/arxiv';
import { pdfCommand } from './commands/pdf';
import { Logger } from './utils/logger';

export function createCLI(): Command {
  const program = new Command();

  // Create a logger instance for CLI
  const logger = new Logger(false);

  program
    .name('dele-paper-summarize')
    .description('CLI tool for summarizing academic papers from arXiv or PDF')
    .version('1.0.0')
    .option('-v, --verbose', 'Enable verbose logging');

  // Add verbose flag handling
  program.on('option:verbose', () => {
    const verbose = program.opts().verbose;
    if (verbose) {
      logger.info('Verbose mode enabled');
    }
  });

  // arxiv command
  program
    .command('arxiv <id>')
    .description('Fetch and summarize a paper from arXiv by ID')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-s, --summarize', 'Generate AI summary using LLM (requires Ollama)')
    .action(async (id: string, options: { verbose: boolean; summarize: boolean }) => {
      if (options.verbose) {
        logger.info(`Running arxiv command with ID: ${id}`);
      }
      await arxivCommand(id, { verbose: options.verbose, summarize: options.summarize });
    });

  // pdf command
  program
    .command('pdf <url>')
    .description('Fetch and summarize a paper from a PDF URL')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-s, --summarize', 'Generate AI summary using LLM (requires Ollama)')
    .action(async (url: string, options: { verbose: boolean; summarize: boolean }) => {
      if (options.verbose) {
        logger.info(`Running pdf command with URL: ${url}`);
      }
      await pdfCommand(url, { verbose: options.verbose, summarize: options.summarize });
    });

  // Help command - show help when no arguments provided
  program.on('command:*', () => {
    console.log(chalk.yellow('\nInvalid command. Use --help for available commands.\n'));
    program.help();
  });

  return program;
}
