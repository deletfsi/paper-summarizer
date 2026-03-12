/**
 * Local LLM service - 调用 Python 后端 API
 */

import { logger } from '../utils/logger';

let apiAvailable = false;
const API_URL = process.env.LLM_API_URL || 'http://localhost:8083';

/**
 * 初始化本地模型服务
 */
export async function initLocalModel(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    apiAvailable = response.ok;
    return apiAvailable;
  } catch {
    apiAvailable = false;
    return false;
  }
}

/**
 * 检查本地模型是否可用
 */
export function isLocalModelAvailable(): boolean {
  return apiAvailable;
}

/**
 * 生成总结
 */
export async function localCompletion(
  prompt: string,
  options: {
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
    model?: string;
  } = {}
): Promise<string> {
  const { maxTokens = 4096, temperature = 0.7 } = options;

  try {
    const url = `${API_URL}/summarize`;

    const body = {
      text: prompt,
      max_length: maxTokens,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });

    if (response.ok) {
      const data: any = await response.json();
      return data.summary || data.mindmap || '';
    }

    throw new Error(`API returned ${response.status}`);
  } catch (error) {
    throw new Error(`Local model failed: ${(error as any)?.message || 'Unknown error'}`);
  }
}

/**
 * 获取可用模型
 */
export async function getAvailableModels(): Promise<string[]> {
  // 返回当前使用的模型
  return ['qwen3-8b'];
}
