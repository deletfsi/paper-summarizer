"""
Paper Summarizer API Server
使用 llama-server (OpenAI 兼容 API)
"""

import os
import sys
import asyncio
import logging
import requests
from pathlib import Path
from aiohttp import web

# 配置 - 使用已有的 llama-server (Qwen3.5-9B on port 8086)
LLAMA_SERVER_URL = "http://localhost:8086"
API_PORT = 8083
MODEL_NAME = "qwen3.5-9b"

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("paper-summarizer-api")



async def health_check(request):
    """健康检查"""
    return web.json_response({
        "status": "ok",
        "model": MODEL_NAME
    })


async def summarize(request):
    """论文总结接口"""
    try:
        data = await request.json()
        text = data.get("text", "")
        max_length = data.get("max_length", 1000)

        if not text:
            return web.json_response({"error": "text is required"}, status=400)

        prompt = f"""请作为专业的学术论文总结助手，总结以下论文内容。

要求：
1. 使用 Markdown 格式
2. 清晰的结构化输出
3. 保留核心观点和关键信息
4. 总结长度：{max_length} 字以内

论文内容：
{text}

总结："""

        # 调用 llama-server
        response = requests.post(
            f"{LLAMA_SERVER_URL}/v1/chat/completions",
            json={
                "model": "Qwen3.5-9B-Q4_0.gguf",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_length,
                "temperature": 0.7
            },
            timeout=300
        )

        if response.ok:
            result = response.json()
            summary = result["choices"][0]["message"]["content"]
            return web.json_response({"summary": summary})
        else:
            return web.json_response({"error": f"LLM error: {response.text}"}, status=500)

    except Exception as e:
        logger.error(f"总结失败: {e}")
        return web.json_response({"error": str(e)}, status=500)


async def generate_mindmap(request):
    """思维导图生成接口"""
    try:
        data = await request.json()
        text = data.get("text", "")

        if not text:
            return web.json_response({"error": "text is required"}, status=400)

        prompt = f"""从以下论文内容生成思维导图（使用 Markdown 格式）：

{text}

请用以下格式输出思维导图：
# 论文主题
## 主要观点1
- 关键点1
- 关键点2
## 主要观点2
- 关键点1
- 关键点2
"""

        response = requests.post(
            f"{LLAMA_SERVER_URL}/v1/chat/completions",
            json={
                "model": "Qwen3.5-9B-Q4_0.gguf",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2000,
                "temperature": 0.7
            },
            timeout=300
        )

        if response.ok:
            result = response.json()
            mindmap = result["choices"][0]["message"]["content"]
            return web.json_response({"mindmap": mindmap})
        else:
            return web.json_response({"error": f"LLM error: {response.text}"}, status=500)

    except Exception as e:
        logger.error(f"思维导图生成失败: {e}")
        return web.json_response({"error": str(e)}, status=500)


def create_app():
    """创建 web 应用"""
    app = web.Application()

    # 添加路由
    app.router.add_get('/health', health_check)
    app.router.add_post('/summarize', summarize)
    app.router.add_post('/mindmap', generate_mindmap)

    return app


if __name__ == '__main__':
    logger.info(f"启动 API 服务: http://localhost:{API_PORT}")
    logger.info(f"使用模型: {MODEL_NAME}")
    logger.info(f" llama-server: {LLAMA_SERVER_URL}")

    app = create_app()
    web.run_app(app, host='0.0.0.0', port=API_PORT)
