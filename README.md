# FJY 综合本体知识库系统

## 当前仓库说明

当前仓库已经收敛为以 `kimi-agent-knowledge-base-collab/app` 为主的前后端应用。

- OntoGit 默认走远端在线服务
- 本地不再强依赖 `OntoGit`、`QAgent`、`Ontology_Factory`
- 根目录启动脚本已经支持“远端 OntoGit 模式”

## 环境要求

- `Node.js 20+`
- `npm 10+`
- Windows：`PowerShell 5.1+` 或 `PowerShell 7+`
- Linux/macOS：`bash`、`curl`、`lsof`

只有在你准备恢复本地 OntoGit 全链路时，才额外需要：

- `Python 3.10` 或 `Python 3.11`
- 本地 `OntoGit` 目录

## 直接启动应用

```bash
cd ./kimi-agent-knowledge-base-collab/app
npm install
npm run server
npm run dev -- --host 127.0.0.1
```

常用入口：

- 前端：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:8787/api/health`

如果 `8787` 已被占用，可以换端口：

```bash
cd ./kimi-agent-knowledge-base-collab/app
PORT=8788 npm run server
```

## 一键启动

### Windows

```powershell
cd D:\code\FJY
.\start_kimi_stack.ps1
```

### Linux/macOS

```bash
cd /path/to/FJY
chmod +x ./start_kimi_stack.sh
./start_kimi_stack.sh
```

脚本默认行为：

- 如果本地 `OntoGit/xiaogugit`、`OntoGit/probability`、`OntoGit/gateway` 不存在，就自动切到远端 OntoGit 模式
- 如果这些目录都存在，则继续兼容本地 OntoGit 启动

如需强制使用远端 OntoGit：

```bash
USE_REMOTE_ONTOGIT=true ./start_kimi_stack.sh
```

## 查看日志

```powershell
Get-Content -Wait .\.run-logs\kimi-frontend.log
Get-Content -Wait .\.run-logs\kimi-backend.log
```

```bash
tail -f ./.run-logs/kimi-frontend.log
tail -f ./.run-logs/kimi-backend.log
```
