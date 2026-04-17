import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Braces, FileCode2, Maximize2, RefreshCw, Sparkles, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  commitEditorDraft,
  fetchEditorWorkspace,
  type EditorCommitResult,
} from '@/features/ontology/api';
import { useOntologyContext } from '@/features/ontology/useOntologyContext';

type EditorMode = 'json' | 'markdown';
type CommitState = {
  status: 'idle' | 'saving' | 'success' | 'partial' | 'error';
  message: string;
  ref?: string;
  refs?: string[];
};

interface GraphIngestPanelProps {
  onSourceCommitted: (projectId: string, filename: string) => Promise<void> | void;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatBatchSummary(result: EditorCommitResult): string {
  const counts = result.layerCounts || { common: 0, domain: 0, private: 0 };
  return `本次入库 ${result.total || result.wikiWrites?.length || 0} 条：common ${counts.common || 0}、domain ${counts.domain || 0}、private ${counts.private || 0}`;
}

function hasBatchItems(source: unknown): boolean {
  if (Array.isArray(source)) {
    return true;
  }
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && Array.isArray((source as { items?: unknown }).items)
  );
}

function dirnameSlug(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  if (!normalized.includes('/')) {
    return normalized;
  }
  return normalized.split('/').slice(0, -1).join('/');
}

