import { useEffect, useMemo, useState } from 'react';
import { Clock3, History, RefreshCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fetchXgTimelines } from '@/features/workspace/api';
import type { XgTimeline, XgTimelineCommit } from '@/lib/xgApi';
import type { Entity } from '@/types/ontology';
import { cn } from '@/lib/utils';

interface EntityTimelinePanelProps {
  entity: Entity | null;
}

interface TimelineContext {
  projectId: string;
  filename: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveTimelineContext(entity: Entity | null): TimelineContext | null {
  if (!entity) {
    return null;
  }

  const properties = entity.properties && typeof entity.properties === 'object' ? entity.properties : {};
  const projectId = asString(properties.project_id) || asString((properties as Record<string, unknown>).projectId);
  const filename =
    asString(properties.filename)
    || asString((properties as Record<string, unknown>).source_filename)
    || asString((properties as Record<string, unknown>).sourceFile)
    || asString(entity.source);

  if (!projectId || !filename) {
    return null;
  }

  return { projectId, filename };
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp || '-';
  }

  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function TimelineEntry({ commit, isCurrent }: { commit: XgTimelineCommit; isCurrent: boolean }) {
  return (
    <div className="relative pl-8 pb-6 last:pb-0">
      <div className="absolute left-[10px] top-2 bottom-0 w-px bg-border/40" />
      <div className="absolute left-0 top-1.5 h-5 w-5 rounded-full border border-border/50 bg-background flex items-center justify-center shadow-sm">
        <div
          className={cn(
            'h-1.5 w-1.5 rounded-full transition-colors',
            isCurrent ? 'bg-emerald-500' : 'bg-muted-foreground/50',
          )}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-muted/10 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-black tracking-tight text-primary/80">
            {commit.id.slice(0, 7)}
          </span>
          {typeof commit.versionId === 'number' && (
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[9px] font-black uppercase tracking-widest">
              v{commit.versionId}
            </Badge>
          )}
          {isCurrent && (
            <Badge className="h-5 rounded-full px-2 text-[9px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              Current
            </Badge>
          )}
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {commit.author || 'unknown'}
          </span>
        </div>

        <p className="text-sm font-bold leading-relaxed text-foreground/90">
          {commit.message || '无提交说明'}
        </p>

        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
          <Clock3 className="h-3.5 w-3.5" />
          {formatTimestamp(commit.timestamp)}
        </div>
      </div>
    </div>
  );
}

function TimelineBody({ timelines, filename }: { timelines: XgTimeline[]; filename: string }) {
  const timeline = timelines.find((item) => item.filename === filename);
  const commits = timeline?.commits ?? [];

  if (!timeline) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground/50">
        当前实体对应的文件未找到历史时间线
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground/50">
        该文件暂无提交历史
      </div>
    );
  }

  return (
    <ScrollArea className="h-[340px] pr-3">
      <div className="space-y-0">
        {commits.map((commit, index) => (
          <TimelineEntry
            key={commit.id}
            commit={commit}
            isCurrent={index === 0}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

export function EntityTimelinePanel({ entity }: EntityTimelinePanelProps) {
  const timelineContext = useMemo(() => resolveTimelineContext(entity), [entity]);
  const [timelines, setTimelines] = useState<XgTimeline[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!timelineContext) {
      setTimelines([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadTimelines = async () => {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchXgTimelines(timelineContext.projectId);
        if (!cancelled) {
          setTimelines(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '时间线加载失败');
          setTimelines([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadTimelines();

    return () => {
      cancelled = true;
    };
  }, [refreshKey, timelineContext]);

  return (
    <Card className="overflow-hidden border-border shadow-sm rounded-3xl">
      <CardHeader className="border-b bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-black tracking-tight">
              <History className="h-4 w-4 text-primary" />
              当前实体时间线
            </CardTitle>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {timelineContext
                ? `${timelineContext.projectId} / ${timelineContext.filename}`
                : '实体未包含 project_id 或 filename，暂时无法定位版本链'}
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={!timelineContext || loading}
          >
            <RefreshCcw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {loading ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground/50">
            正在加载当前实体的历史版本...
          </div>
        ) : error ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 px-6 text-center text-xs font-bold uppercase tracking-widest text-destructive">
            {error}
          </div>
        ) : timelineContext ? (
          <TimelineBody timelines={timelines} filename={timelineContext.filename} />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/10 px-6 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground/50">
            选中实体后即可查看其时间线
          </div>
        )}
      </CardContent>
    </Card>
  );
}
