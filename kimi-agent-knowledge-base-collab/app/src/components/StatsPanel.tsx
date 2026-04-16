import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Layers, 
  GitBranch, 
  BarChart3,
  Database,
  Network,
  FolderTree
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KnowledgeLayer } from '@/types/ontology';

interface StatsPanelProps {
  statistics: {
    total_entities: number;
    total_relations: number;
    domains: string[];
    levels: number[];
    sources?: string[];
    layers: KnowledgeLayer[];
    layer_counts: Partial<Record<KnowledgeLayer, number>>;
  } | null;
}

const layerLabels: Record<KnowledgeLayer, string> = {
  common: 'Common',
  domain: 'Domain',
  private: 'Private',
};

export function StatsPanel({ statistics }: StatsPanelProps) {
  if (!statistics) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="h-24" />
          </Card>
        ))}
      </div>
    );
  }

  const stats = [
    {
      title: '实体总数',
      value: statistics.total_entities,
      icon: <Database className="w-5 h-5" />,
      color: 'bg-primary/20 text-primary',
      description: '知识库中的概念和实例'
    },
    {
      title: '关系总数',
      value: statistics.total_relations,
      icon: <Network className="w-5 h-5" />,
      color: 'bg-emerald-500/20 text-emerald-400',
      description: '实体间的关联'
    },
    {
      title: '领域覆盖',
      value: statistics.domains.length,
      icon: <Layers className="w-5 h-5" />,
      color: 'bg-violet-500/20 text-violet-400',
      description: '不同知识领域'
    },
    {
      title: '层次深度',
      value: statistics.levels.length,
      icon: <GitBranch className="w-5 h-5" />,
      color: 'bg-amber-500/20 text-amber-400',
      description: '本体论层次'
    },
    {
      title: '存储层',
      value: statistics.layers.length,
      icon: <FolderTree className="w-5 h-5" />,
      color: 'bg-rose-500/20 text-rose-400',
      description: 'Common / Domain / Private'
    }
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-bold mt-2">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.description}
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  {stat.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            知识来源分布
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {statistics.sources?.map((source, index) => (
              <Badge key={index} variant="outline" className="px-3 py-1">
                {source}
              </Badge>
            ))}
          </div>
          
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">覆盖领域</h4>
            <div className="flex flex-wrap gap-2">
              {statistics.domains.map((domain, index) => (
                <Badge key={index} variant="secondary" className="px-3 py-1">
                  {domain}
                </Badge>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">层次结构</h4>
            <div className="flex items-center gap-2">
              {statistics.levels.map((level, index) => (
                <div key={index} className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                    {level}
                  </div>
                  {index < statistics.levels.length - 1 && (
                    <div className="w-4 h-px bg-border" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">存储层分布</h4>
            <div className="flex flex-wrap gap-2">
              {statistics.layers.map((layer) => (
                <Badge
                  key={layer}
                  variant="outline"
                  className={cn(
                    "px-3 py-1 border-none font-bold",
                    layer === 'common' && "bg-[#99AF91]/10 text-[#768A6F]",
                    layer === 'domain' && "bg-[#939FB0]/10 text-[#6D7A8D]",
                    layer === 'private' && "bg-[#C19292]/10 text-[#9B6D6D]"
                  )}
                >
                  {layerLabels[layer]} · {statistics.layer_counts[layer] || 0}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
