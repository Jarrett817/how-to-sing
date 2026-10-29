// 首页：介绍 + 性别选择 + 唱歌分析入口
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, AudioLines, Music, ShieldCheck, TrendingUp, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6 lg:py-8">
      <nav className="flex items-center justify-between" aria-label="品牌导航">
        <div className="flex items-center gap-3">
          <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-2xl shadow-md shadow-indigo-950/15">
            <AudioLines className="size-5" />
          </span>
          <div>
            <p className="font-semibold tracking-wide">声研所</p>
            <p className="text-muted-foreground text-[10px] tracking-[0.24em]">VOICE LAB</p>
          </div>
        </div>
        <Badge variant="outline" className="bg-white/60 px-3 py-1">
          <ShieldCheck className="size-3.5 text-emerald-600" />本地分析 · 隐私优先
        </Badge>
      </nav>

      <header className="grid items-center gap-8 py-6 lg:grid-cols-[1.15fr_.85fr] lg:py-10">
        <div>
          <Badge variant="secondary" className="mb-5 px-3 py-1">声乐分析与回放</Badge>
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.12] tracking-[-0.04em] text-slate-950 sm:text-5xl">
            演唱声学<br /><span className="text-primary">分析报告</span>
          </h1>
          <p className="text-muted-foreground mt-5 max-w-lg text-base leading-7">
            按时间轴同步分析音准、气息与共鸣，并支持整段、乐句和单个音符回放。
          </p>
          <div className="text-muted-foreground mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5"><Activity className="text-primary size-4" />七维声学分析</span>
            <span className="flex items-center gap-1.5"><Music className="text-primary size-4" />逐句音频复盘</span>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-2xl shadow-indigo-950/20 sm:p-8">
          <div className="absolute -right-16 -top-16 size-48 rounded-full bg-violet-600/25 blur-3xl" />
          <div className="relative">
            <div className="flex items-center justify-between text-[10px] tracking-[0.2em] text-slate-400">
              <span>LIVE VOICE MAP</span>
              <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-emerald-400" />READY</span>
            </div>
            <div className="my-9 flex h-28 items-center gap-1.5" aria-hidden="true">
              {Array.from({ length: 28 }, (_, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full bg-gradient-to-t from-indigo-500 to-violet-300 opacity-90"
                  style={{ height: `${22 + ((i * 29) % 72)}%` }}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
              {[['PITCH', '音准'], ['BREATH', '气息'], ['TONE', '共鸣']].map(([en, zh]) => (
                <div key={en}>
                  <p className="text-[10px] tracking-widest text-violet-300">{en}</p>
                  <p className="mt-1 text-sm text-slate-200">{zh}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="grid items-start gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <Card className="border-primary/15 bg-white/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl"><Music className="size-4" /></span>
              新建演唱分析
            </CardTitle>
            <CardDescription className="leading-6">
              支持清唱或跟 KTV 伴奏演唱。系统自动识别人声并生成音准、颤音、气息和发声状态报告。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="rounded-2xl bg-muted/60 p-4">
              <p className="text-sm font-medium">选择性别</p>
              <p className="text-muted-foreground mt-1 text-xs">用于匹配对应声部参考，选择会保存在本机</p>
              <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label="性别">
                <Button
                  type="button"
                  variant={gender === 'male' ? 'default' : 'outline'}
                  aria-pressed={gender === 'male'}
                  className="h-11"
                  onClick={() => chooseGender('male')}
                >
                  男声
                </Button>
                <Button
                  type="button"
                  variant={gender === 'female' ? 'default' : 'outline'}
                  aria-pressed={gender === 'female'}
                  className="h-11"
                  onClick={() => chooseGender('female')}
                >
                  女声
                </Button>
              </div>
            </div>
            <Button size="lg" className="h-12 w-full text-base" disabled={!gender} onClick={() => navigate('/sing')}>
              进入录音室<ArrowRight className="size-4" />
            </Button>
            {!gender && <p className="-mt-3 text-center text-xs text-muted-foreground">选择性别后即可开始</p>}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Volume2 className="text-primary size-4" />录音要求</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground flex flex-col gap-3 text-sm">
              <p><span className="text-primary mr-2 font-medium">01</span>尽量避开风扇、车流等持续噪声</p>
              <p><span className="text-primary mr-2 font-medium">02</span>麦克风距离保持在 15–30 cm</p>
              <p><span className="text-primary mr-2 font-medium">03</span>录制一两句旋律完整的演唱</p>
            </CardContent>
          </Card>
          <Card className="bg-emerald-50/55 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-emerald-600" />本地处理</CardTitle>
              <CardDescription className="leading-6">
                录音仅在浏览器内存中处理，不上传、不持久化；性别和历史分数保存在本机。
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="text-primary size-4" />历史趋势</CardTitle>
            <CardDescription>绝对分受录音设备与状态影响，长期趋势更具参考价值。</CardDescription>
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
