export interface XgProject {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status?: string;
  updatedAt?: string;
}

export interface XgTimelineCommit {
  id: string;
  message: string;
  author: string;
  timestamp: string;
  versionId?: number;
}

export interface XgTimeline {
  filename: string;
  commits: XgTimelineCommit[];
}

export interface XgWriteResult {
  status: string;
  commit_id: string;
  version_id?: number;
  inference?: {
    probability: number;
    reason: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeXgProjectsResponse(payload: unknown): XgProject[] {
  const wrapper = asRecord(payload);
  const projects = Array.isArray(payload)
    ? payload
    : asArray(wrapper?.projects);

  const normalized: XgProject[] = [];
  for (const project of projects) {
    const record = asRecord(project);
    if (!record) {
      continue;
    }

    const projectId = asString(record.project_id || record.id).trim();
    if (!projectId) {
      continue;
    }

    normalized.push({
      id: projectId,
      projectId,
      name: asString(record.name, projectId),
      description: asString(record.description),
      status: asString(record.status) || undefined,
      updatedAt: asString(record.updated_at) || undefined,
    });
  }

  return normalized;
}

export function normalizeXgTimelinesResponse(payload: unknown): XgTimeline[] {
  const wrapper = asRecord(payload);
  const timelines = Array.isArray(payload)
    ? payload
    : asArray(wrapper?.timelines);

  const normalized: XgTimeline[] = [];
  for (const timeline of timelines) {
    const record = asRecord(timeline);
    if (!record) {
      continue;
    }

    const filename = asString(record.filename).trim();
    if (!filename) {
      continue;
    }

    const rawCommits = Array.isArray(record.commits)
      ? record.commits
      : asArray(record.history);
    const commits: XgTimelineCommit[] = [];

    for (const commit of rawCommits) {
      const commitRecord = asRecord(commit);
      if (!commitRecord) {
        continue;
      }

      const id = asString(commitRecord.id).trim();
      if (!id) {
        continue;
      }

      commits.push({
        id,
        message: asString(commitRecord.message || commitRecord.msg),
        author: asString(commitRecord.author || commitRecord.committer || commitRecord.object_name),
        timestamp: asString(commitRecord.timestamp || commitRecord.time),
        versionId: asNumber(commitRecord.version_id),
      });
    }

    normalized.push({
      filename,
      commits,
    });
  }

  return normalized;
}

export function normalizeXgReadResponse(payload: unknown): unknown {
  const wrapper = asRecord(payload);
  return wrapper && Object.prototype.hasOwnProperty.call(wrapper, "data")
    ? wrapper.data
    : payload;
}

export function normalizeXgWriteResult(payload: unknown): XgWriteResult {
  const record = asRecord(payload) ?? {};
  const writeResult = asRecord(record.write_result);
  const inferenceResult = asRecord(record.inference_result || record.inference);

  return {
    status: asString(record.status, "unknown"),
    commit_id: asString(writeResult?.commit_id || record.commit_id),
    version_id: asNumber(writeResult?.version_id || record.version_id),
    inference: inferenceResult
      ? {
          probability: typeof inferenceResult.probability === "number"
            ? inferenceResult.probability
            : Number(inferenceResult.probability || 0),
          reason: asString(inferenceResult.reason),
        }
      : undefined,
  };
}
