import type { Entity, KnowledgeGraphData, OntologyModule } from '@/types/ontology';
import { buildApiUrl, parseJson } from '@/shared/api/http';

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

export interface AboutContent {
  platform: {
    name: string;
    vision: string;
    description: string;
  };
  modules: Array<{
    name: string;
    purpose: string;
    status: string;
  }>;
  workflow: string[];
  roadmap: Array<{
    title: string;
    detail: string;
  }>;
  metrics: {
    provider: string;
    entities: number;
    relations: number;
    domains: number;
    levels: number;
    layers: number;
  };
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
  markdown_draft: string;
  source_filenames: {
    json: string;
    markdown: string;
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
  normalized_markdown: string;
  target_ref: string;
}

export interface EditorCommitResult {
  status: 'success' | 'partial';
  batch?: boolean;
  total?: number;
  layerCounts?: {
    common: number;
    domain: number;
    private: number;
  };
  layer?: 'common' | 'domain' | 'private';
  slug?: string;
  ref?: string;
  sourceWrite: {
    filename: string;
    path?: string;
    version_id?: number;
    commit_id?: string;
  };
  wikiWrite?: {
    path: string;
    ref?: string;
  } | null;
  wikiWrites?: Array<{
    ref: string;
    layer: 'common' | 'domain' | 'private';
    slug: string;
    title?: string;
    warnings?: string[];
    wikiWrite?: {
      path: string;
      ref?: string;
    };
  }>;
  failedWrites?: Array<{
    ref: string;
    layer: 'common' | 'domain' | 'private';
    slug: string;
    title?: string;
    warnings?: string[];
    error: string;
  }>;
  exportSummary?: {
    totalEntities: number;
    totalRelations: number;
    documentCount: number;
  };
  updatedEntityId?: string;
  warnings: string[];
  error?: string;
}

export async function fetchKnowledgeGraph(options: { refresh?: boolean } = {}): Promise<KnowledgeGraphData> {
  const response = await fetch(buildApiUrl(`/api/knowledge-graph${options.refresh ? '?refresh=1' : ''}`));
  return parseJson<KnowledgeGraphData>(response);
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

export async function fetchKnowledgeGraphSlice(refs: string[]): Promise<KnowledgeGraphSliceResponse> {
  const response = await fetch(buildApiUrl('/api/knowledge-graph/slice'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refs }),
  });

  return parseJson<KnowledgeGraphSliceResponse>(response);
}

export async function fetchOntologies(): Promise<{
  philosophicalOntology: OntologyModule;
  formalOntology: OntologyModule;
  scientificOntology: OntologyModule;
}> {
  const response = await fetch(buildApiUrl('/api/ontologies'));
  return parseJson(response);
}

export async function searchEntities(query: string): Promise<Entity[]> {
  const response = await fetch(buildApiUrl(`/api/search?q=${encodeURIComponent(query)}`));
  return parseJson<Entity[]>(response);
}

export async function fetchAnalysis(query: string, entityId?: string): Promise<AnalysisResult> {
  const params = new URLSearchParams({ q: query });
  if (entityId) {
    params.set('entityId', entityId);
  }

  const response = await fetch(buildApiUrl(`/api/analysis?${params.toString()}`));
  return parseJson<AnalysisResult>(response);
}

export async function fetchSystemAnalysis(query: string, entityId?: string): Promise<SystemAnalysisData> {
  const params = new URLSearchParams({ q: query });
  if (entityId) {
    params.set('entityId', entityId);
  }

  const response = await fetch(buildApiUrl(`/api/system-analysis?${params.toString()}`));
  return parseJson<SystemAnalysisData>(response);
}

export async function fetchEducationContent(entityId?: string): Promise<EducationContent> {
  const params = new URLSearchParams();
  if (entityId) {
    params.set('entityId', entityId);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(buildApiUrl(`/api/education${suffix}`));
  return parseJson<EducationContent>(response);
}

export async function fetchAboutContent(): Promise<AboutContent> {
  const response = await fetch(buildApiUrl('/api/about'));
  return parseJson<AboutContent>(response);
}

export async function fetchEditorWorkspace(entityId?: string): Promise<EditorWorkspace> {
  const params = new URLSearchParams();
  if (entityId) {
    params.set('entityId', entityId);
  }

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(buildApiUrl(`/api/editor/workspace${suffix}`));
  return parseJson<EditorWorkspace>(response);
}

export async function previewEditorDraft(input: {
  entityId?: string;
  mode: 'json' | 'markdown';
  layer?: 'common' | 'domain' | 'private';
  slug: string;
  source: unknown;
}): Promise<EditorPreview> {
  const response = await fetch(buildApiUrl('/api/editor/preview'), {
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
  mode: 'json' | 'markdown';
  projectId: string;
  layer?: 'common' | 'domain' | 'private';
  slug: string;
  message: string;
  source: unknown;
}): Promise<EditorCommitResult> {
  const response = await fetch(buildApiUrl('/api/editor/commit'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJson<EditorCommitResult>(response);
}
