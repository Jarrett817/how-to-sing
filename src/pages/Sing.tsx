// 唱歌录音页：手动开始/停止，支持清唱或 KTV 外放伴奏场景
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Mic, Music, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { releaseMic, requestMic, startRecording, type RecordingHandle } from '@/audio/recorder';
import { useSession } from '@/lib/session-store';

const MIN_MS = 8000;
const MAX_MS = 60_000;

type Phase = 'idle' | 'recording' | 'stopping';

export default function Sing() {
  const navigate = useNavigate();
  const { setRecording } = useSession();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const handleRef = useRef<RecordingHandle | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    requestMic()
      .then((s) => {
        if (cancelledRef.current) releaseMic(s);
        else setStream(s);
      })
      .catch(() => setMicError('无法访问麦克风，请在浏览器中授权后重试'));
    return () => {
      cancelledRef.current = true;
      setStream((s) => {
        if (s) releaseMic(s);
        return null;
      });
    };
  }, []);

  // 计时 + 到上限自动停止
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => {
      const started = handleRef.current?.startedAt ?? Date.now();
      const ms = Date.now() - started;
      setElapsed(ms);
      if (ms >= MAX_MS) void stopRecording();
    }, 200);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => {
    if (!stream) return;
    handleRef.current = startRecording(stream, setLevel, MAX_MS);
    setElapsed(0);
    setPhase('recording');
  };

  const stopRecording = async () => {
    const handle = handleRef.current;
    if (!handle || phase !== 'recording') return;
    setPhase('stopping');
    try {
      const pcm = await handle.stop();
      if (pcm.samples.length / pcm.sampleRate < MIN_MS / 1000) {
        setMicError(`录音太短（至少 ${MIN_MS / 1000} 秒），请唱完整一两句再停止`);
        setPhase('idle');
        return;
      }
      setRecording('song', pcm);
      navigate('/song-report');
    } catch {
      setMicError('录音失败，请重试');
      setPhase('idle');
    } finally {
      setLevel(0);
    }
  };

  if (micError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6">
            <p className="text-destructive text-sm">{micError}</p>
            <div className="flex gap-2">
              <Button onClick={() => setMicError(null)}>重试</Button>
              <Link to="/">
                <Button variant="outline">返回首页</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music className="size-5" />
            唱一段，直接分析
          </CardTitle>
          <CardDescription>
            清唱或跟着 KTV 伴奏唱都可以。分析只针对你的人声：会自动锁定你的音高，
            剔除伴奏占主导的片段；伴奏太盖过人声时会提示而不是硬算。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            <li>· 唱 {MIN_MS / 1000}–{MAX_MS / 1000} 秒，包含一两句完整的歌词效果最好</li>
            <li>· 有伴奏时：麦克风离嘴近一点（15–30cm），离音箱远一点</li>
            <li>· 正常唱即可，不用刻意大声</li>
          </ul>

          {phase === 'recording' && (
            <div className="flex flex-col gap-3">
              <Progress value={(elapsed / MAX_MS) * 100} />
              <div className="flex items-center gap-2">
                <Mic className="text-destructive size-4 animate-pulse" />
                <div className="bg-muted h-3 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-[width] duration-75"
                    style={{ width: `${Math.min(100, level * 400)}%` }}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                录音中 {(elapsed / 1000).toFixed(1)}s / {MAX_MS / 1000}s
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {phase === 'idle' && (
              <>
                <Button onClick={start} disabled={!stream}>
                  {stream ? '开始录音' : '等待麦克风…'}
                </Button>
                <Link to="/">
                  <Button variant="outline">返回</Button>
                </Link>
              </>
            )}
            {phase === 'recording' && (
              <Button variant="destructive" onClick={() => void stopRecording()} disabled={elapsed < MIN_MS}>
                <Square className="size-4" />
                停止并分析{elapsed < MIN_MS ? `（至少 ${MIN_MS / 1000}s）` : ''}
              </Button>
            )}
            {phase === 'stopping' && (
              <Button disabled>
                <Loader2 className="size-4 animate-spin" />
                正在处理…
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-sm">录音只在本机内存处理，不会上传</p>
    </div>
  );
}
