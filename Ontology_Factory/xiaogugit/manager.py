import json
import os
import re
import subprocess
from datetime import datetime

import git


class XiaoGuGitManager:
    META_FILE = "project_meta.json"
    DEFAULT_STATUS = "开发中"
    ALLOWED_STATUS = {"开发中", "测试中", "已完成", "已暂停", "已归档", "已回滚"}
    VERSION_META_FILENAME = "XG-Filename"
    VERSION_META_ID = "XG-VersionId"
    VERSION_META_BASE = "XG-BaseVersion"
    VERSION_META_OBJECT = "XG-ObjectName"
    VERSION_META_COMMITTER = "XG-CommitterName"

    def __init__(self, root_dir="./storage"):
        self.root_dir = os.path.abspath(root_dir)
        os.makedirs(self.root_dir, exist_ok=True)

    def _now(self):
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _system_actor(self):
        return git.Actor("System", "system@local")

    def _validate_project_id(self, project_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", project_id or ""):
            raise ValueError("project_id 只能包含字母、数字、下划线和短横线")
        return project_id

    def _validate_filename(self, filename):
        normalized = os.path.normpath(filename or "").replace("\\", "/")
        if normalized in {"", ".", ".."}:
            raise ValueError("filename 不能为空")
        if os.path.isabs(filename) or normalized.startswith("../") or "/../" in normalized:
            raise ValueError("filename 非法，禁止路径穿越")
        if normalized.startswith(".git"):
            raise ValueError("filename 非法，禁止写入 .git 目录")
        return normalized

    def _validate_status(self, status):
        if status not in self.ALLOWED_STATUS:
            raise ValueError(f"status 必须是以下之一: {', '.join(sorted(self.ALLOWED_STATUS))}")
        return status

    def _project_path(self, project_id):
        return os.path.join(self.root_dir, self._validate_project_id(project_id))

    def _meta_path(self, project_id):
        return os.path.join(self._project_path(project_id), self.META_FILE)

    def _repo_exists(self, project_id):
        return os.path.exists(os.path.join(self._project_path(project_id), ".git"))

    def _get_repo(self, project_id, create=False):
        path = self._project_path(project_id)
        git_dir = os.path.join(path, ".git")
        if not os.path.exists(git_dir):
            if not create:
                raise FileNotFoundError(f"项目 {project_id} 不存在")
            os.makedirs(path, exist_ok=True)
            repo = git.Repo.init(path)
            with open(os.path.join(path, "init.txt"), "w", encoding="utf-8") as f:
                f.write("Project Start")
            repo.git.add(A=True)
            repo.index.commit("System: Initialized", author=self._system_actor())
            return repo
        return git.Repo(path)

    def _write_json_file(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)

    def _default_meta(self, project_id):
        now = self._now()
        return {
            "project_id": project_id,
            "name": project_id,
            "description": "",
            "status": self.DEFAULT_STATUS,
            "created_at": now,
            "updated_at": now,
        }

    def _load_meta(self, project_id):
        meta = self._default_meta(project_id)
        meta_path = self._meta_path(project_id)
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            meta.update(stored)
        return meta

    def _save_meta(self, project_id, meta, repo=None):
        if repo is None:
            repo = self._get_repo(project_id, create=False)
        self._write_json_file(self._meta_path(project_id), meta)
        repo.git.add(self.META_FILE)

    def _parse_commit_metadata(self, message):
        metadata = {}
        visible_lines = []
        for line in (message or "").splitlines():
            if ":" not in line:
                visible_lines.append(line)
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            if key in {
                self.VERSION_META_FILENAME,
                self.VERSION_META_ID,
                self.VERSION_META_BASE,
                self.VERSION_META_OBJECT,
                self.VERSION_META_COMMITTER,
            }:
                metadata[key] = value
                continue
            visible_lines.append(line)
        visible_message = "\n".join(visible_lines).strip()
        return visible_message, metadata

    def _build_commit_message(self, message, filename, version_id, basevision, object_name, committer_name):
        visible_message = (message or "").strip() or "System: version update"
        footer_lines = [
            f"{self.VERSION_META_FILENAME}: {filename}",
            f"{self.VERSION_META_ID}: {version_id}",
            f"{self.VERSION_META_OBJECT}: {object_name}",
            f"{self.VERSION_META_COMMITTER}: {committer_name}",
        ]
        if basevision is not None:
            footer_lines.append(f"{self.VERSION_META_BASE}: {basevision}")
        return f"{visible_message}\n\n" + "\n".join(footer_lines)

    def _file_exists_in_commit(self, commit, filename):
        try:
            commit.tree / filename
            return True
        except KeyError:
            return False

    def _list_repo_files(self, project_id):
        project_path = self._project_path(project_id)
        results = []
        for current_root, dirnames, filenames in os.walk(project_path):
            dirnames[:] = [dirname for dirname in dirnames if dirname != ".git"]
            for filename in filenames:
                abs_path = os.path.join(current_root, filename)
                rel_path = os.path.relpath(abs_path, project_path).replace("\\", "/")
                if rel_path in {"init.txt", self.META_FILE}:
                    continue
                results.append(rel_path)
        return sorted(results)

    def _list_historical_files(self, project_id):
        repo = self._get_repo(project_id, create=False)
        filenames = set(self._list_repo_files(project_id))
        for commit in repo.iter_commits():
            _, metadata = self._parse_commit_metadata(commit.message)
            filename = metadata.get(self.VERSION_META_FILENAME)
            if filename:
                filenames.add(filename)
        return sorted(filenames)

    def init_project(self, project_id, name=None, description="", status=DEFAULT_STATUS):
        self._validate_status(status)
        existed = self._repo_exists(project_id)
        repo = self._get_repo(project_id, create=True)
        meta = self._load_meta(project_id)
        meta["name"] = name or meta.get("name") or project_id
        meta["description"] = description
        meta["status"] = status
        if not meta.get("created_at"):
            meta["created_at"] = self._now()
        meta["updated_at"] = self._now()

        self._save_meta(project_id, meta, repo)
        commit_id = None
        if repo.is_dirty(untracked_files=True):
            commit = repo.index.commit(
                f"System: 初始化项目 {project_id}",
                author=self._system_actor(),
            )
            commit_id = commit.hexsha
        return {
            "status": "created" if not existed else "updated",
            "commit_id": commit_id,
            "project": self.get_project_info(project_id),
        }

    # 1. 写入 (Write) - 核心：接收 AI 生成的 data 和 message
    def write_version(self, project_id, filename, data, message, agent_name, committer_name, basevision):
        safe_filename = self._validate_filename(filename)
        repo = self._get_repo(project_id, create=True)
        file_path = os.path.join(self._project_path(project_id), safe_filename)
        tree = self.get_file_version_tree(project_id, safe_filename)
        versions = tree["versions"]
        normalized_basevision = int(basevision)
        if not versions:
            if normalized_basevision != 0:
                raise ValueError(f"文件 {safe_filename} 首次写入时 basevision 必须为 0")
        else:
            if normalized_basevision < 0:
                raise ValueError("basevision 不能小于 0")
            if not any(version["version_id"] == normalized_basevision for version in versions):
                if normalized_basevision != 0:
                    raise FileNotFoundError(f"文件 {safe_filename} 的版本 {normalized_basevision} 不存在")

        next_version_id = (max((version["version_id"] for version in versions), default=0) + 1)
        basevision_for_metadata = normalized_basevision if normalized_basevision > 0 else 0
        full_message = self._build_commit_message(
            message,
            safe_filename,
            next_version_id,
            basevision_for_metadata,
            agent_name,
            committer_name,
        )
        current_data = None
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                current_data = json.load(f)
        self._write_json_file(file_path, data)

        meta = self._load_meta(project_id)
        meta["status"] = meta.get("status") or self.DEFAULT_STATUS
        meta["updated_at"] = self._now()
        meta["last_agent"] = agent_name
        meta["last_committer"] = committer_name
        meta["last_message"] = message
        meta["last_basevision"] = normalized_basevision
        self._save_meta(project_id, meta, repo)

        repo.git.add(safe_filename)
        author = git.Actor(committer_name, f"{committer_name}@local")
        if repo.is_dirty(untracked_files=True):
            commit = repo.index.commit(
                full_message,
                author=author,
            )
        elif current_data == data and normalized_basevision is not None:
            repo.git.commit(
                "--allow-empty",
                "-m",
                full_message,
                f"--author={committer_name} <{committer_name}@local>",
            )
            commit = repo.head.commit
        else:
            return {"status": "no_change"}

        return {
            "status": "success",
            "commit_id": commit.hexsha,
            "version_id": next_version_id,
            "basevision": normalized_basevision,
            "currvision": next_version_id,
        }

    def delete_version(self, project_id, filename, message, committer_name, agent_name=None):
        safe_filename = self._validate_filename(filename)
        repo = self._get_repo(project_id, create=False)
        file_path = os.path.join(self._project_path(project_id), safe_filename)
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件 {safe_filename} 当前不存在，无法删除")

        tree = self.get_file_version_tree(project_id, safe_filename)
        versions = tree["versions"]
        if not versions:
            raise FileNotFoundError(f"文件 {safe_filename} 不存在历史版本，无法删除")

        latest_version = versions[-1]
        next_version_id = max((version["version_id"] for version in versions), default=0) + 1
        basevision = latest_version["version_id"]
        object_name = (agent_name or latest_version.get("object_name") or os.path.splitext(os.path.basename(safe_filename))[0]).strip()
        full_message = self._build_commit_message(
            (message or "").strip() or f"System: 删除本体 {safe_filename}",
            safe_filename,
            next_version_id,
            basevision,
            object_name,
            committer_name,
        )

        repo.git.rm("--", safe_filename)
        meta = self._load_meta(project_id)
        meta["updated_at"] = self._now()
        meta["last_agent"] = object_name
        meta["last_committer"] = committer_name
        meta["last_message"] = (message or "").strip() or f"System: 删除本体 {safe_filename}"
        meta["last_basevision"] = basevision
        self._save_meta(project_id, meta, repo)

        commit = repo.index.commit(
            full_message,
            author=git.Actor(committer_name, f"{committer_name}@local"),
        )
        return {
            "status": "success",
            "action": "deleted",
            "filename": safe_filename,
            "commit_id": commit.hexsha,
            "version_id": next_version_id,
            "basevision": basevision,
            "currvision": next_version_id,
        }

    def purge_file_history(self, project_id, filename):
        safe_filename = self._validate_filename(filename)
        repo = self._get_repo(project_id, create=False)
        if repo.is_dirty(untracked_files=True):
            raise ValueError("仓库存在未提交改动，请先清理后再执行彻底删除")

        project_path = self._project_path(project_id)
        index_filter_cmd = f'git rm --cached --ignore-unmatch -- "{safe_filename}"'
        try:
            subprocess.run(
                [
                    "git",
                    "filter-branch",
                    "--force",
                    "--index-filter",
                    index_filter_cmd,
                    "--prune-empty",
                    "--tag-name-filter",
                    "cat",
                    "--",
                    "--all",
                ],
                cwd=project_path,
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            err = (exc.stderr or "").strip()
            out = (exc.stdout or "").strip()
            raise RuntimeError(err or out or "彻底删除失败") from exc

        original_refs = repo.git.for_each_ref("--format=%(refname)", "refs/original/").splitlines()
        for ref in original_refs:
            if ref.strip():
                repo.git.update_ref("-d", ref.strip())
        repo.git.reflog("expire", "--expire=now", "--all")
        repo.git.gc("--prune=now", "--aggressive")

        tree = self.get_file_version_tree(project_id, safe_filename)
        return {
            "status": "success",
            "action": "purged",
            "filename": safe_filename,
            "version_count": tree["version_count"],
            "latest_version_id": tree["latest_version_id"],
        }

    # 2. 读取 (Read) - 支持历史版本读取
    def read_version(self, project_id, filename, commit_id=None):
        safe_filename = self._validate_filename(filename)
        repo = self._get_repo(project_id, create=False)
        if commit_id:
            content = repo.git.show(f"{commit_id}:{safe_filename}")
            return json.loads(content)
        path = os.path.join(self._project_path(project_id), safe_filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"文件 {safe_filename} 不存在")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    # 3. 日志 (Log) - 查看版本演化
    def get_log(self, project_id, filename=None):
        repo = self._get_repo(project_id, create=False)
        kwargs = {}
        if filename:
            kwargs["paths"] = self._validate_filename(filename)
        return [
            {
                "id": c.hexsha,
                "msg": self._parse_commit_metadata(c.message)[0],
                "object_name": self._parse_commit_metadata(c.message)[1].get(self.VERSION_META_OBJECT, c.author.name),
                "committer": self._parse_commit_metadata(c.message)[1].get(self.VERSION_META_COMMITTER, ""),
                "time": str(c.authored_datetime),
            }
            for c in repo.iter_commits(**kwargs)
        ]

    def get_file_version_tree(self, project_id, filename):
        safe_filename = self._validate_filename(filename)
        repo = self._get_repo(project_id, create=False)
        commits = list(reversed(list(repo.iter_commits(paths=safe_filename))))
        version_id_map = {
            commit.hexsha: index + 1
            for index, commit in enumerate(commits)
        }

        versions = []
        for index, commit in enumerate(commits):
            visible_message, metadata = self._parse_commit_metadata(commit.message)
            version_id = int(metadata.get(self.VERSION_META_ID, version_id_map[commit.hexsha]))
            object_name = metadata.get(self.VERSION_META_OBJECT, commit.author.name)
            committer = metadata.get(self.VERSION_META_COMMITTER, "")
            git_parent_commit_ids = [parent.hexsha for parent in commit.parents]
            explicit_base = metadata.get(self.VERSION_META_BASE)
            if explicit_base not in {None, ""}:
                normalized_explicit_base = int(explicit_base)
                parent_version_ids = [] if normalized_explicit_base <= 0 else [normalized_explicit_base]
            else:
                parent_version_ids = [
                    versions[index - 1]["version_id"]
                ] if index > 0 else []

            primary_parent_version_id = parent_version_ids[0] if parent_version_ids else None
            versions.append(
                {
                    "version_id": version_id,
                    "commit_id": commit.hexsha,
                    "filename": safe_filename,
                    "parent_version_ids": parent_version_ids,
                    "primary_parent_version_id": primary_parent_version_id,
                    "basevision": primary_parent_version_id,
                    "currvision": version_id,
                    "git_parent_commit_ids": git_parent_commit_ids,
                    "message": visible_message,
                    "object_name": object_name,
                    "committer": committer,
                    "time": str(commit.authored_datetime),
                    "is_deleted": not self._file_exists_in_commit(commit, safe_filename),
                }
            )

        child_map = {version["version_id"]: [] for version in versions}
        for version in versions:
            for parent_version_id in version["parent_version_ids"]:
                if parent_version_id in child_map:
                    child_map[parent_version_id].append(version["version_id"])

        latest_version_id = versions[-1]["version_id"] if versions else None
        for version in versions:
            version["child_version_ids"] = child_map[version["version_id"]]
            version["is_root"] = not version["parent_version_ids"]
            version["is_latest"] = version["version_id"] == latest_version_id

        return {
            "filename": safe_filename,
            "version_count": len(versions),
            "latest_version_id": latest_version_id,
            "latest_commit_id": versions[-1]["commit_id"] if versions else None,
            "root_version_ids": [version["version_id"] for version in versions if version["is_root"]],
            "versions": versions,
        }

    def get_all_version_trees(self, project_id):
        self._get_repo(project_id, create=False)
        return [
            self.get_file_version_tree(project_id, filename)
            for filename in self._list_repo_files(project_id)
        ]

    def _find_version_node(self, project_id, version_id, filename=None):
        normalized_version_id = str(version_id)
        if filename:
            safe_filename = self._validate_filename(filename)
            tree = self.get_file_version_tree(project_id, safe_filename)
            for version in tree["versions"]:
                if str(version["version_id"]) == normalized_version_id:
                    return version
            raise FileNotFoundError(f"文件 {safe_filename} 的版本 {version_id} 不存在")

        matched = []
        for historical_filename in self._list_historical_files(project_id):
            tree = self.get_file_version_tree(project_id, historical_filename)
            for version in tree["versions"]:
                if str(version["version_id"]) == normalized_version_id:
                    matched.append(version)
        if len(matched) == 1:
            return matched[0]
        if len(matched) > 1:
            raise ValueError(f"版本 {version_id} 在多个文件中重复，请提供 filename")
        raise FileNotFoundError(f"版本 {version_id} 不存在")

    def get_version_detail(self, project_id, version_id, filename=None):
        version = self._find_version_node(project_id, version_id, filename)
        detail = self.get_commit_detail(project_id, version["commit_id"])
        detail.update(
            {
                "version_id": version["version_id"],
                "filename": version["filename"],
                "object_name": version["object_name"],
                "committer": version["committer"],
                "parent_version_ids": version["parent_version_ids"],
                "primary_parent_version_id": version["primary_parent_version_id"],
                "basevision": version["basevision"],
                "currvision": version["currvision"],
                "is_deleted": version["is_deleted"],
                "child_version_ids": version["child_version_ids"],
                "is_root": version["is_root"],
                "is_latest": version["is_latest"],
            }
        )
        return detail

    def read_version_by_id(self, project_id, version_id, filename=None):
        version = self._find_version_node(project_id, version_id, filename)
        if version.get("is_deleted"):
            return {
                "version_id": version["version_id"],
                "commit_id": version["commit_id"],
                "filename": version["filename"],
                "deleted": True,
                "data": None,
            }
        return {
            "version_id": version["version_id"],
            "commit_id": version["commit_id"],
            "filename": version["filename"],
            "data": self.read_version(project_id, version["filename"], version["commit_id"]),
        }

    def diff_versions(self, project_id, base_version_id, target_version_id, filename=None):
        base_version = self._find_version_node(project_id, base_version_id, filename)
        target_version = self._find_version_node(project_id, target_version_id, filename)
        if base_version["filename"] != target_version["filename"]:
            raise ValueError("版本 Diff 仅支持同一文件")
        return {
            "filename": target_version["filename"],
            "base_version_id": base_version["version_id"],
            "target_version_id": target_version["version_id"],
            "base_commit_id": base_version["commit_id"],
            "target_commit_id": target_version["commit_id"],
            "diff": self.get_diff(
                project_id,
                target_version["filename"],
                base_version["commit_id"],
                target_version["commit_id"],
            ),
        }

    def rollback_version_by_id(self, project_id, version_id, filename=None):
        version = self._find_version_node(project_id, version_id, filename)
        result = self.rollback(project_id, version["commit_id"])
        result.update(
            {
                "version_id": version["version_id"],
                "filename": version["filename"],
                "target_commit_id": version["commit_id"],
            }
        )
        return result

    def get_commit_detail(self, project_id, commit_id):
        repo = self._get_repo(project_id, create=False)
        commit = repo.commit(commit_id)
        visible_message, _ = self._parse_commit_metadata(commit.message)
        _, metadata = self._parse_commit_metadata(commit.message)
        return {
            "id": commit.hexsha,
            "msg": visible_message,
            "object_name": metadata.get(self.VERSION_META_OBJECT, commit.author.name),
            "committer": metadata.get(self.VERSION_META_COMMITTER, ""),
            "time": str(commit.authored_datetime),
            "changed_files": sorted(commit.stats.files.keys()),
        }

    # 4. 差异 (Diff) - 为生成规约提供文本素材
    def get_diff(self, project_id, filename, base_commit, target_commit):
        safe_filename = self._validate_filename(filename)
        repo = self._get_repo(project_id, create=False)
        return repo.git.diff(base_commit, target_commit, safe_filename)

    # 5. 回滚 (Rollback) - 强制恢复版本
    def rollback(self, project_id, commit_id):
        repo = self._get_repo(project_id, create=False)
        repo.git.revert(f"{commit_id}..HEAD", n=True)
        meta = self._load_meta(project_id)
        meta["status"] = "已回滚"
        meta["updated_at"] = self._now()
        self._save_meta(project_id, meta, repo)
        commit = repo.index.commit(
            f"System: 自动回滚至版本 {commit_id}",
            author=self._system_actor(),
        )
        return {"status": "success", "commit_id": commit.hexsha}

    # 6. 项目列表
    def list_projects(self):
        projects = []
        for project_id in os.listdir(self.root_dir):
            project_path = os.path.join(self.root_dir, project_id)
            if not os.path.isdir(project_path):
                continue
            if not os.path.exists(os.path.join(project_path, ".git")):
                continue
            projects.append(self.get_project_info(project_id))
        projects.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return projects

    # 7. 项目详情
    def get_project_info(self, project_id):
        repo = self._get_repo(project_id, create=False)
        meta = self._load_meta(project_id)
        files = self._list_repo_files(project_id)
        commits = list(repo.iter_commits())
        meta["file_count"] = len(files)
        meta["commit_count"] = len(commits)
        meta["files"] = files
        if commits:
            meta["latest_commit_id"] = commits[0].hexsha
        return meta

    # 8. 项目状态更新
    def update_project_status(self, project_id, status, operator="System"):
        self._validate_status(status)
        repo = self._get_repo(project_id, create=False)
        meta = self._load_meta(project_id)
        meta["status"] = status
        meta["updated_at"] = self._now()
        meta["last_operator"] = operator
        self._save_meta(project_id, meta, repo)

        commit_id = None
        if repo.is_dirty(untracked_files=True):
            commit = repo.index.commit(
                f"System: 项目状态更新为{status}",
                author=git.Actor(operator, f"{operator}@local"),
            )
            commit_id = commit.hexsha
        return {"status": "success", "commit_id": commit_id, "project": self.get_project_info(project_id)}

    # 9. 文件列表
    def list_files(self, project_id):
        self._get_repo(project_id, create=False)
        return self._list_repo_files(project_id)

    # 10. 全部文件版本链
    def get_all_file_timelines(self, project_id):
        self._get_repo(project_id, create=False)
        timelines = []
        for tree in self.get_all_version_trees(project_id):
            history = [
                {
                    "id": version["commit_id"],
                    "version_id": version["version_id"],
                    "msg": version["message"],
                    "object_name": version["object_name"],
                    "committer": version["committer"],
                    "time": version["time"],
                    "parent_version_ids": version["parent_version_ids"],
                    "primary_parent_version_id": version["primary_parent_version_id"],
                    "basevision": version["basevision"],
                    "currvision": version["currvision"],
                    "is_deleted": version["is_deleted"],
                }
                for version in tree["versions"]
            ]
            timelines.append(
                {
                    "filename": tree["filename"],
                    "version_count": tree["version_count"],
                    "latest_commit_id": tree["latest_commit_id"],
                    "latest_version_id": tree["latest_version_id"],
                    "root_version_ids": tree["root_version_ids"],
                    "history": history,
                }
            )
        return timelines