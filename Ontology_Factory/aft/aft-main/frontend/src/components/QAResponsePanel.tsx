import { BookOpen, Network } from "lucide-react";

import type { GraphHit, QuestionAnswerResponse, RAGHit } from "@/lib/api";
import { formatGraphRelation } from "@/lib/qa";

interface QAResponseProps {
  data: QuestionAnswerResponse;
}

export function QAResponsePanel({ data }: QAResponseProps) {
  if (!data?.answer) {
    return null;
  }

  const ragHits = data.evidence?.rag_hits ?? [];
  const graphHits = data.evidence?.graph_hits ?? [];

  return (
    <div className="animate-in space-y-6 fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 gap-6 opacity-80 transition-opacity hover:opacity-100 xl:grid-cols-3">
        <div className="space-y-2 xl:col-span-2">
          <h4 className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground/80">
            <BookOpen className="h-3.5 w-3.5" />
            Retrieved Context (RAG)
          </h4>
          <div className="space-y-2">
            {ragHits.slice(0, 4).map((hit) => (
              <RAGHitCard key={hit.citation_id || hit.chunk_id || hit.source_file} hit={hit} />
            ))}
            {ragHits.length === 0 && (
              <div className="px-2 text-[10px] italic text-muted-foreground/60">
                No matching document snippets.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-tight text-muted-foreground/80">
              <Network className="h-3.5 w-3.5" />
              Graph Evidence
            </h4>
            <div className="space-y-2">
              {graphHits.slice(0, 4).map((hit) => (
                <GraphHitCard key={hit.citation_id || hit.entity} hit={hit} />
              ))}
              {graphHits.length === 0 && (
                <div className="px-2 text-[10px] italic text-muted-foreground/60">
                  No matching graph entities.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RAGHitCard({ hit }: { hit: RAGHit }) {
  return (
    <div className="rounded-xl border bg-white/50 p-3 text-[11px] shadow-sm dark:bg-zinc-900/50">
      <div className="mb-1 flex items-center gap-2 font-semibold text-primary/80">
        <span>{hit.citation_id || "R?"}</span>
        <span className="truncate">{hit.source_file}</span>
      </div>
      <div className="mb-1 truncate text-muted-foreground">
        {hit.heading_path?.join(" > ") || hit.section || "Overview"}
      </div>
      <div className="line-clamp-3 italic leading-normal text-muted-foreground">
        "{hit.content}"
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground/80">
        dense_score={Number(hit.dense_score ?? hit.score ?? 0).toFixed(3)}
        {hit.token_count ? ` | tokens=${hit.token_count}` : ""}
        {hit.source_id ? ` | source=${hit.source_id}` : ""}
        {hit.metadata.collection ? ` | collection=${hit.metadata.collection}` : ""}
      </div>
    </div>
  );
}

function GraphHitCard({ hit }: { hit: GraphHit }) {
  return (
    <div className="rounded-xl border bg-zinc-50/70 p-3 text-[11px] shadow-sm dark:bg-zinc-900/50">
      <div className="mb-1 flex items-center gap-2 font-semibold text-primary/80">
        <span>{hit.citation_id || "G?"}</span>
        <span className="truncate">{hit.entity}</span>
      </div>
      <div className="leading-normal text-muted-foreground">{hit.evidence_text}</div>

      {hit.relations.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {hit.relations.slice(0, 3).map((relation) => (
            <div
              key={`${hit.entity}-${relation}`}
              className="rounded-lg border border-zinc-200/80 bg-white/80 px-2.5 py-2 font-mono text-[10px] text-muted-foreground dark:border-zinc-800 dark:bg-zinc-950/50"
            >
              {formatGraphRelation(hit.entity, relation).label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
