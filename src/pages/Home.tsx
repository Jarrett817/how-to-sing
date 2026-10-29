// 首页：介绍 + 性别选择 + 唱歌分析入口
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, ShieldCheck, TrendingUp, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HistoryChart } from '@/components/charts/HistoryChart';
import { clearHistory, loadGender, loadHistory, saveGender } from '@/lib/session-store';
import type { Gender } from '@/analysis/types';

export default function Home() {
  const navigate = useNavigate();
  const [gender, setGender] = useState<Gender | null>(loadGender);
  const [history, setHistory] = useState(loadHistory);

  const chooseGender = (value: Gender) => {
    setGender(value);
    saveGender(value);
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
            性别和各维度分数只保存在本机，历史分数随时可以清除。
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
        <CardContent className="flex flex-col items-start gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">开始前请选择性别</p>
            <div className="flex gap-2" role="group" aria-label="性别">
              <Button
                type="button"
                variant={gender === 'male' ? 'default' : 'outline'}
                aria-pressed={gender === 'male'}
                onClick={() => chooseGender('male')}
              >
                男
              </Button>
              <Button
                type="button"
                variant={gender === 'female' ? 'default' : 'outline'}
                aria-pressed={gender === 'female'}
                onClick={() => chooseGender('female')}
              >
                女
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">用于匹配对应声部参考，选择会保存在本机</p>
          </div>
          <Button disabled={!gender} onClick={() => navigate('/sing')}>
            开始唱歌
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
    </div>
  );
}
