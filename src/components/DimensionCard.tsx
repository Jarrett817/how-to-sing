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
    desc: '乐句里音量是否平稳持久，不靠喉咙硬撑',
    help: `在看什么：乐句内部的响度是否平稳。气息支撑好的声音不需要靠喉咙用力维持响度。
怎么算：把录音切成小片段计算响度，取变异系数 CV（波动 ÷ 平均值），再结合音量抖动 Shimmer（相邻周期的振幅差异）。两者越小越稳。
怎么解读：分数低常见于呼气不均、乐句开头一次泄气太多。可先练无声"嘶"音延长呼气，再带音高。
局限：歌曲本身有强弱处理，所以这里只看乐句内部稳定性。它反映"响度稳定"，不是肺活量或呼吸方式的全貌。`,
  },
  {
    key: 'strain',
    label: '松弛不挤卡',
    desc: '声带是否放松，有没有扯着嗓子',
    help: `在看什么：声带振动是否规律、有没有过度挤压。
怎么算：综合三个指标——CPP（倒谱峰突出度，振动越规律干净越高）、H1-H2（前两阶谐波能量差，挤压时通常偏低）、Jitter（相邻周期的音高抖动）。
怎么解读：分数低常见于扯嗓子、高音硬顶、起音过猛。建议先用气泡音、弱延音放松起音，再逐步加大音量。
局限：H1-H2 随音高天然下降，本报告已按你的中位音高分档选参考区间。它也受元音和设备影响，不能用于判断声带疾病；持续嘶哑请就医。`,
  },
  {
    key: 'placement',
    label: '位置靠前',
    desc: '声音是否明亮集中，打在面部前方',
    help: `在看什么：声音是否明亮集中、有穿透力，即常说的"面罩感"。
怎么算：统计 2.5–3.5kHz"歌手共振峰"的能量占比，以及频谱质心（能量重心频率，越高越明亮）。歌手共振峰是声音能穿透伴奏的关键。
怎么解读：偏低通常声音偏闷偏后，可练哼鸣找鼻梁附近的振感，再带到咬字。
局限：明亮不等于好，过度追求会变尖挤。麦克风频响也影响绝对值，更适合看自己的变化趋势而不是和别人比分。`,
  },
  {
    key: 'resonance',
    label: '腔体充分',
    desc: '口腔是否打开，声音有没有共鸣空间',
    help: `在看什么：口腔、咽腔是否形成稳定的共鸣空间。
怎么算：用 LPC（线性预测）从平均频谱估计声道共振峰 F1/F2 及其突出度，共振峰越清晰说明腔体成型越稳定。
怎么解读：偏低常见于咬字含糊、口腔开度不足。可练"打哈欠"式的喉咙打开，保持这个空间再发声。
局限：F1/F2 主要由元音决定，唱歌时不同歌词带来的波动是正常的。`,
  },
  {
    key: 'lowBand',
    label: '低频',
    desc: '声音的厚度与胸腔感',
    help: `在看什么：80–500Hz 频段的能量占比，对应声音的厚度、胸腔感。
怎么算：对长期平均频谱按频段统计能量比例，只保留人声各次谐波附近的能量（梳状滤波），尽量减少伴奏污染。
怎么解读：偏少可能声音偏薄，偏多可能偏暗、压喉。落在参考区间内即为 100 分。
局限：占比随音高和元音变化很大，只有同一元音、相近音高之间的比较才有意义。`,
  },
  {
    key: 'midBand',
    label: '中频',
    desc: '声音的主体能量，决定饱满度',
    help: `在看什么：500–2000Hz 频段的能量占比，是人声主体能量所在，决定饱满度和"芯"。
怎么算：同低频——长期平均频谱的频段能量比例，经梳状滤波抗伴奏。
怎么解读：偏少常见于声带闭合不够、声音发虚；中频占比偏高本身是正常的，人声能量本就集中在这里。
局限：同样是相对占比，受元音与音高影响，请和自己的历史值比较。`,
  },
  {
    key: 'highBand',
    label: '高频',
    desc: '声音的亮度与穿透力',
    help: `在看什么：2000–8000Hz 频段的能量占比，对应泛音丰富度、亮度与穿透力。
怎么算：同低频/中频的频段能量比例，经梳状滤波抗伴奏。
怎么解读：偏少声音偏闷，可尝试更靠前的咬字位置；偏多不一定好，可能是尖亮、挤压的信号，需配合"松弛不挤卡"一起看。
局限：麦克风对高频的拾取差异较大，绝对值仅供自比。`,
  },
];

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
