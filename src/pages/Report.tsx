// 报告页：七维评分 + 原始指标 + 建议
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadarChart } from '@/components/charts/RadarChart';
import { EnvelopeChart } from '@/components/charts/EnvelopeChart';
import { DimensionCard } from '@/components/DimensionCard';
import { analyzeTasks } from '@/analysis/report';
import type { TaskKind } from '@/analysis/types';
import { saveReportSummary, useSession } from '@/lib/session-store';
import { TASKS } from '@/lib/tasks';

export const DIMENSIONS: { key: string; label: string }[] = [
  { key: 'breath', label: '气息稳定' },
  { key: 'strain', label: '松弛不挤卡' },
  { key: 'placement', label: '位置靠前' },
  { key: 'resonance', label: '腔体充分' },
  { key: 'lowBand', label: '低频' },
  { key: 'midBand', label: '中频' },
  { key: 'highBand', label: '高频' },
];

export default function Report() {
  const { recordings, ambientRms, reset } = useSession();
  const savedRef = useRef(false);

  const readyKinds = TASKS.filter((t) => recordings[t.kind]).map((t) => t.kind as TaskKind);
  const report = useMemo(() => {
    if (readyKinds.length === 0) return null;
    const tasks = TASKS.filter((t) => recordings[t.kind]).map((t) => ({
      kind: t.kind,
      samples: recordings[t.kind]!.samples,
      sampleRate: recordings[t.kind]!.sampleRate,
    }));
    return analyzeTasks(tasks, ambientRms ?? 0.005);
    // recordings 引用只在录音变化时更新，useMemo 安全
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordings, ambientRms]);

  useEffect(() => {
    if (report && !savedRef.current) {
      saveReportSummary(report);
      savedRef.current = true;
    }
  }, [report]);

  if (!report) {
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

  const sustain = report.tasks.find((t) => t.kind === 'sustain');
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">七维总览</CardTitle>
          <CardDescription>分数基于通用经验阈值，原始指标见各卡片，建议关注相对趋势</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <RadarChart items={radarItems} />
        </CardContent>
      </Card>

      {sustain && sustain.envelope.times.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">长音响度包络</CardTitle>
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
            dim={report.dimensions[d.key as keyof typeof report.dimensions]}
          />
        ))}
      </div>

      <p className="text-muted-foreground text-center text-xs">
        本报告为声学特征启发式分析，阈值未经个体标定，不构成医疗或声乐教学诊断
      </p>
    </div>
  );
}
