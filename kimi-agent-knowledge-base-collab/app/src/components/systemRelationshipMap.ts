import type { CrossReference, Entity } from '@/types/ontology';

export interface SystemStructureNode {
  id: string;
  name: string;
  entity: Entity | null;
  source: 'selected' | 'relation' | 'property';
  children: SystemStructureNode[];
}

export interface SystemDependencyEdge {
  source: string;
  target: string;
  relation: string;
  description: string;
}

export interface SystemDependencyCluster {
  parentId: string;
  parentName: string;
  nodes: Array<{
    id: string;
    name: string;
    entity: Entity | null;
  }>;
  edges: SystemDependencyEdge[];
}

export interface SystemRelationshipMap {
  root: SystemStructureNode;
  supersystems: string[];
  dependencyClusters: SystemDependencyCluster[];
  containmentCount: number;
  dependencyCount: number;
}

const FORWARD_CONTAINMENT_KEYWORDS = [
  '包含',
  '包括',
  '组成',
  '构成',
  '子系统',
  '模块',
  'component',
  'components',
  'contain',
  'contains',
  'haspart',
  'has_part',
  'subsystem',
];

const REVERSE_CONTAINMENT_KEYWORDS = [
  '属于',
  '隶属',
  '从属',
  'partof',
  'part_of',
  'memberof',
  'member_of',
];

const DEPENDENCY_KEYWORDS = [
  '依赖',
  '支撑',
  '调用',
  '控制',
  '约束',
  '输入',
  '输出',
  '供能',
  '通信',
  '连接',
  'uses',
  'use',
  'depend',
  'depends',
  'support',
  'supports',
];

const PROPERTY_CHILD_KEYS = ['components', 'subsystems', 'parts', 'modules', 'children'];

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[\s_\-()/\\]+/g, '');
}

function isTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function classifyRelation(relation: string): 'contains' | 'contained_by' | 'dependency' | null {
  const normalized = normalizeToken(relation);
  if (!normalized) {
    return null;
  }

  if (FORWARD_CONTAINMENT_KEYWORDS.some((keyword) => normalized.includes(normalizeToken(keyword)))) {
    return 'contains';
  }

  if (REVERSE_CONTAINMENT_KEYWORDS.some((keyword) => normalized.includes(normalizeToken(keyword)))) {
    return 'contained_by';
  }

  if (DEPENDENCY_KEYWORDS.some((keyword) => normalized.includes(normalizeToken(keyword)))) {
    return 'dependency';
  }

  return null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function resolveEntityByName(name: string, entityByName: Map<string, Entity>) {
  return entityByName.get(normalizeToken(name)) ?? null;
}

function getPropertyChildren(
  entity: Entity,
  entityByName: Map<string, Entity>,
): Array<{ id: string; name: string; entity: Entity | null; source: 'property' }> {
  const children: Array<{ id: string; name: string; entity: Entity | null; source: 'property' }> = [];

  for (const key of PROPERTY_CHILD_KEYS) {
    const raw = entity.properties?.[key];
    if (!isTextArray(raw)) {
      continue;
    }

    for (const item of raw) {
      const name = item.trim();
      if (!name) {
        continue;
      }

      const matchedEntity = resolveEntityByName(name, entityByName);
      children.push({
        id: matchedEntity?.id ?? `property:${entity.id}:${normalizeToken(name)}`,
        name,
        entity: matchedEntity,
        source: 'property',
      });
    }
  }

  const hierarchyRaw = entity.properties?.hierarchy;
  if (isTextArray(hierarchyRaw)) {
    for (const chain of hierarchyRaw) {
      const parts = chain
        .split(/→|->|›|>/g)
        .map((item) => item.trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        const name = parts[1];
        const matchedEntity = resolveEntityByName(name, entityByName);
        children.push({
          id: matchedEntity?.id ?? `property:${entity.id}:${normalizeToken(name)}`,
          name,
          entity: matchedEntity,
          source: 'property',
        });
      }
    }
  }

  return children.filter((child, index, array) => array.findIndex((item) => item.id === child.id) === index);
}

export function buildSystemRelationshipMap(
  selectedEntity: Entity | null | undefined,
  entities: Entity[],
  crossReferences: CrossReference[],
): SystemRelationshipMap | null {
  if (!selectedEntity) {
    return null;
  }

  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const entityByName = new Map(
    entities.map((entity) => [normalizeToken(entity.name), entity] as const),
  );

  const childrenByParent = new Map<string, Array<{ id: string; source: 'relation' }>>();
  const supersystemNames = new Set<string>();
  const dependencies: SystemDependencyEdge[] = [];

  for (const edge of crossReferences) {
    if (edge.source === edge.target) {
      continue;
    }

    const relationKind = classifyRelation(edge.relation);
    if (relationKind === 'contains') {
      const list = childrenByParent.get(edge.source) ?? [];
      list.push({ id: edge.target, source: 'relation' });
      childrenByParent.set(edge.source, list);
      if (edge.target === selectedEntity.id) {
        const parentEntity = entityById.get(edge.source);
        supersystemNames.add(parentEntity?.name ?? edge.source);
      }
      continue;
    }

    if (relationKind === 'contained_by') {
      const list = childrenByParent.get(edge.target) ?? [];
      list.push({ id: edge.source, source: 'relation' });
      childrenByParent.set(edge.target, list);
      if (edge.source === selectedEntity.id) {
        const parentEntity = entityById.get(edge.target);
        supersystemNames.add(parentEntity?.name ?? edge.target);
      }
      continue;
    }

    if (relationKind === 'dependency') {
      dependencies.push({
        source: edge.source,
        target: edge.target,
        relation: edge.relation,
        description: edge.description,
      });
    }
  }

  const dependencyClusters: SystemDependencyCluster[] = [];
  let containmentCount = 0;

  const buildNode = (
    nodeId: string,
    source: SystemStructureNode['source'],
    path: Set<string>,
    fallbackName?: string,
  ): SystemStructureNode | null => {
    if (path.has(nodeId)) {
      return null;
    }

    const entity = entityById.get(nodeId) ?? null;
    const nodeName = entity?.name ?? fallbackName ?? nodeId;
    const nextPath = new Set(path);
    nextPath.add(nodeId);

    const relationChildren = (childrenByParent.get(nodeId) ?? [])
      .map((child) => ({
        id: child.id,
        name: entityById.get(child.id)?.name ?? child.id,
        entity: entityById.get(child.id) ?? null,
        source: child.source,
      }));

    const propertyChildren = entity ? getPropertyChildren(entity, entityByName) : [];
    const directChildren = [...relationChildren, ...propertyChildren]
      .filter((child) => child.id !== nodeId)
      .filter((child, index, array) => array.findIndex((item) => item.id === child.id) === index);

    const children = directChildren
      .map((child) => buildNode(child.id, child.source, nextPath, child.name))
      .filter((child): child is SystemStructureNode => child !== null);

    containmentCount += children.length;

    if (children.length > 1) {
      const childIds = new Set(children.map((child) => child.id));
      const clusterEdges = dependencies.filter((edge) => childIds.has(edge.source) && childIds.has(edge.target));
      if (clusterEdges.length > 0) {
        dependencyClusters.push({
          parentId: nodeId,
          parentName: nodeName,
          nodes: children.map((child) => ({
            id: child.id,
            name: child.name,
            entity: child.entity,
          })),
          edges: clusterEdges,
        });
      }
    }

    return {
      id: nodeId,
      name: nodeName,
      entity,
      source,
      children,
    };
  };

  const root = buildNode(selectedEntity.id, 'selected', new Set(), selectedEntity.name);
  if (!root) {
    return null;
  }

  const visibleNodeIds = new Set<string>();
  const collectVisibleNodeIds = (node: SystemStructureNode) => {
    visibleNodeIds.add(node.id);
    node.children.forEach(collectVisibleNodeIds);
  };
  collectVisibleNodeIds(root);

  const dependencyCount = dependencies.filter((edge) => (
    visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  )).length;

  return {
    root,
    supersystems: uniqueStrings([...supersystemNames]),
    dependencyClusters,
    containmentCount,
    dependencyCount,
  };
}
