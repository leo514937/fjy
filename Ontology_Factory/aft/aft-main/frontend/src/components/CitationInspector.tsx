import { BookOpen, Network, X } from "lucide-react";

import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import type { CitationDetail } from "@/lib/qa";
import { formatGraphRelation } from "@/lib/qa";
import { Button } from "./ui/button";

interface CitationInspectorProps {
  detail: CitationDetail | null;
  onClose: () => void;
}

export function CitationInspector({ detail, onClose }: CitationInspectorProps) {
  if (!detail) {
    return null;
  }

  const isGraph = detail.kind === "graph";
  const title = isGraph ? detail.hit.entity : detail.hit.source_file || detail.citationId;

  return (
    <aside className="w-[400px] shrink-0 border-l bg-zinc-50/50 dark:bg-zinc-950/50 backdrop-blur-xl flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-b bg-white/50 dark:bg-zinc-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            {isGraph ? <Network className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold truncate pr-2">{title}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-[9px] px-1.5 h-4">
                {detail.citationId}
              </Badge>
              <span className="text-[10px] text-muted-foreground uppercase tracking-tight">
                {isGraph ? "Neo4j Graph" : "Qdrant RAG"}
              </span>
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-6">
          {isGraph ? (
            <div className="space-y-6">
              <section className="space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                  Entity Evidence
                </div>
                <div className="rounded-xl border bg-white dark:bg-zinc-900 p-4 text-sm leading-relaxed shadow-sm">
                  {detail.hit.evidence_text}
                </div>
              </section>

              {detail.hit.related_entities.length > 0 && (
                <section className="space-y-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                    Related Entities
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.hit.related_entities.map((entity) => (
                      <Badge key={entity} variant="secondary" className="rounded-md text-[10px] px-2 py-0 border-none">
                        {entity}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {detail.hit.relations.length > 0 && (
                <section className="space-y-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                    Relation Chain
                  </div>
                  <div className="space-y-2.5">
                    {detail.hit.relations.map((relation) => {
                      const formatted = formatGraphRelation(detail.hit.entity, relation);
                      return (
                        <div
                          key={`${detail.hit.entity}-${relation}`}
                          className="rounded-xl border bg-white dark:bg-zinc-900 p-3 shadow-sm"
                        >
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            <Badge variant="outline" className="text-[9px] h-4 uppercase">{formatted.direction}</Badge>
                            <span className="text-xs font-semibold text-primary">{formatted.relationType}</span>
                          </div>
                          <div className="text-[11px] font-medium leading-relaxed text-zinc-600 dark:text-zinc-300">
                            {formatted.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-2.5">
                <MetricCard label="Relevance score" value={formatScore(detail.hit.score)} />
                <MetricCard label="Tokens" value={String(detail.hit.token_count || 0)} />
              </div>

              <section className="space-y-2.5">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                  Context Snippet
                </div>
                <div className="rounded-xl border bg-white dark:bg-zinc-900 p-4 shadow-sm">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 overflow-hidden">
                    "{detail.hit.content}"
                  </div>
                </div>
              </section>

              <Separator className="opacity-50" />

              <section className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                  Source Details
                </div>
                <div className="space-y-2">
                  <DetailRow label="Source File" value={detail.hit.source_file} />
                  <DetailRow label="Section" value={detail.hit.section || "Overview"} />
                  <DetailRow 
                    label="Heading Path" 
                    value={detail.hit.heading_path.length > 0 ? detail.hit.heading_path.join(" > ") : "Top level"} 
                  />
                  <DetailRow label="Match Type" value={detail.hit.match_reason || "Semantic Similarity"} />
                </div>
              </section>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 p-3 shadow-sm">
      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1">{label}</div>
      <div className="text-sm font-bold font-mono">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">{label}</span>
      <span className="text-xs font-medium break-all">{value}</span>
    </div>
  );
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "0.000";
}
