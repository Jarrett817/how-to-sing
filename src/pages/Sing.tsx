// 唱歌录音页：手动开始/停止，支持清唱或 KTV 外放伴奏场景
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Mic, Music, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { releaseMic, monitorLevel, requestMic, rmsToPercent, startRecording, type RecordingHandle } from '@/audio/recorder';
import { useSession } from '@/lib/session-store';

const MIN_MS = 8000;
const MAX_MS = 60_000;

type Phase = 'idle' | 'recording' | 'stopping';

export default function Sing() {
  const navigate = useNavigate();
  const { setRecording } = useSession();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const handleRef = useRef<RecordingHandle | null>(null);
  const cancelledRef = useRef(false);
  const previewStopRef = useRef<(() => void) | null>(null);

  // 离开页面时释放麦克风和试音监听
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      previewStopRef.current?.();
      setStream((s) => {
        if (s) releaseMic(s);
        return null;
      });
    };
  }, []);

  // 麦克风必须由用户点击触发申请：部分手机浏览器（含华为）不会响应页面加载时的自动申请
  const enableMic = async () => {
    setRequesting(true);
    try {
      const s = await requestMic();
      if (cancelledRef.current) {
        releaseMic(s);
        return;
      }
      setMicError(null);
      setStream(s);
      previewStopRef.current = monitorLevel(s, setLevel);
    } catch (e) {
      setMicError(e instanceof Error ? e.message : '无法访问麦克风，请重试');
    } finally {
      setRequesting(false);
    }
  };

  // 已有麦克风流时（例如录音失败），重试只需恢复试音，不重复申请设备
  const retryMic = () => {
    if (stream) {
      setMicError(null);
      previewStopRef.current?.();
      previewStopRef.current = monitorLevel(stream, setLevel);
    } else {
      void enableMic();
    }
  };

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
    // 试音监听让位给录音电平监听，避免两个监听器同时跑
    previewStopRef.current?.();
    previewStopRef.current = null;
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
        setMicError(`录音时长不足 ${MIN_MS / 1000} 秒`);
        setPhase('idle');
        return;
      }
      setRecording(pcm);
      navigate('/song-report');
    } catch {
      setMicError('录音失败，请重试');
      setPhase('idle');
    } finally {
      setLevel(0);
      // 回到待录状态后重新开启试音电平（成功时会跳转，由卸载清理）
      if (stream) previewStopRef.current = monitorLevel(stream, setLevel);
    }
  };

  if (micError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6">
            <p className="text-destructive text-sm">{micError}</p>
            <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
              <li>· 出现权限提示时请选择"允许"；之前拒绝过的话，点地址栏的权限图标重新允许</li>
              <li>· 华为/鸿蒙浏览器：在浏览器设置里允许本站使用麦克风，或复制链接到 Chrome / Edge 打开</li>
              <li>· 关闭其他正在录音、语音通话或开会的软件</li>
            </ul>
            <div className="flex gap-2">
              <Button onClick={retryMic} disabled={requesting}>
                {requesting ? '正在请求…' : '重试'}
              </Button>
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-10">
      <header>
        <p className="text-primary text-[10px] font-medium tracking-[0.24em]">RECORDING STUDIO</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">演唱录音</h1>
        <p className="text-muted-foreground mt-2 text-sm">录制 {MIN_MS / 1000}–{MAX_MS / 1000} 秒音频，用于乐句和音符级分析。</p>
      </header>
      <Card className="overflow-hidden border-primary/15 py-0 shadow-lg shadow-indigo-950/5">
        <CardHeader className="bg-gradient-to-br from-slate-950 to-indigo-950 px-6 py-7 text-white">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className={`flex size-11 items-center justify-center rounded-2xl bg-white/10 ${phase === 'recording' ? 'animate-pulse text-rose-300' : 'text-violet-300'}`}>
              <Music className="size-5" />
            </span>
            {phase === 'recording' ? '录音中' : '演唱录音'}
          </CardTitle>
          <CardDescription className="leading-6 text-slate-400">
            支持清唱或 KTV 伴奏。系统识别人声音高，伴奏占主导的片段将标记为低可信。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 px-6 pb-7">
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            <li>· 时长 {MIN_MS / 1000}–{MAX_MS / 1000} 秒，包含完整乐句</li>
            <li>· 有伴奏时，麦克风距离嘴部 15–30 cm，并远离音箱</li>
            <li>· 保持正常演唱音量</li>
          </ul>

          {stream && phase === 'idle' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Mic className="text-primary size-4" />
                <span className="text-muted-foreground text-sm">输入音量</span>
                <div className="bg-muted h-3 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-[width] duration-75"
                    style={{ width: `${rmsToPercent(level)}%` }}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                音量条无变化时，请检查麦克风权限和输入设备。
              </p>
            </div>
          )}

          {phase === 'recording' && (
            <div className="flex flex-col gap-3">
              <Progress value={(elapsed / MAX_MS) * 100} />
              <div className="flex items-center gap-2">
                <Mic className="text-destructive size-4 animate-pulse" />
                <div className="bg-muted h-3 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-[width] duration-75"
                    style={{ width: `${rmsToPercent(level)}%` }}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                录音中 {(elapsed / 1000).toFixed(1)}s / {MAX_MS / 1000}s
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {phase === 'idle' && !stream && (
              <>
                <Button onClick={() => void enableMic()} disabled={requesting}>
                  {requesting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      正在请求麦克风…
                    </>
                  ) : (
                    <>
                      <Mic className="size-4" />
                      开启麦克风
                    </>
                  )}
                </Button>
                <Link to="/">
                  <Button variant="outline">返回</Button>
                </Link>
              </>
            )}
            {phase === 'idle' && stream && (
              <>
                <Button size="lg" className="h-12 px-6" onClick={start}><Mic className="size-4" />开始录音</Button>
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

    </div>
  );
}
