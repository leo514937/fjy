import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function extractCodeLanguage(className?: string): string | null {
  if (!className) {
    return null;
  }

  const match = className.match(/language-([\w-]+)/);
  return match?.[1] || null;
}

function normalizeCodeContent(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => (typeof child === 'string' ? child : ''))
    .join('')
    .replace(/\n$/, '');
}

export async function copyCodeToClipboard(code: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code);
    return;
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = code;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return;
  }

  throw new Error('Clipboard API unavailable');
}

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => (
    () => {
      if (timeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutRef.current);
      }
    }
  ), []);

  const handleCopy = async () => {
    await copyCodeToClipboard(code);
    setCopied(true);

    if (typeof window !== 'undefined') {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    }
  };

  return (
    <div className="my-6 overflow-hidden rounded-xl border border-border/40 bg-slate-100 dark:bg-background/80 shadow-md group/code">
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-slate-200 dark:border-white/5 bg-slate-200/50 dark:bg-zinc-900/50 px-3 py-2 sm:px-4">
        <span className="min-w-0 truncate font-mono text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">
          {language || 'text'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            void handleCopy();
          }}
          className="h-7 shrink-0 rounded-lg px-2 text-[10px] font-bold text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground transition-all"
        >
          {copied ? <Check className="h-3 w-3 mr-1 text-green-600 dark:text-green-400" /> : <Copy className="h-3 w-3 mr-1" />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <pre className="max-w-full max-h-[450px] overflow-auto p-4 sm:p-5 custom-scrollbar-thin">
        <code className="font-mono text-[13px] leading-relaxed text-slate-900 dark:text-zinc-300">{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 className="mb-4 mt-6 text-2xl font-bold tracking-tight text-foreground first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mb-3 mt-5 text-xl font-bold tracking-tight text-foreground/90 first:mt-0" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mb-2 mt-4 text-lg font-semibold tracking-tight text-foreground/80 first:mt-0" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="mb-4 break-words [overflow-wrap:anywhere] text-[17px] leading-[1.7] text-foreground last:mb-0" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-black text-foreground" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-foreground/80" {...props}>
      {children}
    </em>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-6 marker:text-foreground dark:marker:text-muted-foreground/60" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-3 list-decimal space-y-1.5 pl-6 marker:font-black marker:text-foreground dark:marker:text-muted-foreground/60" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="pl-1 text-[17px] leading-[1.7] text-foreground" {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-4 break-words [overflow-wrap:anywhere] rounded-r-xl border-l-4 border-primary/40 bg-primary/5 px-4 py-3 text-[17px] leading-[1.7] text-foreground/80 italic shadow-sm"
      {...props}
    >
      {children}
    </blockquote>
  ),
  a: ({ children, ...props }) => (
    <a className="break-all font-bold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-primary transition-all" {...props}>
      {children}
    </a>
  ),
  hr: (props) => <hr className="my-8 border-border/20" {...props} />,
  table: ({ children, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse overflow-hidden rounded-xl border border-border/40 text-left text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => <thead className="bg-muted/30" {...props}>{children}</thead>,
  th: ({ children, ...props }) => <th className="border-b border-border/40 px-4 py-2 font-bold text-foreground/90 uppercase tracking-wider text-[11px]" {...props}>{children}</th>,
  td: ({ children, ...props }) => <td className="border-b border-border/20 px-4 py-2 text-foreground/80" {...props}>{children}</td>,
  pre: ({ children }) => {
    const child = React.Children.only(children) as React.ReactElement<{
      children?: React.ReactNode;
      className?: string;
    }>;

    if (!React.isValidElement(child)) {
      return <pre>{children}</pre>;
    }

    return (
      <CodeBlock
        code={normalizeCodeContent(child.props.children)}
        language={extractCodeLanguage(child.props.className)}
      />
    );
  },
  code: ({ children, className, ...props }) => (
    <code
      className={cn(
        'break-all whitespace-pre-wrap rounded-md border border-border/40 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-900 dark:text-primary/90',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  ),
};

function preprocessMarkdown(content: string): string {
  return content;
}

export function AssistantMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  if (!content) {
    return null;
  }

  const processedContent = preprocessMarkdown(content);

  return (
    <div className={cn('min-w-0 break-words [overflow-wrap:anywhere] text-[17px] leading-[1.7] text-foreground selection:bg-primary/20', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

export { extractCodeLanguage, normalizeCodeContent };
