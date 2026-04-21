---
name: git-query-agent-cli
description: 使用 `git` CLI 在 QAgent 中稳定执行仓库查询、状态检查、分支/日志/差异检索和只读查询；如果未来仓库内存在专用 Git Query CLI，则优先使用其相对路径，否则回退到标准 `git` 命令。
---

# Git Query Agent CLI

当任务是在当前仓库或指定仓库里做 Git 查询、定位提交、查看分支、查看日志、比较差异或读取变更历史时，使用这个 skill。

## 什么时候应该命中我

- 用户问“当前状态 / 最近提交 / 分支 / 差异 / 历史”
- 用户想看某个仓库有没有改动、哪些文件变了、最近发生了什么
- 用户要的是只读 Git 查询，而不是改写历史

## 什么时候不要命中我

- 用户在问 OntoGit、本体版本、推荐版本、时间线或推理
- 用户想要修改 Git 历史或做危险操作，但没有明确说明
- 用户其实是在查业务数据，不是在查仓库

## 触发关键词

- `git`
- `commit`
- `branch`
- `log`
- `diff`
- `status`
- `history`
- `upstream`
- `ahead`
- `behind`
- `origin`
- `tag`
- `最近提交`
- `当前分支`
- `未提交变更`
- `差异`
- `代码变更`

## 使用原则

- 优先做只读查询
- 不确定仓库时，先确认当前工作目录
- 需要跨目录查询时，优先用 `git -C <repo>`，不要依赖临时 `cd`
- 如果未来存在专用 Git Query CLI，优先按项目相对路径调用；如果没有，就直接使用 `git`

## 典型查询

```powershell
git -C . status --short
git -C . branch --show-current
git -C . log --oneline --decorate -n 20
git -C . diff --stat HEAD~1..HEAD
git -C . show --name-only --stat HEAD
```

## 稳定使用策略

1. 先判断任务是不是只读查询
2. 要看当前状态，用 `status`
3. 要看最近历史，用 `log`
4. 要看变化细节，用 `diff` 或 `show`
5. 要定位分支，用 `branch`
6. 要跨仓库时，用 `git -C <repo>`
7. 如果输出太长，先缩小范围，再继续查

## 结果判定

- `status`：返回工作区和暂存区状态
- `log`：返回提交历史
- `diff`：返回差异内容或统计
- `show`：返回提交、文件或对象的详细内容

## 不要误用

- 需要写入历史时，不要把查询 skill 当作自动修改工具
- 只想查 OntoGit 数据时，不要切到 Git skill
- 不要为了查询去做危险操作，比如默认 `reset` 或 `clean`
- 如果用户在问“本体版本/推荐版本/时间线”，应回到 OntoGit skill
