from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable, Optional, Sequence

Handler = Callable[[argparse.Namespace], Any]
DEFAULT_STATUS = "开发中"


def _manager_class():
    if __package__:
        from .manager import XiaoGuGitManager
        return XiaoGuGitManager

    from manager import XiaoGuGitManager  # pragma: no cover - fallback for direct script execution

    return XiaoGuGitManager


def _build_manager(args: argparse.Namespace):
    return _manager_class()(root_dir=args.root_dir)


def _load_write_data(args: argparse.Namespace) -> Any:
    if args.data_file:
        return json.loads(Path(args.data_file).read_text(encoding="utf-8"))
    return json.loads(args.data_json)


def _render_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _cmd_project_init(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.init_project(args.project_id, args.name, args.description, args.status)


def _cmd_project_list(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"projects": manager.list_projects()}


def _cmd_project_show(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.get_project_info(args.project_id)


def _cmd_project_status(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.update_project_status(args.project_id, args.status, args.operator)


def _cmd_file_list(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"files": manager.list_files(args.project_id)}


def _cmd_write(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.write_version(
        args.project_id,
        args.filename,
        _load_write_data(args),
        args.message,
        args.agent_name,
        args.committer_name,
        args.basevision,
    )


def _cmd_read(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"data": manager.read_version(args.project_id, args.filename, args.commit_id)}


def _cmd_log(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"history": manager.get_log(args.project_id, args.filename)}


def _cmd_commit_show(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.get_commit_detail(args.project_id, args.commit_id)


def _cmd_version_tree(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.get_file_version_tree(args.project_id, args.filename)


def _cmd_version_trees(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"files": manager.get_all_version_trees(args.project_id)}


def _cmd_version_show(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.get_version_detail(args.project_id, args.version_id, args.filename)


def _cmd_version_read(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.read_version_by_id(args.project_id, args.version_id, args.filename)


def _cmd_timeline_list(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"timelines": manager.get_all_file_timelines(args.project_id)}


def _cmd_diff_commits(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return {"diff": manager.get_diff(args.project_id, args.filename, args.base_commit, args.target_commit)}


def _cmd_diff_versions(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.diff_versions(args.project_id, args.base_version_id, args.target_version_id, args.filename)


def _cmd_rollback_commit(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.rollback(args.project_id, args.commit_id)


def _cmd_rollback_version(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.rollback_version_by_id(args.project_id, args.version_id, args.filename)


def _cmd_delete_soft(args: argparse.Namespace) -> dict[str, Any]:
    manager = _build_manager(args)
    return manager.delete_version(args.project_id, args.filename, args.message, args.committer_name, args.agent_name)


def _cmd_delete_purge(args: argparse.Namespace) -> dict[str, Any]:
    if not args.yes:
        raise ValueError("Refusing to purge without --yes.")
    manager = _build_manager(args)
    return manager.purge_file_history(args.project_id, args.filename)


def _register_common_arguments(
    parser: argparse.ArgumentParser,
    *,
    default: str | argparse._SUPPRESS_T = argparse.SUPPRESS,
) -> None:
    parser.add_argument(
        "--root-dir",
        default=default,
        help="Storage root directory. Defaults to ./storage.",
    )


def _register_project_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    project_parser = subparsers.add_parser("project", help="Manage projects.")
    _register_common_arguments(project_parser)
    project_subparsers = project_parser.add_subparsers(dest="project_command", required=True)

    init_parser = project_subparsers.add_parser("init", help="Initialize a project.")
    _register_common_arguments(init_parser)
    init_parser.add_argument("--project-id", required=True, help="Project identifier.")
    init_parser.add_argument("--name", default=None, help="Optional project name.")
    init_parser.add_argument("--description", default="", help="Project description.")
    init_parser.add_argument(
        "--status",
        default=DEFAULT_STATUS,
        help="Initial project status.",
    )
    init_parser.set_defaults(handler=_cmd_project_init)

    list_parser = project_subparsers.add_parser("list", help="List all projects.")
    _register_common_arguments(list_parser)
    list_parser.set_defaults(handler=_cmd_project_list)

    show_parser = project_subparsers.add_parser("show", help="Show a single project.")
    _register_common_arguments(show_parser)
    show_parser.add_argument("--project-id", required=True, help="Project identifier.")
    show_parser.set_defaults(handler=_cmd_project_show)

    status_parser = project_subparsers.add_parser("status", help="Update project status.")
    _register_common_arguments(status_parser)
    status_parser.add_argument("--project-id", required=True, help="Project identifier.")
    status_parser.add_argument("--status", required=True, help="Target project status.")
    status_parser.add_argument("--operator", default="System", help="Operator name.")
    status_parser.set_defaults(handler=_cmd_project_status)


def _register_file_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    file_parser = subparsers.add_parser("file", help="Inspect project files.")
    _register_common_arguments(file_parser)
    file_subparsers = file_parser.add_subparsers(dest="file_command", required=True)

    list_parser = file_subparsers.add_parser("list", help="List files in a project.")
    _register_common_arguments(list_parser)
    list_parser.add_argument("--project-id", required=True, help="Project identifier.")
    list_parser.set_defaults(handler=_cmd_file_list)


def _register_commit_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    commit_parser = subparsers.add_parser("commit", help="Inspect commits.")
    _register_common_arguments(commit_parser)
    commit_subparsers = commit_parser.add_subparsers(dest="commit_command", required=True)

    show_parser = commit_subparsers.add_parser("show", help="Show commit details.")
    _register_common_arguments(show_parser)
    show_parser.add_argument("--project-id", required=True, help="Project identifier.")
    show_parser.add_argument("--commit-id", required=True, help="Commit SHA.")
    show_parser.set_defaults(handler=_cmd_commit_show)


def _register_version_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    version_parser = subparsers.add_parser("version", help="Inspect version trees and snapshots.")
    _register_common_arguments(version_parser)
    version_subparsers = version_parser.add_subparsers(dest="version_command", required=True)

    tree_parser = version_subparsers.add_parser("tree", help="Show a file version tree.")
    _register_common_arguments(tree_parser)
    tree_parser.add_argument("--project-id", required=True, help="Project identifier.")
    tree_parser.add_argument("--filename", required=True, help="Target filename.")
    tree_parser.set_defaults(handler=_cmd_version_tree)

    trees_parser = version_subparsers.add_parser("trees", help="Show version trees for all files.")
    _register_common_arguments(trees_parser)
    trees_parser.add_argument("--project-id", required=True, help="Project identifier.")
    trees_parser.set_defaults(handler=_cmd_version_trees)

    show_parser = version_subparsers.add_parser("show", help="Show version details.")
    _register_common_arguments(show_parser)
    show_parser.add_argument("--project-id", required=True, help="Project identifier.")
    show_parser.add_argument("--version-id", required=True, type=int, help="Version identifier.")
    show_parser.add_argument("--filename", default=None, help="Optional filename to disambiguate the version.")
    show_parser.set_defaults(handler=_cmd_version_show)

    read_parser = version_subparsers.add_parser("read", help="Read a version snapshot.")
    _register_common_arguments(read_parser)
    read_parser.add_argument("--project-id", required=True, help="Project identifier.")
    read_parser.add_argument("--version-id", required=True, type=int, help="Version identifier.")
    read_parser.add_argument("--filename", default=None, help="Optional filename to disambiguate the version.")
    read_parser.set_defaults(handler=_cmd_version_read)


def _register_timeline_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    timeline_parser = subparsers.add_parser("timeline", help="Inspect project timelines.")
    _register_common_arguments(timeline_parser)
    timeline_subparsers = timeline_parser.add_subparsers(dest="timeline_command", required=True)

    list_parser = timeline_subparsers.add_parser("list", help="List timelines for all files.")
    _register_common_arguments(list_parser)
    list_parser.add_argument("--project-id", required=True, help="Project identifier.")
    list_parser.set_defaults(handler=_cmd_timeline_list)


def _register_diff_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    diff_parser = subparsers.add_parser("diff", help="Compare commits or versions.")
    _register_common_arguments(diff_parser)
    diff_subparsers = diff_parser.add_subparsers(dest="diff_command", required=True)

    commits_parser = diff_subparsers.add_parser("commits", help="Diff two commits for one file.")
    _register_common_arguments(commits_parser)
    commits_parser.add_argument("--project-id", required=True, help="Project identifier.")
    commits_parser.add_argument("--filename", required=True, help="Target filename.")
    commits_parser.add_argument("--base-commit", required=True, help="Base commit SHA.")
    commits_parser.add_argument("--target-commit", required=True, help="Target commit SHA.")
    commits_parser.set_defaults(handler=_cmd_diff_commits)

    versions_parser = diff_subparsers.add_parser("versions", help="Diff two versions.")
    _register_common_arguments(versions_parser)
    versions_parser.add_argument("--project-id", required=True, help="Project identifier.")
    versions_parser.add_argument("--base-version-id", required=True, type=int, help="Base version identifier.")
    versions_parser.add_argument("--target-version-id", required=True, type=int, help="Target version identifier.")
    versions_parser.add_argument("--filename", default=None, help="Optional filename to disambiguate the versions.")
    versions_parser.set_defaults(handler=_cmd_diff_versions)


def _register_rollback_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    rollback_parser = subparsers.add_parser("rollback", help="Rollback by commit or version.")
    _register_common_arguments(rollback_parser)
    rollback_subparsers = rollback_parser.add_subparsers(dest="rollback_command", required=True)

    commit_parser = rollback_subparsers.add_parser("commit", help="Rollback to a commit boundary.")
    _register_common_arguments(commit_parser)
    commit_parser.add_argument("--project-id", required=True, help="Project identifier.")
    commit_parser.add_argument("--commit-id", required=True, help="Commit SHA.")
    commit_parser.set_defaults(handler=_cmd_rollback_commit)

    version_parser = rollback_subparsers.add_parser("version", help="Rollback using a version identifier.")
    _register_common_arguments(version_parser)
    version_parser.add_argument("--project-id", required=True, help="Project identifier.")
    version_parser.add_argument("--version-id", required=True, type=int, help="Version identifier.")
    version_parser.add_argument("--filename", default=None, help="Optional filename to disambiguate the version.")
    version_parser.set_defaults(handler=_cmd_rollback_version)


def _register_delete_subcommands(subparsers: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    delete_parser = subparsers.add_parser("delete", help="Delete files or purge file history.")
    _register_common_arguments(delete_parser)
    delete_subparsers = delete_parser.add_subparsers(dest="delete_command", required=True)

    soft_parser = delete_subparsers.add_parser("soft", help="Delete the current file while keeping history.")
    _register_common_arguments(soft_parser)
    soft_parser.add_argument("--project-id", required=True, help="Project identifier.")
    soft_parser.add_argument("--filename", required=True, help="Target filename.")
    soft_parser.add_argument("--message", default="System: 删除本体", help="Commit message.")
    soft_parser.add_argument("--committer-name", default="System", help="Committer name.")
    soft_parser.add_argument("--agent-name", default=None, help="Optional agent name.")
    soft_parser.set_defaults(handler=_cmd_delete_soft)

    purge_parser = delete_subparsers.add_parser("purge", help="Purge all history for a file.")
    _register_common_arguments(purge_parser)
    purge_parser.add_argument("--project-id", required=True, help="Project identifier.")
    purge_parser.add_argument("--filename", required=True, help="Target filename.")
    purge_parser.add_argument("--yes", action="store_true", help="Confirm history purge.")
    purge_parser.set_defaults(handler=_cmd_delete_purge)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xiaogugit",
        description="Command line interface for XiaoGuGit project and version management.",
    )
    _register_common_arguments(parser, default="./storage")
    subparsers = parser.add_subparsers(dest="command", required=True)

    _register_project_subcommands(subparsers)
    _register_file_subcommands(subparsers)
    _register_commit_subcommands(subparsers)
    _register_version_subcommands(subparsers)
    _register_timeline_subcommands(subparsers)
    _register_diff_subcommands(subparsers)
    _register_rollback_subcommands(subparsers)
    _register_delete_subcommands(subparsers)

    write_parser = subparsers.add_parser("write", help="Write JSON data and create a version commit.")
    _register_common_arguments(write_parser)
    write_parser.add_argument("--project-id", required=True, help="Project identifier.")
    write_parser.add_argument("--filename", required=True, help="Target filename.")
    write_parser.add_argument("--message", required=True, help="Commit message.")
    write_parser.add_argument("--agent-name", required=True, help="Agent name.")
    write_parser.add_argument("--committer-name", required=True, help="Committer name.")
    write_parser.add_argument("--basevision", required=True, type=int, help="Base version identifier.")
    write_source = write_parser.add_mutually_exclusive_group(required=True)
    write_source.add_argument("--data-file", help="Path to a JSON file.")
    write_source.add_argument("--data-json", help="Inline JSON string.")
    write_parser.set_defaults(handler=_cmd_write)

    read_parser = subparsers.add_parser("read", help="Read the latest or a historical file snapshot.")
    _register_common_arguments(read_parser)
    read_parser.add_argument("--project-id", required=True, help="Project identifier.")
    read_parser.add_argument("--filename", required=True, help="Target filename.")
    read_parser.add_argument("--commit-id", default=None, help="Optional historical commit SHA.")
    read_parser.set_defaults(handler=_cmd_read)

    log_parser = subparsers.add_parser("log", help="Show commit history for a project or file.")
    _register_common_arguments(log_parser)
    log_parser.add_argument("--project-id", required=True, help="Project identifier.")
    log_parser.add_argument("--filename", default=None, help="Optional filename filter.")
    log_parser.set_defaults(handler=_cmd_log)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    handler: Optional[Handler] = getattr(args, "handler", None)
    if handler is None:
        parser.error("a command handler is required")

    try:
        payload = handler(args)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    _render_json(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
