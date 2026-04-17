import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diffData: unknown;
  compareTarget: string;
}

function readDiffLines(diffData: unknown): string[] {
  if (!diffData || typeof diffData !== 'object') {
    return [];
  }

  const diff = (diffData as { diff?: unknown }).diff;
  return typeof diff === 'string' ? diff.split('\n') : [];
}

export function DiffDialog({ open, onOpenChange, diffData, compareTarget }: DiffDialogProps) {
  const lines = readDiffLines(diffData);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            版本差异对比
            <Badge variant="outline" className="font-mono">{compareTarget.slice(0, 7)} vs HEAD</Badge>
          </DialogTitle>
          <DialogDescription>显示目标版本与当前工作区版本之间的属性变更。</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full bg-muted/20 border border-border/40 rounded-lg p-4">
            {diffData ? (
              <div className="space-y-1 font-mono text-xs">
                {lines.map((line, index) => (
                  <div key={index} className={`${line.startsWith('+') ? 'text-green-400 bg-green-950/30' : line.startsWith('-') ? 'text-red-400 bg-red-950/30' : 'text-muted-foreground'}`}>
                    {line}
                  </div>
                ))}
                {lines.length === 0 && <div className="text-muted-foreground/60 italic">两个版本之间内容一致。</div>}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground/60">正在计算差异...</div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
