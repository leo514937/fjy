import { useState } from 'react';
import { GitBranch, Activity, LayoutDashboard } from 'lucide-react';

import { XiaoGuGitDashboard } from '@/components/XiaoGuGitDashboard';
import { SystemHubPage } from '@/app/pages/SystemHubPage';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function WorkspacePage() {
  const [viewMode, setViewMode] = useState<'business' | 'tech-hub'>('business');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-6 space-y-6">
          {/* Header Banner - Now inside Scrollable Container */}
          <div className="rounded-3xl border border-border/40 bg-card/60 backdrop-blur-md shadow-lg overflow-hidden">
            <div className="px-6 py-8 lg:px-10 bg-gradient-to-r from-primary/5 via-background to-transparent relative">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary/80">
                    <GitBranch className="w-3.5 h-3.5" />
                    统一本体工作台 (Unified Workspace)
                  </div>
                  <h2 className="mt-4 text-2xl font-black tracking-tight text-foreground/90">
                    {viewMode === 'business' ? '本体版本管理与实时编辑' : 'OntoGit 技术管理中台'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground max-w-2xl font-medium">
                    {viewMode === 'business' 
                      ? '支持 Git 级的历史记录管理，并在每次写入时自动触发概率推理服务。' 
                      : '监控服务集群运行状态、路由目录及底层统一鉴权体系。'}
                  </p>
                </div>

                <div className="flex flex-col gap-2 z-10">
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => setViewMode(viewMode === 'business' ? 'tech-hub' : 'business')}
                    className={cn(
                      "rounded-2xl gap-2 font-black uppercase tracking-widest text-[10px] h-10 px-5 transition-all duration-300 border-border/60 shadow-none",
                      viewMode === 'tech-hub' 
                        ? "bg-primary text-primary-foreground border-primary" 
                        : "bg-transparent hover:bg-primary/5 hover:border-primary/30 text-foreground/80"
                    )}
                  >
                    {viewMode === 'business' ? (
                      <>
                        <Activity className="w-4 h-4" />
                        进入技术中台
                      </>
                    ) : (
                      <>
                        <LayoutDashboard className="w-4 h-4" />
                        返回业务仪表盘
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="absolute right-10 top-1/2 -translate-y-1/2 opacity-[0.03] pointer-events-none">
                <GitBranch className="w-40 h-40" />
              </div>
            </div>
          </div>

          {/* Main Content Sections */}
          {viewMode === 'business' ? (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
              <XiaoGuGitDashboard />
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
              <SystemHubPage />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

