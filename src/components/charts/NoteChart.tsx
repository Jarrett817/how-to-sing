// 音符钢琴卷帘图：x=时间，y=音高（半音），颜色=音准偏差；支持点击音符回放
import { useEffect, useMemo, useRef } from 'react';
import { midiToName, type NoteSegment } from '@/analysis/song';

interface NoteChartProps {
  notes: NoteSegment[];
  width?: number;
  height?: number;
  /** 传入后音符可点击（用于回放对应片段） */
  onNoteClick?: (note: NoteSegment, index: number) => void;
  /** 正在回放的音符下标，高亮描边 */
  activeIndex?: number;
  /** 当前播放位置（秒），绘制同步播放头 */
  currentTime?: number;
  /** 完整录音时长，避免只按最后一个音符截断时间轴 */
  duration?: number;
}

/** |centsDev| → 颜色：≤15 准，≤35 略偏，>35 明显偏 */
function noteColor(centsDev: number): string {
  const a = Math.abs(centsDev);
  if (a <= 15) return '#22c55e';
  if (a <= 35) return '#eab308';
  return '#ef4444';
}

export function NoteChart({
  notes,
  width = 640,
  height = 180,
  onNoteClick,
  activeIndex = -1,
  currentTime,
  duration,
}: NoteChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 布局几何同时用于绘制与点击命中，避免两处各算一遍不一致
  const geom = useMemo(() => {
    if (notes.length === 0) return null;
    const padL = 36;
    const padR = 8;
    const padT = 8;
    const padB = 18;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const midis = notes.map((n) => n.midi);
    const minMidi = Math.min(...midis) - 1;
    const maxMidi = Math.max(...midis) + 1;
    const maxT = Math.max(duration ?? 0, ...notes.map((n) => n.endSec), 0.001);
    return {
      padL,
      padT,
      plotW,
      plotH,
      minMidi,
      maxMidi,
      maxT,
      yOf: (midi: number) => padT + ((maxMidi - midi) / (maxMidi - minMidi + 1)) * plotH,
      xOf: (t: number) => padL + (t / maxT) * plotW,
      rowH: plotH / (maxMidi - minMidi + 1),
    };
  }, [notes, width, height, duration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    const { padL, padT, plotW, plotH, minMidi, maxMidi, maxT, yOf, xOf, rowH } = geom;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const style = getComputedStyle(document.documentElement);
    const border = style.getPropertyValue('--border').trim() || '#e5e5e5';
    const fg = style.getPropertyValue('--foreground').trim() || '#171717';

    // 半音网格 + 音名（C 开头标八度）
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = yOf(m);
      ctx.strokeStyle = border;
      ctx.lineWidth = m % 12 === 0 ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      if (m % 12 === 0 || maxMidi - minMidi <= 14) {
        ctx.fillStyle = fg;
        ctx.textAlign = 'right';
        ctx.fillText(midiToName(m), padL - 4, y);
      }
    }

    // 音符块（正在回放的描边高亮）
    notes.forEach((n, i) => {
      const x = xOf(n.startSec);
      const w = Math.max(2, xOf(n.endSec) - x - 1);
      ctx.fillStyle = noteColor(n.centsDev);
      ctx.globalAlpha = i === activeIndex ? 1 : 0.85;
      ctx.beginPath();
      ctx.roundRect(x, yOf(n.midi) - rowH / 2 + 1, w, rowH - 2, 2);
      ctx.fill();
      if (i === activeIndex) {
        ctx.strokeStyle = fg;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    // 播放头与音频时间同步，位置超出最后一个音符时也继续走到录音末尾
    if (currentTime != null && currentTime >= 0 && currentTime <= maxT) {
      const x = xOf(currentTime);
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath();
      ctx.arc(x, padT + 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 时间刻度（每 5 秒）
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= maxT; t += 5) {
      ctx.fillText(`${t}s`, xOf(t), padT + plotH + 4);
    }
  }, [notes, geom, activeIndex, currentTime, width, height]);

  if (!geom) return null;

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onNoteClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    const { xOf, yOf, rowH } = geom;
    const hit = notes.findIndex(
      (n) =>
        x >= xOf(n.startSec) - 3 &&
        x <= xOf(n.endSec) + 3 &&
        Math.abs(y - yOf(n.midi)) <= Math.max(rowH / 2 + 2, 8),
    );
    if (hit >= 0) onNoteClick(notes[hit], hit);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ width: '100%', maxWidth: width, height, cursor: onNoteClick ? 'pointer' : 'default' }}
    />
  );
}
