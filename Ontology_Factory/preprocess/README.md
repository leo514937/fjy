# 多模型文档预处理与保守降噪（只输出干净文本）

本项目用于把工程文档（`pdf/docx/txt/md/html`）转成**干净、可追溯、偏保守**的纯文本。

## 特性

- **多格式输入**：`pdf/docx/txt/md/html`
- **保守降噪**：宁可漏修，也尽量不碰数字/单位/参数
- **可选三模型协同**：你配置三套模型后，可用“最小改动 + 数字保全校验”做仲裁（未配置也可纯规则运行）

## 安装

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 配置

复制 `config.example.yaml` 为 `config.yaml` 并按需修改：

- `models.enabled=false`：只做规则清洗（推荐先跑通）
- `models.enabled=true`：启用三模型并行清洗与保守仲裁
- `models.chunking.enabled=true`：自动分块处理长文档（默认开启）
- `models.chunking.max_chars`：每块最大字符数（默认 `3500`）

模型密钥支持两种方式（推荐用环境变量，避免把密钥写进文件）：

```bash
setx MODEL_A_API_KEY "xxx"
setx MODEL_B_API_KEY "yyy"
setx MODEL_C_API_KEY "zzz"
```

也可以直接在 `config.yaml` 的 `api_key_env` 字段里填写 key（不推荐，注意不要提交/共享该文件）。

## 使用

单文件：

```bash
python -m mm_denoise.cli --config config.yaml --input "你的文件.pdf"
```

批量（按配置里的 `input_globs` 扫描当前目录）：

```bash
python -m mm_denoise.cli --config config.yaml
```

输出在 `outputs/`，每个输入文件对应一个 `.clean.txt`。

同时会额外生成一个同名的清洗报告：`.report.json`（包含规则清洗统计、模型候选 notes/置信度、仲裁选择与被拒绝原因等）。

长文档无需手动拆分：程序会自动分块、逐块清洗并自动拼接回单一输出文件。

