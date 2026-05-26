import { useMemo } from 'react';
import { Boxes } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { buildSystemRelationshipMap } from '@/components/systemRelationshipMap';
import type { CrossReference, Entity } from '@/types/ontology';

interface SystemRelationshipPanelProps {
  entities: Entity[];
  crossReferences: CrossReference[];
  selectedEntity?: Entity | null;
  onSelectEntity?: (entity: Entity) => void;
  className?: string;
  emptyMessage?: string;
  maxDepth?: number;
}

export function SystemRelationshipPanel({
  entities,
  crossReferences,
  selectedEntity,
  onSelectEntity,
  className,
  emptyMessage = '请先在左侧图谱中选择一个节点，系统结构视图会以该节点作为根系统展开。',
  maxDepth = 1,
}: SystemRelationshipPanelProps) {
  const relationshipMap = useMemo(() => (
    buildSystemRelationshipMap(selectedEntity ?? null, entities, crossReferences)
  ), [crossReferences, entities, selectedEntity]);

  const renderStructureNode = (node: NonNullable<typeof relationshipMap>['root'], depth: number = 0) => {
    const isRoot = depth === 0;
    const isEntityNode = Boolean(node.entity);
    const hasReachedDepthLimit = depth >= maxDepth;
    const visibleChildren = hasReachedDepthLimit ? [] : node.children;

    return (
      <div
        key={node.id}
        className={cn(
          'min-w-0 overflow-hidden rounded-3xl border p-4 transition-colors',
          isRoot
            ? 'border-primary/30 bg-primary/5 shadow-sm'
            : 'border-border/60 bg-background/80',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {isEntityNode ? (
            <button
              type="button"
              className="max-w-full min-w-0 flex-1 text-left text-sm font-bold tracking-tight text-foreground whitespace-normal break-words leading-snug hover:text-primary"
              onClick={() => node.entity && onSelectEntity?.(node.entity)}
            >
              {node.name}
            </button>
          ) : (
            <span className="max-w-full min-w-0 flex-1 text-sm font-bold tracking-tight text-foreground whitespace-normal break-words leading-snug">{node.name}</span>
          )}
          <Badge variant="outline" className="max-w-full whitespace-normal break-all rounded-full text-center text-[10px] uppercase tracking-widest leading-snug">
            {isRoot ? '根系统' : node.source === 'relation' ? '关系推导' : '属性推导'}
          </Badge>
          {node.entity ? <Badge variant="secondary" className="max-w-full whitespace-normal break-all text-center leading-snug">{node.entity.type}</Badge> : null}
          {node.entity?.domain ? <Badge variant="outline" className="max-w-full whitespace-normal break-all text-center leading-snug">{node.entity.domain}</Badge> : null}
        </div>

        {visibleChildren.length > 0 ? (
          <div className={cn('mt-4 grid gap-3', depth === 0 ? 'md:grid-cols-2' : 'grid-cols-1')}>
            {visibleChildren.map((child) => renderStructureNode(child, depth + 1))}
          </div>
        ) : node.children.length > 0 && hasReachedDepthLimit ? (
          <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/70 p-3 text-xs text-muted-foreground">
            已达到展示深度上限，当前节点下还有 {node.children.length} 个下级节点未展开。
          </div>
        ) : (
          <p className="mt-3 break-words text-xs text-muted-foreground">
            该节点当前没有继续向下展开的显式包含信息。
          </p>
        )}
      </div>
    );
  };

  if (!selectedEntity) {
    return (
      <Card className={cn('border-border/60 bg-card/80', className)}>
        <CardContent className="pt-6">
          <div className="rounded-2xl border border-dashed border-border bg-background/70 p-5 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">包含边</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted/40 p-3 text-2xl font-black tracking-tight">
              {relationshipMap?.containmentCount ?? 0}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">来自“包含/组成/components/subsystems”等显式信息。</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">依赖边</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted/40 p-3 text-2xl font-black tracking-tight">
              {relationshipMap?.dependencyCount ?? 0}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">统计当前系统展开范围内的依赖、支撑、调用等关系。</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Boxes className="w-5 h-5 text-primary" />
            系统结构示意
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              选中的图谱节点会作为根系统；嵌套框表示包含关系，同级依赖会在下方单独列出。
            </p>
            <Badge variant="outline" className="rounded-full text-[10px] uppercase tracking-widest">
              最深显示 {maxDepth + 1} 层
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            当前视图会限制继续下钻，避免层级过深时卡片过窄、文字出框。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {relationshipMap ? renderStructureNode(relationshipMap.root) : (
            <div className="rounded-2xl border border-dashed border-border bg-background/70 p-5 text-sm text-muted-foreground">
              当前未能从所选实体中提取出明确的包含结构，请先选择一个更具体的系统节点，或补充“包含 / 组成 / 依赖”关系。
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">上位系统</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(relationshipMap?.supersystems.length ?? 0) > 0 ? relationshipMap?.supersystems.map((item) => (
              <div key={item} className="rounded-lg bg-muted/40 p-3 text-sm break-words">{item}</div>
            )) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
                当前没有识别到显式上位系统。
              </div>
            )}
          </CardContent>
        </Card>

        {(relationshipMap?.dependencyClusters.length ?? 0) > 0 ? relationshipMap?.dependencyClusters.map((cluster) => (
          <Card key={cluster.parentId}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{cluster.parentName} 内部依赖</CardTitle>
              <p className="text-sm text-muted-foreground">
                仅显示同一父系统下节点之间的依赖关系，避免跨层级连线搅乱结构。
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {cluster.nodes.map((node) => (
                  <Badge key={node.id} variant="outline" className="max-w-full whitespace-normal break-all rounded-full px-3 py-1 text-center leading-snug">
                    {node.name}
                  </Badge>
                ))}
              </div>

              <div className="space-y-3">
                {cluster.edges.map((edge) => {
                  const sourceNode = cluster.nodes.find((node) => node.id === edge.source);
                  const targetNode = cluster.nodes.find((node) => node.id === edge.target);
                  if (!sourceNode || !targetNode) {
                    return null;
                  }

                  return (
                    <div key={`${cluster.parentId}:${edge.source}:${edge.target}:${edge.relation}`} className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-background/70 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <button
                          type="button"
                          className="max-w-[38%] whitespace-normal break-words rounded-full border border-sky-500/20 bg-sky-500/5 px-3 py-1 text-left text-xs font-bold leading-snug text-sky-700 transition-colors hover:bg-sky-500/10 dark:text-sky-300"
                          onClick={() => sourceNode.entity && onSelectEntity?.(sourceNode.entity)}
                        >
                          {sourceNode.name}
                        </button>
                        <div className="h-px flex-1 bg-gradient-to-r from-sky-400/60 to-violet-400/60" />
                        <Badge variant="secondary" className="max-w-[24%] whitespace-normal break-all shrink-0 rounded-full text-center leading-snug">{edge.relation}</Badge>
                        <div className="h-px flex-1 bg-gradient-to-r from-violet-400/60 to-emerald-400/60" />
                        <button
                          type="button"
                          className="max-w-[38%] whitespace-normal break-words rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-left text-xs font-bold leading-snug text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
                          onClick={() => targetNode.entity && onSelectEntity?.(targetNode.entity)}
                        >
                          {targetNode.name}
                        </button>
                      </div>
                      {edge.description ? (
                        <p className="mt-2 break-words text-xs text-muted-foreground">{edge.description}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )) : (
          <Card>
            <CardContent className="pt-6">
              <div className="rounded-2xl border border-dashed border-border bg-background/70 p-5 text-sm text-muted-foreground">
                当前系统展开范围内还没有检测到同级依赖关系。若补充“依赖 / 支撑 / 调用 / 控制”等关系，这里会自动显示连线。
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
