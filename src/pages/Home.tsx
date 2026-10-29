// 首页：介绍 + 免责声明 + 环境噪声检测 + 开始
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Music, ShieldCheck, TrendingUp, Volume2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { measureAmbient, releaseMic, requestMic } from '@/audio/recorder';
import { HistoryChart } from '@/components/charts/HistoryChart';
import { clearHistory, loadHistory, useSession } from '@/lib/session-store';

type CheckState =
  | { phase: 'idle' }
  | { phase: 'measuring'; progress: number }
  | { phase: 'done'; rms: number; quiet: boolean }
  | { phase: 'error'; message: string };

// 环境噪声阈值（线性 RMS）：超过则认为太吵，不建议检测
const NOISY_RMS = 0.02;

export default function Home() {
  const navigate = useNavigate();
  const { setAmbient } = useSession();
  const [state, setState] = useState<CheckState>({ phase: 'idle' });
  const [history, setHistory] = useState(loadHistory);

  const startCheck = async () => {
    let stream: MediaStream;
    try {
      stream = await requestMic();
    } catch (e) {
      setState({
        phase: 'error',
        message: e instanceof Error ? e.message : '无法访问麦克风，请在浏览器中授权后重试',
      });
      return;
    }
    setState({ phase: 'measuring', progress: 0 });
    const rms = await measureAmbient(stream, 2000, (p) =>
      setState({ phase: 'measuring', progress: p * 100 }),
    );
    releaseMic(stream);
    setAmbient(rms);
    setState({ phase: 'done', rms, quiet: rms < NOISY_RMS });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">发声科学检测</h1>
        <p className="text-muted-foreground mt-2">
          不是跟原唱比打分，而是检查你的发声技术：气息、挤卡、位置、腔体、频段分布
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            隐私说明
          </CardTitle>
          <CardDescription>
            所有录音只在你的浏览器内存中处理，不上传、不存储，刷新后即消失。
            为展示个人趋势，只在本机保存各维度分数，随时可以清除。
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Volume2 className="size-4" />
            开始前请确认
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>1. 在安静的房间里，避免风扇、车流等持续噪声</p>
          <p>2. 距离麦克风 15–30 cm，不要用嘴贴着它</p>
          <p>3. 本检测是声学特征分析，不能替代声乐老师；阈值基于通用经验值，结果供参考</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Music className="size-4" />
            唱一段直接分析
          </CardTitle>
          <CardDescription>
            清唱或跟 KTV 伴奏唱都行：自动锁定人声、剔除伴奏干扰，分析音准、颤音、气息和发声状态。
            不依赖安静环境。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate('/sing')}>
            去唱歌（免环境检测）
          </Button>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4" />
              你的历史趋势
            </CardTitle>
            <CardDescription>
              绝对分会受录音设备和状态影响，长期趋势更适合观察自己的变化。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <HistoryChart history={history} />
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                if (!window.confirm('确定清除本机保存的全部历史分数吗？此操作无法撤销。')) return;
                clearHistory();
                setHistory([]);
              }}
            >
              清除历史分数
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mic className="size-4" />
            环境检测
          </CardTitle>
          <CardDescription>练声检测需要安静环境：先测 2 秒环境噪声，太吵会影响准确性</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          {state.phase === 'idle' && <Button onClick={startCheck}>开始环境检测</Button>}
          {state.phase === 'measuring' && (
            <div className="flex w-full flex-col gap-2">
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                保持安静，正在采样…
              </p>
              <Progress value={state.progress} />
            </div>
          )}
          {state.phase === 'done' && (
            <div className="flex w-full flex-col gap-3">
              <p className="text-sm">
                {state.quiet
                  ? '环境安静，可以开始检测。'
                  : '环境噪声偏大，结果可能不准，建议换安静环境后重新检测。'}
              </p>
              <div className="flex gap-2">
                <Button onClick={() => navigate('/session')} disabled={!state.quiet}>
                  开始练声检测
                </Button>
                <Button variant="outline" onClick={startCheck}>
                  重新检测
                </Button>
                {!state.quiet && (
                  <Button variant="ghost" onClick={() => navigate('/session')}>
                    仍要继续
                  </Button>
                )}
              </div>
            </div>
          )}
          {state.phase === 'error' && (
            <div className="flex flex-col gap-3">
              <p className="text-destructive text-sm">{state.message}</p>
              <Button onClick={startCheck}>重试</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
