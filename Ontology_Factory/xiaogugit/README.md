# xiaogugit

一个基于 Git 的“数据版本管理”小服务：把每次写入的 JSON 数据落到本地仓库并自动提交，从而获得可追溯的版本历史、差异对比与回滚能力。

## 功能

- 按 `project_id` 自动初始化一个本地 Git 仓库（位于 `./storage/<project_id>`）
- 写入：把 `data`（JSON）写入指定 `filename` 并提交（commit author 使用 `agent_name`）
- 读取：读取当前版本或指定 `commit_id` 的历史版本
- 日志：查看该项目的提交历史
- Diff：对比两个提交之间某文件的差异
- 回滚：将某个提交之后的变更批量 revert（生成一次新的回滚提交）
- 路径安全校验：限制非法 `project_id` 和 `filename`，避免路径穿越

## 项目结构

```
.
├─ manager.py   # Git 版本管理核心逻辑（GitPython）
├─ server.py    # FastAPI HTTP API
└─ storage/     # 数据与本地 Git 仓库根目录（运行后自动生成）
```

`storage/test_project` 是一个示例/测试项目目录（其中包含自己的 `.git`）。

## 环境依赖

- Python 3.9+（推荐）
- 依赖库：`fastapi`、`uvicorn`、`gitpython`、`pydantic`

安装示例：

```bash
pip install fastapi uvicorn gitpython pydantic
```

如果希望安装并直接使用 CLI，可在当前目录执行：

```bash
pip install -e .
xiaogugit --help
```

如果直接使用源码目录中的模块入口，请在 `Ontology_Factory` 父目录执行：

```bash
python -m xiaogugit --help
```

## CLI

当前版本新增了一个仅面向“项目/版本管理”的命令行封装，直接复用 `manager.py` 的现有逻辑，不会替代现有 HTTP 服务。

常用示例：

```bash
xiaogugit --root-dir ./storage project init --project-id demo --name "演示项目"
xiaogugit --root-dir ./storage write --project-id demo --filename ontology.json --message "AI: update ontology" --agent-name agent-1 --committer-name Teacher --basevision 0 --data-file ./payload.json
xiaogugit --root-dir ./storage read --project-id demo --filename ontology.json
xiaogugit --root-dir ./storage log --project-id demo
xiaogugit --root-dir ./storage version tree --project-id demo --filename ontology.json
xiaogugit --root-dir ./storage diff commits --project-id demo --filename ontology.json --base-commit <base_sha> --target-commit <target_sha>
xiaogugit --root-dir ./storage rollback version --project-id demo --version-id 1 --filename ontology.json
xiaogugit --root-dir ./storage delete purge --project-id demo --filename ontology.json --yes
```

也可以不安装，直接从 `Ontology_Factory` 父目录运行：

```bash
python -m xiaogugit --root-dir ./xiaogugit/storage project list
```

## 启动

方式 1：直接运行（`server.py` 内置 uvicorn 启动）

```bash
python server.py
```

方式 2：命令行启动（推荐开发调试）

```bash
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

启动后访问：

- API 文档：`http://127.0.0.1:8000/docs`
- 简易前端：`http://127.0.0.1:8000/ui`
- 可视化前端：`http://127.0.0.1:8000/ui-visual`
- 现代版前端：`http://127.0.0.1:8000/ui-modern`
- 可视化现代版前端：`http://127.0.0.1:8000/ui-visual-modern`

## API 说明

### 0) 服务状态

- `GET /`：服务首页信息
- `GET /health`：健康检查

### 1) 初始化项目

`POST /projects/init`

请求体（JSON）：

```json
{
  "project_id": "demo",
  "name": "发动机项目",
  "description": "课程作业演示项目",
  "status": "开发中"
}
```

### 2) 查询项目与提交信息

- `GET /projects`：查看全部项目
- `GET /projects/{project_id}`：查看单个项目详情
- `GET /projects/{project_id}/files`：查看项目中的文件列表
- `GET /projects/{project_id}/commits/{commit_id}`：查看某次提交详情

### 3) 写入并提交

`POST /write`

请求体（JSON）：

```json
{
  "project_id": "demo",
  "filename": "ontology.json",
  "data": { "hello": "world" },
  "message": "AI: update ontology",
  "agent_name": "agent-1",
  "committer_name": "Teacher",
  "basevision": 0
}
```

