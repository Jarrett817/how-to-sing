// 唱歌分析报告：七维评分（抗伴奏降级）+ 音准/颤音/音域/音符回放（分析在 Worker 中进行）
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadarChart } from '@/components/charts/RadarChart';
import { EnvelopeChart } from '@/components/charts/EnvelopeChart';
import { NoteChart } from '@/components/charts/NoteChart';
import { DimensionCard } from '@/components/DimensionCard';
import { MetricHelp } from '@/components/MetricHelp';
import { QualityNotice } from '@/components/QualityNotice';
import { runSongAnalysis } from '@/analysis/client';
import type { SongReport } from '@/analysis/song';
import { classifyVoiceRange } from '@/analysis/voice-range';
import { playSegment, stopPlayback } from '@/audio/playback';
import { historyBaselines, loadHistory, saveReportSummary, useSession } from '@/lib/session-store';
import { DIMENSIONS } from '@/pages/Report';

export default function SongReport() {
  const { recordings, reset } = useSession();
  const pcm = recordings.song;
  const [report, setReport] = useState<SongReport | null>(null);
  const [playingIdx, setPlayingIdx] = useState(-1);
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

  // 离开报告页时停止回放
  useEffect(() => () => stopPlayback(), []);

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
  const voice = classifyVoiceRange(song.f0Range, song.medianF0);
  const radarItems = DIMENSIONS.map((d) => ({
    label: d.label,
    score: report.dimensions[d.key as keyof typeof report.dimensions].score,
  }));
  const degraded = song.dominantRatio < 0.3 && song.voicedRatio > 0.2;

  const handleNoteClick = (_note: (typeof song.notes)[number], index: number) => {
    if (playingIdx === index) {
      stopPlayback();
      setPlayingIdx(-1);
      return;
    }
    const note = song.notes[index];
    // 前后各留一点余量，避免起音/收音被切得太生硬
    playSegment(pcm, Math.max(0, note.startSec - 0.08), note.endSec + 0.2, () => setPlayingIdx(-1));
    setPlayingIdx(index);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">唱歌分析报告</h1>
          <p className="text-muted-foreground text-sm">
            {new Date(report.meta.createdAt).toLocaleString('zh-CN')} · 时长{' '}
            {song.duration.toFixed(1)}s · 人声主导 {Math.round(song.dominantRatio * 100)}%
          </p>
        </div>
        <Link to="/sing" onClick={() => reset()}>
          <Button variant="outline">再唱一段</Button>
        </Link>
      </header>

      <QualityNotice pcm={pcm} />

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
              <p>与练声报告同一套维度。雷达图越靠外分数越高，停在中心的维度是"数据不足"（通常因为伴奏盖过人声），不是零分。</p>
              <p>分数来自通用经验阈值，更有价值的是和自己过去的形状对比。每张卡片标题旁的问号有该维度的详细说明。</p>
            </MetricHelp>
          </div>
          <CardDescription>与练声报告同一套维度；伴奏干扰大的维度会标"数据不足"</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <RadarChart items={radarItems} />
        </CardContent>
      </Card>

      {song.notes.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1">
              <CardTitle className="text-base">音符与音准</CardTitle>
              <MetricHelp title="音符图怎么看、怎么回放">
                <p>每个色块是一个识别出的音符：横轴时间、纵轴音高，颜色表示它与最近标准音的偏差（绿 ≤15 音分，黄 ≤35，红 &gt;35；100 音分 = 半个音）。</p>
                <p>点任意色块可以回放这一小段录音，再点一次停止。对照"听到的"和"看到的"偏差，是最直接的音准练习方式。</p>
                <p>注意：色块颜色包含整体起音偏移。如果整段都偏黄偏红但"扣除偏移后的音准偏差"很小，说明你只是起音起高/起低了，音准控制本身没问题。</p>
                <p>滑音、转音和过短的装饰音不参与统计，伴奏盖过人声的片段也会被剔除。</p>
              </MetricHelp>
            </div>
            <CardDescription>
              高度=音高，颜色=偏差；点击色块回放该音符（再点一次停止）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NoteChart notes={song.notes} onNoteClick={handleNoteClick} activeIndex={playingIdx} />
          </CardContent>
        </Card>
      )}

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
                <p>男/女声音区按中位音高估计：低于约 150Hz 偏男声，高于约 190Hz 偏女声，之间不硬判。</p>
                <p>一段歌曲的音域由歌决定，不代表你的极限音域。想测真实音域和声部，请用练声模式里的"爬音阶"，从舒服的低音唱到不舒服就停。</p>
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
                <p>有伴奏时这条线包含伴奏能量，只适合看大体走势，精确的气息评估请以练声模式的长音为准。</p>
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
