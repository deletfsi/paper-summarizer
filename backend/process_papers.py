"""
论文处理脚本 - PDF 转 Markdown + LLM 总结
"""

import os
import sys
import json
import glob
from pathlib import Path

# 添加项目路径
sys.path.insert(0, '/mnt/d/0VibeCoding/000000000arxiv/paper-summarizer/backend')

import fitz  # pymupdf
import requests

API_URL = "http://localhost:8083"

def extract_text_from_pdf(pdf_path: str) -> str:
    """从 PDF 提取文本"""
    doc = fitz.open(pdf_path)
    text = ""

    for page in doc:
        text += page.get_text()

    doc.close()
    return text.strip()

def summarize_text(text: str, max_length: int = 800) -> str:
    """调用 LLM 总结"""
    # 限制输入文本长度，避免超时
    text = text[:8000]
    try:
        response = requests.post(
            f"{API_URL}/summarize",
            json={"text": text, "max_length": max_length},
            timeout=600  # 增加超时时间
        )
        if response.ok:
            return response.json().get("summary", "")
        else:
            print(f"  总结失败: {response.status_code}")
            return ""
    except Exception as e:
        print(f"  总结出错: {e}")
        return ""

def process_paper(paper_dir: str):
    """处理单个论文"""
    paper_name = os.path.basename(paper_dir)
    print(f"\n处理: {paper_name}")

    # 找 PDF 文件
    pdf_files = list(Path(paper_dir).glob("*.pdf"))
    if not pdf_files:
        print(f"  没有 PDF 文件，跳过")
        return

    pdf_path = pdf_files[0]

    # 检查 PDF 大小（太小可能是错误页面）
    pdf_size = os.path.getsize(pdf_path)
    if pdf_size < 10000:
        print(f"  PDF 文件太小 ({pdf_size} bytes)，可能是错误页面，跳过")
        return

    # 提取文本
    print(f"  提取文本中...")
    text = extract_text_from_pdf(str(pdf_path))

    if not text or len(text) < 100:
        print(f"  文本提取失败或内容太少")
        return

    print(f"  提取到 {len(text)} 字符")

    # 生成总结
    print(f"  生成总结中...")
    summary = summarize_text(text[:5000])  # 限制输入长度

    if summary:
        # 保存总结到 MD 文件
        md_path = pdf_path.with_suffix('.md')

        # 读取现有内容（如果有）
        existing_content = ""
        if md_path.exists():
            existing_content = md_path.read_text(encoding='utf-8')

        # 添加总结部分
        summary_content = f"""

---

## 🤖 AI 总结

{summary}

---

*由 Qwen3-8B 生成*
"""

        # 如果已有内容，插入总结
        if existing_content:
            # 在开头添加总结
            full_content = f"# {paper_name}\n{summary_content}\n\n{existing_content}"
        else:
            full_content = f"# {paper_name}\n\n{summary_content}\n\n## 原文内容\n\n{text[:10000]}..."

        md_path.write_text(full_content, encoding='utf-8')
        print(f"  已保存: {md_path}")
    else:
        print(f"  总结失败")

def main():
    base_dir = "/mnt/d/0VibeCoding/000000000arxiv/test-result/2026-03-11"

    # 处理每个论文目录
    for item in os.listdir(base_dir):
        item_path = os.path.join(base_dir, item)
        if os.path.isdir(item_path):
            process_paper(item_path)

    print("\n完成!")

if __name__ == "__main__":
    main()
