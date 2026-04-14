import type { ReactNode } from "react";
import { BookOpen, ExternalLink, Network } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import type { CitationDetail } from "@/lib/qa";
import { formatGraphRelation } from "@/lib/qa";

interface CitationDetailsDialogProps {
  detail: CitationDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CitationDetailsDialog({
  detail,
  open,
  onOpenChange,
}: CitationDetailsDialogProps) {
  if (!detail) {
    return null;
  }

  const isGraph = detail.kind === "graph";
  const title = isGraph ? detail.hit.entity : detail.hit.source_file || detail.citationId;
  const description = isGraph
    ? "Graph evidence retrieved from Neo4j."
    : "Document evidence retrieved from Qdrant.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl overflow-hidden rounded-3xl border-zinc-200 bg-zinc-50 p-0 dark:border-zinc-800 dark:bg-zinc-950">
        <DialogHeader className="border-b border-zinc-200/80 bg-white/80 px-6 py-5 dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
              {isGraph ? <Network className="w-5 h-5" /> : <BookOpen className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="truncate text-xl">{title}</DialogTitle>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {detail.citationId}
                </Badge>
                <Badge className="bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                  {isGraph ? "Neo4j" : "Qdrant"}
                </Badge>
              </div>
              <DialogDescription className="mt-2 text-sm">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <div className="space-y-6 px-6 py-6">
            {isGraph ? (
              <div className="space-y-6">
                <section className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Entity evidence
                  </div>
                  <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-sm leading-7">{detail.hit.evidence_text}</div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Related entities
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {detail.hit.related_entities.length > 0 ? (
                      detail.hit.related_entities.map((entity) => (
                        <Badge key={entity} variant="secondary" className="rounded-full px-3 py-1">
                          {entity}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No related entities surfaced.</span>
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Relation chain
                  </div>
                  <div className="space-y-3">
                    {detail.hit.relations.length > 0 ? (
                      detail.hit.relations.map((relation) => {
                        const formatted = formatGraphRelation(detail.hit.entity, relation);
                        return (
                          <div
                            key={`${detail.hit.entity}-${relation}`}
                            className="rounded-2xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{formatted.direction}</Badge>
                              <Badge variant="secondary">{formatted.relationType}</Badge>
                              <span className="text-sm font-medium">{formatted.neighbor}</span>
                            </div>
                            <div className="mt-3 font-mono text-xs text-muted-foreground">
                              {formatted.label}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border bg-white p-4 text-sm text-muted-foreground shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        No relation chain was returned for this entity.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : (
              <div className="space-y-6">
                <section className="grid gap-3 md:grid-cols-2">
                  <InfoCard
                    label="Collection"
                    value={String(detail.hit.metadata.collection || "unknown")}
                  />
                  <InfoCard label="Source ID" value={detail.hit.source_id || "unknown"} />
                  <InfoCard label="Section" value={detail.hit.section || "Overview"} />
                  <InfoCard
                    label="Heading"
                    value={detail.hit.heading_path.length > 0 ? detail.hit.heading_path.join(" > ") : "Overview"}
                  />
                </section>

                <section className="grid gap-3 md:grid-cols-3">
                  <InfoCard label="Relevance score" value={formatScore(detail.hit.score)} />
                  <InfoCard label="MMR score" value={formatScore(Number(detail.hit.metadata.mmr_score ?? 0))} />
                  <InfoCard label="Dense score" value={formatScore(detail.hit.dense_score)} />
                  <InfoCard label="Tokens" value={String(detail.hit.token_count || 0)} />
                </section>

                <section className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Retrieved snippet
                  </div>
                  <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="whitespace-pre-wrap text-sm leading-7">{detail.hit.content}</div>
                  </div>
                </section>

                <Separator />

                <section className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Retrieval metadata
                  </div>
                  <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="grid gap-3 md:grid-cols-2">
                      <InfoCard label="Match reason" value={detail.hit.match_reason || "n/a"} />
                      <InfoCard
                        label="Vector point"
                        value={String(detail.hit.metadata.id || "unknown")}
                        icon={<ExternalLink className="w-3.5 h-3.5" />}
                      />
                      <InfoCard label="Filename" value={String(detail.hit.metadata.filename || "unknown")} />
                      <InfoCard label="Index profile" value={String(detail.hit.metadata.index_profile || "unknown")} />
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function InfoCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="break-words text-sm leading-6">{value}</div>
    </div>
  );
}

function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}
