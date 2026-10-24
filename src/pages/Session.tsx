// 练声任务页：引导用户依次完成 3 个录音任务
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Loader2, Mic, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { recordPcm, releaseMic, requestMic } from '@/audio/recorder';
import { TASKS } from '@/lib/tasks';
import { useSession } from '@/lib/session-store';

type StepPhase = 'idle' | 'recording' | 'done';

export default function Session() {
  const navigate = useNavigate();
  const { recordings, setRecording, clearRecording } = useSession();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<StepPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [level, setLevel] = useState(0);
  const cancelledRef = useRef(false);

  // 进入页面即申请麦克风，离开释放
  useEffect(() => {
    cancelledRef.current = false;
    requestMic()
      .then((s) => {
        if (cancelledRef.current) releaseMic(s);
        else setStream(s);
      })
      .catch(() => setMicError('无法访问麦克风，请返回首页重新授权'));
    return () => {
      cancelledRef.current = true;
      setStream((s) => {
        if (s) releaseMic(s);
        return null;
      });
    };
  }, []);

  const task = TASKS[step];
  const isLast = step === TASKS.length - 1;
  const recorded = recordings[task.kind] != null;

  const startRecording = async () => {
    if (!stream) return;
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
            <Link to="/">
              <Button>返回首页</Button>
            </Link>
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

          {phase === 'recording' && (
            <div className="flex flex-col gap-3">
              <Progress value={progress} />
              <div className="flex items-center gap-2">
                <Mic className="text-destructive size-4 animate-pulse" />
                <div className="bg-muted h-3 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-[width] duration-75"
                    style={{ width: `${Math.min(100, level * 400)}%` }}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-sm">录音中…保持发声</p>
            </div>
          )}

          <div className="flex gap-2">
            {phase === 'idle' && !recorded && (
              <Button onClick={startRecording} disabled={!stream}>
                {stream ? '开始录音' : '等待麦克风…'}
              </Button>
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
