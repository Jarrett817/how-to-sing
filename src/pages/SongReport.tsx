// 唱歌分析报告：七维评分（抗伴奏降级）+ 音准/颤音/音域/音符回放（分析在 Worker 中进行）
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AudioWaveform, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadarChart } from '@/components/charts/RadarChart';
import { EnvelopeChart } from '@/components/charts/EnvelopeChart';
import { PerformancePlayer } from '@/components/PerformancePlayer';
import { DIMENSIONS, DimensionCard } from '@/components/DimensionCard';
import { MetricHelp } from '@/components/MetricHelp';
import { QualityNotice } from '@/components/QualityNotice';
import { runSongAnalysis } from '@/analysis/client';
import type { SongReport } from '@/analysis/song';
import { classifyVoiceRange } from '@/analysis/voice-range';
import { historyBaselines, loadGender, loadHistory, saveReportSummary, useSession } from '@/lib/session-store';
import { saveSession } from '@/lib/storage';

export default function SongReport() {
  const { recording: pcm, storedReport, reset } = useSession();
  const [gender] = useState(loadGender);
  // 历史回看直接使用已存报告，不再重新分析
  const [report, setReport] = useState<SongReport | null>(storedReport);
  const savedRef = useRef(false);
  // 在本次报告写入历史之前取一次，作为个人基线
  const [history] = useState(() => loadHistory());
  const baselines = historyBaselines(history);

  useEffect(() => {
    if (!pcm || storedReport) return;
    let cancelled = false;
    runSongAnalysis(pcm)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pcm, storedReport]);

  useEffect(() => {
    // 仅新录音写入：历史回看的报告已在存储中
    if (report && pcm && !storedReport && !savedRef.current) {
      savedRef.current = true;
      saveReportSummary(report);
      void saveSession(pcm, report);
    }
  }, [report, pcm, storedReport]);

  if (!pcm) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6">
            <p className="text-sm">暂无录音数据。</p>
            <Link to="/sing">
              <Button>新建录音</Button>
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
        正在分析…
      </div>
    );
  }

  const { song } = report;
  const voice = gender ? classifyVoiceRange(song.f0Range, gender) : null;
  const radarItems = DIMENSIONS.map((d) => ({
    label: d.label,
    score: report.dimensions[d.key as keyof typeof report.dimensions].score,
  }));
  const degraded = song.dominantRatio < 0.3 && song.voicedRatio > 0.2;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-xl shadow-indigo-950/15 sm:p-8">
        <div className="absolute -right-20 -top-24 size-64 rounded-full bg-violet-600/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-[10px] tracking-[0.24em] text-violet-300">
              <AudioWaveform className="size-4" />VOCAL SESSION REPORT
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">演唱分析报告</h1>
            <p className="mt-3 text-sm text-slate-400">
              {new Date(report.meta.createdAt).toLocaleString('zh-CN')} · 时长{' '}
              {song.duration.toFixed(1)}s · 人声主导 {Math.round(song.dominantRatio * 100)}%
            </p>
          </div>
          <Link to="/sing" onClick={() => reset()}>
            <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/20">
              <RotateCcw className="size-4" />新建录音
            </Button>
          </Link>
        </div>
      </header>

      <QualityNotice pcm={pcm} />

      <PerformancePlayer pcm={pcm} song={song} />

      {song.voicedRatio < 0.2 && (
        <Card>
          <CardContent className="pt-6 text-sm">
            未检测到稳定人声旋律，请重新录制。
          </CardContent>
        </Card>
      )}
      {degraded && (
        <Card>
          <CardContent className="pt-6 text-sm">
            伴奏占主导片段较多，频谱类指标标记为数据不足；音准与音符指标仍基于音高计算。
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              分析方法
            </summary>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-5">
              <li>
                <span className="text-foreground font-medium">人声识别</span>
                ：将录音切分为短时片段，根据谐波特征提取人声基频，并与伴奏和环境噪声区分。
              </li>
              <li>
                <span className="text-foreground font-medium">可信度筛选</span>
                ：伴奏占主导的片段标记为低可信；音色类指标仅在人声占主导的片段上计算。
              </li>
              <li>
                <span className="text-foreground font-medium">指标计算</span>
                ：音准衡量与十二平均律标准音的偏差；颤音衡量长音周期性变化；气息衡量乐句内音量稳定性；音色维度衡量频谱能量分布。
              </li>
            </ol>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-1">
            <CardTitle className="text-base">七维总览</CardTitle>
            <MetricHelp title="七维总览">
              <p>雷达图越靠外分数越高；位于中心的维度表示数据不足，通常由伴奏占主导导致。</p>
              <p>分数基于通用经验阈值，适用于历史记录的纵向对比。</p>
            </MetricHelp>
          </div>
          <CardDescription>伴奏干扰大的维度会标"数据不足"</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <RadarChart items={radarItems} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">音准</CardTitle>
              <MetricHelp title="音准指标">
                <p>偏差（大数字）：扣除整段起音偏移后，各音符与十二平均律标准音的平均偏差，数值越小越稳定。</p>
                <p>整体起音偏移（小字）：整段有符号平均偏移，反映定调偏差，不反映音准稳定性。</p>
                <p>无原曲旋律参照，指标衡量的是与十二平均律标准音的贴合度，不与原唱比对。</p>
              </MetricHelp>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-bold tabular-nums">
              {Number.isFinite(song.pitchStability) ? `±${song.pitchStability.toFixed(0)}` : '—'}
              <span className="text-muted-foreground text-sm font-normal"> 音分</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {!Number.isFinite(song.pitchStability)
                ? '数据不足'
                : song.pitchStability <= 15
                  ? '偏差正常'
                  : song.pitchStability <= 35
                    ? '存在轻微偏差'
                    : '偏差较大'}
            </p>
            {Number.isFinite(song.pitchOffset) && (
              <p className="text-muted-foreground text-xs tabular-nums">
                整体起音偏移 {song.pitchOffset >= 0 ? '+' : ''}
                {song.pitchOffset.toFixed(0)} 音分（{Math.abs(song.pitchOffset) < 10 ? '偏移不明显' : song.pitchOffset > 0 ? '整体偏高' : '整体偏低'}）
              </p>
            )}
            <p className="text-muted-foreground text-xs">大数字已扣除整体偏移；100 音分 = 半个音</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">颤音</CardTitle>
              <MetricHelp title="颤音">
                <p>速率（Hz）为每秒周期数，幅度（音分）为音高波动范围。</p>
                <p>计算：对足够长的音符去除线性趋势后，对音高曲线做自相关，在 4–8Hz 区间检测周期性。</p>
                <p>常见自然颤音范围约 4.5–7Hz、±50–100 音分；无颤音不代表异常。短音符、转音及伴奏占主导片段不参与检测。</p>
              </MetricHelp>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-bold tabular-nums">
              {Number.isFinite(song.vibrato.rate) ? song.vibrato.rate.toFixed(1) : '—'}
              <span className="text-muted-foreground text-sm font-normal"> Hz</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {Number.isFinite(song.vibrato.rate)
                ? `幅度约 ±${(song.vibrato.extent / 2).toFixed(0)} 音分${song.vibrato.rate >= 4 && song.vibrato.rate <= 8 ? '，速率在常见范围' : song.vibrato.rate < 4 ? '，速率偏慢' : '，速率偏快'}`
                : '未检测到明显周期性颤音'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">音域与声部</CardTitle>
              <MetricHelp title="音域与声部">
                <p>音域为本段录音检测到的最低音与最高音；声部为该音域与常见实用音域区间的匹配结果。</p>
                <p>声部匹配使用首页选择的性别参考区间。</p>
                <p>本段音域由曲目决定，不代表演唱者的极限音域。</p>
              </MetricHelp>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-bold tabular-nums">
              {voice ? voice.rangeText : '—'}
            </p>
            <p className="text-muted-foreground text-sm">
              {voice ? `${voice.genderText} · ${voice.typeText}` : '未识别到稳定音符'}
            </p>
            <p className="text-muted-foreground text-xs">
              {voice
                ? `${voice.referenceText}；共 ${song.notes.length} 个音符 · ${song.phrases.length} 个乐句`
                : '音符数据不足'}
            </p>
          </CardContent>
        </Card>
      </div>

      {song.envelope.times.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">响度包络</CardTitle>
              <MetricHelp title="响度包络">
                <p>横轴为时间，纵轴为 RMS 响度；乐句间的下凹通常对应换气或停顿。</p>
                <p>乐句内曲线平稳度对应响度稳定性。有伴奏时曲线包含伴奏能量，仅反映总体走势。</p>
              </MetricHelp>
            </div>
            <CardDescription>时间轴上的 RMS 响度变化</CardDescription>
          </CardHeader>
          <CardContent>
            <EnvelopeChart times={song.envelope.times} rms={song.envelope.rms} />
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

      <div className="flex justify-center gap-2">
        <Badge variant="outline">人声可信片段 {song.dominantFrames} 帧</Badge>
        <Badge variant="outline">人声时长占比 {Math.round(song.voicedRatio * 100)}%</Badge>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        声学特征启发式分析，结果仅供参考，不构成医疗诊断
      </p>
    </div>
  );
}
