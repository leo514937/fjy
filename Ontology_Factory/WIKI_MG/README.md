# WikiMG

WikiMG is a small CLI-first wiki manager for Markdown documents.

It organizes documents into exactly one of three layers:

- `common`
- `domain`
- `private`

Every document must live under one layer only.

## Workspace Layout

```text
.wikimg/config.json
wiki/
  common/
  domain/
  private/
```

## Quick Start

Direct run from the repository:

```bash
./wikimg init
./wikimg new common "Getting Started"
./wikimg list
```

Install as a command:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

wikimg init
wikimg new common "Getting Started"
wikimg list
wikimg show common:getting-started
wikimg edit common:getting-started
wikimg move common:getting-started private
wikimg rename private:getting-started "Personal Notes"
wikimg search notes --content
wikimg doctor
wikimg show domain:getting-started --json
wikimg export --profile kimi --json
wikimg validate --profile kimi --json
wikimg sync --project-id demo
```

## Commands

- `wikimg init`
- `wikimg new <layer> <title>`
- `wikimg list`
- `wikimg show <ref>`
- `wikimg edit <ref>`
- `wikimg rename <ref> <new_title>`
- `wikimg move <ref> <target_layer>`
- `wikimg delete <ref> --yes`
- `wikimg search <query> [--content]`
- `wikimg doctor`
- `wikimg show <ref> --json`
- `wikimg export --profile <name> --json`
- `wikimg validate --profile <name> --json`
- `wikimg sync --project-id <project_id>`

## Document References

The preferred reference form is `layer:slug`, for example:

```text
common:getting-started
domain:backend/auth-flow
private:daily-notes
```

Nested slugs are supported. A document still belongs to exactly one top-level
layer, even when it is placed inside subdirectories under that layer.

## Structured Profile Documents

WikiMG now supports profile-oriented Markdown documents via frontmatter. For the
current `kimi` profile, the recommended minimum fields are:

- `profile`
- `title`
- `type`
- `domain`
- `level`
- `source`
- `properties`
- `relations`

The frontmatter parser accepts JSON objects directly, which also keeps the
documents valid YAML frontmatter because JSON is a YAML subset.

For `kimi` exports, entity pages under `common/`, `domain/`, and `private/`
are all included in `entity_index` as long as they use `profile: kimi` and are
not marked as `page_kind: meta`. The document `layer` is derived from the
top-level directory and exported alongside each entity. Export statistics also
include `layers` and `layer_counts` so downstream applications can distinguish
shared knowledge, business nodes, and private drafts.

## OntoGit Sync

If you want to mirror the local `wiki/` directory into OntoGit, use:

```bash
wikimg sync --project-id demo
```

The sync command walks the `wiki/` tree and writes each file to OntoGit by
relative path. OntoGit handles versioning, so `wikimg` only needs to keep the
local tree and resync on changes.

Example:

```markdown
---
{
  "profile": "kimi",
  "page_kind": "entity",
  "title": "光照监测",
  "type": "监测能力",
  "domain": "智能养鱼",
  "level": 2,
  "source": "WiKiMG kimi demo",
  "properties": {
    "核心指标": ["光照强度", "采样时间"]
  },
  "relations": [
    {
      "target": "domain:kimi-demo/智能养鱼系统概览",
      "type": "组成部分",
      "description": "监测能力属于系统环境感知层。"
    }
  ]
}
---
# 光照监测

## 定义与定位
用于展示某个能力节点是什么、属于哪里、与什么相关。
```
