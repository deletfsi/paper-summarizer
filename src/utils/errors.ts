export interface ErrorResult {
  hasError: boolean;
  errorType?: 'exit_code' | 'keyword' | 'unknown';
  message: string;
  isUncertain: boolean;
}

/**
 * Detect errors from command output and exit codes
 * @param exitCode - Process exit code
 * @param output - Command output (stdout/stderr)
 * @returns Error detection result
 */
export function detectError(exitCode: number | null, output: string): ErrorResult {
  const errorKeywords = ['Error', 'Failed', 'Exception', 'error', 'failed', 'exception'];

  // Check exit code
  if (exitCode !== null && exitCode !== 0) {
    return {
      hasError: true,
      errorType: 'exit_code',
      message: `Command failed with exit code: ${exitCode}`,
      isUncertain: false
    };
  }

  // Check for error keywords in output
  for (const keyword of errorKeywords) {
    if (output.includes(keyword)) {
      // Determine if it's a certain error or uncertain
      // Certain errors: actual error messages
      // Uncertain: warnings or informational messages containing keywords
      const uncertainPatterns = ['error handling', 'error code', 'error rate', 'no error'];
      const isCertain = !uncertainPatterns.some(pattern =>
        output.toLowerCase().includes(pattern.toLowerCase())
      );

      return {
        hasError: true,
        errorType: 'keyword',
        message: `Found "${keyword}" in output: ${output.substring(0, 100)}...`,
        isUncertain: !isCertain
      };
    }
  }

  return {
    hasError: false,
    message: 'No errors detected',
    isUncertain: false
  };
}

/**
 * Get user-facing error message with optional conservative mode prompt
 * @param result - Error detection result
 * @param conservativeMode - Whether to ask user about uncertain errors
 * @returns Formatted error message
 */
export function formatErrorMessage(result: ErrorResult, conservativeMode: boolean = true): string {
  if (!result.hasError) {
    return '';
  }

  let message = `\n[ERROR] ${result.message}\n`;

  if (result.isUncertain && conservativeMode) {
    message += '\n⚠️  This might be a false positive. The operation may have completed successfully.\n';
    message += 'Please verify the output manually.\n';
  }

  return message;
}
