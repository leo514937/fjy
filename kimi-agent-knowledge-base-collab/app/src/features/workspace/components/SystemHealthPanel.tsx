import { useEffect, useState } from 'react';
import { Activity, ShieldCheck, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchHealth, type HealthStatus } from '@/features/workspace/api';
import { cn } from '@/lib/utils';

export function SystemHealthPanel() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshHealth = async () => {
    setLoading(true);
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch (error) {
      console.error('Failed to fetch health status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'ok':
      case 'healthy':
      case 'running':
        return 'text-green-500';
      case 'warn':
      case 'degraded':
        return 'text-yellow-500';
      case 'error':
      case 'down':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'ok':
      case 'healthy':
      case 'running':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'warn':
      case 'degraded':
        return <AlertTriangle className="h-4 w-4" />;
      case 'error':
      case 'down':
        return <AlertTriangle className="h-4 w-4" />;
      default:
        return <Zap className="h-4 w-4" />;
    }
  };

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg">
      <CardHeader className="pb-3 border-b border-border/20">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            服务运行状态
          </CardTitle>
          <Badge variant={health?.status === 'ok' ? 'default' : 'outline'} className={cn(
            "rounded-full px-3 font-bold uppercase tracking-widest text-[10px]",
            health?.status === 'ok' ? "bg-green-500/10 text-green-500 hover:bg-green-500/20" : ""
          )}>
            {loading ? '检测中...' : (health?.status || 'UNKNOWN')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {health?.modules && Object.entries(health.modules).map(([name, status]) => (
            <div key={name} className="p-3 rounded-2xl bg-muted/30 border border-border/20 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{name}</span>
                <span className={cn("flex items-center gap-1 text-[11px] font-bold", getStatusColor(status))}>
                  {getStatusIcon(status)}
                  {status}
                </span>
              </div>
              <div className="h-1 w-full bg-muted/50 rounded-full overflow-hidden">
                <div className={cn(
                  "h-full rounded-full transition-all duration-1000",
                  status === 'ok' ? "bg-green-500 w-full" : "bg-yellow-500 w-1/2"
                )} />
              </div>
            </div>
          ))}
          {!health?.modules && !loading && (
            <div className="col-span-3 py-6 text-center text-muted-foreground text-xs italic">
              未能获取模块详细状态
            </div>
          )}
        </div>
        <div className="pt-2 flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
          <ShieldCheck className="h-3 w-3" />
          系统每 30s 自动同步一次后端健康心跳监测
        </div>
      </CardContent>
    </Card>
  );
}
