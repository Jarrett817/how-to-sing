// 报告页：七维评分 + 原始指标 + 建议（分析在 Worker 中进行）
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadarChart } from '@/components/charts/RadarChart';
import { EnvelopeChart } from '@/components/charts/EnvelopeChart';
import { DimensionCard } from '@/components/DimensionCard';
import { MetricHelp } from '@/components/MetricHelp';
import { QualityNotice } from '@/components/QualityNotice';
import { runTasksAnalysis } from '@/analysis/client';
import type { AnalysisReport, TaskKind } from '@/analysis/types';
import { classifyVoiceRange } from '@/analysis/voice-range';
import { historyBaselines, loadHistory, saveReportSummary, useSession } from '@/lib/session-store';
import { TASKS } from '@/lib/tasks';

export const DIMENSIONS: { key: string; label: string; desc: string; help: string }[] = [
  {
    key: 'breath',
    label: '气息稳定',
    desc: '乐句里音量是否平稳持久，不靠喉咙硬撑',
    help: `在看什么：长音或乐句内部的响度是否平稳。气息支撑好的声音不需要靠喉咙用力维持响度。
怎么算：把录音切成小片段计算响度，取变异系数 CV（波动 ÷ 平均值），再结合音量抖动 Shimmer（相邻周期的振幅差异）。两者越小越稳。
怎么解读：分数低常见于呼气不均、乐句开头一次泄气太多。可先练无声"嘶"音延长呼气，再带音高。
局限：歌曲本身有强弱处理，所以唱歌模式只看乐句内部稳定性，阈值比长音宽。它反映"响度稳定"，不是肺活量或呼吸方式的全貌。`,
  },
  {
    key: 'strain',
    label: '松弛不挤卡',
    desc: '声带是否放松，有没有扯着嗓子',
    help: `在看什么：声带振动是否规律、有没有过度挤压。
怎么算：综合三个指标——CPP（倒谱峰突出度，振动越规律干净越高）、H1-H2（前两阶谐波能量差，挤压时通常偏低）、Jitter（相邻周期的音高抖动）。
怎么解读：分数低常见于扯嗓子、高音硬顶、起音过猛。建议先用气泡音、弱延音放松起音，再逐步加大音量。
局限：H1-H2 随音高天然下降，本报告已按你的中位音高分档选参考区间（男声/高音/女声不同档）。它也受元音和设备影响，不能用于判断声带疾病；持续嘶哑请就医。`,
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
局限：F1/F2 主要由元音决定，所以练声统一用「啊」；唱歌时不同歌词带来的波动是正常的。`,
  },
  {
    key: 'lowBand',
    label: '低频',
    desc: '声音的厚度与胸腔感',
    help: `在看什么：80–500Hz 频段的能量占比，对应声音的厚度、胸腔感。
怎么算：对长期平均频谱按频段统计能量比例；唱歌模式只保留人声各次谐波附近的能量（梳状滤波），尽量减少伴奏污染。
怎么解读：偏少可能声音偏薄，偏多可能偏暗、压喉。落在参考区间内即为 100 分。
局限：占比随音高和元音变化很大，只有同一元音、相近音高之间的比较才有意义。`,
  },
  {
    key: 'midBand',
    label: '中频',
    desc: '声音的主体能量，决定饱满度',
    help: `在看什么：500–2000Hz 频段的能量占比，是人声主体能量所在，决定饱满度和"芯"。
怎么算：同低频——长期平均频谱的频段能量比例，唱歌模式经梳状滤波抗伴奏。
怎么解读：偏少常见于声带闭合不够、声音发虚；中频占比偏高本身是正常的，人声能量本就集中在这里。
局限：同样是相对占比，受元音与音高影响，请和自己的历史值比较。`,
  },
  {
    key: 'highBand',
    label: '高频',
    desc: '声音的亮度与穿透力',
    help: `在看什么：2000–8000Hz 频段的能量占比，对应泛音丰富度、亮度与穿透力。
怎么算：同低频/中频的频段能量比例，唱歌模式经梳状滤波抗伴奏。
怎么解读：偏少声音偏闷，可尝试更靠前的咬字位置；偏多不一定好，可能是尖亮、挤压的信号，需配合"松弛不挤卡"一起看。
局限：麦克风对高频的拾取差异较大，绝对值仅供自比。`,
  },
];

export default function Report() {
  const { recordings, ambientRms, reset } = useSession();
  const savedRef = useRef(false);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  // 在本次报告写入历史之前取一次，作为"和自己比"的基线
  const [history] = useState(() => loadHistory());
  const baselines = useMemo(() => historyBaselines(history), [history]);

  const readyKinds = TASKS.filter((t) => recordings[t.kind]).map((t) => t.kind as TaskKind);

  useEffect(() => {
    const tasks = TASKS.filter((t) => recordings[t.kind]).map((t) => ({
      kind: t.kind,
      samples: recordings[t.kind]!.samples,
      sampleRate: recordings[t.kind]!.sampleRate,
    }));
    if (tasks.length === 0) return;
    let cancelled = false;
    runTasksAnalysis(tasks, ambientRms ?? 0.005)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      });
    return () => {
      cancelled = true;
    };
    // recordings 引用只在录音变化时更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordings, ambientRms]);

  useEffect(() => {
    if (report && !savedRef.current) {
      saveReportSummary(report);
      savedRef.current = true;
    }
  }, [report]);

  if (readyKinds.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6">
            <p className="text-sm">还没有任何录音，请先完成练声任务。</p>
            <Link to="/session">
              <Button>去录音</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-24">
        <Loader2 className="size-5 animate-spin" />
        正在分析，约需几秒钟…
      </div>
    );
  }

  const sustain = report.tasks.find((t) => t.kind === 'sustain');
  const rangeTask = report.tasks.find((t) => t.kind === 'scale') ?? sustain;
  const voice = rangeTask ? classifyVoiceRange(rangeTask.f0Range, rangeTask.medianF0) : null;
  const firstPcm = recordings.sustain ?? recordings.scale ?? recordings.glide;
  const radarItems = DIMENSIONS.map((d) => ({
    label: d.label,
    score: report.dimensions[d.key as keyof typeof report.dimensions].score,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">发声体检报告</h1>
          <p className="text-muted-foreground text-sm">
            {new Date(report.meta.createdAt).toLocaleString('zh-CN')}
            {Number.isFinite(report.meta.snr) && ` · 信噪比 ${report.meta.snr.toFixed(1)} dB`}
          </p>
        </div>
        <Link to="/session" onClick={() => reset()}>
          <Button variant="outline">重新检测</Button>
        </Link>
      </header>

      {firstPcm && <QualityNotice pcm={firstPcm} />}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-1">
            <CardTitle className="text-base">七维总览</CardTitle>
            <MetricHelp title="七维总览怎么看">
              <p>雷达图每个轴是一个发声维度，越靠外分数越高；某次数据不足的维度会停在中心，不代表"零分"。</p>
              <p>分数来自通用经验阈值，不是医学或声乐考级标准。更有意义的是多次检测的形状变化：哪个维度在变好、哪个一直拖后腿。</p>
              <p>每张卡片下方的原始指标（CPP、H1-H2 等）是分数的依据，点标题旁的问号可看该维度的详细说明。</p>
            </MetricHelp>
          </div>
          <CardDescription>分数基于通用经验阈值，原始指标见各卡片，建议关注相对趋势</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <RadarChart items={radarItems} />
        </CardContent>
      </Card>

      {voice && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">音域与声部（参考）</CardTitle>
              <MetricHelp title="音域与声部怎么判断">
                <p>音域取本次录音中唱到的最低音与最高音；声部是把你的音域与各声部常见实用音域做匹配，取最吻合的一个。</p>
                <p>男/女声音区按中位音高估计：低于约 150Hz 偏男声，高于约 190Hz 偏女声，之间属于男女声都可能出现的交界区，不硬判。</p>
                <p>真正的声部划分主要看舒适音区（tessitura）、换声点和音色，而不是能喊到的最高音。本次只跨几个半音时会直接提示"不足以判断"。</p>
                <p>想测准：用爬音阶任务，从舒服的最低音唱到不舒服就停的最高音，不要硬顶。</p>
              </MetricHelp>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-bold">{voice.rangeText}</p>
            <p className="text-muted-foreground text-sm">
              {voice.genderText} · {voice.typeText}
            </p>
            <p className="text-muted-foreground text-xs">
              {voice.referenceText}；声部主要看舒适音区与换声点，单段录音只能给参考
            </p>
          </CardContent>
        </Card>
      )}

      {sustain && sustain.envelope.times.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">长音响度包络</CardTitle>
              <MetricHelp title="长音响度包络怎么看">
                <p>横轴是时间，纵轴是响度，虚线是平均值。这条线越平，说明长音维持得越稳。</p>
                <p>开头冲高、结尾塌陷 = 起音太猛、后段气息不够；整体缓慢下滑 = 呼气后段支撑不足；锯齿状抖动 = 喉咙在代偿用力。</p>
                <p>它同时也是"气息稳定"维度里响度 CV 的来源。</p>
              </MetricHelp>
            </div>
            <CardDescription>越平越稳（虚线为平均值）</CardDescription>
          </CardHeader>
          <CardContent>
            <EnvelopeChart times={sustain.envelope.times} rms={sustain.envelope.rms} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <DimensionCard
            key={d.key}
            label={d.label}
            desc={d.desc}
            help={d.help}
            baseline={baselines[d.key]}
            dim={report.dimensions[d.key as keyof typeof report.dimensions]}
          />
        ))}
      </div>

      <p className="text-muted-foreground text-center text-xs">
        本报告为声学特征启发式分析，阈值未经个体标定，不构成医疗或声乐教学诊断；持续声音嘶哑请及时就医
      </p>
    </div>
  );
}
