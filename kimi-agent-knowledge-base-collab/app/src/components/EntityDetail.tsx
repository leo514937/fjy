import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { BookOpen, Layers, Atom, Tag, Link2, FileText, History } from 'lucide-react';
import type { Entity, KnowledgeLayer } from '@/types/ontology';
import { MarkdownBlocks } from '@/components/MarkdownBlocks';
import { EntityTimelinePanel } from '@/components/EntityTimelinePanel';

interface EntityDetailProps {
  entity: Entity | null;
  relatedEntities?: Entity[];
  onSelectRelated?: (entity: Entity) => void;
}

const typeIcons: Record<string, React.ReactNode> = {
  '哲学概念': <BookOpen className="w-5 h-5" />,
  '形式概念': <Layers className="w-5 h-5" />,
  '科学概念': <Atom className="w-5 h-5" />,
};

const levelColors: Record<number, string> = {
  1: 'bg-[#99AF91]/10 text-[#768A6F]', // Match Common
  2: 'bg-[#4F83C3]/10 text-[#345C8F]', // Match Domain
  3: 'bg-[#C19292]/10 text-[#9B6D6D]', // Match Private
  4: 'bg-purple-500/10 text-purple-400',
  5: 'bg-pink-500/10 text-pink-400',
  6: 'bg-indigo-500/10 text-indigo-400',
};

const layerBadgeClasses: Record<KnowledgeLayer, string> = {
  common: 'bg-[#99AF91]/10 text-[#768A6F] border-none',
  domain: 'bg-[#4F83C3]/10 text-[#345C8F] border-none',
  private: 'bg-[#C19292]/10 text-[#9B6D6D] border-none',
};

const layerLabels: Record<KnowledgeLayer, string> = {
  common: 'Common',
  domain: 'Domain',
  private: 'Private',
};

function formatPrimitiveValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderStructuredValue(value: unknown, path: string): React.ReactNode {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-sm leading-relaxed text-foreground/85 break-all">{formatPrimitiveValue(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-muted-foreground">空数组</span>;
    }

    const allPrimitive = value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
    if (allPrimitive) {
      return (
        <div className="flex flex-wrap gap-2">
          {value.map((item, index) => (
            <Badge key={`${path}-${index}`} variant="secondary" className="rounded-md max-w-full whitespace-normal break-all">
              {formatPrimitiveValue(item)}
            </Badge>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {value.map((item, index) => (
          <div key={`${path}-${index}`} className="rounded-xl border border-border/40 bg-background/60 p-4">
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              #{index + 1}
            </div>
            {renderStructuredValue(item, `${path}.${index}`)}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-sm text-muted-foreground">空对象</span>;
    }

    return (
      <div className="space-y-3">
        {entries.map(([childKey, childValue]) => (
          <div key={`${path}.${childKey}`} className="rounded-xl border border-border/40 bg-background/60 p-4">
            <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground break-all">
              {childKey}
            </div>
            {renderStructuredValue(childValue, `${path}.${childKey}`)}
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-sm leading-relaxed text-foreground/85 break-all">{String(value)}</span>;
}

export function EntityDetail({ entity, relatedEntities = [], onSelectRelated }: EntityDetailProps) {
  // 核心去重逻辑：同时根据 ID 和 Name 进行去重，确保视觉上无重复项
  const uniqueRelatedEntities = useMemo(() => {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    return relatedEntities.filter((item) => {
      // 如果 ID 或 Name 已经存在，则过滤掉
      if (item.id && seenIds.has(item.id)) return false;
      if (item.name && seenNames.has(item.name)) return false;

      if (item.id) seenIds.add(item.id);
      if (item.name) seenNames.add(item.name);
      return true;
    });
  }, [relatedEntities]);

  if (!entity) {
    return (
      <Card className="h-full">
        <CardContent className="flex flex-col items-center justify-center h-96 text-muted-foreground">
          <BookOpen className="w-16 h-16 mb-4 opacity-50" />
          <p>选择一个实体查看详情</p>
        </CardContent>
      </Card>
    );
  }

  const formattedSections = entity.formatted_sections || [];
  const definitionSection = formattedSections.find((section) => section.title === '定义与定位');
  const propertySection = formattedSections.find((section) => section.title === '属性');
  const evidenceSection = formattedSections.find((section) => section.title === '证据来源');
  const relatedTopicSection = formattedSections.find((section) => section.title === '关联主题');
  const extraSections = formattedSections.filter((section) => !['定义与定位', '属性', '证据来源', '关联主题', ''].includes(section.title));
  const propertyEntries = Object.entries(entity.properties || {});
  const entityJsonData = useMemo(() => {
    const payload = {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      domain: entity.domain,
      layer: entity.layer,
      level: entity.level,
      source: entity.source,
      definition: entity.definition,
      properties: entity.properties,
      formatted_sections: entity.formatted_sections,
      display_level: entity.display_level,
      visible: entity.visible,
      highlight: entity.highlight,
      pinned: entity.pinned,
      focus: entity.focus,
    };

    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => {
        if (value === undefined || value === null) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
      }),
    );
  }, [entity]);

  const handleSelectEntityRef = (ref: string) => {
    const target = uniqueRelatedEntities.find((related) => related.id === ref);
    if (target) {
      onSelectRelated?.(target);
    }
  };

  return (
    <div className="h-full">
      <Card className="overflow-hidden border-border shadow-sm rounded-3xl">
        <CardHeader className="pb-5 border-b bg-card p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-4 bg-primary/10 rounded-2xl shrink-0">
                {typeIcons[entity.type] || <BookOpen className="w-6 h-6 text-primary" />}
              </div>
              <div>
                <CardTitle className="text-3xl font-black tracking-tight">{entity.name}</CardTitle>
                <CardDescription className="mt-2 text-sm font-medium text-muted-foreground max-w-2xl leading-relaxed">
                  当前节点的定义、属性、关联和来源都来自 本体知识库 文档导出的结构化内容。
                </CardDescription>
                <div className="flex items-center gap-2 mt-4">
                  <Badge variant="outline" className="rounded-lg font-bold">{entity.type}</Badge>
                  <Badge variant="secondary" className="rounded-lg font-bold">{entity.domain}</Badge>
                  <Badge className={`${layerBadgeClasses[entity.layer]} rounded-lg font-bold`}>
                    {layerLabels[entity.layer]}
                  </Badge>
                  {entity.level && (
                    <Badge className={`${levelColors[entity.level]} rounded-lg font-bold`}>
                      层次 {entity.level}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 工业级高密度指标列表 - 垂直布局 */}
          <div className="mt-8 flex flex-col gap-4 px-6 py-5 rounded-2xl border border-border/40 bg-muted/10 backdrop-blur-md shadow-inner">
            <div className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-background/50 border border-border/40 flex items-center justify-center shadow-sm group-hover:border-primary/40 transition-colors">
                  <BookOpen className="w-5 h-5 text-primary/80" />
                </div>
                <span className="text-[13px] font-black text-foreground/80 tracking-tight">来源文档</span>
              </div>
              <span className="text-xs font-bold text-foreground/90 truncate max-w-[200px]" title={entity.source}>{entity.source}</span>
            </div>

            <Separator className="bg-border/20" />

            <div className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-background/50 border border-border/40 flex items-center justify-center shadow-sm group-hover:border-primary/40 transition-colors">
                  <Layers className="w-5 h-5 text-primary/80" />
                </div>
                <span className="text-[13px] font-black text-foreground/80 tracking-tight">存储层级</span>
              </div>
              <Badge className={`${layerBadgeClasses[entity.layer]} rounded-md font-bold text-[10px] px-2`}>
                {layerLabels[entity.layer]}
              </Badge>
            </div>

            <Separator className="bg-border/20" />

            <div className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-background/50 border border-border/40 flex items-center justify-center shadow-sm group-hover:border-primary/40 transition-colors">
                  <Tag className="w-5 h-5 text-primary/80" />
                </div>
                <span className="text-[13px] font-black text-foreground/80 tracking-tight">核心属性</span>
              </div>
              <span className="text-xs font-bold text-foreground/90">{propertyEntries.length} 组</span>
            </div>

            <Separator className="bg-border/20" />

            <div className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-background/50 border border-border/40 flex items-center justify-center shadow-sm group-hover:border-primary/40 transition-colors">
                  <Link2 className="w-5 h-5 text-primary/80" />
                </div>
                <span className="text-[13px] font-black text-foreground/80 tracking-tight">相关实体</span>
              </div>
              <span className="text-xs font-bold text-foreground/90">{uniqueRelatedEntities.length} 个</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8 p-8 pb-12">
          {/* 定义 */}
          <section>
            <h4 className="font-black text-xs text-muted-foreground/60 uppercase tracking-widest mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              语义定义与定位
            </h4>
            <div className="bg-muted/10 p-6 rounded-2xl border border-border/40">
              {definitionSection && definitionSection.blocks.length > 0 ? (
                <MarkdownBlocks
                  blocks={definitionSection.blocks}
                  onSelectEntityRef={handleSelectEntityRef}
                />
              ) : (
                <p className="text-[17px] leading-[1.8] text-foreground font-medium tracking-tight">
                  {entity.definition || '暂无定义'}
                </p>
              )}
            </div>
          </section>

          <Separator className="opacity-50" />

          {/* 属性 */}
          {(propertySection?.blocks.length || (entity.properties && Object.keys(entity.properties).length > 0)) && (
            <>
              <section>
                <h4 className="font-black text-xs text-muted-foreground/60 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  属性特征
                </h4>
                {propertySection && propertySection.blocks.length > 0 ? (
                  <div className="rounded-2xl border border-border/40 bg-muted/10 p-6">
                    <MarkdownBlocks
                      blocks={propertySection.blocks}
                      onSelectEntityRef={handleSelectEntityRef}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {propertyEntries.map(([key, value]) => (
                      <div key={key} className="bg-card p-5 rounded-2xl border border-border shadow-sm">
                        <span className="text-[10px] text-muted-foreground font-black uppercase tracking-widest">
                          {key}
                        </span>
                        <div className="mt-3">
                          {renderStructuredValue(value, `properties.${key}`)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <Separator className="opacity-50" />
            </>
          )}

          <section>
            <h4 className="font-black text-xs text-muted-foreground/60 uppercase tracking-widest mb-4 flex items-center gap-2">
              <History className="w-4 h-4" />
              节点数据 JSON
            </h4>
            <div className="rounded-2xl border border-border/40 bg-muted/10 p-6 space-y-4">
              <p className="text-xs leading-6 text-muted-foreground">
                此处按当前节点实际 JSON 结构递归展示，新增字段、数组或嵌套对象会自动适配，不再依赖写死属性。
              </p>
              {renderStructuredValue(entityJsonData, 'entity')}
            </div>
          </section>
          <Separator className="opacity-50" />

          {evidenceSection && evidenceSection.blocks.length > 0 && (
            <>
              <section>
                <h4 className="font-black text-xs text-muted-foreground/60 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  证据来源
                </h4>
                <div className="rounded-2xl border border-border/40 bg-muted/10 p-6">
                  <MarkdownBlocks
                    blocks={evidenceSection.blocks}
                    onSelectEntityRef={handleSelectEntityRef}
                  />
                </div>
              </section>
              <Separator className="opacity-50" />
            </>
          )}

          {relatedTopicSection && relatedTopicSection.blocks.length > 0 && (
            <>
              <section>
                <h4 className="font-black text-xs text-muted-foreground/60 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Link2 className="w-4 h-4" />
                  Markdown 关联主题
                </h4>
                <div className="rounded-2xl border border-border/40 bg-muted/10 p-6">
                  <MarkdownBlocks
                    blocks={relatedTopicSection.blocks}
                    onSelectEntityRef={handleSelectEntityRef}
                  />
                </div>
              </section>
              <Separator className="opacity-50" />
            </>
          )}

          {/* 相关实体 */}
          {uniqueRelatedEntities.length > 0 && (
            <>
              <section>
                <h4 className="font-black text-xs text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Link2 className="w-4 h-4" />
                  相关实体 ({uniqueRelatedEntities.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {uniqueRelatedEntities.map((related) => (
                    <Badge
                      key={related.id}
                      variant="outline"
                      className="cursor-pointer rounded-full px-4 py-2 hover:bg-primary/10 hover:border-primary transition-all font-bold text-foreground/70 border-border"
                      onClick={() => onSelectRelated?.(related)}
                    >
                      {related.name}
                    </Badge>
                  ))}
                </div>
              </section>
              <Separator className="opacity-50" />
            </>
          )}

          {extraSections.length > 0 ? (
            <>
              {extraSections.map((section) => (
                <section key={section.title}>
                  <h4 className="font-black text-xs text-slate-400 uppercase tracking-widest mb-4">
                    {section.title}
                  </h4>
                  <div className="rounded-2xl border border-border/40 bg-muted/20 p-6">
                    <MarkdownBlocks
                      blocks={section.blocks}
                      onSelectEntityRef={handleSelectEntityRef}
                    />
                  </div>
                </section>
              ))}
              <Separator className="opacity-50" />
            </>
          ) : null}

          <section>
            <h4 className="font-black text-xs text-muted-foreground/60 uppercase tracking-widest mb-4 flex items-center gap-2">
              <History className="w-4 h-4" />
              实体时间线
            </h4>
            <EntityTimelinePanel entity={entity} />
          </section>

          <Separator className="opacity-50" />

          {/* 元信息 */}
          <footer className="rounded-2xl border border-dashed border-border bg-muted/10 p-6 pb-10 text-[10px] font-bold text-muted-foreground uppercase tracking-widest space-y-1">
            <p>Node ID: {entity.id}</p>
            <p>Full Source: {entity.source}</p>
            <p>Knowledge Domain: {entity.domain}</p>
            <p>Storage Layer: {layerLabels[entity.layer]}</p>
          </footer>

          {/* 底部留白，防止滚动到底部时被横条遮挡 */}
          <div className="h-12" />
        </CardContent>
      </Card>
    </div>
  );
}
