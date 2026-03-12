"""
Paper Summarizer - 本地模型调用模块
基于 llama.cpp server
"""

import os
import sys
import logging
import requests
from typing import Optional, Dict, Any

logger = logging.getLogger("paper-summarizer")

# 配置
DEFAULT_MODEL_PATH = "/mnt/d/0VibeCoding/000000model/Qwen3.5-9B/Qwen3.5-9B-Q6_K.gguf"
DEFAULT_SERVER_URL = "http://localhost:8080"
DEFAULT_MODEL_NAME = "qwen3.5-9b"


class LocalSummarizer:
    """本地模型总结器"""

    def __init__(self, model_path: str = None, server_url: str = None, model_name: str = None):
        self.model_path = model_path or DEFAULT_MODEL_PATH
        self.server_url = server_url or DEFAULT_SERVER_URL
        self.model_name = model_name or DEFAULT_MODEL_NAME
        self.server_process = None

    def check_server(self) -> bool:
        """检查 server 是否可用"""
        try:
            response = requests.get(f"{self.server_url}/v1/models", timeout=5)
            return response.status_code == 200
        except:
            return False

    def summarize(self, text: str, max_length: int = 1000) -> Optional[str]:
        """
        总结文本

        Args:
            text: 要总结的文本
            max_length: 最大长度

        Returns:
            总结后的文本
        """
        prompt = f"""请作为专业的学术论文总结助手，总结以下论文内容。

要求：
1. 使用 Markdown 格式
2. 清晰的结构化输出
3. 保留核心观点和关键信息
4. 总结长度：{max_length} 字以内

论文内容：
{text}

总结："""

        try:
            response = requests.post(
                f"{self.server_url}/v1/chat/completions",
                json={
                    "model": self.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_length,
                    "temperature": 0.7
                },
                timeout=300
            )

            if response.status_code == 200:
                result = response.json()
                summary = result.get("choices", [{}])[0].get("message", {}).get("content", "")
                return summary.strip()
            else:
                logger.error(f"API调用失败: {response.status_code}")
                return None

        except Exception as e:
            logger.error(f"总结失败: {e}")
            return None


def get_summarizer() -> LocalSummarizer:
    """获取总结器实例"""
    return LocalSummarizer()


__all__ = ["LocalSummarizer", "get_summarizer"]
