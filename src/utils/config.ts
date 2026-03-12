/**
 * Configuration module for LLM API settings
 * Supports environment variables: LLM_API_URL, LLM_API_KEY, LLM_MODEL
 * Also supports local models via node-llama-cpp
 */

import * as path from 'path';
import * as fs from 'fs';

export interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  timeout: number;
  maxRetries: number;
  useLocal: boolean;
  localModelPath: string;
  localModelType: 'llama-cpp' | 'ollama' | 'server';
}

const DEFAULT_CONFIG: Partial<LLMConfig> = {
  model: 'qwen3.5-9b', // Default model name
  timeout: 300000, // 5 minutes
  maxRetries: 2,
  useLocal: true, // Use local server
  localModelType: 'server', // llama.cpp server
};

/**
 * Get default local model path
 */
function getDefaultLocalModelPath(): string {
  const modelPaths = [
    // Primary: Qwen3.5-9B (WSL path)
    '/mnt/d/0VibeCoding/000000model/Qwen3.5-9B/Qwen3.5-9B-Q6_K.gguf',
    // Windows path in WSL
    '/mnt/d/0VibeCoding/000000model/Qwen3.5-9B/Qwen3.5-9B-Q6_K.gguf',
    // Fallback: Qwen3-8B
    '/mnt/d/0VibeCoding/000000model/Qwen3-8B/Qwen3-8B-Q6_K.gguf',
  ];

  for (const p of modelPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return modelPaths[0];
}

/**
 * Get LLM configuration from environment variables
 */
export function getLLMConfig(): LLMConfig {
  const useLocal = process.env.LLM_USE_LOCAL !== 'false';
  const localModelPath = process.env.LLM_LOCAL_MODEL_PATH || getDefaultLocalModelPath();

  // Use Windows Ollama via network (172.30.32.1 is the default gateway/Windows host)
  const ollamaUrl = process.env.LLM_API_URL || 'http://172.30.32.1:11434/api/generate';

  return {
    apiUrl: ollamaUrl,
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'qwen3.5-9b',  // Use imported Qwen model
    timeout: parseInt(process.env.LLM_TIMEOUT || '', 10) || DEFAULT_CONFIG.timeout!,
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '', 10) || DEFAULT_CONFIG.maxRetries!,
    useLocal,
    localModelPath,
    localModelType: (process.env.LLM_LOCAL_MODEL_TYPE as 'llama-cpp' | 'ollama' | 'server') || DEFAULT_CONFIG.localModelType!,
  };
}

/**
 * Validate LLM configuration
 */
export function validateLLMConfig(config: LLMConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.useLocal) {
    // Validate remote API config
    if (!config.apiUrl) {
      errors.push('LLM_API_URL is required');
    }

    if (!config.model) {
      errors.push('LLM_MODEL is required');
    }

    // Check if API URL is valid
    try {
      new URL(config.apiUrl);
    } catch {
      errors.push(`Invalid LLM_API_URL: ${config.apiUrl}`);
    }
  } else {
    // Validate local model config
    if (!fs.existsSync(config.localModelPath)) {
      errors.push(`Local model not found: ${config.localModelPath}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
