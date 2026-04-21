---
name: ontogit-tools-cli
description: 使用 `D:\code\FJY\OntoGit\ontogit_tools.py` 这个 CLI 通过 OntoGit 网关执行项目列表、读取、写入并触发推理、时间线查询和概率推理。适用于需要稳定调用 `write`、`read`、`list`、`infer` 子命令并解析 JSON 输出的场景。
---

# OntoGit Tools CLI

当任务涉及 OntoGit、XiaoGuGit、本体数据、项目列表、时间线或概率推理时，使用这个 skill。

## 什么时候应该命中我

- 用户问“某项目某本体的官方推荐版本是什么”
- 用户问“最近版本变化 / 历史时间线 / 社区推荐版本”
- 用户要求“列出项目 / 读取文件 / 写入并推理 / 概率推理”
- 用户给出 `project_id`、`filename`、`ontology_name`，并希望直接查结果

## 什么时候不要命中我

- 只是普通 Git 仓库查询
- 只是本地文件操作，不涉及 OntoGit 网关
- 没有项目、本体、版本、推荐、时间线、推理这类语义

## CLI 位置

- 从 `D:\code\FJY\QAgent` 仓库根目录到 CLI 的相对路径是 `..\OntoGit\ontogit_tools.py`
- 从本 skill 目录 `D:\code\FJY\QAgent\.agent\skills\ontogit-tools-cli` 到 CLI 的相对路径是 `..\..\..\..\OntoGit\ontogit_tools.py`
- qagent 优先按仓库根目录解析；如果当前工作目录不确定，再按 skill 目录解析
- 调用前先确认路径存在，再执行 CLI

## 触发关键词

- `OntoGit`
- `XiaoGuGit`
- `write-and-infer`
- `project list`
- `timeline`
- `probability reason`
- `本体`
- `概率推理`
- `项目列表`
- `官方推荐版本`
- `最近版本变化`
- `历史版本`
- `社区推荐`
- `版本时间线`

## 适用场景

- 查询项目列表、读取本体文件、写入数据并触发推理
- 查询版本时间线、最近变化、官方推荐、社区推荐
- 对现有 OntoGit 服务做概率推理分析
- 需要让 qagent 稳定、可重复地调用 `ontogit_tools.py`
- 需要在工作目录变化时仍能正确找到 CLI

## 先决条件

- CLI 默认连接 `http://127.0.0.1:8080`
- 默认 API key 是 `change-me`
- 如果调用失败并提示连接错误，先确认 OntoGit 服务栈已启动
- Windows 下优先运行 `D:\code\FJY\OntoGit\start_ontogit.ps1`
- Linux/macOS 下优先运行 OntoGit 仓库根目录下的 `start_ontogit.sh`

## 调用规则

- 已知项目时，直接用对应子命令；未知项目时，先 `list`
- `write` 会同时写入数据并触发推理，适合变更型任务
- `read` 只读，不会修改数据
- `infer` 只做概率推理，不写入项目数据
- `timeline` 只读，适合看最近版本变化
- `--data`、`--data-file`、`--stdin-json` 三选一，`write` 和 `infer` 都支持
- 如果输入是对象或数组，先用 `ConvertTo-Json -Compress -Depth 20` 压成单行，或者直接走 `--stdin-json`
- 输出优先按 JSON 解析；成功时是 `{"status":"success","command":"...","result":...}`，失败时是 `{"status":"error",...}`
- 只有在确认需要修改 OntoGit 数据时才使用 `write`

## 极其友好的快速判断

1. 想看有哪些项目，用 `list`
2. 想看某个项目文件，用 `read`
3. 想把新数据写进去并触发推理，用 `write`
4. 只想让模型做概率推理，不改数据，用 `infer`
5. 不确定时，先 `list` 再决定下一步
6. 想看版本变化和最近时间线，用 `timeline`

## 给 qagent 的自然语言理解模板

当用户说：

- “demo 项目的官方推荐版本和最近版本变化”
- “学校当前推荐版本是什么”
- “帮我看 school.json 的历史版本和时间线”

应优先转成：

- 已知项目：直接进入对应命令
- 不知道项目：先 `list`
- 不知道文件名但知道本体名：优先用 `ontology_name`
- 明确要写入时：用 `write`
- 明确只看推理结论时：用 `infer`

## 常用命令

```powershell
python ..\OntoGit\ontogit_tools.py list
python ..\OntoGit\ontogit_tools.py read --project <project_id> --file <filename>
python ..\OntoGit\ontogit_tools.py timeline --project <project_id> --limit 20
python ..\OntoGit\ontogit_tools.py write --project <project_id> --file <filename> --stdin-json --msg "QAgent update"
python ..\OntoGit\ontogit_tools.py infer --data-file <payload.json>
```

## 稳定使用策略

1. 先确认目标是 `list`、`read`、`write` 还是 `infer`
2. 如果不知道 project id，先 `list`
3. 写入前确保 `--data` 是合法 JSON，必要时先压成单行
4. 执行后检查 JSON 输出中的 `error`、空响应和字段缺失
5. 如果网关不可用，优先重试一次；仍失败则提示启动 `start_ontogit.ps1` 或 `start_ontogit.sh`
6. 如果只是路径不稳，优先使用 skill 中写死的相对路径，不要临时猜目录
7. 如果只需要最近版本变化，优先调用 `timeline`，不要绕到 `read`

## 结果判定

- `list` 成功：返回项目数组或项目对象集合
- `read` 成功：返回指定项目/文件的本体数据
- `timeline` 成功：返回版本时间线和最近变化记录
- `write` 成功：返回写入与推理结果，且应包含服务端响应
- `infer` 成功：返回概率推理结果

## 不要误用

- 只是在做普通 Git 查询时，不要用这个 skill
- 只是查看本地仓库文件变化时，不要绕到 OntoGit
- 没有 OntoGit 服务时，不要假装写入成功
- 如果用户只说“看看代码有没有改”，应回到 Git skill
