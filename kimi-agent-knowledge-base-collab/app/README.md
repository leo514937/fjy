# Kimi Agent Knowledge Base Collab App

## 启动方式

在 `app` 目录下执行：

```bash
npm install
npm run server
npm run dev -- --host 127.0.0.1
```

默认端口：

- 前端：`5173`
- 后端：`8787`

如果后端端口冲突：

```bash
PORT=8788 npm run server
```

## 当前默认运行模式

当前应用默认对接远端 OntoGit 在线服务，不再要求本地同时存在：

- `OntoGit`
- `QAgent`
- `Ontology_Factory`

后端会在本地自动补齐：

- `KNOWLEDGE_IO_ROOT=./knowledge-data`
- `ONTOGIT_STORAGE_ROOT=./knowledge-data/store`

如果你要覆盖远端地址，可设置：

```bash
ONTOGIT_GATEWAY_URL=http://81.70.12.214:8080 npm run server
```

## 常用命令

```bash
npm run build
npm test
npm run test:server
```

## 统一数据格式说明

- 当前仅支持 `docs/WORKFLOW_ENTITY_JSON_FORMAT.md` 定义的标准工作流实体 JSON
- 其他历史格式与兼容路径已被拦截或废弃
