// 练声任务页：引导用户依次完成 3 个录音任务
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Loader2, Mic, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { recordPcm, monitorLevel, releaseMic, requestMic, rmsToPercent } from '@/audio/recorder';
import { TASKS } from '@/lib/tasks';
import { useSession } from '@/lib/session-store';

type StepPhase = 'idle' | 'recording' | 'done';

export default function Session() {
  const navigate = useNavigate();
  const { recordings, setRecording, clearRecording } = useSession();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<StepPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
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
      setPhase('idle');
      previewStopRef.current?.();
      previewStopRef.current = monitorLevel(stream, setLevel);
    } else {
      void enableMic();
    }
  };

  const task = TASKS[step];
  const isLast = step === TASKS.length - 1;
  const recorded = recordings[task.kind] != null;

  const startRecording = async () => {
    if (!stream) return;
    // 试音监听让位给录音电平监听
    previewStopRef.current?.();
    previewStopRef.current = null;
    setPhase('recording');
    setProgress(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - startedAt) / task.durationMs) * 100));
    }, 100);
    try {
      const pcm = await recordPcm(stream, task.durationMs, setLevel);
      setRecording(task.kind, pcm);
      setPhase('done');
    } catch {
      setMicError('录音失败，请重试');
      setPhase('idle');
    } finally {
      window.clearInterval(timer);
      setLevel(0);
      if (!cancelledRef.current) previewStopRef.current = monitorLevel(stream, setLevel);
    }
  };

  const reRecord = () => {
    clearRecording(task.kind);
    setPhase('idle');
    setProgress(0);
  };

  const next = () => {
    if (isLast) {
      navigate('/report');
    } else {
      setStep(step + 1);
      setPhase('idle');
      setProgress(0);
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
      {/* 步骤指示 */}
      <ol className="flex items-center gap-2">
        {TASKS.map((t, i) => (
          <li key={t.kind} className="flex items-center gap-2">
            <span
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-medium ${
                i < step || recordings[t.kind]
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                    ? 'border-primary text-primary'
                    : 'text-muted-foreground'
              }`}
            >
              {recordings[t.kind] ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium' : 'text-muted-foreground'}>{t.title}</span>
            {i < TASKS.length - 1 && <span className="bg-border mx-2 h-px w-8" />}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{task.title}</CardTitle>
          <CardDescription>{task.instruction}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            时长 {task.durationMs / 1000} 秒 · 用于判断：{task.purpose}
          </p>

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
                试着说句话，音量条应随之跳动；如果一直不动，请检查系统麦克风权限和输入设备。
              </p>
            </div>
          )}

          {phase === 'recording' && (
            <div className="flex flex-col gap-3">
              <Progress value={progress} />
              <div className="flex items-center gap-2">
                <Mic className="text-destructive size-4 animate-pulse" />
                <div className="bg-muted h-3 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-[width] duration-75"
                    style={{ width: `${rmsToPercent(level)}%` }}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-sm">录音中…保持发声</p>
            </div>
          )}

          <div className="flex gap-2">
            {phase === 'idle' && !recorded && !stream && (
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
                  <Button variant="outline">返回首页</Button>
                </Link>
              </>
            )}
            {phase === 'idle' && !recorded && stream && (
              <Button onClick={() => void startRecording()}>开始录音</Button>
            )}
            {phase === 'idle' && recorded && (
              <>
                <Button variant="outline" onClick={reRecord}>
                  <RotateCcw className="size-4" />
                  重录
                </Button>
                <Button onClick={next}>{isLast ? '生成报告' : '下一项'}</Button>
              </>
            )}
            {phase === 'done' && (
              <>
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Check className="size-4" /> 已完成
                </p>
                <Button variant="outline" onClick={reRecord}>
                  <RotateCcw className="size-4" />
                  重录
                </Button>
                <Button onClick={next}>{isLast ? '生成报告' : '下一项'}</Button>
              </>
            )}
            {phase === 'recording' && (
              <Button disabled>
                <Loader2 className="size-4 animate-spin" />
                录音中
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-center text-sm">
        完成全部 {TASKS.length} 项后生成报告，录音不会离开你的设备
      </p>
    </div>
  );
}
