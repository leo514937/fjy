# Ontology Factory CLI 速查

这份文档整理了当前项目里已经接好的 CLI 能力。

当前设计原则是：

- `wiki_agent` 只有一个工具：`run_command`
- 具体能力全部通过命令行暴露
- 优先返回结构化 JSON，方便 agent 消费

## 环境准备

建议先进入项目根目录并激活虚拟环境：

```bash
cd /Users/qiuboyu/Documents/Ontology_Factory
source .venv/bin/activate
```

如果直接在命令行使用 Python 模块形式的 CLI，建议带上 `PYTHONPATH`：

```bash
export PYTHONPATH=".:WIKI_MG/src:storage/src:wiki_agent/src:ontology_core/src:evolution/src:relation/src:ner/src:dls/src:preprocess:pipeline/src"
```

所有 CLI 的顶层入口和实际子命令都支持干净的 `--help` 输出，建议 agent 在首次调用前先读取帮助：

```bash
wikimg --help
wikimg search --help
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m ner.cli --help
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m ner.cli extract --help
python -m ontology_negotiator.cli classify --help
python -m mm_denoise.cli --help
```

## 1. 文件系统只读命令

这些命令主要给 `wiki_agent` 在目标文档所在目录中做自由探索和检索。

可用命令：

- `pwd`
- `ls`
- `find`
- `rg`
- `cat`
- `sed`
- `head`
- `tail`
- `wc`
- `sort`
- `stat`

示例：

```bash
pwd
ls
rg -n 光照 .
find . -name "*.txt"
cat 鱼家第一阶段.txt
```

## 2. Wiki CLI

Wiki 使用 [`WIKI_MG`](/Users/qiuboyu/Documents/Ontology_Factory/WIKI_MG) 提供的 `wikimg`。

可调用形式：

- 直接命令：`wikimg ...`
- Python 模块：`python -m wikimg ...`
- 两种形式都支持 `--help`

常用命令：

```bash
wikimg --root /Users/qiuboyu/Documents/Ontology_Factory list
wikimg --root /Users/qiuboyu/Documents/Ontology_Factory search 光照 --content
wikimg --root /Users/qiuboyu/Documents/Ontology_Factory show domain:光照
wikimg --root /Users/qiuboyu/Documents/Ontology_Factory new domain "测试页面"
```

Wiki 内容目录：

- [`/Users/qiuboyu/Documents/Ontology_Factory/wiki`](/Users/qiuboyu/Documents/Ontology_Factory/wiki)

## 3. NER CLI

入口：

```bash
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m ner.cli extract
```

代码位置：

- [`/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src/ner/cli.py`](/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src/ner/cli.py)

支持参数：

- `--input`
- `--output`
- `--stdout`
- `--doc-id`
- `--query`
- `--max-sentences`
- `--openrouter-model`
- `--openrouter-api-key`
- `--openrouter-base-url`

示例：

```bash
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m ner.cli extract --input /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/preprocess/鱼家第一阶段.txt --stdout
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m ner.cli extract --input /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/preprocess/鱼家第一阶段.txt --query 光照 --max-sentences 4 --stdout
```

输出：

- `NerDocument` JSON

## 4. relation CLI

入口：

```bash
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m entity_relation.cli extract
```

代码位置：

- [`/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src/entity_relation/cli.py`](/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src/entity_relation/cli.py)

支持参数：

- `--input`
- `--output`
- `--stdout`
- `--doc-id`
- `--query`
- `--max-sentences`

示例：

```bash
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m entity_relation.cli extract --input /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/preprocess/鱼家第一阶段.txt --stdout
PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m entity_relation.cli extract --input /Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/preprocess/鱼家第一阶段.txt --query 光照 --max-sentences 6 --stdout
```

输出：

- `RelationDocument` JSON

## 5. storage CLI

入口：

```bash
python -m ontology_store.cli query
```

代码位置：

- [`/Users/qiuboyu/Documents/Ontology_Factory/storage/src/ontology_store/cli.py`](/Users/qiuboyu/Documents/Ontology_Factory/storage/src/ontology_store/cli.py)

支持参数：

- `--database`
- `--kind`
- `--query`
- `--limit`
- `--output`
- `--stdout`

`--kind` 当前支持：

- `pages`
- `entities`
- `relations`
- `classifications`

示例：

```bash
python -m ontology_store.cli query --database /Users/qiuboyu/Documents/Ontology_Factory/storage/data/classification_store.sqlite3 --kind pages --query 光照 --stdout
python -m ontology_store.cli query --database /Users/qiuboyu/Documents/Ontology_Factory/storage/data/classification_store.sqlite3 --kind entities --query 光照 --stdout
python -m ontology_store.cli query --database /Users/qiuboyu/Documents/Ontology_Factory/storage/data/classification_store.sqlite3 --kind relations --query 光照 --stdout
```

