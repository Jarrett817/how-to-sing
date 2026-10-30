// 演唱复盘工作台：乐句/音符回放与时间轴、音准、响度同步
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Music, Pause, Play, Volume2 } from 'lucide-react';
import type { PcmData } from '@/analysis/types';
import type { SongResult } from '@/analysis/song';
import { createPcmPlayer, type PcmPlayer } from '@/audio/playback';
import { NoteChart } from '@/components/charts/NoteChart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PerformancePlayerProps {
  pcm: PcmData;
  song: SongResult;
}

function nearestValue(times: number[], values: number[], time: number): number {
  if (times.length === 0) return NaN;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (times[mid] <= time) low = mid;
    else high = mid - 1;
  }
  if (low > 0 && Math.abs(times[low - 1] - time) < Math.abs(times[low] - time)) {
    return values[low - 1];
  }
  return values[low];
}

function pitchFeedback(cents: number) {
  const abs = Math.abs(cents);
  if (abs <= 15) return { label: '偏差正常', tone: 'text-emerald-700 bg-emerald-50 border-emerald-100' };
  if (abs <= 35) {
    return {
      label: cents > 0 ? '略偏高' : '略偏低',
      tone: 'text-amber-700 bg-amber-50 border-amber-100',
    };
  }
  return {
    label: cents > 0 ? '明显偏高' : '明显偏低',
    tone: 'text-rose-700 bg-rose-50 border-rose-100',
  };
}

export function PerformancePlayer({ pcm, song }: PerformancePlayerProps) {
  const playerRef = useRef<PcmPlayer | null>(null);
  const [range, setRange] = useState({ start: 0, end: song.duration });
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const player = createPcmPlayer(pcm);
    playerRef.current = player;
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, [pcm]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const update = () => {
      const player = playerRef.current;
      if (!player) return;
      setCurrentTime(player.getCurrentTime());
      if (!player.isPlaying()) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const activeNoteIndex = song.notes.findIndex(
    (note) => currentTime >= note.startSec && currentTime <= note.endSec,
  );
  const activeNote = activeNoteIndex >= 0 ? song.notes[activeNoteIndex] : null;
  const activePhraseIndex = song.phrases.findIndex(
    (phrase) => currentTime >= phrase.startSec && currentTime <= phrase.endSec,
  );
  const currentRms = nearestValue(song.envelope.times, song.envelope.rms, currentTime);
  const currentDb = Number.isFinite(currentRms) && currentRms > 0 ? 20 * Math.log10(currentRms) : NaN;
  const peakRms = useMemo(() => Math.max(...song.envelope.rms, 1e-6), [song.envelope.rms]);
  const feedback = activeNote ? pitchFeedback(activeNote.centsDev) : null;

  const playRange = (start: number, end: number) => {
    playerRef.current?.play(start, end);
    setRange({ start, end });
    setCurrentTime(start);
    setPlaying(true);
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.pause();
      setCurrentTime(player.getCurrentTime());
      setPlaying(false);
      return;
    }
    if (currentTime >= range.end - 0.02) {
      playRange(range.start, range.end);
    } else {
      player.resume();
      setPlaying(true);
    }
  };

  const seek = (seconds: number) => {
    playerRef.current?.seek(seconds);
    setCurrentTime(seconds);
  };

  const wholeSelected = range.start === 0 && Math.abs(range.end - song.duration) < 0.02;

  return (
    <Card className="overflow-hidden border-primary/15 shadow-md shadow-indigo-950/5">
      <CardHeader className="border-b border-indigo-100/70 bg-gradient-to-r from-indigo-50 via-white to-violet-50">
        <div className="flex items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl shadow-sm">
            <Activity className="size-5" />
          </span>
          <div>
            <CardTitle className="text-lg">乐句回放</CardTitle>
            <CardDescription className="mt-1">播放位置与音符、音准偏差和响度同步</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="选择回放段落">
          <Button
            variant={wholeSelected ? 'default' : 'outline'}
            size="sm"
            className="shrink-0"
            onClick={() => playRange(0, song.duration)}
          >
            <Play className="size-3.5" />整段
          </Button>
          {song.phrases.map((phrase, index) => {
            const selected = !wholeSelected && Math.abs(range.start - phrase.startSec) < 0.02;
            return (
              <Button
                key={`${phrase.startSec}-${phrase.endSec}`}
                variant={selected ? 'default' : 'outline'}
                size="sm"
                className="shrink-0"
                onClick={() => playRange(phrase.startSec, phrase.endSec)}
              >
                乐句 {index + 1}
                <span className="opacity-60 tabular-nums">{phrase.startSec.toFixed(1)}s</span>
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="icon"
            className="size-11 shrink-0 rounded-full"
            onClick={togglePlayback}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
          </Button>
          <span className="w-12 text-right text-sm font-medium tabular-nums">{currentTime.toFixed(1)}s</span>
          <input
            type="range"
            aria-label="播放位置"
            min={range.start}
            max={range.end}
            step={0.01}
            value={Math.max(range.start, Math.min(range.end, currentTime))}
            onChange={(event) => seek(Number(event.target.value))}
            className="accent-primary h-1.5 min-w-0 flex-1 cursor-pointer"
          />
          <span className="text-muted-foreground w-12 text-sm tabular-nums">{range.end.toFixed(1)}s</span>
        </div>

        {song.notes.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border bg-white/70 p-3">
            <NoteChart
              notes={song.notes}
              pitchTrack={song.pitchTrack}
              duration={song.duration}
              currentTime={currentTime}
              activeIndex={activeNoteIndex}
              width={920}
              height={220}
              onNoteClick={(note) =>
                playRange(Math.max(0, note.startSec - 0.08), Math.min(song.duration, note.endSec + 0.2))
              }
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <p className="flex items-center gap-1.5 text-xs text-slate-400"><Music className="size-3.5" />当前音符</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{activeNote?.name ?? '—'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {activeNote
                ? `${activeNote.meanF0.toFixed(1)} Hz · 第 ${activeNoteIndex + 1} 个音`
                : activePhraseIndex >= 0
                  ? `第 ${activePhraseIndex + 1} 乐句 · 过渡`
                  : '无识别音符'}
            </p>
          </div>
          <div className={`rounded-2xl border p-4 ${feedback?.tone ?? 'border-border bg-muted/40'}`}>
            <p className="text-xs opacity-70">该音平均音准偏差</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {activeNote ? `${activeNote.centsDev >= 0 ? '+' : ''}${activeNote.centsDev.toFixed(0)}` : '—'}
              <span className="ml-1 text-sm font-normal">音分</span>
            </p>
            <p className="mt-1 text-xs">{feedback?.label ?? '暂无数据'}</p>
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-indigo-950">
            <p className="flex items-center gap-1.5 text-xs opacity-70"><Volume2 className="size-3.5" />当前响度</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {Number.isFinite(currentDb) ? currentDb.toFixed(1) : '—'}
              <span className="ml-1 text-sm font-normal">dBFS</span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-200/70">
              <div
                className="h-full rounded-full bg-indigo-600 transition-[width] duration-75"
                style={{ width: `${Number.isFinite(currentRms) ? Math.min(100, (currentRms / peakRms) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          点击音符回放对应片段；偏差为该音符的完整平均值。时间轴按识别到的乐句和音符对齐。
        </p>
      </CardContent>
    </Card>
  );
}
