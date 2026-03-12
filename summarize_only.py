#!/usr/bin/env python3
"""
只运行总结部分 - 用于已转换好的 Markdown
"""

import os
import sys
import requests

LLM_API_URL = "http://localhost:8083/v1/chat/completions"
OUTPUT_DIR = "/mnt/d/0VibeCoding/000000000arxiv/test"

def summarize_with_llm(text: str, paper_name: str) -> str:
    """使用 LLM 总结"""
    text = text[:6000]

    prompt = f"""你是一个学术论文分析助手。请仔细阅读以下论文内容，然后提供：
1. 论文标题（如果能从内容中推断）
2. 主要研究问题/目标
3. 提出的方法/方案
4. 实验结果和结论
5. 创新点

请用中文回答，语言简洁专业。

论文内容：
{text}

---

请总结以上论文："""

    try:
        response = requests.post(
            LLM_API_URL,
            json={
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2048,
                "temperature": 0.7
            },
            timeout=600
        )

        if response.ok:
            result = response.json()
            return result["choices"][0]["message"]["content"]
        else:
            print(f"  LLM 失败: {response.status_code}")
            return ""
    except Exception as e:
        print(f"  LLM 出错: {e}")
        return ""


def extract_text_from_md(md_path: str, max_chars: int = 8000) -> str:
    """从 markdown 提取文本"""
    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()
    # 简单处理：移除图片引用
    lines = []
    for line in text.split("\n"):
        if not line.startswith("!["):
            lines.append(line)
    return "\n".join(lines)[:max_chars]


def main():
    for item in sorted(os.listdir(OUTPUT_DIR)):
        item_path = os.path.join(OUTPUT_DIR, item)
        if not os.path.isdir(item_path):
            continue

        # 检查是否已有总结
        summary_path = os.path.join(item_path, "summary.md")
        if os.path.exists(summary_path):
            print(f"跳过已处理: {item}")
            continue

        # 检查是否有 content.md
        md_path = os.path.join(item_path, "content.md")
        if not os.path.exists(md_path):
            continue

        print(f"\n处理: {item}")

        # 提取文本
        text = extract_text_from_md(md_path)
        print(f"  文本长度: {len(text)} 字符")

        # 总结
        summary = summarize_with_llm(text, item)

        if summary:
            with open(summary_path, "w", encoding="utf-8") as f:
                f.write(f"# {item}\n\n## 🤖 AI 总结\n\n{summary}\n\n---\n*由 Qwen3-8B 生成*\n")
            print(f"  已保存: {summary_path}")
        else:
            print(f"  总结失败")


if __name__ == "__main__":
    main()
