import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings2,
  Layers,
  PanelRightOpen,
  PanelRightClose,
  Network,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import {
  CUSTOM_MODEL_KEY,
  MODEL_PRESETS,
} from '@/hooks/useOntologyAssistantState';
import {
  fetchKnowledgeGraphSlice,
  type KnowledgeGraphSliceResponse,
} from '@/features/ontology/api';
import {
  fetchAssistantGraphOverlay,
  saveAssistantGraphOverlay,
  type AssistantGraphOverlay,
} from '@/features/assistant/api';
import { cn } from '@/lib/utils';
import type { CrossReference, Entity } from '@/types/ontology';

import { ChatArea } from './assistant/ChatArea';
import { ExecutionFlow } from './assistant/ExecutionFlow';
import { stopPointerEventPropagation } from './assistant/pointerGuards';
import type { ConversationExecutionStage, ConversationSession } from './assistant/types';
import { collectWikimgShowRefs } from './assistant/wikimgGraph';
import { buildAssistantGraphOverlay } from './assistant/toolGraph';

function rawGraphEntityToEntity(node: AssistantGraphOverlay['nodes'][number]): Entity {
  return {
    id: node.entity_id || (node as any).id || node.text || node.normalized_text || '',
    name: node.text || node.normalized_text || node.entity_id,
    type: node.label || '实体',
    domain: '会话补丁',
    layer: 'private',
    level: 2,
    source: 'QAgent Graph Patch',
    definition: node.source_sentence || node.text || node.normalized_text || '',
    properties: {
      confidence: node.confidence ?? null,
      metadata: node.metadata || {},
    },
    display_level: node.display_level,
    visible: node.visible,
    highlight: node.highlight,
    pinned: node.pinned,
    focus: node.focus,
  };
}

function rawGraphRelationToCrossReference(relation: AssistantGraphOverlay['relations'][number]) {
  return {
    source: relation.source_entity_id || relation.source_text || '',
    target: relation.target_entity_id || relation.target_text || '',
    relation: relation.relation_type || '关联',
    description: relation.evidence_sentence || '',
    display_level: relation.display_level,
    visible: relation.visible,
    highlight: relation.highlight,
  };
}

function graphEntityToRaw(entity: Entity): AssistantGraphOverlay['nodes'][number] {
  return {
    entity_id: entity.id,
    text: entity.name,
    normalized_text: entity.name,
    label: entity.type,
    confidence: typeof entity.properties?.confidence === 'number' ? entity.properties.confidence : null,
    source_sentence: entity.definition,
    metadata: entity.properties || {},
    display_level: entity.display_level,
    visible: entity.visible,
    highlight: entity.highlight,
    pinned: entity.pinned,
    focus: entity.focus,
    start: 0,
    end: 0,
  };
}

function graphRelationToRaw(reference: CrossReference & { display_level?: number; visible?: boolean; highlight?: boolean }): AssistantGraphOverlay['relations'][number] {
  return {
    relation_id: `${reference.source}__${reference.target}__${reference.relation}`,
    source_entity_id: reference.source,
    target_entity_id: reference.target,
    source_text: reference.source,
    target_text: reference.target,
    relation_type: reference.relation,
    confidence: null,
    evidence_sentence: reference.description,
    metadata: {},
    display_level: reference.display_level,
    visible: reference.visible,
    highlight: reference.highlight,
  };
}

function buildEntityMergeKey(entity: Entity) {
  return entity.id || entity.name || '';
}

function buildRelationMergeKey(
  relation: CrossReference | { source: string; target: string; relation: string },
) {
  return `${relation.source || ''}__${relation.target || ''}__${relation.relation || '关联'}`;
}

interface AssistantProps {
  activeSession: ConversationSession | null;
  businessPrompt: string;
  isBusy: boolean;
  modelName: string;
  onAsk: (question?: string) => void;
  onBusinessPromptChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  onStop: () => void;
  selectedEntityName?: string;
  executionStages: ConversationExecutionStage[];
}

