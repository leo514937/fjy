import { useEffect, useState } from 'react';
import { Network, Search, Hash, Lock, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import { Badge } from '@/components/ui/badge';
import { fetchRoutes, type RouteDoc } from '@/features/workspace/api';
import { cn } from '@/lib/utils';

export function RouteCatalogPanel() {
  const [routes, setRoutes] = useState<RouteDoc[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRoutes = async () => {
      try {
        const data = await fetchRoutes();
        setRoutes(data);
      } catch (error) {
        console.error('Failed to fetch routes:', error);
      } finally {
        setLoading(false);
      }
    };
    loadRoutes();
  }, []);

  const filteredRoutes = routes.filter(route => 
    route.name.toLowerCase().includes(search.toLowerCase()) ||
    route.path.toLowerCase().includes(search.toLowerCase()) ||
    route.module.toLowerCase().includes(search.toLowerCase())
  );

  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'POST': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'PUT': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'DELETE': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
    }
  };

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-lg flex flex-col">
      <CardHeader className="pb-3 border-b border-border/20">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-2 shrink-0">
            <Network className="h-4 w-4 text-primary" />
            统一路由目录 (API Catalog)
          </CardTitle>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="搜索接口名称、路径或模块..."
              className="pl-8 h-8 rounded-full bg-muted/20 border-border/40 text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
          <div className="p-4 space-y-2">
            {loading ? (
              <div className="py-20 text-center text-muted-foreground animate-pulse text-xs font-bold uppercase tracking-widest">
                正在同步网关路由表...
              </div>
            ) : filteredRoutes.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground text-xs italic">
                未找到匹配的路由接口
              </div>
            ) : (
              filteredRoutes.map((route, idx) => (
                <div key={idx} className="group p-4 rounded-2xl bg-muted/20 border border-border/10 hover:border-primary/30 transition-all hover:shadow-md">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("rounded-md px-1.5 py-0 text-[10px] font-black", getMethodColor(route.method))}>
                          {route.method}
                        </Badge>
                        <span className="text-sm font-black tracking-tight text-foreground truncate">{route.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground/70 bg-muted/40 px-2 py-0.5 rounded-md">
                        <Hash className="h-3 w-3" />
                        {route.path}
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-bold uppercase tracking-widest bg-primary/5 text-primary/70 shrink-0">
                      {route.module}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed mb-3">
                    {route.description || '暂无描述信息'}
                  </p>
                  <div className="flex items-center gap-3 border-t border-border/10 pt-3">
                    <div className={cn(
                      "flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full",
                      route.auth === 'none' ? "bg-green-500/5 text-green-500" : "bg-amber-500/5 text-amber-500"
                    )}>
                      {route.auth === 'none' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      鉴权：{route.auth}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
      </CardContent>
    </Card>
  );
}