function CommitStatus({ state, className }: { state: CommitState; className?: string }) {
  if (state.status === 'idle') {
    return null;
  }

  return (
    <div className={cn(
      "rounded-lg border px-3 py-2 font-bold leading-relaxed",
      state.status === 'success' && "border-emerald-500/30 bg-emerald-500/5 text-emerald-700",
      state.status === 'partial' && "border-amber-500/30 bg-amber-500/5 text-amber-700",
      state.status === 'error' && "border-destructive/30 bg-destructive/5 text-destructive",
      state.status === 'saving' && "border-primary/20 bg-primary/5 text-primary",
      className,
    )}>
      <div>{state.message}</div>
      {state.refs && state.refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {state.refs.slice(0, 8).map((ref) => (
            <Badge key={ref} variant="outline" className="h-5 rounded-md bg-background/60 px-1.5 text-[9px] font-mono">
              {ref}
            </Badge>
          ))}
          {state.refs.length > 8 && (
            <Badge variant="outline" className="h-5 rounded-md bg-background/60 px-1.5 text-[9px]">
              +{state.refs.length - 8}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export function GraphIngestPanel({ onSourceCommitted }: GraphIngestPanelProps) {
  const {
    selectedEntity,
    refreshKnowledgeGraph,
  } = useOntologyContext();

  const [projectId, setProjectId] = useState('demo');
  const [slug, setSlug] = useState('');
  const [suggestedSlug, setSuggestedSlug] = useState('');
  const [mode, setMode] = useState<EditorMode>('json');
  const [message, setMessage] = useState('');
  const [jsonSource, setJsonSource] = useState('');
  const [markdownSource, setMarkdownSource] = useState('');
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewTargetRef, setPreviewTargetRef] = useState('');
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEnlarged, setIsEnlarged] = useState(false);
  const [isJsonValid, setIsJsonValid] = useState(true);
  const [commitState, setCommitState] = useState<CommitState>({ status: 'idle', message: '' });
  const targetLabel = previewTargetRef || (slug.trim() ? `auto:${slug.trim()}` : 'WiKiMG auto layer/slug');
  const slugPlaceholder = suggestedSlug
    ? `${suggestedSlug}（默认路径）`
    : '留空自动生成，或填写 kimi-demo 作为批量前缀';

  const resetCommitState = () => {
    if (commitState.status !== 'idle') {
      setCommitState({ status: 'idle', message: '' });
    }
  };

  useEffect(() => {
    if (mode === 'json') {
      try {
        if (jsonSource.trim()) {
          JSON.parse(jsonSource);
        }
        setIsJsonValid(true);
      } catch {
        setIsJsonValid(false);
      }
    } else {
      setIsJsonValid(true);
    }
  }, [jsonSource, mode]);

  const loadWorkspace = async (entityId?: string) => {
    setLoadingWorkspace(true);
    try {
      const workspace = await fetchEditorWorkspace(entityId);
      if (!workspace) throw new Error('Empty workspace data');
      
      setProjectId(workspace.project_id || 'demo');
      setSlug('');
      setSuggestedSlug(workspace.slug || '');
       setJsonSource(workspace.json_draft ? formatJson(workspace.json_draft) : '');
       setMarkdownSource(workspace.markdown_draft || '');
      setMessage('');
      setPreviewWarnings([]);
      setPreviewTargetRef(workspace.layer && workspace.slug ? `${workspace.layer}:${workspace.slug}` : '');
      setCommitState({ status: 'idle', message: '' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '载入编辑工作区失败');
    } finally {
      setLoadingWorkspace(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const getCurrentSource = (): unknown => {
    if (mode === 'markdown') {
      return markdownSource;
    }

    try {
      return JSON.parse(jsonSource);
    } catch (e) {
      throw new Error(`JSON 格式不正确: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const handleCommit = async (e?: React.MouseEvent): Promise<boolean> => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!isJsonValid) {
      const errorMessage = 'JSON 格式有误，无法入库';
      setCommitState({ status: 'error', message: errorMessage });
      toast.error(errorMessage);
      return false;
    }

    setSaving(true);
    setCommitState({ status: 'saving', message: '正在提交并等待 WiKiMG 判断 layer/slug...' });
    try {
      const source = getCurrentSource();
      const submitSlug = slug.trim()
        || (hasBatchItems(source) ? dirnameSlug(suggestedSlug) : suggestedSlug.trim());
      const result: EditorCommitResult = await commitEditorDraft({
        entityId: selectedEntity?.id,
        mode,
        projectId,
        slug: submitSlug,
        message: message.trim() || `Update ${submitSlug || 'auto-ingest'}`,
        source,
      });

      setPreviewWarnings(result.warnings || []);
      const resolvedRef = result.ref || result.updatedEntityId || result.wikiWrite?.ref || result.wikiWrites?.[0]?.ref || previewTargetRef;
      if (resolvedRef) {
        setPreviewTargetRef(result.batch ? `batch:${result.total || 0}` : resolvedRef);
      }
      if (result.sourceWrite?.filename) {
        await onSourceCommitted(projectId, result.sourceWrite.filename);
      }
      await refreshKnowledgeGraph();
      // 注释掉可能会导致 Tab 跳转或页面重置的操作
      // setSelectedLayer('all');
      // if (result.updatedEntityId) {
      //   selectEntityById(result.updatedEntityId);
      // }

      if (result.status === 'partial') {
        const warningMessage = result.batch
          ? `${formatBatchSummary(result)}，其中 ${result.failedWrites?.length || 0} 条失败`
          : result.error
            ? `源文件已入库，但图谱刷新未完成：${result.error}`
            : '源文件已入库，但图谱刷新未完成';
        setCommitState({
          status: 'partial',
          message: warningMessage,
          ref: resolvedRef,
          refs: result.wikiWrites?.map((item) => item.ref),
        });
        toast.warning(warningMessage);
      } else {
        const successMessage = result.batch
          ? formatBatchSummary(result)
          : `入库完成：${resolvedRef || submitSlug || 'auto'}`;
        setCommitState({
          status: 'success',
          message: successMessage,
          ref: resolvedRef,
          refs: result.batch ? result.wikiWrites?.map((item) => item.ref) : resolvedRef ? [resolvedRef] : undefined,
        });
        toast.success(successMessage);
      }
      return result.status !== 'partial';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '入库失败';
      setCommitState({ status: 'error', message: errorMessage });
      toast.error(errorMessage);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border/40 bg-card shadow-2xl overflow-hidden flex flex-col rounded-3xl h-[600px]">
      <CardHeader className="bg-muted/10 border-b border-border/20 px-6 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Sparkles className="h-5 w-5 text-primary/70" />
            <div className="space-y-0.5">
              <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground/80">
                知识入库 (本体知识库 Editor)
              </CardTitle>
              <div className="flex items-center gap-2 text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">
                <span>Target:</span>
                <Badge variant="outline" className="h-4 border-border/20 px-1 py-0 text-[8px] bg-background">{targetLabel}</Badge>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-xl gap-2 font-black text-[10px] uppercase tracking-widest h-8 bg-primary/5 hover:bg-primary/10 border border-primary/10"
            disabled={loadingWorkspace}
            onClick={() => void loadWorkspace(selectedEntity?.id)}
          >
            {loadingWorkspace ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            同步节点
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="p-3 flex-1 flex flex-col gap-3 overflow-hidden">
          {/* Metadata Bar: Enhanced high-density controls */}
          <div className="flex items-center gap-3 px-1 py-1 bg-muted/5 rounded-2xl border border-border/10 shrink-0">
             <div className="flex items-center gap-2 px-2 border-r border-border/20">
                <span className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-tighter">Layer</span>
                <Badge variant="outline" className="h-6 rounded-md border-primary/20 bg-primary/10 px-2 text-[8px] font-black uppercase tracking-widest text-primary">AUTO</Badge>
             </div>
             <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-[9px] font-black uppercase text-muted-foreground/40 tracking-tighter shrink-0">Slug</span>
                <Input
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    setPreviewTargetRef('');
                    resetCommitState();
                  }}
                  className="h-8 min-w-0 flex-1 rounded-lg border-border/30 bg-background px-3 font-mono text-[12px] font-bold text-primary placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-primary/30"
                  placeholder={slugPlaceholder}
                />
             </div>
             <div className="flex items-center gap-2 px-2 shrink-0">
                {isJsonValid ? (
                  <Badge variant="outline" className="h-5 text-[8px] border-emerald-500/30 text-emerald-600 bg-emerald-500/5 font-black tracking-widest px-1.5 uppercase">Valid</Badge>
                ) : (
                  <Badge variant="outline" className="h-5 text-[8px] border-amber-500/30 text-amber-600 bg-amber-500/5 font-black tracking-widest px-1.5 uppercase">Invalid</Badge>
                )}
             </div>
          </div>

          <Tabs value={mode} onValueChange={(value) => setMode(value as EditorMode)} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0">
              {/* Full Width Editor with Integrated Toolbar */}
              <div className="flex flex-col h-full bg-muted/5 rounded-xl border border-border/20 overflow-hidden relative group">
                <div className="px-3 py-1.5 border-b border-border/20 bg-muted/10 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-1.5 h-1.5 rounded-full animate-pulse", isJsonValid ? "bg-emerald-500" : "bg-amber-500")} />
                      <span className="text-[9px] font-black uppercase tracking-widest text-foreground/80">源码编辑器</span>
                    </div>
                    
                    {/* Integrated Mode Switcher */}
                    <TabsList className="flex w-fit rounded-xl border bg-muted/40 p-1 h-9">
                      <TabsTrigger value="json" className="rounded-lg font-black uppercase tracking-tight text-[10px] gap-2 px-3 h-7 data-[state=active]:bg-background transition-all">
                        <Braces className="h-3.5 w-3.5" /> JSON
                      </TabsTrigger>
                      <TabsTrigger value="markdown" className="rounded-lg font-black uppercase tracking-tight text-[10px] gap-2 px-3 h-7 data-[state=active]:bg-background transition-all">
                        <FileCode2 className="h-3.5 w-3.5" /> Markdown
                      </TabsTrigger>
                    </TabsList>
                  </div>

                    <div className="flex items-center gap-3">
                      <Dialog open={isEnlarged} onOpenChange={setIsEnlarged}>
                        <DialogTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all border border-border/20 shadow-sm"
                            title="全屏编辑"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] p-0 overflow-hidden bg-card border-border/40 rounded-3xl flex flex-col shadow-2xl">
                          <DialogHeader className="px-6 py-4 border-b border-border/20 bg-muted/10 shrink-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                <Sparkles className="h-5 w-5 text-primary" />
                                <div className="flex items-center gap-6">
                                  <div>
                                    <DialogTitle className="text-sm font-black uppercase tracking-widest">全屏精修模式</DialogTitle>
                                    <p className="text-[10px] text-muted-foreground opacity-60 uppercase mt-0.5 tracking-tight font-bold">
                                      Ontology Git Workbench
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-3 h-10 px-4 bg-background rounded-2xl border border-border/10 shadow-inner text-foreground">
                                     <div className="flex items-center gap-2 border-r border-border/20 pr-4">
                                        <span className="text-[10px] font-black uppercase text-muted-foreground/30">Layer</span>
                                        <Badge variant="outline" className="h-7 rounded-md border-primary/20 bg-primary/5 px-3 text-[9px] font-black uppercase tracking-widest text-primary">AUTO</Badge>
                                     </div>
                                     <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black uppercase text-muted-foreground/30">Slug</span>
                                        <Input
                                          value={slug}
                                          onChange={(event) => {
                                            setSlug(event.target.value);
                                            setPreviewTargetRef('');
                                            resetCommitState();
                                          }}
                                          className="h-8 w-80 rounded-lg border-border/30 bg-background px-3 font-mono text-[12px] font-bold text-primary placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-primary/30"
                                          placeholder={slugPlaceholder}
                                        />
                                     </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 pr-8">
                                  <TabsList className="flex w-fit rounded-xl border bg-muted/40 p-1 h-9">
                                    <TabsTrigger value="json" onClick={() => setMode('json')} className={cn("rounded-lg font-black uppercase tracking-tight text-[10px] gap-2 px-3 h-7 transition-all", mode === 'json' && "bg-background")}>
                                      <Braces className="h-3.5 w-3.5" /> JSON
                                    </TabsTrigger>
                                    <TabsTrigger value="markdown" onClick={() => setMode('markdown')} className={cn("rounded-lg font-black uppercase tracking-tight text-[10px] gap-2 px-3 h-7 transition-all", mode === 'markdown' && "bg-background")}>
                                      <FileCode2 className="h-3.5 w-3.5" /> Markdown
                                    </TabsTrigger>
                                  </TabsList>
                              </div>
                            </div>
                          </DialogHeader>
                          
                          <div className="flex-1 flex flex-col min-h-0 bg-background overflow-hidden relative">
                             {mode === 'json' ? (
                                <Textarea
                                  value={jsonSource}
                                  onChange={(event) => {
                                    setJsonSource(event.target.value);
                                    resetCommitState();
                                  }}
                                  className="flex-1 w-full font-mono text-[16px] resize-none border-none bg-transparent p-12 focus-visible:ring-0 leading-relaxed scrollbar-thin placeholder:text-muted-foreground/50 text-foreground"
                                  placeholder={`{
  "title": ""
}`}
                                />
                             ) : (
                                <Textarea
                                  value={markdownSource}
                                  onChange={(event) => {
                                    setMarkdownSource(event.target.value);
                                    resetCommitState();
                                  }}
                                  className="flex-1 w-full font-mono text-[16px] resize-none border-none bg-transparent p-12 focus-visible:ring-0 leading-relaxed scrollbar-thin placeholder:text-muted-foreground/50 text-foreground"
                                  placeholder="# 新概念标题"
                                />
                             )}

                             {/* Floating Warnings in Modal */}
                             {previewWarnings.length > 0 && (
                                <div className="absolute bottom-8 right-8 z-10 max-w-[400px] rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-bottom-4">
                                  <p className="text-xs font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-2">
                                    <Sparkles className="h-4 w-4" /> 规范化建议
                                  </p>
                                  <div className="space-y-2 text-sm text-amber-700 font-medium leading-relaxed">
                                    {previewWarnings.slice(0, 5).map((warning, i) => (
                                      <p key={i}>• {warning}</p>
                                    ))}
                                  </div>
                                </div>
                             )}
                          </div>

                          <div className="p-6 border-t border-border/20 bg-muted/5 shrink-0">
                            <div className="flex flex-col gap-3 max-w-4xl mx-auto">
                              <CommitStatus state={commitState} className="text-[12px]" />
                              <div className="flex items-center gap-4">
                              <div className="flex-1 relative group">
                                <Input
                                  value={message}
                                  onChange={(event) => setMessage(event.target.value)}
                                  className="h-12 text-sm bg-background border-border/40 rounded-2xl px-6 pl-10 transition-all focus:ring-2 focus:ring-primary/20 text-foreground"
                                  placeholder="commit..."
                                />
                                <Upload className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40" />
                              </div>
                              <Button 
                                type="button" 
                                size="lg"
                                className="rounded-2xl gap-3 font-black text-xs uppercase tracking-widest px-8 h-12 shadow-xl shadow-primary/20 transition-all hover:scale-105 active:scale-95" 
                                disabled={saving || !isJsonValid} 
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleCommit(e).then((success) => {
                                    if (success) setIsEnlarged(false);
                                  });
                                }}
                              >
                                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                确认变更并入库
                              </Button>
                              </div>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                </div>
              <TabsContent value="json" className="m-0 flex-1 overflow-hidden">
                <Textarea
                  value={jsonSource}
                  onChange={(event) => {
                    setJsonSource(event.target.value);
                    resetCommitState();
                  }}
                  className="w-full h-full font-mono text-[13px] resize-none border-none bg-transparent p-6 focus-visible:ring-0 leading-relaxed scrollbar-thin placeholder:text-muted-foreground/50 text-foreground"
                  placeholder={`{
  "title": ""
}`}
                />
              </TabsContent>
              <TabsContent value="markdown" className="m-0 flex-1 overflow-hidden">
                <Textarea
                  value={markdownSource}
                  onChange={(event) => {
                    setMarkdownSource(event.target.value);
                    resetCommitState();
                  }}
                  className="w-full h-full font-mono text-[13px] resize-none border-none bg-transparent p-6 focus-visible:ring-0 leading-relaxed scrollbar-thin placeholder:text-muted-foreground/50 text-foreground"
                  placeholder="# 新概念标题"
                />
              </TabsContent>
              
              {/* Floating Warnings if any */}
              {previewWarnings.length > 0 && (
                <div className="absolute bottom-4 right-4 z-10 max-w-[300px] rounded-lg border border-amber-500/30 bg-amber-50 p-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-1 flex items-center gap-2">
                    <Sparkles className="h-3 w-3" /> 规范化建议
                  </p>
                  <div className="space-y-1 text-[11px] text-amber-700 font-medium leading-relaxed">
                    {previewWarnings.slice(0, 3).map((warning, i) => (
                      <p key={i}>• {warning}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Tabs>

        {/* Action Footer: Compacted */}
        <div className="flex flex-col gap-3 pt-2 border-t border-border/20 shrink-0">
          <CommitStatus state={commitState} className="text-[11px]" />
          <div className="flex items-center gap-3">
             <div className="flex-1 relative group">
                <Input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="h-9 text-xs bg-muted/10 border-border/40 rounded-xl px-4 pl-8 transition-all focus:bg-background text-foreground"
                  placeholder="commit..."
                />
                <Upload className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40" />
             </div>
             <div className="flex items-center gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  className="rounded-xl font-black text-[10px] uppercase tracking-widest px-4 h-9 border-border/40 hover:bg-muted/50" 
                  disabled={loadingWorkspace} 
                  onClick={() => void loadWorkspace()}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingWorkspace ? 'animate-spin' : ''}`} />
                </Button>
                <Button 
                  type="button" 
                  size="sm"
                  className={cn(
                    "rounded-xl gap-2 font-black text-[10px] uppercase tracking-widest px-6 h-9 transition-all active:scale-95",
                    (saving || !isJsonValid) 
                      ? "bg-muted text-muted-foreground opacity-50 cursor-not-allowed" 
                      : "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90"
                  )}
                  disabled={saving || !isJsonValid} 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleCommit(e);
                  }}
                >
                  {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  确认入库
                </Button>
             </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
