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

export default function SongReport() {
  const { recording: pcm, reset } = useSession();
  const [gender] = useState(loadGender);
  const [report, setReport] = useState<SongReport | null>(null);
  const savedRef = useRef(false);
  // 在本次报告写入历史之前取一次，作为个人基线
  const [history] = useState(() => loadHistory());
  const baselines = historyBaselines(history);

  useEffect(() => {
    if (!pcm) return;
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
  }, [pcm]);

  useEffect(() => {
    if (report && !savedRef.current) {
      saveReportSummary(report);
      savedRef.current = true;
    }
  }, [report]);

  if (!pcm) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6">
            <p className="text-sm">还没有唱歌录音，先去唱一段。</p>
            <Link to="/sing">
              <Button>去唱歌</Button>
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
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">你的演唱，逐句看清。</h1>
            <p className="mt-3 text-sm text-slate-400">
              {new Date(report.meta.createdAt).toLocaleString('zh-CN')} · 时长{' '}
              {song.duration.toFixed(1)}s · 人声主导 {Math.round(song.dominantRatio * 100)}%
            </p>
          </div>
          <Link to="/sing" onClick={() => reset()}>
            <Button variant="secondary" className="bg-white/10 text-white hover:bg-white/20">
              <RotateCcw className="size-4" />再唱一段
            </Button>
          </Link>
        </div>
      </header>

      <QualityNotice pcm={pcm} />

      <PerformancePlayer pcm={pcm} song={song} />

      {song.voicedRatio < 0.2 && (
        <Card>
          <CardContent className="pt-6 text-sm">
            没检测到稳定的人声旋律——可能伴奏声太大或离麦克风太远。建议清唱，或麦克风离嘴近一点、离音箱远一点再录。
          </CardContent>
        </Card>
      )}
      {degraded && (
        <Card>
          <CardContent className="pt-6 text-sm">
            伴奏占主导的片段较多，频谱类指标已降级为"数据不足"；音准、音符图等基于音高的指标仍然有效。
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              这个报告是怎么分析出来的？
            </summary>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-5">
              <li>
                <span className="text-foreground font-medium">找到你的声音</span>
                ：把录音切成许多小片段，寻找带有人声特征（一串规律排列的谐波）的音高，把它和伴奏、环境杂音区分开。
              </li>
              <li>
                <span className="text-foreground font-medium">只听你的声音</span>
                ：伴奏太响、盖过人声的片段会被判为不可信——音准、颤音照常计算；音色类指标只在你声音占主导的片段上取值，尽量不被伴奏污染。
              </li>
              <li>
                <span className="text-foreground font-medium">计算指标</span>
                ：音准 = 你唱的音离标准音差多少（拆成"整体起音偏移"和"扣除偏移后的偏差"两个数）；颤音 = 长音是否有规律地轻摇；气息 = 乐句内音量是否平稳；音色类维度 = 声音能量在不同频率上的分布。
              </li>
            </ol>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-1">
            <CardTitle className="text-base">七维总览</CardTitle>
            <MetricHelp title="七维总览怎么看">
              <p>雷达图越靠外分数越高，停在中心的维度是"数据不足"（通常因为伴奏盖过人声），不是零分。</p>
              <p>分数来自通用经验阈值，更有价值的是和自己过去的形状对比。每张卡片标题旁的问号有该维度的详细说明。</p>
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
              <MetricHelp title="音准的两个数分别是什么意思">
                <p>扣除偏移后的偏差（大数字）：把整段的整体起音偏移去掉之后，每个音离它该在的位置还差多少。这才是"唱得稳不稳、准不准"的核心指标，越小越好。</p>
                <p>整体起音偏移（小字）：整段演唱平均起高（+）或起低（−）了多少音分。它反映的是起音和定调，不是音准能力。</p>
                <p>举例：整体起高 30 音分但每个音都唱得很稳的人，旧算法会显示"音准差"，新口径会显示偏移 +30、偏差很小——更符合实际。</p>
                <p>没有原曲旋律作参照，所以这里衡量的是"与十二平均律标准音的贴合度"，不等于和原唱比对。</p>
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
                  ? '音准很好'
                  : song.pitchStability <= 35
                    ? '略有偏差，注意听伴奏定音'
                    : '偏差较大，先慢速跟唱找音高'}
            </p>
            {Number.isFinite(song.pitchOffset) && (
              <p className="text-muted-foreground text-xs tabular-nums">
                整体起音偏移 {song.pitchOffset >= 0 ? '+' : ''}
                {song.pitchOffset.toFixed(0)} 音分（{Math.abs(song.pitchOffset) < 10 ? '定调正常' : song.pitchOffset > 0 ? '整体起高' : '整体起低'}）
              </p>
            )}
            <p className="text-muted-foreground text-xs">大数字已扣除整体偏移；100 音分 = 半个音</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">颤音</CardTitle>
              <MetricHelp title="颤音速率和幅度怎么看">
                <p>颤音是长音有规律地轻摇。速率（Hz）表示每秒摇几次，幅度（音分）表示摇多大。</p>
                <p>算法：对每个足够长的音符，先去掉整体滑音/漂移趋势，再对音高曲线做自相关，在 4–8Hz 区间找周期性。</p>
                <p>自然颤音大多在 4.5–7Hz、幅度 ±50–100 音分。过慢像摇晃、过快常伴随发紧；没有颤音不等于差，长直音可以是刻意处理。</p>
                <p>短音符、转音不参与检测；伴奏太强的片段也不算。</p>
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
                ? `幅度约 ±${(song.vibrato.extent / 2).toFixed(0)} 音分${song.vibrato.rate >= 4 && song.vibrato.rate <= 8 ? '，速率在自然范围' : song.vibrato.rate < 4 ? '，偏慢' : '，偏快（可能发紧）'}`
                : '未检测到明显颤音（长直音也可能是刻意的）'}
            </p>
            <p className="text-muted-foreground text-xs">
              颤音 = 声音有规律地轻摇；Hz 表示每秒摇几次
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">音域与声部</CardTitle>
              <MetricHelp title="音域与声部怎么判断">
                <p>音域 = 这段演唱中唱到的最低音与最高音；声部是把这段音域与各声部常见实用音域匹配后的最吻合项。</p>
                <p>声部参考使用你在首页选择的性别，不再根据音高猜测性别。</p>
                <p>一段歌曲的音域由歌决定，不代表你的极限音域；这里的声部仅是音域匹配参考。</p>
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
                : '换一段旋律完整的录音再试'}
            </p>
          </CardContent>
        </Card>
      </div>

      {song.envelope.times.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">响度包络</CardTitle>
              <MetricHelp title="响度包络怎么看">
                <p>横轴时间、纵轴响度。乐句之间的下凹通常是换气点，可以检查换气是否打断了乐句。</p>
                <p>看乐句内部：越平气息越稳；开头冲高后快速下滑 = 起音泄气太多；结尾塌陷 = 后段支撑不足。</p>
                <p>有伴奏时这条线包含伴奏能量，只适合看大体走势。</p>
              </MetricHelp>
            </div>
            <CardDescription>乐句之间的下凹是换气点；乐句内部越平气息越稳</CardDescription>
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
        本报告为声学特征启发式分析，有伴奏时频谱类指标基于人声主导帧与梳状滤波估计，精度有限，结果供参考；不构成医疗诊断
      </p>
    </div>
  );
}
