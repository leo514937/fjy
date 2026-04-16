import { useState, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { RefreshCw, Upload, Maximize2, Check, Hash } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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

export function WriteBackPanel({
  selectedProjectId,
  writeFilename,
  setWriteFilename,
  writeData,
  setWriteData,
  writeMessage,
  setWriteMessage,
  writing,
  onWrite,
}: WriteBackPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const isInvalid = useMemo(() => {
    if (!writeData) return false;
    try {
      JSON.parse(writeData);
      return false;
    } catch (e) {
      return true;
    }
  }, [writeData]);

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-2xl overflow-hidden flex flex-col h-[600px] rounded-3xl">
      <CardHeader className="bg-muted/10 border-b border-border/20 px-6 py-4 group">
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
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">JSON 内容</label>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all opacity-0 group-hover:opacity-100">
                  <Maximize2 className="h-3 w-3" />
                </Button>
              </DialogTrigger>
            <DialogContent className={cn(
              "max-w-full w-screen h-screen flex flex-col rounded-none border-none p-0 gap-0 overflow-hidden shadow-none transition-colors duration-300",
              isInvalid ? "bg-[#FFF5F5] dark:bg-[#2D1616]" : "bg-white dark:bg-zinc-950"
            )}>
              <div className="flex-1 min-h-0 relative">
                <Textarea 
                  value={writeData} 
                  onChange={(event) => setWriteData(event.target.value)} 
                  className={cn(
                    "w-full h-full font-mono text-lg resize-none border-none focus:ring-0 focus:outline-none leading-relaxed p-12 pr-12 rounded-none transition-all",
                    isInvalid ? "bg-[#FFF5F5] dark:bg-[#2D1616] text-red-900 dark:text-red-100" : "bg-white dark:bg-zinc-950"
                  )}
                  placeholder='{ "id": "001", ... }' 
                />
                {/* Floating Top Indicator */}
                <div className="absolute top-6 left-12 flex items-center gap-2 pointer-events-none">
                  <div className={cn(
                    "px-4 py-1.5 rounded-full border shadow-sm transition-all",
                    isInvalid ? "bg-red-100 border-red-200" : "bg-emerald-50 border-emerald-100 dark:bg-zinc-900 dark:border-zinc-800"
                  )}>
                    <p className={cn(
                      "text-[10px] font-black uppercase tracking-widest",
                      isInvalid ? "text-red-600" : "text-emerald-600 dark:text-emerald-400"
                    )}>
                      {isInvalid ? "⚠️ JSON 语法错误" : `正在编辑: ${writeFilename || '未命名文件'}`}
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-12 py-6 border-t border-border/20 bg-muted/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-10 text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em] whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full transition-all",
                      isInvalid ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]" : "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                    )} />
                    {isInvalid ? "JSON 格式非法" : "数据实时同步中"}
                  </div>
                  <div className="h-4 w-[1px] bg-border/40" />
                  <div>字符数: {writeData.length}</div>
                </div>
                <div className="flex items-center gap-4">
                  <DialogTrigger asChild>
                    <Button 
                      size="lg" 
                      disabled={isInvalid}
                      className={cn(
                        "rounded-2xl px-10 h-12 font-black uppercase tracking-widest text-xs gap-3 shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]",
                        isInvalid ? "bg-zinc-200 text-zinc-400 cursor-not-allowed shadow-none" : "bg-primary text-primary-foreground shadow-primary/20"
                      )}
                    >
                      <Check className="h-5 w-5" />
                      {isInvalid ? "请修复错误" : "保存并返回"}
                    </Button>
                  </DialogTrigger>
                </div>
              </div>
            </DialogContent>
            </Dialog>
          </div>
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
