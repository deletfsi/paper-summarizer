#!/usr/bin/env python3
"""
论文处理 Pipeline: PDF -> Markdown (保留图片) -> LLM 总结
"""

import os
import sys
import glob
import json
import shutil
import base64
from pathlib import Path
from datetime import datetime

# 安装依赖: pip install pymupdf pillow requests llama-cpp-python
import fitz  # pymupdf
from PIL import Image
import requests

# ============= 配置 =============
# 本地模型路径
MODEL_PATH = "/mnt/d/0VibeCoding/000000model/Qwen3-8B/Qwen3-8B-Q4_K_M.gguf"
# 输出目录
OUTPUT_DIR = "/mnt/d/0VibeCoding/000000000arxiv/test"
# LLM API 地址
LLM_API_URL = "http://localhost:8083/v1/chat/completions"
# 最大输入token（安全起见）
MAX_INPUT_LENGTH = 6000

def pdf_to_markdown_with_images(pdf_path: str, output_dir: str) -> str:
    """
    将 PDF 转换为 Markdown，保留图片到本地
    返回 markdown 文件路径
    """
    os.makedirs(output_dir, exist_ok=True)
    images_dir = os.path.join(output_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    markdown_lines = []
    image_count = 0

    print(f"  PDF 共 {len(doc)} 页")

    for page_num, page in enumerate(doc):
        # 获取文本
        text = page.get_text()
        if text.strip():
            markdown_lines.append(f"\n## 第 {page_num + 1} 页\n")
            markdown_lines.append(text.strip())

        # 提取图片
        image_list = page.get_images(full=True)
        for img_index, img in enumerate(image_list):
            try:
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]

                # 保存图片
                image_filename = f"page{page_num + 1}_img{img_index + 1}.{image_ext}"
                image_path = os.path.join(images_dir, image_filename)

                with open(image_path, "wb") as f:
                    f.write(image_bytes)

                # 在 markdown 中引用图片
                markdown_lines.append(f"\n![{image_filename}](images/{image_filename})\n")
                image_count += 1
            except Exception as e:
                print(f"    提取图片失败: {e}")

    doc.close()

    # 保存 markdown 文件
    md_path = os.path.join(output_dir, "content.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(markdown_lines))

    print(f"  提取了 {image_count} 张图片")
    print(f"  保存 Markdown 到: {md_path}")
    return md_path


def summarize_with_llm(text: str, model_name: str = "Qwen3.5-9B") -> str:
    """
    使用本地 LLM 总结论文内容
    """
    # 限制输入长度
    text = text[:MAX_INPUT_LENGTH]

    # 构建 prompt
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
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 2048,
                "temperature": 0.7
            },
            timeout=600
        )

        if response.ok:
            result = response.json()
            return result["choices"][0]["message"]["content"]
        else:
            print(f"  LLM 调用失败: {response.status_code}")
            print(f"  错误: {response.text[:200]}")
            return ""
    except Exception as e:
        print(f"  LLM 调用出错: {e}")
        return ""


def extract_text_from_pdf(pdf_path: str, max_chars: int = 15000) -> str:
    """从 PDF 提取纯文本"""
    doc = fitz.open(pdf_path)
    text_parts = []

    for page in doc:
        text_parts.append(page.get_text())

    full_text = "\n".join(text_parts)
    return full_text[:max_chars]


def process_paper(paper_dir: str):
    """处理单篇论文"""
    paper_name = os.path.basename(paper_dir)
    print(f"\n{'='*50}")
    print(f"处理论文: {paper_name}")
    print(f"{'='*50}")

    # 查找 PDF 文件
    pdf_files = list(Path(paper_dir).glob("*.pdf"))
    if not pdf_files:
        print(f"  错误: 没有找到 PDF 文件")
        return

    pdf_path = str(pdf_files[0])
    pdf_size = os.path.getsize(pdf_path)

    if pdf_size < 5000:
        print(f"  错误: PDF 文件太小 ({pdf_size} bytes)，可能是错误页面")
        return

    print(f"  PDF 大小: {pdf_size / 1024 / 1024:.2f} MB")

    # Step 1: PDF 转 Markdown（保留图片）
    print(f"\n[1/2] 转换 PDF 为 Markdown...")
    md_path = pdf_to_markdown_with_images(pdf_path, paper_dir)

    # Step 2: 提取文本并总结
    print(f"\n[2/2] 使用 LLM 总结论文...")
    text = extract_text_from_pdf(pdf_path)
    print(f"  提取文本长度: {len(text)} 字符")

    summary = summarize_with_llm(text)

    if summary:
        # 保存总结
        summary_path = os.path.join(paper_dir, "summary.md")
        summary_content = f"""# {paper_name}

## 🤖 AI 总结

{summary}

---
*由 {os.path.basename(MODEL_PATH)} 生成*
*处理时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*
"""

        with open(summary_path, "w", encoding="utf-8") as f:
            f.write(summary_content)

        print(f"  总结已保存: {summary_path}")
    else:
        print(f"  总结失败")


def main():
    """主函数"""
    print("=" * 60)
    print("论文处理 Pipeline")
    print(f"模型: {MODEL_PATH}")
    print(f"输出目录: {OUTPUT_DIR}")
    print("=" * 60)

    # 处理每个论文目录
    for item in sorted(os.listdir(OUTPUT_DIR)):
        item_path = os.path.join(OUTPUT_DIR, item)
        if os.path.isdir(item_path):
            # 跳过已处理的
            if os.path.exists(os.path.join(item_path, "summary.md")):
                print(f"\n跳过已处理: {item}")
                continue
            process_paper(item_path)

    print("\n" + "=" * 60)
    print("处理完成!")
    print("=" * 60)


if __name__ == "__main__":
    main()
