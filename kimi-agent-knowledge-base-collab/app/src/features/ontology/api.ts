import type { Entity, KnowledgeGraphData, OntologyModule } from '@/types/ontology';
import { apiFetch, parseJson } from '@/shared/api/http';
import { notifyRepositorySync } from '@/shared/events/repositorySync';
import { validateWorkflowEntityFileData } from '@/features/workspace/workflowEntityFormat';

interface SessionCacheEntry<T> {
  promise: Promise<T> | null;
  value: T | null;
}

const knowledgeGraphRequestCache = new Map<string, SessionCacheEntry<KnowledgeGraphData>>();
const knowledgeGraphSliceRequestCache = new Map<string, SessionCacheEntry<KnowledgeGraphSliceResponse>>();
const ontologiesRequestCache = new Map<string, SessionCacheEntry<{
  philosophicalOntology: OntologyModule;
  formalOntology: OntologyModule;
  scientificOntology: OntologyModule;
}>>();
const SESSION_CACHE_LIMIT = 6;

function touchSessionCacheEntry<T>(
  cache: Map<string, SessionCacheEntry<T>>,
  key: string,
  entry: SessionCacheEntry<T>,
) {
  if (cache.get(key) === entry) {
    cache.delete(key);
  }
  cache.set(key, entry);
}

function pruneSessionCache<T>(cache: Map<string, SessionCacheEntry<T>>) {
  while (cache.size > SESSION_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }

    const oldestEntry = cache.get(oldestKey);
    if (oldestEntry?.promise) {
      const settledKey = [...cache.entries()].find(([, entry]) => !entry.promise)?.[0];
      if (settledKey === undefined) {
        return;
      }
      cache.delete(settledKey);
      continue;
    }

    cache.delete(oldestKey);
  }
}

function getSharedSessionPromise<T>(
  cache: Map<string, SessionCacheEntry<T>>,
  key: string,
  factory: () => Promise<T>,
  options: { refresh?: boolean } = {},
): Promise<T> {
  const refresh = Boolean(options.refresh);
  const existing = cache.get(key);
  if (existing && !refresh) {
    touchSessionCacheEntry(cache, key, existing);
    if (existing.promise) {
      return existing.promise;
    }
    if (existing.value !== null) {
      return Promise.resolve(existing.value);
    }
  }

  const entry = existing ?? { promise: null, value: null };
  const promise = factory();
  entry.promise = promise;
  touchSessionCacheEntry(cache, key, entry);
  pruneSessionCache(cache);

  void promise.then((value) => {
    const current = cache.get(key);
    if (current?.promise === promise) {
      current.promise = null;
      current.value = value;
      touchSessionCacheEntry(cache, key, current);
      pruneSessionCache(cache);
    }
  }).catch(() => {
    const current = cache.get(key);
    if (current?.promise === promise) {
      current.promise = null;
      if (current.value === null) {
        cache.delete(key);
      }
    }
  });

  return promise;
}

function normalizeProjectId(projectId?: string): string {
  return projectId?.trim() || '';
}

function buildKnowledgeGraphRequestKey(options: { refresh?: boolean; projectId?: string } = {}): string {
  return JSON.stringify({
    projectId: normalizeProjectId(options.projectId),
  });
}

function buildKnowledgeGraphSliceRequestKey(refs: string[], projectId?: string): string {
  return JSON.stringify({
    refs,
    projectId: normalizeProjectId(projectId),
  });
}

export interface AnalysisResult {
  entity_name: string;
  primary_level: string;
  secondary_levels: string[];
  ontology_breakdown: {
    entity_level: {
      main_level: string;
      physical_basis: string;
      social_dimension?: string;
    };
    essential_attributes: Array<{
      attribute: string;
      description: string;
      necessity: string;
    }>;
    accidental_attributes: Array<{
      attribute: string;
      examples: string[];
    }>;
    components: Array<{
      part: string;
      function: string;
      material?: string;
      ontology_relation: string;
    }>;
    relations: Array<{
      relation: string;
      target: string;
      description: string;
    }>;
    ontological_questions: Array<{
      question: string;
      discussion: string;
    }>;
    formalization: {
      RDF?: string;
      OWL?: string;
      description_logic?: string;
    };
  };
}

export interface SystemAnalysisData {
  entity: string;
  holistic_properties: string[];
  boundary: {
    physical?: string;
    functional?: string;
    cognitive?: string;
    dynamic?: string;
  };
  environment: {
    description: string;
    inputs: string[];
    outputs: string[];
  };
  feedback: {
    negative: string[];
    positive: string[];
  };
  hierarchy: {
    subsystems: string[];
    supersystems: string[];
  };
  emergence_examples: string[];
  systems_questions: Array<{
    question: string;
    analysis: string;
  }>;
}

export interface EducationContent {
  featured_topic: {
    title: string;
    summary: string;
    audience: string;
    reading_time: string;
    takeaways: string[];
  };
  primers: Array<{
    title: string;
    focus: string;
    summary: string;
    tags: string[];
  }>;
  scenarios: Array<{
    title: string;
    question: string;
    answer: string;
  }>;
  selected_entity_guide: {
    entity: string;
    why_it_matters: string;
    beginner_angle: string;
    connected_concepts: string[];
  } | null;
}

export interface EditorWorkspace {
  project_id: string;
  entity_id?: string;
  name: string;
  type: string;
  domain: string;
  source: string;
  definition: string;
  properties_text: string;
  layer: 'common' | 'domain' | 'private';
  slug: string;
  json_draft: Record<string, unknown>;
  source_filenames: {
    json: string;
  };
  suggestions: {
    recommended_type: string;
    suggested_relations: string[];
    rdf_preview: string;
    owl_preview: string;
  };
}

