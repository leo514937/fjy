from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from manager import XiaoGuGitManager

app = FastAPI(
    title="本体Git 核心 API",
    description="一个面向本体/结构化数据版本管理的轻量级 Git 包装服务。可访问 /ui 使用简易前端页面。",
    version="0.2.0",
)
xg = XiaoGuGitManager()
FRONTEND_FILE = Path(__file__).with_name("frontend.html")
MODERN_FRONTEND_FILE = Path(__file__).with_name("frontend_modern.html")
VISUAL_FRONTEND_FILE = Path(__file__).with_name("frontend_visual.html")
VISUAL_MODERN_FRONTEND_FILE = Path(__file__).with_name("frontend_visual_modern.html")


class WriteReq(BaseModel):
    project_id: str
    filename: str
    data: Dict[str, Any]
    message: str
    agent_name: str
    committer_name: str
    basevision: int


class DeleteReq(BaseModel):
    project_id: str
    filename: str
    message: str = "System: 删除本体"
    committer_name: str = "System"
    agent_name: Optional[str] = None
    purge_history: bool = True


class ProjectInitReq(BaseModel):
    project_id: str
    name: Optional[str] = None
    description: str = ""
    status: str = "开发中"


class ProjectStatusReq(BaseModel):
    project_id: str
    status: str
    operator: str = "System"


def _handle_error(exc: Exception):
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/ui", response_class=HTMLResponse)
async def ui():
    return FRONTEND_FILE.read_text(encoding="utf-8")


@app.get("/ui-visual", response_class=HTMLResponse)
async def ui_visual():
    return VISUAL_FRONTEND_FILE.read_text(encoding="utf-8")


@app.get("/ui-modern", response_class=HTMLResponse)
async def ui_modern():
    return MODERN_FRONTEND_FILE.read_text(encoding="utf-8")


@app.get("/ui-visual-modern", response_class=HTMLResponse)
async def ui_visual_modern():
    return VISUAL_MODERN_FRONTEND_FILE.read_text(encoding="utf-8")


@app.get("/")
async def index():
    return {
        "service": "本体Git",
        "status": "running",
        "docs": "/docs",
        "supported_status": sorted(list(xg.ALLOWED_STATUS)),
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/projects/init")
async def init_project(req: ProjectInitReq):
    try:
        return xg.init_project(req.project_id, req.name, req.description, req.status)
    except Exception as exc:
        _handle_error(exc)


@app.get("/projects")
async def list_projects():
    try:
        return {"projects": xg.list_projects()}
    except Exception as exc:
        _handle_error(exc)


@app.get("/projects/{project_id}")
async def project_detail(project_id: str):
    try:
        return {"project": xg.get_project_info(project_id)}
    except Exception as exc:
        _handle_error(exc)


@app.post("/projects/status")
async def update_project_status(req: ProjectStatusReq):
    try:
        return xg.update_project_status(req.project_id, req.status, req.operator)
    except Exception as exc:
        _handle_error(exc)


@app.get("/projects/{project_id}/files")
async def list_project_files(project_id: str):
    try:
        return {"files": xg.list_files(project_id)}
    except Exception as exc:
        _handle_error(exc)


@app.get("/versions/{project_id}/{filename:path}")
async def file_versions(project_id: str, filename: str):
    try:
        return xg.get_file_version_tree(project_id, filename)
    except Exception as exc:
        _handle_error(exc)


@app.get("/versions/{project_id}")
async def project_versions(project_id: str, filename: Optional[str] = Query(None)):
    try:
        if filename:
            return xg.get_file_version_tree(project_id, filename)
        return {"files": xg.get_all_version_trees(project_id)}
    except Exception as exc:
        _handle_error(exc)


@app.get("/timelines/{project_id}")
async def file_timelines(project_id: str):
    try:
        return {"timelines": xg.get_all_file_timelines(project_id)}
    except Exception as exc:
        _handle_error(exc)


@app.get("/version-detail/{project_id}/{version_id}")
async def version_detail(project_id: str, version_id: str, filename: Optional[str] = Query(None)):
    try:
        return {"version": xg.get_version_detail(project_id, version_id, filename)}
    except Exception as exc:
        _handle_error(exc)


@app.get("/version-read/{project_id}/{version_id}")
async def version_read(project_id: str, version_id: str, filename: Optional[str] = Query(None)):
    try:
        return xg.read_version_by_id(project_id, version_id, filename)
    except Exception as exc:
        _handle_error(exc)


@app.get("/projects/{project_id}/commits/{commit_id}")
async def commit_detail(project_id: str, commit_id: str):
    try:
        return {"commit": xg.get_commit_detail(project_id, commit_id)}
    except Exception as exc:
        _handle_error(exc)


@app.post("/write")
async def write(req: WriteReq):
    try:
        return xg.write_version(
            req.project_id,
            req.filename,
            req.data,
            req.message,
            req.agent_name,
            req.committer_name,
            req.basevision,
        )
    except Exception as exc:
        _handle_error(exc)


@app.post("/delete")
async def delete(req: DeleteReq):
    try:
        if req.purge_history:
            return xg.purge_file_history(
                req.project_id,
                req.filename,
            )
        return xg.delete_version(
            req.project_id,
            req.filename,
            req.message,
            req.committer_name,
            req.agent_name,
        )
    except Exception as exc:
        _handle_error(exc)


@app.get("/read/{project_id}/{filename}")
async def read(project_id: str, filename: str, commit_id: Optional[str] = Query(None)):
    try:
        data = xg.read_version(project_id, filename, commit_id)
        return {"data": data}
    except Exception as exc:
        _handle_error(exc)


@app.get("/log/{project_id}")
async def log(project_id: str, filename: Optional[str] = Query(None)):
    try:
        return {"history": xg.get_log(project_id, filename)}
    except Exception as exc:
        _handle_error(exc)


@app.get("/diff")
async def diff(
    project_id: str,
    filename: str,
    base: Optional[str] = Query(None),
    target: Optional[str] = Query(None),
    base_version_id: Optional[str] = Query(None),
    target_version_id: Optional[str] = Query(None),
):
    try:
        if base_version_id and target_version_id:
            return xg.diff_versions(project_id, base_version_id, target_version_id)
        if not base or not target:
            raise ValueError("base 和 target 不能为空")
        return {"diff": xg.get_diff(project_id, filename, base, target)}
    except Exception as exc:
        _handle_error(exc)


@app.get("/version-diff")
async def version_diff(project_id: str, base_version_id: str, target_version_id: str, filename: Optional[str] = Query(None)):
    try:
        return xg.diff_versions(project_id, base_version_id, target_version_id, filename)
    except Exception as exc:
        _handle_error(exc)


@app.post("/rollback")
async def rollback(
    project_id: str,
    commit_id: Optional[str] = Query(None),
    version_id: Optional[str] = Query(None),
):
    try:
        if version_id:
            return xg.rollback_version_by_id(project_id, version_id)
        if not commit_id:
            raise ValueError("commit_id 或 version_id 必须提供一个")
        return xg.rollback(project_id, commit_id)
    except Exception as exc:
        _handle_error(exc)


@app.post("/version-rollback")
async def version_rollback(project_id: str, version_id: str, filename: Optional[str] = Query(None)):
    try:
        return xg.rollback_version_by_id(project_id, version_id, filename)
    except Exception as exc:
        _handle_error(exc)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)