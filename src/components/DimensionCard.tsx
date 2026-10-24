// 单个评分维度的展示卡片（练声报告 / 唱歌报告共用）
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { DimensionScore } from '@/analysis/types';

const LEVEL_TEXT: Record<string, string> = { good: '良好', fair: '一般', poor: '待改进' };

function levelVariant(score: number, level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score < 0) return 'outline';
  if (level === 'good') return 'default';
  if (level === 'fair') return 'secondary';
  return 'destructive';
}

/** 原始指标值的展示名与格式化 */
const RAW_LABELS: Record<string, { label: string; unit: string; digits?: number; pct?: boolean }> = {
  envelopeCV: { label: '包络波动 CV', unit: '%' },
  phraseCV: { label: '乐句响度 CV', unit: '%' },
  shimmer: { label: 'Shimmer', unit: '%' },
  jitter: { label: 'Jitter', unit: '%' },
  cpp: { label: 'CPP', unit: 'dB' },
  h1h2: { label: 'H1-H2', unit: 'dB' },
  singerFormantRatio: { label: '歌手共振峰占比', unit: '%', pct: true },
  centroid: { label: '频谱质心', unit: 'Hz', digits: 0 },
  f1: { label: 'F1', unit: 'Hz', digits: 0 },
  f2: { label: 'F2', unit: 'Hz', digits: 0 },
  f1Prom: { label: 'F1 突出度', unit: 'dB' },
  f2Prom: { label: 'F2 突出度', unit: 'dB' },
  ratio: { label: '能量占比', unit: '%', pct: true },
};

function fmtRaw(key: string, value: number): { label: string; text: string } {
  const meta = RAW_LABELS[key] ?? { label: key, unit: '' };
  if (!Number.isFinite(value)) return { label: meta.label, text: '—' };
  const v = meta.pct ? value * 100 : value;
  return { label: meta.label, text: `${v.toFixed(meta.digits ?? 1)} ${meta.unit}`.trim() };
}

export function DimensionCard({ label, dim }: { label: string; dim: DimensionScore }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label}</CardTitle>
          <Badge variant={levelVariant(dim.score, dim.level)}>
            {dim.score < 0 ? '数据不足' : `${dim.score} 分 · ${LEVEL_TEXT[dim.level]}`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {dim.score >= 0 && <Progress value={dim.score} />}
        <p className="text-muted-foreground text-sm">{dim.hint}</p>
        <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {Object.entries(dim.raw).map(([k, v]) => {
            const { label: l, text } = fmtRaw(k, v);
            return (
              <div key={k} className="flex justify-between">
                <dt>{l}</dt>
                <dd className="tabular-nums">{text}</dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