export function OntologyAssistant({
  activeSession,
  businessPrompt,
  isBusy,
  modelName,
  onAsk,
  onBusinessPromptChange,
  onDraftChange,
  onModelNameChange,
  onUploadFile,
  onStop,
  selectedEntityName,
  executionStages,
}: AssistantProps) {
  const [showFlow, setShowFlow] = useState(false);
  const [draftModelName, setDraftModelName] = useState(modelName);
  const lastPersistedGraphSignatureRef = useRef<string>('');
  const pendingGraphSignatureRef = useRef<string>('');
  const lastLoadedGraphSignatureRef = useRef<string>('');

  useEffect(() => {
    setDraftModelName(modelName);
  }, [modelName]);

  const viewedRefs = useMemo(
    () => collectWikimgShowRefs(activeSession?.messages),
    [activeSession?.messages],
  );
  const [graphSlice, setGraphSlice] = useState<KnowledgeGraphSliceResponse | null>(null);
  const [savedGraphOverlay, setSavedGraphOverlay] = useState<AssistantGraphOverlay | null>(null);
  const assistantGraphOverlay = useMemo(
    () => buildAssistantGraphOverlay(activeSession?.messages.flatMap((message) => message.toolRuns || []) || []),
    [activeSession?.messages],
  );

  useEffect(() => {
    let cancelled = false;

    const resolveRefs = async () => {
      if (viewedRefs.length === 0) {
        setGraphSlice(null);
        return;
      }

      try {
        const slice = await fetchKnowledgeGraphSlice(viewedRefs);
        if (!cancelled) {
          setGraphSlice(slice);
        }
      } catch {
        if (!cancelled) {
          setGraphSlice({
            viewedRefs,
            missingRefs: [],
            entities: [],
            crossReferences: [],
          });
        }
      }
    };

    void resolveRefs();

    return () => {
      cancelled = true;
    };
  }, [viewedRefs]);

  useEffect(() => {
    let cancelled = false;

    const resolveGraphOverlay = async () => {
      if (!activeSession?.id) {
        setSavedGraphOverlay(null);
        pendingGraphSignatureRef.current = '';
        lastLoadedGraphSignatureRef.current = '';
        return;
      }

      try {
        const overlay = await fetchAssistantGraphOverlay(activeSession.id);
        if (!cancelled) {
          const fetchedSignature = JSON.stringify({
            conversationId: overlay.conversationId,
            nodes: overlay.nodes,
            relations: overlay.relations,
          });
          if (pendingGraphSignatureRef.current && fetchedSignature !== pendingGraphSignatureRef.current) {
            return;
          }
          if (fetchedSignature === lastLoadedGraphSignatureRef.current) {
            return;
          }
          setSavedGraphOverlay(overlay);
          lastLoadedGraphSignatureRef.current = fetchedSignature;
          lastPersistedGraphSignatureRef.current = fetchedSignature;
          if (pendingGraphSignatureRef.current === fetchedSignature) {
            pendingGraphSignatureRef.current = '';
          }
        }
      } catch {
        if (!cancelled) {
          setSavedGraphOverlay(null);
          lastPersistedGraphSignatureRef.current = '';
          pendingGraphSignatureRef.current = '';
          lastLoadedGraphSignatureRef.current = '';
        }
      }
    };

    void resolveGraphOverlay();
    const refreshTask = window.setInterval(() => {
      void resolveGraphOverlay();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTask);
    };
  }, [activeSession?.id]);

  const derivedGraphOverlay = useMemo<AssistantGraphOverlay>(() => ({
    version: 1,
    conversationId: activeSession?.id || savedGraphOverlay?.conversationId || '',
    updatedAt: '',
    nodes: assistantGraphOverlay.entities.map((entity) => graphEntityToRaw(entity)),
    relations: assistantGraphOverlay.crossReferences.map((reference) => graphRelationToRaw(reference)),
  }), [activeSession?.id, assistantGraphOverlay.crossReferences, assistantGraphOverlay.entities, savedGraphOverlay?.conversationId]);

  const mergedGraphOverlay = useMemo<AssistantGraphOverlay>(() => {
    const savedNodes = savedGraphOverlay?.nodes || [];
    const savedRelations = savedGraphOverlay?.relations || [];
    const nodeMap = new Map<string, AssistantGraphOverlay['nodes'][number]>();
    for (const node of [...derivedGraphOverlay.nodes, ...savedNodes]) {
      const key = node.entity_id || node.text || node.normalized_text || '';
      if (!key) continue;
      nodeMap.set(key, node);
    }

    const relationMap = new Map<string, AssistantGraphOverlay['relations'][number]>();
    for (const relation of [...derivedGraphOverlay.relations, ...savedRelations]) {
      const key = relation.relation_id
        || `${relation.source_entity_id || relation.source_text || ''}__${relation.target_entity_id || relation.target_text || ''}__${relation.relation_type || '关联'}`;
      relationMap.set(key, relation);
    }

    return {
      version: savedGraphOverlay?.version || 1,
      conversationId: activeSession?.id || savedGraphOverlay?.conversationId || '',
      updatedAt: savedGraphOverlay?.updatedAt || '',
      nodes: [...nodeMap.values()],
      relations: [...relationMap.values()],
    };
  }, [activeSession?.id, derivedGraphOverlay, savedGraphOverlay]);

  const hasGraphSliceEntities = Boolean(graphSlice && graphSlice.entities.length > 0);
  const showKnowledgeGraph = Boolean(hasGraphSliceEntities || mergedGraphOverlay.nodes.length > 0);
  const hasViewCommand = viewedRefs.length > 0;
  const sidePanelWidth = showKnowledgeGraph || hasViewCommand ? 'w-[520px]' : 'w-[340px]';
  const graphEntities = useMemo(() => {
    const baseEntities = graphSlice?.entities ?? [];
    const overlayEntities = mergedGraphOverlay.nodes.map((node) => rawGraphEntityToEntity(node));
    const entityMap = new Map<string, Entity>();

    for (const entity of baseEntities) {
      const key = buildEntityMergeKey(entity);
      if (key) {
        entityMap.set(key, entity);
      }
    }

    for (const entity of overlayEntities) {
      const key = buildEntityMergeKey(entity);
      if (key) {
        entityMap.set(key, entity);
      }
    }

    return [...entityMap.values()];
  }, [graphSlice?.entities, mergedGraphOverlay.nodes]);
  const graphCrossReferences = useMemo(() => {
    const baseCrossReferences = graphSlice?.crossReferences ?? [];
    const overlayCrossReferences = mergedGraphOverlay.relations.map((relation) => rawGraphRelationToCrossReference(relation));
    const relationMap = new Map<string, CrossReference>();

    for (const relation of baseCrossReferences) {
      const key = buildRelationMergeKey(relation);
      if (key) {
        relationMap.set(key, relation);
      }
    }

    for (const relation of overlayCrossReferences) {
      const key = buildRelationMergeKey(relation);
      if (key) {
        relationMap.set(key, relation);
      }
    }

    return [...relationMap.values()];
  }, [graphSlice?.crossReferences, mergedGraphOverlay.relations]);
  const baseGraphViewedRefs = graphSlice?.viewedRefs ?? [];
  const selectedGraphEntityId = graphEntities[0]?.id;

  useEffect(() => {
    if (!activeSession?.id || mergedGraphOverlay.nodes.length === 0 && mergedGraphOverlay.relations.length === 0) {
      return;
    }

    const signature = JSON.stringify({
      conversationId: mergedGraphOverlay.conversationId,
      nodes: mergedGraphOverlay.nodes,
      relations: mergedGraphOverlay.relations,
    });
    if (signature === lastPersistedGraphSignatureRef.current) {
      return;
    }

    const persistTask = window.setTimeout(() => {
      pendingGraphSignatureRef.current = signature;
      void saveAssistantGraphOverlay({
        ...mergedGraphOverlay,
        updatedAt: new Date().toISOString(),
      }).then((overlay) => {
        lastPersistedGraphSignatureRef.current = signature;
        pendingGraphSignatureRef.current = '';
        setSavedGraphOverlay(overlay);
      }).catch(() => {
        pendingGraphSignatureRef.current = '';
      });
    }, 350);

    return () => window.clearTimeout(persistTask);
  }, [activeSession?.id, mergedGraphOverlay]);

  if (!activeSession) {
    return null;
  }

  return (
    <div className="flex h-full max-h-full min-h-0 min-w-0 w-full overflow-hidden bg-background text-foreground">
      {/* Main Chat Area */}
      <div
        className="relative flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden"
        onPointerDownCapture={stopPointerEventPropagation}
      >
        <ChatArea
          activeSession={activeSession}
          onAsk={onAsk}
          onDraftChange={onDraftChange}
          onUploadFile={onUploadFile}
          onStop={onStop}
          isBusy={isBusy}
          selectedEntityName={selectedEntityName}
          renderSettings={() => (
            /* 只放设置栏在左侧 */
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 rounded-2xl border-border bg-card p-5 shadow-2xl" align="start">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-foreground">助手配置</h4>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                      推理引擎
                    </label>
                    <Select
                      value={MODEL_PRESETS.some((preset) => preset.value === draftModelName) ? draftModelName : CUSTOM_MODEL_KEY}
                      onValueChange={(value) => setDraftModelName(value === CUSTOM_MODEL_KEY ? '' : value)}
                    >
                      <SelectTrigger className="h-10 rounded-xl">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {MODEL_PRESETS.map((preset) => (
                          <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_MODEL_KEY}>自定义模型</SelectItem>
                      </SelectContent>
                    </Select>
                    {!MODEL_PRESETS.some((preset) => preset.value === draftModelName) ? (
                      <Input
                        value={draftModelName}
                        onChange={(event) => setDraftModelName(event.target.value)}
                        placeholder="名称..."
                        className="mt-2 h-10 rounded-xl"
                      />
                    ) : null}
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        variant="ghost"
                        className="h-9 rounded-xl"
                        onClick={() => setDraftModelName(modelName)}
                        disabled={draftModelName === modelName}
                      >
                        重置
                      </Button>
                      <Button
                        className="h-9 rounded-xl"
                        onClick={() => onModelNameChange(draftModelName)}
                        disabled={draftModelName === modelName}
                      >
                        保存模型
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                      全局指令 (Prompt)
                    </label>
                    <Textarea
                      value={businessPrompt}
                      onChange={(event) => onBusinessPromptChange(event.target.value)}
                      placeholder="定制助手的行为..."
                      className="min-h-[140px] resize-none rounded-xl text-sm"
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          renderExtraActions={() => (
            /* 执行流程按钮放在右侧 */
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFlow(!showFlow)}
              className={cn(
                "h-8 w-8 rounded-lg transition-all",
                showFlow ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={showFlow ? "关闭执行流程" : "打开执行流程"}
            >
              {showFlow ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          )}
        />
      </div>

      {/* Right Side Panel */}
      <div
        className={cn(
          'shrink-0 h-full transition-all duration-300 ease-in-out overflow-hidden border-l',
          (showKnowledgeGraph || showFlow) ? `${sidePanelWidth} opacity-100` : 'w-0 opacity-0 border-transparent',
        )}
      >
        {showKnowledgeGraph && (graphSlice || mergedGraphOverlay.nodes.length > 0) ? (
          <div
            className="flex h-full w-[520px] flex-col bg-background"
            onPointerDownCapture={stopPointerEventPropagation}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-card px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground/90">
                    知识图谱
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    命中 `./wikimg.sh show`，共 {baseGraphViewedRefs.length} 个节点
                  </div>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                弹出
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <KnowledgeGraph
                entities={graphEntities}
                crossReferences={graphCrossReferences}
                onSelectEntity={() => {}}
                selectedEntityId={selectedGraphEntityId}
              />
            </div>
          </div>
        ) : hasViewCommand ? (
          <div
            className="flex h-full w-[340px] flex-col items-center justify-center gap-3 border-border/40 bg-background px-5 text-center"
            onPointerDownCapture={stopPointerEventPropagation}
          >
            <div className="rounded-full bg-muted/50 p-3">
              <Network className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground/90">
                已识别 `./wikimg.sh show`
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {graphSlice?.missingRefs?.length
                  ? `这些引用在当前 markdown 源中未找到：${graphSlice.missingRefs.join('、')}`
                  : '但当前知识库里没找到可展示的节点。'}
              </div>
            </div>
          </div>
        ) : showFlow ? (
          <div
            className="h-full w-[340px]"
            onPointerDownCapture={stopPointerEventPropagation}
          >
            <ExecutionFlow executionStages={executionStages} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
