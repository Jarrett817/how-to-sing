// 唱歌分析报告：七维评分（抗伴奏降级）+ 音准/颤音/音符图
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
import { analyzeSongReport, midiToName, type SongReport } from '@/analysis/song';
import { saveReportSummary, useSession } from '@/lib/session-store';
import { DIMENSIONS } from '@/pages/Report';

function f0ToMidi(f0: number): number {
  return Math.round(69 + 12 * Math.log2(f0 / 440));
}

export default function SongReport() {
  const { recordings, reset } = useSession();
  const pcm = recordings.song;
  const [report, setReport] = useState<SongReport | null>(null);
  const savedRef = useRef(false);

  // 分析较重（几十秒音频），先渲染 loading 再算
  useEffect(() => {
    if (!pcm) return;
    const timer = window.setTimeout(() => {
      setReport(analyzeSongReport(pcm));
    }, 50);
    return () => window.clearTimeout(timer);
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
  const radarItems = DIMENSIONS.map((d) => ({
    label: d.label,
    score: report.dimensions[d.key as keyof typeof report.dimensions].score,
  }));
  const degraded = song.dominantRatio < 0.3 && song.voicedRatio > 0.2;

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
        <CardHeader>
          <CardTitle className="text-base">七维总览</CardTitle>
          <CardDescription>与练声报告同一套维度；伴奏干扰大的维度会标"数据不足"</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <RadarChart items={radarItems} />
        </CardContent>
      </Card>

      {song.notes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">音符与音准</CardTitle>
            <CardDescription>
              绿色=准（≤15音分） 黄色=略偏（≤35） 红色=明显偏（&gt;35）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NoteChart notes={song.notes} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">音准</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-bold tabular-nums">
              {Number.isFinite(song.pitchAccuracy) ? `±${song.pitchAccuracy.toFixed(0)}` : '—'}
              <span className="text-muted-foreground text-sm font-normal"> 音分</span>
            </p>
            <p className="text-muted-foreground text-sm">
              {!Number.isFinite(song.pitchAccuracy)
                ? '数据不足'
                : song.pitchAccuracy <= 15
                  ? '音准很好'
                  : song.pitchAccuracy <= 35
                    ? '略有偏差，注意听伴奏定音'
                    : '偏差较大，先慢速跟唱找音高'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">颤音</CardTitle>
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">音域</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-2xl font-bold tabular-nums">
              {Number.isFinite(song.f0Range[0])
                ? `${midiToName(f0ToMidi(song.f0Range[0]))} – ${midiToName(f0ToMidi(song.f0Range[1]))}`
                : '—'}
            </p>
            <p className="text-muted-foreground text-sm">
              {song.notes.length > 0
                ? `共 ${song.notes.length} 个音符 · ${song.phrases.length} 个乐句`
                : '未识别到稳定音符'}
            </p>
          </CardContent>
        </Card>
      </div>

      {song.envelope.times.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">响度包络</CardTitle>
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
            dim={report.dimensions[d.key as keyof typeof report.dimensions]}
          />
        ))}
      </div>

      <div className="flex justify-center gap-2">
        <Badge variant="outline">人声主导帧 {song.dominantFrames}</Badge>
        <Badge variant="outline">浊音占比 {Math.round(song.voicedRatio * 100)}%</Badge>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        本报告为声学特征启发式分析，有伴奏时频谱类指标基于人声主导帧与梳状滤波估计，精度有限，结果供参考
      </p>
    </div>
  );
}
