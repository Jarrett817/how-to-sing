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
                试着说句话或唱一句，音量条应随之跳动；如果一直不动，请检查系统麦克风权限和输入设备。
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
                <Button onClick={start}>开始录音</Button>
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
