from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from wikimg.core import (
    WikiError,
    create_document,
    delete_document,
    discover_workspace,
    doctor,
    init_workspace,
    launch_editor,
    move_document,
    normalize_layer,
    render_rows,
    rename_document,
    resolve_document,
    read_document_text,
    scan_documents,
    search_documents,
)
from wikimg.ingest import ingest_source
from wikimg.kimi_profile import export_profile, show_document_json, validate_profile
from wikimg.ontogit_sync import fetch_wiki_directory, sync_export_payload, sync_wiki_directory


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wikimg",
        description="命令行层级 Markdown Wiki 管理工具。",
    )
    parser.add_argument(
        "--root",
        default=".",
        help="工作区根目录或工作区内的某个路径。",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式输出结果，而非人类可读的文本。",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init", help="在根目录初始化一个新的 Wiki 工作区。")

    new_parser = subparsers.add_parser("new", help="创建一个新的 Wiki 文档。返回创建的文档信息。")
    new_parser.add_argument("layer", help="目标层级：'common' (公共), 'domain' (领域), 或 'private' (私有)。")
    new_parser.add_argument("title", help="新文档的标题。")
    new_parser.add_argument("--slug", help="可选：为文档指定自定义 slug (路径)。")
    new_parser.add_argument("--edit", action="store_true", help="创建后立即在编辑器中打开文档。")
    new_parser.add_argument("--editor", help="覆盖默认的编辑器命令。")
    new_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    list_parser = subparsers.add_parser("list", help="列出 Wiki 中的所有文档。支持 JSON 输出。")
    list_parser.add_argument("--layer", help="可选：按层级过滤文档。")
    list_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    show_parser = subparsers.add_parser("show", help="打印特定文档的内容。")
    show_parser.add_argument("reference", help="文档引用标识 (例如 'domain:item_name')。")
    show_parser.add_argument("--path", action="store_true", help="仅打印文件的绝对路径，而非内容。")
    show_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    export_parser = subparsers.add_parser("export", help="导出 profile 对应的结构化结果。支持 JSON 输出。")
    export_parser.add_argument("--profile", required=True, help="要导出的 profile 名称，例如 'kimi'。")
    export_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    sync_parser = subparsers.add_parser("sync", help="将本地 wiki 目录按文件同步到 OntoGit。")
    sync_parser.add_argument(
        "--project-id",
        help="OntoGit 项目 ID。默认使用环境变量 WIKIMG_ONTOGIT_PROJECT_ID 或 demo。",
    )
    sync_parser.add_argument(
        "--wiki-dir",
        help="要同步的 wiki 目录。默认使用工作区下的 wiki/。",
    )
    sync_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    fetch_parser = subparsers.add_parser("fetch", help="从 OntoGit 拉取 wiki 目录并写回本地。")
    fetch_parser.add_argument(
        "--project-id",
        help="OntoGit 项目 ID。留空时会拉取 common/domain/private 三个项目。",
    )
    fetch_parser.add_argument(
        "--wiki-dir",
        help="要写回的 wiki 目录。默认使用工作区下的 wiki/。",
    )
    fetch_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    validate_parser = subparsers.add_parser("validate", help="校验 profile 文档的结构与链接。支持 JSON 输出。")
    validate_parser.add_argument("--profile", required=True, help="要校验的 profile 名称，例如 'kimi'。")
    validate_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    ingest_parser = subparsers.add_parser("ingest", help="将 JSON/Markdown 输入归一化为 WiKiMG 文档。支持 JSON 输出。")
    ingest_parser.add_argument("--profile", required=True, help="归一化使用的 profile 名称，例如 'kimi'。")
    ingest_parser.add_argument("--mode", required=True, choices=("json", "markdown"), help="输入模式。")
    ingest_parser.add_argument("--layer", help="目标层级：'common'、'domain' 或 'private'。省略时由 WiKiMG 自动推断。")
    ingest_parser.add_argument("--slug", help="目标文档 slug，例如 'kimi-demo/lighting'。批量 items 入库时可作为路径前缀。")
    ingest_parser.add_argument("--input-file", required=True, help="待归一化的源文件路径。")
    ingest_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    edit_parser = subparsers.add_parser("edit", help="在编辑器中打开现有文档。")
    edit_parser.add_argument("reference", help="文档引用标识。")
    edit_parser.add_argument("--editor", help="覆盖默认的编辑器命令。")

    rename_parser = subparsers.add_parser("rename", help="修改文档的标题/slug。")
    rename_parser.add_argument("reference", help="当前文档引用标识。")
    rename_parser.add_argument("title", help="文档的新标题。")
    rename_parser.add_argument("--slug", help="可选：文档的新 slug。")
    rename_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    move_parser = subparsers.add_parser("move", help="将文档移至其他层级。")
    move_parser.add_argument("reference", help="文档引用标识。")
    move_parser.add_argument("layer", help="目标层级名称。")
    move_parser.add_argument("--slug", help="可选：在目标层级指定自定义 slug。")
    move_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    delete_parser = subparsers.add_parser("delete", help="永久删除文档。")
    delete_parser.add_argument("reference", help="文档引用标识。")
    delete_parser.add_argument(
        "--yes",
        action="store_true",
        help="强制要求：无需交互提示即可确认删除。",
    )

    search_parser = subparsers.add_parser("search", help="按标题或内容搜索文档。支持 JSON 输出。")
    search_parser.add_argument("query", help="要搜索的文本。")
    search_parser.add_argument("--layer", help="可选：按层级过滤搜索结果。")
    search_parser.add_argument(
        "--content",
        action="store_true",
        help="同时搜索 Markdown 正文内容，而非仅搜索标题。",
    )
    search_parser.add_argument("--json", action="store_true", dest="json", help="以 JSON 格式输出结果。")

    subparsers.add_parser("doctor", help="检查 Wiki 工作区是否存在结构性问题。返回 JSON 状态。")

    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "init":
            workspace = init_workspace(Path(args.root))
            print(f"Initialized wiki workspace at {workspace.root}")
            return 0

        workspace = discover_workspace(Path(args.root))

        if args.command == "new":
            document = create_document(workspace, args.layer, args.title, slug=args.slug)
            if args.json:
                print(json.dumps({"status": "created", "document": document.to_dict()}, ensure_ascii=False))
            else:
                print(f"Created {document.ref} -> {document.path}")
            if args.edit:
                launch_editor(document.path, editor=args.editor)
            return 0

        if args.command == "list":
            layer = normalize_layer(args.layer) if args.layer else None
            documents = scan_documents(workspace, layer=layer)
            if args.json:
                print(json.dumps([doc.to_dict() for doc in documents], ensure_ascii=False, indent=2))
                return 0
            if not documents:
                print("No documents found.")
                return 0
            rows = [("LAYER", "REF", "TITLE", "UPDATED")]
            rows.extend(
                (document.layer, document.ref, document.title, document.updated_at)
                for document in documents
            )
            print(render_rows(rows))
            return 0

        if args.command == "show":
            document = resolve_document(workspace, args.reference)
            if args.path:
                if args.json:
                    print(json.dumps({"status": "ok", "path": str(document.path)}, ensure_ascii=False, indent=2))
                else:
                    print(document.path)
            elif args.json:
                print(json.dumps({"status": "ok", "document": show_document_json(workspace, args.reference)}, ensure_ascii=False, indent=2))
            else:
                print(read_document_text(document), end="")
            return 0

        if args.command == "export":
            payload = export_profile(workspace, args.profile)
            try:
                sync_export_payload(
                    workspace_root=workspace.root,
                    profile=args.profile,
                    payload=payload,
                )
            except Exception as error:
                print(f"Warning: OntoGit sync failed: {error}", file=sys.stderr)
            if args.json:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                statistics = payload["knowledgeGraph"]["statistics"]
                print(
                    f"Exported profile={args.profile} entities={statistics['total_entities']} "
                    f"relations={statistics['total_relations']} docs={len(payload['documents'])}"
                )
            return 0

        if args.command == "sync":
            wiki_dir = Path(args.wiki_dir) if args.wiki_dir else workspace.docs_dir
            result = sync_wiki_directory(
                workspace_root=workspace.root,
                wiki_dir=wiki_dir,
                project_id=args.project_id,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print(
                    f"Synced wiki directory -> project={result['project_id']} "
                    f"written={result['written_count']} deleted={result['deleted_count']}"
            )
            return 0

        if args.command == "fetch":
            wiki_dir = Path(args.wiki_dir) if args.wiki_dir else workspace.docs_dir
            result = fetch_wiki_directory(
                workspace_root=workspace.root,
                wiki_dir=wiki_dir,
                project_id=args.project_id,
            )
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print(
                    f"Fetched wiki directory -> project={args.project_id or 'common/domain/private'} "
                    f"written={result['fetched_count']} skipped={result['skipped_count']}"
                )
            return 0

        if args.command == "validate":
            payload = validate_profile(workspace, args.profile)
            if args.json:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                if payload["healthy"]:
                    print(f"Profile '{args.profile}' looks healthy.")
                else:
                    print(f"Profile '{args.profile}' has {len(payload['issues'])} issue(s):")
                    for issue in payload["issues"]:
                        print(f"- [{issue['ref']}] {issue['message']}")
            return 1 if not payload["healthy"] else 0

        if args.command == "ingest":
            source_text = Path(args.input_file).read_text(encoding="utf-8")
            payload = ingest_source(
                workspace,
                profile=args.profile,
                mode=args.mode,
                layer=args.layer,
                slug=args.slug,
                source_text=source_text,
            )
            if args.json:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                print(f"Normalized {payload['ref']} -> {payload['title']}")
            return 0

        if args.command == "edit":
            document = resolve_document(workspace, args.reference)
            launch_editor(document.path, editor=args.editor)
            print(f"Edited {document.ref}")
            return 0

        if args.command == "rename":
            document = rename_document(workspace, args.reference, args.title, slug=args.slug)
            if args.json:
                print(json.dumps({"status": "renamed", "document": document.to_dict()}, ensure_ascii=False))
            else:
                print(f"Renamed document -> {document.ref}")
            return 0

        if args.command == "move":
            document = move_document(workspace, args.reference, args.layer, slug=args.slug)
            if args.json:
                print(json.dumps({"status": "moved", "document": document.to_dict()}, ensure_ascii=False))
            else:
                print(f"Moved document -> {document.ref}")
            return 0

        if args.command == "delete":
            if not args.yes:
                raise WikiError("Refusing to delete without --yes.")
            document = delete_document(workspace, args.reference)
            if args.json:
                print(json.dumps({"status": "deleted", "reference": args.reference}, ensure_ascii=False))
            else:
                print(f"Deleted {document.ref}")
            return 0

        if args.command == "search":
            layer = normalize_layer(args.layer) if args.layer else None
            documents = search_documents(
                workspace,
                args.query,
                layer=layer,
                content=args.content,
            )
            if args.json:
                print(json.dumps([doc.to_dict() for doc in documents], ensure_ascii=False, indent=2))
                return 0
            if not documents:
                print("No documents matched.")
                return 0
            rows = [("LAYER", "REF", "TITLE", "UPDATED")]
            rows.extend(
                (document.layer, document.ref, document.title, document.updated_at)
                for document in documents
            )
            print(render_rows(rows))
            return 0

        if args.command == "doctor":
            issues = doctor(workspace)
            if args.json:
                print(json.dumps({"healthy": not issues, "issues": issues}, ensure_ascii=False, indent=2))
            else:
                if not issues:
                    print("Workspace looks healthy.")
                else:
                    for issue in issues:
                        print(f"- {issue}")
            return 1 if issues else 0

        parser.error(f"Unsupported command: {args.command}")
        return 2
    except WikiError as error:
        if getattr(args, "json", False):
            print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False, indent=2))
        else:
            print(f"Error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
