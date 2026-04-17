import { Fragment, type ReactNode } from 'react';
import { AlertCircle, Info, Lightbulb, ShieldAlert } from 'lucide-react';
import type { MarkdownBlock, MarkdownInlineToken } from '@/types/ontology';

interface MarkdownBlocksProps {
  blocks: MarkdownBlock[];
  onSelectEntityRef?: (ref: string) => void;
}

const calloutStyles: Record<string, string> = {
  note: 'border-blue-500/20 bg-blue-500/5 text-blue-200',
  info: 'border-sky-500/20 bg-sky-500/5 text-sky-200',
  tip: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200',
  warning: 'border-amber-500/20 bg-amber-500/5 text-amber-200',
  caution: 'border-rose-500/20 bg-rose-500/5 text-rose-200',
};

const calloutIcons: Record<string, ReactNode> = {
  note: <Info className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  tip: <Lightbulb className="h-4 w-4" />,
  warning: <AlertCircle className="h-4 w-4" />,
  caution: <ShieldAlert className="h-4 w-4" />,
};

function renderInlineTokens(
  tokens: MarkdownInlineToken[] | undefined,
  onSelectEntityRef?: (ref: string) => void,
) {
  if (!tokens || tokens.length === 0) {
    return null;
  }

  return tokens.map((token, index) => {
    if (token.type === 'code') {
      return (
        <code key={index} className="rounded-md bg-muted/30 border border-border/40 px-1.5 py-0.5 font-mono text-[0.9em] text-primary/90">
          {token.text}
        </code>
      );
    }

    if (token.type === 'strong') {
      return <strong key={index} className="font-black text-foreground">{token.text}</strong>;
    }

    if (token.type === 'emphasis') {
      return <em key={index} className="italic text-foreground/80">{token.text}</em>;
    }

    if (token.type === 'link') {
      if (token.target_ref && onSelectEntityRef) {
        return (
          <button
            key={index}
            type="button"
            className="font-bold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-primary transition-all"
            onClick={() => onSelectEntityRef(token.target_ref!)}
          >
            {token.text}
          </button>
        );
      }

      if (token.href) {
        return (
          <a
            key={index}
            href={token.href}
            target={token.external ? '_blank' : undefined}
            rel={token.external ? 'noreferrer' : undefined}
            className="font-bold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-primary transition-all"
          >
            {token.text}
          </a>
        );
      }
    }

    return <Fragment key={index}>{token.text}</Fragment>;
  });
}

export function MarkdownBlocks({ blocks, onSelectEntityRef }: MarkdownBlocksProps) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return (
              <div key={index} className="font-black text-foreground tracking-tight">
                {renderInlineTokens(block.tokens, onSelectEntityRef) || block.text}
              </div>
            );
          case 'paragraph':
            return (
              <p key={index} className="text-[15px] leading-7 text-foreground font-medium">
                {renderInlineTokens(block.tokens, onSelectEntityRef) || block.text}
              </p>
            );
          case 'list':
            return (
              <ul key={index} className="list-disc space-y-2.5 pl-5 text-[15px] leading-7 text-foreground font-medium marker:text-primary/40">
                {(block.items || []).map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {renderInlineTokens(item.tokens, onSelectEntityRef) || item.text}
                  </li>
                ))}
              </ul>
            );
          case 'ordered_list':
            return (
              <ol key={index} className="list-decimal space-y-2.5 pl-5 text-[15px] leading-7 text-foreground/90 font-medium marker:text-primary/40">
                {(block.items || []).map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {renderInlineTokens(item.tokens, onSelectEntityRef) || item.text}
                  </li>
                ))}
              </ol>
            );
          case 'checklist':
            return (
              <div key={index} className="space-y-2.5">
                {(block.items || []).map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/10 px-4 py-3 text-[15px] text-foreground font-medium">
                    <span className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded border transition-colors ${item.checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}>
                      {item.checked ? '✓' : ''}
                    </span>
                    <span>{renderInlineTokens(item.tokens, onSelectEntityRef) || item.text}</span>
                  </div>
                ))}
              </div>
            );
          case 'quote':
            return (
              <blockquote key={index} className="rounded-r-xl border-l-4 border-primary/40 bg-primary/5 px-6 py-4 text-[15px] leading-7 text-foreground italic shadow-sm">
                {renderInlineTokens(block.tokens, onSelectEntityRef) || block.text}
              </blockquote>
            );
          case 'callout': {
            const tone = String(block.tone || 'note').toLowerCase();
            const toneClass = calloutStyles[tone] || calloutStyles.note;
            const title = block.title || tone.toUpperCase();

            // 过滤：不要显示“前端联调提示”
            if (title === '前端联调提示') {
              return null;
            }

            return (
              <div key={index} className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {calloutIcons[tone] || calloutIcons.note}
                  <span>{title}</span>
                </div>
                <div className="mt-2 text-sm leading-7">
                  {renderInlineTokens(block.tokens, onSelectEntityRef) || block.text}
                </div>
              </div>
            );
          }
          case 'code':
            return (
              <div key={index} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-slate-800 bg-zinc-50 dark:bg-slate-950 text-zinc-900 dark:text-slate-50">
                {block.language ? (
                  <div className="border-b border-zinc-200 dark:border-slate-800 px-4 py-2 text-xs uppercase tracking-widest font-bold text-zinc-500 dark:text-slate-400 bg-zinc-100/50 dark:bg-slate-900/50">
                    {block.language}
                  </div>
                ) : null}
                <pre className="overflow-x-auto p-4 text-sm leading-relaxed font-mono">
                  <code>{block.text}</code>
                </pre>
              </div>
            );
          case 'table':
            return (
              <div key={index} className="overflow-x-auto rounded-2xl border">
                <table className="min-w-full text-sm">
                  {block.header && block.header.length > 0 ? (
                    <thead className="bg-muted/50">
                      <tr>
                        {block.header.map((cell, cellIndex) => (
                          <th key={cellIndex} className="border-b px-4 py-3 text-left font-bold text-foreground/80 uppercase tracking-wider text-[11px]">
                            {renderInlineTokens(cell.tokens, onSelectEntityRef) || cell.text}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {(block.rows || []).map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-t">
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-4 py-3 align-top text-foreground/70">
                            {renderInlineTokens(cell.tokens, onSelectEntityRef) || cell.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