输出：

- 统一 JSON
- 包含 `kind`、`count`、`items`

## 6. ontology CLI

入口：

```bash
python -m ontology_core.cli search
```

代码位置：

- [`/Users/qiuboyu/Documents/Ontology_Factory/ontology_core/src/ontology_core/cli.py`](/Users/qiuboyu/Documents/Ontology_Factory/ontology_core/src/ontology_core/cli.py)

支持参数：

- `--database`
- `--query`
- `--limit`
- `--include-mentions`
- `--include-relations`
- `--output`
- `--stdout`

示例：

```bash
python -m ontology_core.cli search --database /Users/qiuboyu/Documents/Ontology_Factory/storage/data/classification_store.sqlite3 --query 光照 --stdout
python -m ontology_core.cli search --database /Users/qiuboyu/Documents/Ontology_Factory/storage/data/classification_store.sqlite3 --query 光照 --include-mentions --include-relations --stdout
```

输出：

- 统一 JSON
- 默认返回 canonical entity 和当前分类
- 可选附带 mentions 和 relations

## 7. DLS CLI

入口：

```bash
python -m ontology_negotiator.cli classify
```

代码位置：

- [`/Users/qiuboyu/Documents/Ontology_Factory/dls/src/ontology_negotiator/cli.py`](/Users/qiuboyu/Documents/Ontology_Factory/dls/src/ontology_negotiator/cli.py)

支持参数：

- `--graph`
- `--config`
- `--artifact-root`
- `--node-id`
- `--max-concurrency`
- `--output`
- `--stdout`

示例：

```bash
python -m ontology_negotiator.cli classify --graph /path/to/graph.json --config /Users/qiuboyu/Documents/Ontology_Factory/dls/config/ontology_negotiator.toml --stdout
python -m ontology_negotiator.cli classify --graph /path/to/graph.json --node-id n1 --config /Users/qiuboyu/Documents/Ontology_Factory/dls/config/ontology_negotiator.toml --stdout
```

输出：

- 图模式：`{"mode":"graph","results":[...]}`
- 单节点模式：`{"mode":"node","result":{...}}`

## 8. xiaogugit CLI

入口：

```bash
python -m xiaogugit
```

代码位置：

- [`/Users/qiuboyu/Documents/Ontology_Factory/xiaogugit/cli.py`](/Users/qiuboyu/Documents/Ontology_Factory/xiaogugit/cli.py)

常用命令：

```bash
python -m xiaogugit --root-dir /Users/qiuboyu/Documents/Ontology_Factory/xiaogugit/storage project list
python -m xiaogugit --root-dir /Users/qiuboyu/Documents/Ontology_Factory/xiaogugit/storage write --project-id demo --filename ontology.json --message "AI: update ontology" --agent-name agent-1 --committer-name Teacher --basevision 0 --data-file /path/to/payload.json
python -m xiaogugit --root-dir /Users/qiuboyu/Documents/Ontology_Factory/xiaogugit/storage read --project-id demo --filename ontology.json
python -m xiaogugit --root-dir /Users/qiuboyu/Documents/Ontology_Factory/xiaogugit/storage version tree --project-id demo --filename ontology.json
```

支持的命令组：

- `project`
- `file`
- `write`
- `read`
- `log`
- `commit`
- `version`
- `timeline`
- `diff`
- `rollback`
- `delete`

输出：

- 统一 JSON

## 9. pipeline CLI

入口：

```bash
python -m pipeline.cli --help
python -m pipeline.cli --input /path/to/doc.txt --preprocess-config preprocess.yaml
```

代码位置：

- [`/Users/qiuboyu/Documents/Ontology_Factory/pipeline/src/pipeline/cli.py`](/Users/qiuboyu/Documents/Ontology_Factory/pipeline/src/pipeline/cli.py)

支持参数：

- `--input`
- `--input-dir`
- `--mode`
- `--glob`
- `--preprocess-config`
- `--pipeline-config`
- `--force-reingest`

输出：

- 统一 JSON 状态
- 支持单文档与批处理

## 10. mm_denoise CLI

入口：

```bash
python -m mm_denoise.cli --help
python -m mm_denoise.cli --config preprocess/mm_denoise/config.yaml --input /path/to/doc.txt
```

代码位置：