export interface EditorPreview {
  summary: string;
  rdf: string;
  owl: string;
  warnings: string[];
  normalized_json: string;
  target_ref: string;
}

export interface EditorCommitResult {
  status: 'success' | 'partial';
  layer?: 'common' | 'domain' | 'private';
  slug?: string;
  ref?: string;
  sourceWrite: {
    filename: string;
    path?: string;
    version_id?: number;
    commit_id?: string;
  };
  exportSummary?: {
    totalEntities: number;
    totalRelations: number;
    documentCount: number;
  };
  updatedEntityId?: string;
  warnings: string[];
  error?: string;
}

export async function fetchKnowledgeGraph(options: { refresh?: boolean; projectId?: string } = {}): Promise<KnowledgeGraphData> {
  return getSharedSessionPromise(knowledgeGraphRequestCache, buildKnowledgeGraphRequestKey(options), async () => {
    const params = new URLSearchParams();
    if (options.refresh) {
      params.set('refresh', '1');
    }
    const projectId = normalizeProjectId(options.projectId);
    if (projectId) {
      params.set('project_id', projectId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await apiFetch(`/api/knowledge-graph${suffix}`);
    return parseJson<KnowledgeGraphData>(response);
  }, options);
}

export function prefetchKnowledgeGraph(options: { refresh?: boolean; projectId?: string } = {}): Promise<KnowledgeGraphData> {
  return fetchKnowledgeGraph(options);
}

export interface KnowledgeGraphSliceResponse {
  viewedRefs: string[];
  missingRefs: string[];
  entities: Entity[];
  crossReferences: Array<{
    source: string;
    target: string;
    relation: string;
    description: string;
  }>;
}

export async function fetchKnowledgeGraphSlice(refs: string[], projectId?: string): Promise<KnowledgeGraphSliceResponse> {
  return getSharedSessionPromise(knowledgeGraphSliceRequestCache, buildKnowledgeGraphSliceRequestKey(refs, projectId), async () => {
    const response = await apiFetch('/api/knowledge-graph/slice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refs, project_id: projectId }),
    });

    return parseJson<KnowledgeGraphSliceResponse>(response);
  });
}

export function prefetchKnowledgeGraphSlice(refs: string[], projectId?: string): Promise<KnowledgeGraphSliceResponse> {
  return fetchKnowledgeGraphSlice(refs, projectId);
}

export async function fetchOntologies(): Promise<{
  philosophicalOntology: OntologyModule;
  formalOntology: OntologyModule;
  scientificOntology: OntologyModule;
}> {
  return getSharedSessionPromise(ontologiesRequestCache, 'ontologies', async () => {
    const response = await apiFetch('/api/ontologies');
    return parseJson(response);
  });
}

export function prefetchOntologies(): Promise<{
  philosophicalOntology: OntologyModule;
  formalOntology: OntologyModule;
  scientificOntology: OntologyModule;
}> {
  return fetchOntologies();
}

export async function searchEntities(query: string, projectId?: string): Promise<Entity[]> {
  const params = new URLSearchParams({ q: query });
  if (projectId?.trim()) {
    params.set('project_id', projectId.trim());
  }
  const response = await apiFetch(`/api/search?${params.toString()}`);
  return parseJson<Entity[]>(response);
}

export async function fetchAnalysis(query: string, entityId?: string): Promise<AnalysisResult> {
  const params = new URLSearchParams({ q: query });
  if (entityId) {
    params.set('entityId', entityId);
  }

  const response = await apiFetch(`/api/analysis?${params.toString()}`);
  return parseJson<AnalysisResult>(response);
}

export async function fetchSystemAnalysis(query: string, entityId?: string): Promise<SystemAnalysisData> {
  const params = new URLSearchParams({ q: query });
  if (entityId) {
    params.set('entityId', entityId);
  }

  const response = await apiFetch(`/api/system-analysis?${params.toString()}`);
  return parseJson<SystemAnalysisData>(response);
}

export async function fetchEducationContent(entityId?: string): Promise<EducationContent> {
  const params = new URLSearchParams();
  if (entityId) {
    params.set('entityId', entityId);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch(`/api/education${suffix}`);
  return parseJson<EducationContent>(response);
}

export async function fetchEditorWorkspace(entityId?: string): Promise<EditorWorkspace> {
  const params = new URLSearchParams();
  if (entityId) {
    params.set('entityId', entityId);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch(`/api/editor/workspace${suffix}`);
  return parseJson<EditorWorkspace>(response);
}

export async function previewEditorDraft(input: {
  entityId?: string;
  mode: 'json';
  layer?: 'common' | 'domain' | 'private';
  slug: string;
  source: unknown;
}): Promise<EditorPreview> {
  const response = await apiFetch('/api/editor/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson<EditorPreview>(response);
}

export async function commitEditorDraft(input: {
  entityId?: string;
  mode: 'json';
  projectId: string;
  layer?: 'common' | 'domain' | 'private';
  slug: string;
  message: string;
  source: unknown;
}): Promise<EditorCommitResult> {
  const validation = validateWorkflowEntityFileData(input.source);
  if (!validation.ok) {
    throw new Error(`写入拦截：仅支持标准工作流实体 JSON。${validation.error}`);
  }

  const response = await apiFetch('/api/editor/commit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const result = await parseJson<EditorCommitResult>(response);
  notifyRepositorySync({ projectId: input.projectId, filename: result.sourceWrite?.filename, source: 'commitEditorDraft' });
  return result;
}
