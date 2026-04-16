import type { Dispatch, SetStateAction } from 'react';
import { RefreshCw, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface WriteBackPanelProps {
  selectedProjectId: string;
  writeFilename: string;
  setWriteFilename: Dispatch<SetStateAction<string>>;
  writeData: string;
  setWriteData: Dispatch<SetStateAction<string>>;
  writeMessage: string;
  setWriteMessage: Dispatch<SetStateAction<string>>;
  writing: boolean;
  onWrite: () => void | Promise<void>;
}

export function WriteBackPanel(props: WriteBackPanelProps) {
  const {
    selectedProjectId,
    writeFilename,
    setWriteFilename,
    writeData,
    setWriteData,
    writeMessage,
    setWriteMessage,
    writing,
    onWrite,
  } = props;

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-2xl overflow-hidden flex flex-col h-[600px] rounded-3xl">
      <CardHeader className="bg-muted/10 border-b border-border/20 px-6 py-4">
        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-3 text-muted-foreground/80">
          <Upload className="h-4 w-4 text-emerald-500/70" />
          入库同步
        </CardTitle>
        <CardDescription className="text-[11px] font-medium text-muted-foreground/60 mt-1">将更改同步到中心仓库并触发概率推理</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 p-6 flex flex-col gap-6 overflow-hidden">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">项目 ID</label>
            <Input disabled value={selectedProjectId} className="h-10 text-xs bg-muted/20 border-border/40 font-bold" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">文件名</label>
            <Input placeholder="ontology.json" value={writeFilename} onChange={(event) => setWriteFilename(event.target.value)} className="h-10 text-xs font-mono bg-muted/10 border-border/40 focus:bg-muted/20 transition-all font-bold" />
          </div>
        </div>
        <div className="space-y-2 flex-1 flex flex-col min-h-0">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">JSON 内容</label>
          <Textarea value={writeData} onChange={(event) => setWriteData(event.target.value)} className="flex-1 font-mono text-[13px] resize-none bg-muted/10 border-border/40 focus:bg-muted/20 transition-all leading-relaxed p-4 rounded-xl" placeholder='{ "id": "001", ... }' />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">提交备注</label>
          <Input placeholder="例如：更新了实体属性定义" value={writeMessage} onChange={(event) => setWriteMessage(event.target.value)} className="h-10 text-sm bg-muted/10 border-border/40 focus:bg-muted/20 transition-all font-bold" />
        </div>
        <Button 
          className="w-full bg-zinc-200 hover:bg-zinc-300 dark:bg-primary dark:hover:bg-primary/90 text-zinc-900 dark:text-primary-foreground gap-2 h-12 rounded-2xl shadow-lg ring-1 ring-zinc-300/50 dark:ring-primary-foreground/10 font-black uppercase tracking-widest text-xs transition-all active:scale-[0.98]" 
          onClick={onWrite} 
          disabled={writing || !selectedProjectId}
        >
          {writing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          执行写入并推理 (Write & Infer)
        </Button>
      </CardContent>
    </Card>
  );
}
