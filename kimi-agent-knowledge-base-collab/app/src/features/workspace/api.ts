import {
  normalizeXgProjectsResponse,
  normalizeXgReadResponse,
  normalizeXgTimelinesResponse,
  normalizeXgWriteResult,
  type XgProject,
  type XgTimeline,
  type XgWriteResult,
} from '@/lib/xgApi';
import { buildApiUrl, parseJson } from '@/shared/api/http';

export type { XgProject, XgTimeline, XgWriteResult } from '@/lib/xgApi';

export interface ProbabilityResult {
  probability: number;
  reason: string;
}

export async function fetchXgProjects(): Promise<XgProject[]> {
  const response = await fetch(buildApiUrl('/api/xg/projects'));
  return normalizeXgProjectsResponse(await parseJson<unknown>(response));
}

export async function fetchXgRead(projectId: string, filename: string, commitId?: string): Promise<unknown> {
  const url = buildApiUrl(`/api/xg/read/${projectId}/${filename}${commitId ? `?commit_id=${commitId}` : ''}`);
  const response = await fetch(url);
  return normalizeXgReadResponse(await parseJson<unknown>(response));
}

export async function fetchXgTimelines(projectId: string): Promise<XgTimeline[]> {
  const response = await fetch(buildApiUrl(`/api/xg/timelines/${projectId}`));
  return normalizeXgTimelinesResponse(await parseJson<unknown>(response));
}

export async function writeXgAndInfer(input: {
  project_id: string;
  filename: string;
  data: unknown;
  message: string;
  agent_name?: string;
  committer_name?: string;
  basevision?: number;
  inference_message?: string;
  inference_agent_name?: string;
  inference_committer_name?: string;
}): Promise<XgWriteResult> {
  const response = await fetch(buildApiUrl('/api/xg/write-and-infer'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return normalizeXgWriteResult(await parseJson<unknown>(response));
}

export async function fetchProbabilityReason(concept: unknown): Promise<ProbabilityResult> {
  const response = await fetch(buildApiUrl('/api/probability/api/llm/probability-reason'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  return parseJson<ProbabilityResult>(response);
}

export async function fetchOfficialRecommend(projectId: string, filename: string): Promise<unknown> {
  const response = await fetch(buildApiUrl(`/api/xg/version-recommend/official?project_id=${projectId}&filename=${filename}`));
  return parseJson(response);
}

export async function fetchCommunityRecommend(projectId: string, filename: string): Promise<unknown> {
  const response = await fetch(buildApiUrl(`/api/xg/version-recommend/community?project_id=${projectId}&filename=${filename}`));
  return parseJson(response);
}

export async function rollbackXgVersion(projectId: string, commitId: string): Promise<unknown> {
  const params = new URLSearchParams({ project_id: projectId, commit_id: commitId });
  const response = await fetch(buildApiUrl(`/api/xg/rollback?${params.toString()}`), {
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
  const response = await fetch(buildApiUrl(`/api/xg/diff?${params.toString()}`));
  return parseJson(response);
}

export async function initXgProject(projectData: { project_id: string; name?: string; description?: string }): Promise<unknown> {
  const response = await fetch(buildApiUrl('/api/xg/projects/init'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(projectData),
  });
  return parseJson(response);
}

export async function setOfficialRecommend(projectId: string, filename: string, versionId: string): Promise<unknown> {
  const response = await fetch(buildApiUrl('/api/xg/version-recommend/official/set'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, filename, version_id: versionId }),
  });
  return parseJson(response);
}

// --- New OntoGit Dashboard & Monitor Endpoints ---

export interface DashboardSummary {
  projects: XgProject[];
  timelines: Record<string, XgTimeline[]>;
  health: {
    gateway: string;
    xiaogugit: string;
    probability: string;
  };
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetch(buildApiUrl('/api/dashboard/summary'));
  return parseJson<DashboardSummary>(response);
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
  const response = await fetch(buildApiUrl('/api/routes'));
  return parseJson<RouteDoc[]>(response);
}

export interface HealthStatus {
  status: string;
  modules: Record<string, string>;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await fetch(buildApiUrl('/health'));
  return parseJson<HealthStatus>(response);
}

// --- New Auth Endpoints ---

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export async function login(username: string, password: string): Promise<{ access_token: string }> {
  const response = await fetch(buildApiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return parseJson<{ access_token: string }>(response);
}

export async function logout(): Promise<void> {
  await fetch(buildApiUrl('/auth/logout'), { method: 'POST' });
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await fetch(buildApiUrl('/auth/me'));
  return parseJson<AuthUser>(response);
}

// --- New Admin & Advanced Endpoints ---

export async function deleteXgProject(projectId: string): Promise<unknown> {
  const response = await fetch(buildApiUrl(`/api/xg/projects/${projectId}`), {
    method: 'DELETE',
  });
  return parseJson(response);
}

export async function fetchProbabilityScoreOnly(concept: unknown): Promise<{ probability: number }> {
  const response = await fetch(buildApiUrl('/api/probability/api/llm/probability'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  return parseJson<{ probability: number }>(response);
}
