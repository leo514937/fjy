import { SystemHealthPanel } from '@/features/workspace/components/SystemHealthPanel';
import { RouteCatalogPanel } from '@/features/workspace/components/RouteCatalogPanel';
import { ShieldCheck, Info, Package, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function SystemHubPage() {
  return (
    <div className="flex flex-col space-y-6">
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <SystemHealthPanel />
            <RouteCatalogPanel />
          </div>

          <div className="space-y-6">
            <Card className="border-border/40 bg-primary/5 border-dashed">
              <CardHeader className="pb-3 border-b border-border/20">
                <CardTitle className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  系统概览 (Summary)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">网关版本</span>
                    <span className="font-mono bg-background px-2 py-0.5 rounded border border-border/40">v1.2.4-stable</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">存储后端</span>
                    <span className="font-bold text-primary">XiaoGuGit-Core</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">推理引擎</span>
                    <span className="font-bold">LLM-Probability-v2</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-border/20">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    当前环境为 <strong>Development</strong> 开发模式。
                    API 密钥已通过浏览器 Secret Storage 安全锁定。
                  </p>
                </div>
              </CardContent>
            </Card>

            <Alert className="rounded-3xl border-amber-500/20 bg-amber-500/5">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <AlertTitle className="text-xs font-black uppercase tracking-wider text-amber-600">管理提醒</AlertTitle>
              <AlertDescription className="text-[11px] text-amber-700/80 leading-relaxed font-medium">
                所有对本体项目的 <strong>ROLLBACK</strong> (回滚) 和 <strong>DELETE</strong> (删除) 操作都会触发审计日志追踪，请谨慎操作。
              </AlertDescription>
            </Alert>

            <div className="p-6 rounded-3xl border border-border/40 bg-muted/20 flex flex-col items-center justify-center text-center gap-3">
              <Package className="h-10 w-10 text-muted-foreground/30" />
              <div className="space-y-1">
                <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">多源融合视图</h4>
                <p className="text-[10px] text-muted-foreground px-4">
                  该功能项正在由 QAgent 加速开发中，支持跨项目本体对比。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
