# Paper Summarizer 后端

## 启动方式

### 方式1: 使用已有的 bilibili 后端
如果 `dele-bilibili-up-summarize` 后端已经在运行，API 已经在 `localhost:8080`

### 方式2: 手动启动 llama.cpp server

```bash
# 安装 llama.cpp
# 或直接用 Python 的 llama-cpp-python

# 启动 server
llama-server -m /mnt/d/0VibeCoding/000000model/Qwen3.5-9B/Qwen3.5-9B-Q6_K.gguf -c 32768 --port 8080
```

### 方式3: 启动本项目的 API Server

```bash
cd backend
pip install aiohttp requests
python api.py
```

这会：
1. 尝试启动 llama.cpp server (如果没有运行)
2. 在端口 8081 提供 API 服务

## API 接口

- `GET /health` - 健康检查
- `POST /summarize` - 论文总结
- `POST /mindmap` - 思维导图生成
