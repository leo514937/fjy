# Ontology Audit Hub

由 LangGraph、Pydantic、Qdrant 和 Neo4j 构建的基础设施驱动的问答审计中心。

## 🚀 快速启动（Windows / PowerShell）

下面的命令默认在仓库根目录 `D:\code\aft` 下执行。

### 1. 前置条件

- **Python**: 3.10+
- **Docker Desktop**: 用于运行后端服务（Qdrant / Neo4j）
- **PowerShell**: 用于执行仓库中的 `.ps1` 脚本

建议先确认 Python 可用：

```powershell
python --version
```

### 2. 创建虚拟环境并安装依赖

推荐在 Windows 上先创建虚拟环境，再安装开发依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[ai,graph,api,dev]"
```

如果你只想安装最小依赖，也可以使用：

```powershell
python -m pip install -e .
```

### 3. 配置环境变量

复制示例配置文件：

```powershell
Copy-Item .env.example .env
```

然后按需编辑 `.env`。

### 4. 启动后端服务

使用 PowerShell 脚本启动 Qdrant 和 Neo4j：

```powershell
### 4. 快速启动 (一键运行)

项目提供了一个整合脚本，可以同时启动数据库（Qdrant & Neo4j）和 Web API。

```powershell
# 运行整合脚本
.\scripts\start-all.ps1
```

该脚本会自动完成：
- 检查并后台运行数据库。
- 从 `.env` 加载 API Key（确保 LLM 模型生效）。
- 启动 FastAPI (uvicorn) 后台服务。

启动后默认访问地址：

```text
http://127.0.0.1:8000
```

可选参数：

```powershell
# 指定自定义端口
.\scripts\start-api.ps1 -Port 8080

# 跳过 .env 加载（直接使用系统环境变量）
.\scripts\start-api.ps1 -NoDotenv

# 关闭热重载（生产环境推荐）
.\scripts\start-api.ps1 -NoReload
```

启动后默认访问地址：

```text
http://127.0.0.1:8000
```

常用接口：

- `GET /health` — 服务健康探针
- `GET /ready` — 后端组件就绪状态
- `POST /audit/run` — 发起完整审计任务
- `POST /audit/resume` — 继续人工介入中断的会话
- `POST /qa/answer` — 向本体知识库提问（RAG + 图谱 + LLM）

### 5. 启动 Web 前端 

如果需要访问拥有图形界面的审计操作台，请确保后台 Web API 正在运行，然后打开一个新的 PowerShell 终端执行以下命令：

```powershell
# 进入前端目录
cd .\frontend

npm install

npm run dev
```

启动后，在浏览器中访问：`http://localhost:5173`

### 7. 运行 CLI

```powershell
python -m ontology_audit_hub.cli doctor
python -m ontology_audit_hub.cli run --request examples/audit_request.yaml
```

### 8. 常见问题

#### `ModuleNotFoundError: No module named 'ontology_audit_hub'`

请优先检查下面几项：

- 当前目录是否是仓库根目录
- 虚拟环境是否已经激活
- 依赖是否已执行 `python -m pip install -e ".[api]"` 或 `python -m pip install -e ".[ai,graph,api,dev]"`

在当前仓库中，也可以直接从根目录运行：

```powershell
python -m uvicorn ontology_audit_hub.api:app --reload
```

## 🛠️ 技术栈

- **框架**: [LangGraph](https://github.com/langchain-ai/langgraph)
- **数据验证**: [Pydantic](https://docs.pydantic.dev/)
- **向量数据库**: [Qdrant](https://qdrant.tech/)
- **图数据库**: [Neo4j](https://neo4j.com/)
- **API**: [FastAPI](https://fastapi.tiangolo.com/)
- **命令行**: [Typer](https://typer.tiangolo.com/)

## 🏗️ 项目架构

```text
                                +-------------------+
                                |   User Request    |
                                +---------+---------+
                                          |
                                          v
                    +-------------------------------------------+
                    |        Ontology Audit Hub (FastAPI / CLI) |
                    +---------------------+---------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |      LangGraph Supervisor (Orchestrator)  |
                    +---------+-----------+-----------+---------+
                              |           |           |
               +--------------+           |           +---------------+
               |                          |                           |
               v                          v                           v
    +-------------------+      +-------------------+       +-------------------+
    | Ontology Subgraph |      | Document Subgraph |       |   Code Subgraph   |
    | (Neo4j / Domain)  |      |  (Qdrant / RAG)   |       | (Static Analysis) |
    +---------+---------+      +---------+---------+       +---------+---------+
              |                          |                           |
              +---------------+----------+----------+----------------+
                              |          |          |
                              v          v          v
                    +---------+----------+----------+---------+
                    |          Infrastructure Layer           |
                    +-------------------------+---------------+
                    |  [Neo4j] Graph Storage  | [Qdrant] VecDB|
                    |  [LLM] AI Agent Adapter | [SQLite] State|
                    +-------------------------+---------------+
```

## Additional CLI Entry Points

Installed scripts:

```powershell
aft-review github --request-file examples/review_request.json
aft-review doctor

aft-qa answer --question "Explain the payment approval flow" --session-id qa-1
aft-qa answer --request-file examples/qa_request.json
aft-qa upload --file docs/requirements.md --collection docs
aft-qa rebuild-lexical-index --collection docs
aft-qa doctor
```

Module entrypoints:

```powershell
python -m ontology_audit_hub.review_cli github --request-file examples/review_request.json
python -m ontology_audit_hub.review_cli doctor

python -m ontology_audit_hub.qa_cli answer --question "Explain the payment approval flow" --session-id qa-1
python -m ontology_audit_hub.qa_cli answer --request-file examples/qa_request.json
python -m ontology_audit_hub.qa_cli upload --file docs/requirements.md --collection docs
python -m ontology_audit_hub.qa_cli rebuild-lexical-index --collection docs
python -m ontology_audit_hub.qa_cli doctor
```

### 核心设计理念
- **多代理协作**：基于 LangGraph 的状态管理，将审计拆分为本体校验、文档审查和代码静态分析。
- **混合检索 (Hybrid RAG)**：结合 **Qdrant** 的语义向量召回与 **Neo4j** 的本体关系增强。
- **人在回路 (HITL)**：支持中断会话以等待人工决策（Human-in-the-loop），确保审计结论的准确性。
