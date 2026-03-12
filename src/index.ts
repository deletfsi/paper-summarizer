#!/usr/bin/env node

import { createCLI } from './cli';

const program = createCLI();

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments provided
if (process.argv.length === 2) {
  program.help();
}
