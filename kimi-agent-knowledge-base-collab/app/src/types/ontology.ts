// 本体论知识库类型定义

export type KnowledgeLayer = 'common' | 'domain' | 'private';

export interface MarkdownInlineToken {
  type: 'text' | 'link' | 'code' | 'strong' | 'emphasis';
  text: string;
  href?: string;
  target_ref?: string;
  external?: boolean;
}

export interface MarkdownListItem {
  text: string;
  tokens?: MarkdownInlineToken[];
  checked?: boolean;
}

export interface MarkdownTableCell {
  text: string;
  tokens?: MarkdownInlineToken[];
}

export interface MarkdownBlock {
  type: 'paragraph' | 'heading' | 'list' | 'ordered_list' | 'checklist' | 'quote' | 'callout' | 'code' | 'table';
  text?: string;
  tokens?: MarkdownInlineToken[];
  items?: MarkdownListItem[];
  language?: string;
  level?: number;
  tone?: string;
  title?: string;
  header?: MarkdownTableCell[];
  rows?: MarkdownTableCell[][];
}

export interface FormattedSection {
  title: string;
  blocks: MarkdownBlock[];
}

export interface AblationData {
  entity_id?: string;
  entity_name?: string;
  impact_level?: string;
  impact_reason?: string;
  system_risk?: string;
  remove_target?: string;
  retain_target?: string;
  keep_role?: string;
  remove_impact?: string;
  observation?: string;
  evidence?: string;
  keep_probability?: string;
  remove_probability?: string;
  probability_gap?: string;
  judge_reason?: string;
  small_reason?: true;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  domain: string;
  layer: KnowledgeLayer;
  level?: number;
  source: string;
  definition: string;
  properties: Record<string, any>;
  ablation?: AblationData | null;
  formatted_sections?: FormattedSection[];
  display_level?: number;
  visible?: boolean;
  highlight?: boolean;
  pinned?: boolean;
  focus?: boolean;
}

export interface Relation {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  description?: string;
}

export interface HierarchyNode {
  id: string;
  name: string;
  level: number;
  children?: HierarchyNode[];
  entity?: Entity;
}

export interface DomainInfo {
  name: string;
  description: string;
  count: number;
}

export interface KnowledgeGraphData {
  metadata: {
    title: string;
    version: string;
    description: string;
  };
  statistics: {
    total_entities: number;
    total_relations: number;
    domains: string[];
    levels: number[];
    sources?: string[];
    layers: KnowledgeLayer[];
    layer_counts: Partial<Record<KnowledgeLayer, number>>;
  };
  entity_index: Record<string, Entity>;
  cross_references: CrossReference[];
}

export interface CrossReference {
  source: string;
  target: string;
  relation: string;
  description: string;
  display_level?: number;
  visible?: boolean;
  highlight?: boolean;
}

export interface OntologyModule {
  metadata: {
    title: string;
    created_by: string;
    version: string;
    description: string;
  };
}

export type ViewMode = 'hierarchy' | 'graph' | 'list' | 'detail';
export type DomainFilter = 'all' | 'philosophy' | 'formal' | 'science';
