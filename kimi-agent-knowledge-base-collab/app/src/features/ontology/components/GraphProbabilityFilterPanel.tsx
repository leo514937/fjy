import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  DEFAULT_GRAPH_PROBABILITY_FILTERS,
  hasActiveGraphProbabilityFilters,
  type GraphProbabilityFilters,
} from '@/features/ontology/graphProbabilityFilters';

const GRAPH_PROBABILITY_FILTER_FIELDS: Array<{
  key: keyof GraphProbabilityFilters;
  label: string;
  description: string;
  min: number;
  max: number;
}> = [
  {
    key: 'keepProbabilityMin',
    label: '保留概率下限',
    description: '仅显示 keep_probability 大于等于该阈值的实体',
    min: 0,
    max: 100,
  },
  {
    key: 'removeProbabilityMax',
    label: '去除概率上限',
    description: '仅显示 remove_probability 小于等于该阈值的实体',
    min: 0,
    max: 100,
  },
  {
    key: 'probabilityGapMin',
    label: '概率差下限',
    description: '仅显示 probability_gap 大于等于该阈值的实体',
    min: -100,
    max: 100,
  },
];

function clampPercentage(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

interface GraphProbabilityFilterPanelProps {
  filters: GraphProbabilityFilters;
  onChange: (filters: GraphProbabilityFilters) => void;
  matchedEntityCount: number;
  totalEntityCount: number;
  relationCount: number;
  compact?: boolean;
}

export function GraphProbabilityFilterPanel({
  filters,
  onChange,
  matchedEntityCount,
  totalEntityCount,
  relationCount,
  compact = false,
}: GraphProbabilityFilterPanelProps) {
  const hasActiveFilters = hasActiveGraphProbabilityFilters(filters);

  const setFilterValue = (key: keyof GraphProbabilityFilters, value: number) => {
    const field = GRAPH_PROBABILITY_FILTER_FIELDS.find((item) => item.key === key);
    if (!field) {
      return;
    }

    onChange({
      ...filters,
      [key]: clampPercentage(value, field.min, field.max),
    });
  };

  return (
    <Card className="border-border/50 bg-card/80 shadow-sm rounded-3xl">
      <CardContent className={compact ? 'p-4 space-y-4' : 'p-6 space-y-6'}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-muted-foreground">
              图谱概率筛选
            </div>
            <div className={compact ? 'text-lg font-black tracking-tight' : 'text-2xl font-black tracking-tight'}>
              按小故判定三值筛选知识图谱
            </div>
            <div className="text-sm text-muted-foreground">
              当前只渲染满足 `keep_probability`、`remove_probability`、`probability_gap` 条件的实体和关系。
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={hasActiveFilters ? 'default' : 'secondary'} className="rounded-full px-3 py-1">
              {matchedEntityCount} / {totalEntityCount} 实体
            </Badge>
            <Badge variant="outline" className="rounded-full px-3 py-1">
              {relationCount} 条关系
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => onChange(DEFAULT_GRAPH_PROBABILITY_FILTERS)}
            >
              重置阈值
            </Button>
          </div>
        </div>

        <div className={compact ? 'grid gap-4' : 'grid gap-5 lg:grid-cols-3'}>
          {GRAPH_PROBABILITY_FILTER_FIELDS.map((field) => {
            const value = filters[field.key];
            return (
              <div
                key={field.key}
                className="rounded-2xl border border-border/50 bg-background/70 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">{field.label}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {field.description}
                    </div>
                  </div>
                  <div className="w-20 shrink-0">
                    <Input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={value}
                      onChange={(event) => setFilterValue(field.key, Number(event.target.value))}
                      className="h-9 text-right font-mono"
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Slider
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={[value]}
                    onValueChange={(values) => setFilterValue(field.key, values[0] ?? value)}
                  />
                  <div className="w-12 text-right text-xs font-bold text-muted-foreground">
                    {value}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {matchedEntityCount === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            当前阈值下没有命中的实体，可以适当调低 `keep_probability / probability_gap`，或调高 `remove_probability` 上限。
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
