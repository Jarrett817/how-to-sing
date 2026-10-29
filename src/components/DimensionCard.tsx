// 单个评分维度的展示卡片（练声报告 / 唱歌报告共用）
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { DimensionScore } from '@/analysis/types';
import { MetricHelp } from '@/components/MetricHelp';

const LEVEL_TEXT: Record<string, string> = { good: '良好', fair: '一般', poor: '待改进' };

function levelVariant(score: number, level: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score < 0) return 'outline';
  if (level === 'good') return 'default';
  if (level === 'fair') return 'secondary';
  return 'destructive';
}

/** 原始指标值的展示名与格式化（术语配白话，括号保留专业名方便查证） */
const RAW_LABELS: Record<string, { label: string; unit: string; digits?: number; pct?: boolean }> = {
  envelopeCV: { label: '响度波动 CV', unit: '%' },
  phraseCV: { label: '乐句音量波动 CV', unit: '%' },
  shimmer: { label: '音量抖动 Shimmer', unit: '%' },
  jitter: { label: '音高抖动 Jitter', unit: '%' },
  cpp: { label: '嗓音干净度 CPP', unit: 'dB' },
  h1h2: { label: '声带松紧 H1-H2', unit: 'dB' },
  singerFormantRatio: { label: '穿透力占比', unit: '%', pct: true },
  centroid: { label: '音色明亮度（质心）', unit: 'Hz', digits: 0 },
  f1: { label: '第1共鸣峰 F1', unit: 'Hz', digits: 0 },
  f2: { label: '第2共鸣峰 F2', unit: 'Hz', digits: 0 },
  f1Prom: { label: '第1共鸣峰强度', unit: 'dB' },
  f2Prom: { label: '第2共鸣峰强度', unit: 'dB' },
  ratio: { label: '能量占比', unit: '%', pct: true },
};

function fmtRaw(key: string, value: number): { label: string; text: string } {
  const meta = RAW_LABELS[key] ?? { label: key, unit: '' };
  if (!Number.isFinite(value)) return { label: meta.label, text: '—' };
  const v = meta.pct ? value * 100 : value;
  return { label: meta.label, text: `${v.toFixed(meta.digits ?? 1)} ${meta.unit}`.trim() };
}

interface DimensionCardProps {
  label: string;
  desc?: string;
  /** 问号弹框里的完整说明（\n 分段） */
  help?: string;
  /** 个人历史中位数（同维度），用于"和自己比" */
  baseline?: number;
  dim: DimensionScore;
}

export function DimensionCard({ label, desc, help, baseline, dim }: DimensionCardProps) {
  const delta =
    dim.score >= 0 && baseline != null && Number.isFinite(baseline) ? dim.score - baseline : null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <CardTitle className="text-base">{label}</CardTitle>
            {help && (
              <MetricHelp title={label}>
                <p className="whitespace-pre-line">{help}</p>
              </MetricHelp>
            )}
          </div>
          <Badge variant={levelVariant(dim.score, dim.level)}>
            {dim.score < 0 ? '数据不足' : `${dim.score} 分 · ${LEVEL_TEXT[dim.level]}`}
          </Badge>
        </div>
        {desc && <p className="text-muted-foreground text-xs">{desc}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {dim.score >= 0 && <Progress value={dim.score} />}
        {delta != null && (
          <p className="text-muted-foreground text-xs">
            你的历史中位数 {baseline} 分 · 本次{delta > 0 ? `高 ${delta} 分` : delta < 0 ? `低 ${-delta} 分` : '持平'}
          </p>
        )}
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