返回示例：

```json
{ "status": "success", "commit_id": "..." }
```

当内容未变化时：

```json
{ "status": "no_change" }
```

### 4) 更新项目状态

`POST /projects/status`

请求体（JSON）：

```json
{
  "project_id": "demo",
  "status": "测试中",
  "operator": "teacher"
}
```

支持状态：

- `开发中`
- `测试中`
- `已完成`
- `已暂停`
- `已归档`
- `已回滚`

### 5) 读取（支持历史版本）

`GET /read/{project_id}/{filename}`

- 读取最新：不带 `commit_id`
- 读取历史：加 query 参数 `commit_id`

示例：

```bash
curl "http://127.0.0.1:8000/read/demo/ontology.json"
curl "http://127.0.0.1:8000/read/demo/ontology.json?commit_id=<commit_sha>"
```

### 6) 日志与版本树

`GET /log/{project_id}`

- `GET /versions/{project_id}`：查看项目内所有文件版本树
- `GET /versions/{project_id}?filename=ontology.json`：查看指定文件版本树
- `GET /versions/{project_id}/{filename}`：查看指定文件版本树（路径参数版本）
- `GET /timelines/{project_id}`：查看所有文件时间线
- `GET /version-detail/{project_id}/{version_id}`：查看版本详情（可选 `filename`）
- `GET /version-read/{project_id}/{version_id}`：按版本号读取（可选 `filename`）

示例：

```bash
curl "http://127.0.0.1:8000/log/demo"
curl "http://127.0.0.1:8000/versions/demo"
curl "http://127.0.0.1:8000/versions/demo?filename=ontology.json"
curl "http://127.0.0.1:8000/version-detail/demo/<version_id>"
curl "http://127.0.0.1:8000/version-read/demo/<version_id>"
```

### 7) Diff（提交级与版本级）

`GET /diff?project_id=...&filename=...&base=...&target=...`

或使用版本号对比：

`GET /diff?project_id=...&filename=...&base_version_id=...&target_version_id=...`

专用版本对比接口：

`GET /version-diff?project_id=...&base_version_id=...&target_version_id=...`

示例：

```bash
curl "http://127.0.0.1:8000/diff?project_id=demo&filename=ontology.json&base=<base_sha>&target=<target_sha>"
curl "http://127.0.0.1:8000/diff?project_id=demo&filename=ontology.json&base_version_id=<v1>&target_version_id=<v2>"
curl "http://127.0.0.1:8000/version-diff?project_id=demo&base_version_id=<v1>&target_version_id=<v2>"
```

### 8) 删除（软删或清历史）

`POST /delete`

请求体（JSON）：

```json
{
  "project_id": "demo",
  "filename": "ontology.json",
  "message": "System: 删除本体",
  "committer_name": "System",
  "agent_name": null,
  "purge_history": true
}
```

- 当 `purge_history=true`（默认）时，执行彻底清除该文件历史
- 当 `purge_history=false` 时，执行一次普通删除提交（保留历史）

### 9) 回滚（提交级与版本级）

`POST /rollback?project_id=...&commit_id=...`

或：

`POST /rollback?project_id=...&version_id=...`

专用版本回滚接口：

`POST /version-rollback?project_id=...&version_id=...`

示例：

```bash
curl -X POST "http://127.0.0.1:8000/rollback?project_id=demo&commit_id=<commit_sha>"
curl -X POST "http://127.0.0.1:8000/rollback?project_id=demo&version_id=<version_id>"
curl -X POST "http://127.0.0.1:8000/version-rollback?project_id=demo&version_id=<version_id>"
```

## 数据与版本存储规则

- 每个 `project_id` 对应一个目录：`./storage/<project_id>/`
- 该目录是一个独立 Git 仓库（含 `.git`）
- `filename` 是写入到该仓库根目录下的文件名（通常为 `*.json`）
- 项目会自动维护一个 `project_meta.json`，保存名称、描述、状态、更新时间等元数据

## 安全提示（重要）

当前版本已加入基础路径校验，但如果对外开放服务，仍建议继续增强：

- 增加更严格的文件名白名单
- 增加认证鉴权与访问控制
- 为同一项目写入增加并发锁

## License

未包含 License 文件；如需开源/分发，建议补充明确的许可证。
