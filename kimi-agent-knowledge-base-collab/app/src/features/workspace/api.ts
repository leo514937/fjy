import {
  normalizeXgProjectsResponse,
  normalizeXgReadResponse,
  normalizeXgTimelinesResponse,
  normalizeXgWriteResult,
  type XgProject,
  type XgTimeline,
  type XgWriteResult,
} from '@/lib/xgApi';
import { apiFetch, clearStoredAccessToken, parseJson, setStoredAccessToken } from '@/shared/api/http';
import { notifyRepositorySync } from '@/shared/events/repositorySync';
import { validateWorkflowEntityFileData } from '@/features/workspace/workflowEntityFormat';

export type { XgProject, XgTimeline, XgTimelineCommit, XgWriteResult } from '@/lib/xgApi';

const SOFT_DELETED_PROJECTS_STORAGE_KEY = 'xg-soft-deleted-projects';
const SOFT_DELETED_PROJECTS_EVENT = 'xg:soft-deleted-projects-changed';

type SoftDeletedProjectMap = Record<string, string>;

function encodePathSegments(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeProjectId(projectId: string): string {
  return projectId.trim();
}

function readSoftDeletedProjectMap(): SoftDeletedProjectMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(SOFT_DELETED_PROJECTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const normalizedEntries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => {
        const [projectId, deletedAt] = entry;
        return typeof projectId === 'string'
          && normalizeProjectId(projectId) !== ''
          && typeof deletedAt === 'string';
      },
    );

    return normalizedEntries.reduce<SoftDeletedProjectMap>((acc, [projectId, deletedAt]) => {
      acc[projectId] = deletedAt;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function writeSoftDeletedProjectMap(nextMap: SoftDeletedProjectMap): void {
  if (typeof window === 'undefined') {
    return;
  }

  const entries = Object.entries(nextMap).filter(([projectId, deletedAt]) => (
    normalizeProjectId(projectId) !== ''
    && typeof deletedAt === 'string'
    && deletedAt.trim() !== ''
  ));

  if (entries.length === 0) {
    window.localStorage.removeItem(SOFT_DELETED_PROJECTS_STORAGE_KEY);
  } else {
    window.localStorage.setItem(SOFT_DELETED_PROJECTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  }

  window.dispatchEvent(new CustomEvent(SOFT_DELETED_PROJECTS_EVENT, {
    detail: {
      projectIds: entries.map(([projectId]) => projectId),
    },
  }));
}

function isSoftDeletedProject(projectId: string): boolean {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return false;
  }

  return Boolean(readSoftDeletedProjectMap()[normalizedProjectId]);
}

export interface ProbabilityResult {
  probability: number;
  reason: string;
}

export interface WorkflowConfig {
  workflowModel: string;
}

export interface WorkflowV2Config {
  workflowModel: string;
  workflowModelA: string;
  workflowModelB: string;
  workflowJudgeModel: string;
  chunkMaxChars: number;
  chunkMinChars: number;
  windowSize: number;
  windowStep: number;
  parallelWindows: number;
}

export async function fetchXgProjects(): Promise<XgProject[]> {
  const response = await apiFetch('/api/xg/projects');
  return normalizeXgProjectsResponse(await parseJson<unknown>(response))
    .filter((project) => !isSoftDeletedProject(project.id));
}

export async function fetchXgRead(projectId: string, filename: string, commitId?: string): Promise<unknown> {
  const response = await apiFetch(`/api/xg/read/${encodeURIComponent(projectId)}/${encodePathSegments(filename)}${commitId ? `?commit_id=${commitId}` : ''}`);
  return normalizeXgReadResponse(await parseJson<unknown>(response));
}

export async function fetchXgTimelines(projectId: string): Promise<XgTimeline[]> {
  const response = await apiFetch(`/api/xg/timelines/${encodeURIComponent(projectId)}`);
  return normalizeXgTimelinesResponse(await parseJson<unknown>(response));
}

export async function writeXgAndInfer(input: {
  project_id: string;
  filename: string;
  data: unknown;
  message: string;
  agent_name?: string;
  committer_name?: string;
  basevision: number;
  inference_message?: string;
  inference_agent_name?: string;
  inference_committer_name?: string;
}): Promise<XgWriteResult> {
  const validation = validateWorkflowEntityFileData(input.data);
  if (!validation.ok) {
    throw new Error(`写入拦截：仅支持标准工作流实体 JSON。${validation.error}`);
  }

  const response = await apiFetch('/api/xg/write-and-infer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const result = normalizeXgWriteResult(await parseJson<unknown>(response));
  notifyRepositorySync({ projectId: input.project_id, filename: input.filename, source: 'writeXgAndInfer' });
  return result;
}

export async function fetchProbabilityReason(concept: unknown): Promise<ProbabilityResult> {
  const response = await apiFetch('/api/probability/api/llm/probability-reason', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  return parseJson<ProbabilityResult>(response);
}

export async function fetchWorkflowConfig(): Promise<WorkflowConfig> {
  const response = await apiFetch('/api/workflow/config');
  return parseJson<WorkflowConfig>(response);
}

export async function updateWorkflowConfig(workflowModel: string): Promise<WorkflowConfig> {
  const response = await apiFetch('/api/workflow/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowModel }),
  });
  return parseJson<WorkflowConfig>(response);
}

export async function fetchWorkflowV2Config(): Promise<WorkflowV2Config> {
  const response = await apiFetch('/api/workflow/v2/config');
  return parseJson<WorkflowV2Config>(response);
}

export async function updateWorkflowV2Config(input: WorkflowV2Config): Promise<WorkflowV2Config> {
  const response = await apiFetch('/api/workflow/v2/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJson<WorkflowV2Config>(response);
}

export async function rollbackXgVersion(projectId: string, commitId: string): Promise<unknown> {
  const params = new URLSearchParams({ project_id: projectId, commit_id: commitId });
  const response = await apiFetch(`/api/xg/rollback?${params.toString()}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({} as { detail?: string }));
    throw new Error(errorData.detail || `Rollback failed with status ${response.status}`);
  }

  return response.json();
}

export async function fetchXgDiff(projectId: string, filename: string, base: string, target: string): Promise<unknown> {
  const params = new URLSearchParams({ project_id: projectId, filename, base, target });
  const response = await apiFetch(`/api/xg/diff?${params.toString()}`);
  return parseJson(response);
}

export async function initXgProject(projectData: { project_id: string; name?: string; description?: string }): Promise<unknown> {
  const response = await apiFetch('/api/xg/projects/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData),
  });
  const result = await parseJson(response);
  notifyRepositorySync({ projectId: projectData.project_id, source: 'initXgProject' });
  return result;
}

export async function updateXgProjectName(projectId: string, name: string): Promise<unknown> {
  const response = await apiFetch(`/api/xg/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const result = await parseJson(response);
  notifyRepositorySync({ projectId, source: 'updateXgProjectName' });
  return result;
}

export async function setOfficialRecommend(projectId: string, filename: string, versionId: string): Promise<unknown> {
  const response = await apiFetch('/api/xg/version-recommend/official/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, filename, version_id: versionId }),
  });
  return parseJson(response);
}

export interface RouteDoc {
  name: string;
  method: string;
  path: string;
  module: string;
  auth: string;
  description: string;
}

export async function fetchRoutes(): Promise<RouteDoc[]> {
  const response = await apiFetch('/api/routes');
  return parseJson<RouteDoc[]>(response);
}

export interface HealthStatus {
  status: string;
  modules: Record<string, string>;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await apiFetch('/health');
  return parseJson<HealthStatus>(response);
}

// --- New Auth Endpoints ---

export async function login(username: string, password: string): Promise<{ access_token: string }> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await parseJson<{ access_token: string }>(response);
  if (payload.access_token) {
    setStoredAccessToken(payload.access_token);
  }
  return payload;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    clearStoredAccessToken();
  }
}

// --- New Admin & Advanced Endpoints ---

export async function deleteXgProject(projectId: string): Promise<unknown> {
  const response = await apiFetch(`/api/xg/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  return parseJson(response);
}

export function softDeleteXgProject(projectId: string): { status: 'soft_deleted'; project_id: string; deleted_at: string } {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    throw new Error('projectId 不能为空');
  }

  const deletedAt = new Date().toISOString();
  writeSoftDeletedProjectMap({
    ...readSoftDeletedProjectMap(),
    [normalizedProjectId]: deletedAt,
  });
  notifyRepositorySync({ projectId: normalizedProjectId, source: 'softDeleteXgProject' });

  return {
    status: 'soft_deleted',
    project_id: normalizedProjectId,
    deleted_at: deletedAt,
  };
}
