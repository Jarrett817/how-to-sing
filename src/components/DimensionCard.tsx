// 唱歌报告的评分维度配置与展示卡片
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { DimensionScore } from '@/analysis/types';
import { MetricHelp } from '@/components/MetricHelp';

export const DIMENSIONS: { key: string; label: string; desc: string; help: string }[] = [
  {
    key: 'breath',
    label: '气息稳定',
    desc: '乐句内响度稳定性',
    help: `定义：乐句内部响度的平稳程度。
计算：对乐句内短时响度取变异系数 CV（标准差 ÷ 平均值），并结合相邻周期振幅差异 Shimmer，数值越小得分越高。
影响因素：呼气均匀度、起音冲量、歌曲本身的强弱处理均会影响 CV。
可信度：仅统计乐句内部，不反映肺活量或完整呼吸方式。`,
  },
  {
    key: 'strain',
    label: '声带松弛',
    desc: '振动规律性与紧张特征',
    help: `定义：声带振动的规律程度。
计算：综合 CPP（倒谱峰突出度）、H1-H2（前两阶谐波能量差）与 Jitter（相邻周期音高抖动）。H1-H2 按中位音高分档选取参考区间。
影响因素：元音、音高、麦克风频响均会影响绝对值。
可信度：用于声学特征描述，不能用于判断声带疾病。`,
  },
  {
    key: 'placement',
    label: '声音位置',
    desc: '高频泛音与歌手共振峰占比',
    help: `定义：2.5–3.5kHz 歌手共振峰能量占比与频谱质心（能量重心频率）。
计算：歌手共振峰占比与频谱质心加权得分；数值越高表示高频能量越集中。
影响因素：麦克风高频频响、拾音距离会影响绝对值。
可信度：适用于同一设备下的纵向对比。`,
  },
  {
    key: 'resonance',
    label: '腔体共鸣',
    desc: '声道共振峰 F1/F2 突出度',
    help: `定义：声道共振峰 F1/F2 的突出程度。
计算：用 LPC（线性预测）从长期平均频谱估计 F1/F2 频率及突出度。
影响因素：F1/F2 主要由元音决定，不同歌词之间存在正常波动。
可信度：结果反映频谱特征，不直接对应具体发声动作。`,
  },
  {
    key: 'lowBand',
    label: '低频',
    desc: '80–500Hz 能量占比',
    help: `定义：80–500Hz 频段在长期平均频谱中的能量比例。
计算：经梳状滤波仅保留人声谐波附近能量后统计频段占比，按参考区间评分。
影响因素：占比随音高和元音显著变化。
可信度：仅适用于相近音高、相近元音之间的对比。`,
  },
  {
    key: 'midBand',
    label: '中频',
    desc: '500–2000Hz 能量占比',
    help: `定义：500–2000Hz 频段的能量比例，为人声主体能量区间。
计算：经梳状滤波后的长期平均频谱频段占比，按参考区间评分。
影响因素：占比受元音与音高影响。
可信度：适用于历史值纵向对比。`,
  },
  {
    key: 'highBand',
    label: '高频',
    desc: '2000–8000Hz 能量占比',
    help: `定义：2000–8000Hz 频段的能量比例，对应泛音丰富度。
计算：经梳状滤波后的长期平均频谱频段占比，按参考区间评分。
影响因素：麦克风高频响应与拾音距离差异较大。
可信度：绝对值仅供同一设备下自比，需结合声带松弛维度共同判读。`,
  },
];

const LEVEL_TEXT: Record<string, string> = { good: '良好', fair: '一般', poor: '偏低' };

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
            历史中位数 {baseline} 分 · 本次差值 {delta > 0 ? `+${delta}` : `${delta}`} 分
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