- [`/Users/qiuboyu/Documents/Ontology_Factory/preprocess/mm_denoise/cli.py`](/Users/qiuboyu/Documents/Ontology_Factory/preprocess/mm_denoise/cli.py)

支持参数：

- `--config`
- `--input`
- `--base-dir`

输出：

- 清洗后的文本文件
- 对应的 JSON 执行报告

## 11. agent 当前可调用的 CLI 面

`wiki_agent` 当前允许通过唯一工具 `run_command` 调用：

- 文件系统只读命令
- `wikimg`
- `python -m wikimg`
- `python -m ner.cli`
- `python -m entity_relation.cli`
- `python -m ontology_store.cli`
- `python -m ontology_core.cli`
- `python -m ontology_negotiator.cli`
- `python -m xiaogugit`
- `python -m pipeline.cli`
- `python -m mm_denoise.cli`
- `python -m ontology_audit_hub.review_cli`
- `python -m ontology_audit_hub.qa_cli`

相关实现：

- [`/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/src/wiki_agent/tools.py`](/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/src/wiki_agent/tools.py)
- [`/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/src/wiki_agent/prompts.py`](/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/src/wiki_agent/prompts.py)

## 12. 当前推荐组合

如果是人工调试，推荐顺序：

1. `rg` / `cat` 看原文
2. `PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m ner.cli extract` 看实体
3. `PYTHONPATH="/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/relation/src:/Users/qiuboyu/CodeLearning/new_fjy/fjy/Ontology_Factory/ner/src" python -m entity_relation.cli extract` 看关系
4. `python -m ontology_store.cli query` 看库存量结果
5. `python -m ontology_core.cli search` 看 canonical 结果
6. `wikimg search/show` 看现有 wiki 页面
7. `python -m ontology_negotiator.cli classify` 做达类私分类
8. `python -m pipeline.cli` 跑整条流水线
9. `python -m mm_denoise.cli` 单独排查预处理去噪效果
10. `python -m xiaogugit ...` 管理结构化 JSON 的项目、版本、Diff 与回滚

## 13. 测试状态

CLI 相关回归已覆盖，建议重点关注以下测试：

相关测试：

- [`/Users/qiuboyu/Documents/Ontology_Factory/storage/tests/test_cli_tools.py`](/Users/qiuboyu/Documents/Ontology_Factory/storage/tests/test_cli_tools.py)
- [`/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/tests/test_wiki_agent_runtime.py`](/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/tests/test_wiki_agent_runtime.py)
- [`/Users/qiuboyu/Documents/Ontology_Factory/pipeline/tests/test_cli_help.py`](/Users/qiuboyu/Documents/Ontology_Factory/pipeline/tests/test_cli_help.py)
- [`/Users/qiuboyu/Documents/Ontology_Factory/pipeline/tests/test_pipeline_wiki_runner.py`](/Users/qiuboyu/Documents/Ontology_Factory/pipeline/tests/test_pipeline_wiki_runner.py)
- [`/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/tests/test_aft_cli_integration.py`](/Users/qiuboyu/Documents/Ontology_Factory/wiki_agent/tests/test_aft_cli_integration.py)

## 14. AFT Review And QA CLI

New AFT module CLIs are also callable from the main `wiki_agent` flow through `run_command`.

Module entrypoints:

```bash
python -m ontology_audit_hub.review_cli github --request-file /absolute/path/review.json
python -m ontology_audit_hub.review_cli doctor
python -m ontology_audit_hub.qa_cli answer --question "Explain Payment" --session-id qa-1
python -m ontology_audit_hub.qa_cli answer --request-file /absolute/path/qa.json
python -m ontology_audit_hub.qa_cli upload --file /absolute/path/knowledge.md --collection docs
python -m ontology_audit_hub.qa_cli rebuild-lexical-index --collection docs
python -m ontology_audit_hub.qa_cli doctor
```

Key files:

- [`C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/aft/aft-main/src/ontology_audit_hub/review_cli.py`](/C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/aft/aft-main/src/ontology_audit_hub/review_cli.py)
- [`C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/aft/aft-main/src/ontology_audit_hub/qa_cli.py`](/C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/aft/aft-main/src/ontology_audit_hub/qa_cli.py)
- [`C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/wiki_agent/src/wiki_agent/tools.py`](/C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/wiki_agent/src/wiki_agent/tools.py)
- [`C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/wiki_agent/src/wiki_agent/prompts.py`](/C:/Users/aidis/Desktop/本体工厂/Ontology_Factory/wiki_agent/src/wiki_agent/prompts.py)

Main-flow allowlist now includes:

- `python -m ontology_audit_hub.review_cli`
- `python -m ontology_audit_hub.qa_cli`
