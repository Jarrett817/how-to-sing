// 音符钢琴卷帘图：x=时间，y=音高（半音），颜色=音准偏差
import { useEffect, useRef } from 'react';
import { midiToName, type NoteSegment } from '@/analysis/song';

interface NoteChartProps {
  notes: NoteSegment[];
  width?: number;
  height?: number;
}

/** |centsDev| → 颜色：≤15 准，≤35 略偏，>35 明显偏 */
function noteColor(centsDev: number): string {
  const a = Math.abs(centsDev);
  if (a <= 15) return '#22c55e';
  if (a <= 35) return '#eab308';
  return '#ef4444';
}

export function NoteChart({ notes, width = 640, height = 180 }: NoteChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || notes.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const style = getComputedStyle(document.documentElement);
    const border = style.getPropertyValue('--border').trim() || '#e5e5e5';
    const fg = style.getPropertyValue('--foreground').trim() || '#171717';

    const padL = 36;
    const padR = 8;
    const padT = 8;
    const padB = 18;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const midis = notes.map((n) => n.midi);
    const minMidi = Math.min(...midis) - 1;
    const maxMidi = Math.max(...midis) + 1;
    const maxT = Math.max(...notes.map((n) => n.endSec));
    const yOf = (midi: number) => padT + ((maxMidi - midi) / (maxMidi - minMidi + 1)) * plotH;
    const xOf = (t: number) => padL + (t / maxT) * plotW;
    const rowH = plotH / (maxMidi - minMidi + 1);

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

    // 音符块
    for (const n of notes) {
      const x = xOf(n.startSec);
      const w = Math.max(2, xOf(n.endSec) - x - 1);
      ctx.fillStyle = noteColor(n.centsDev);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(x, yOf(n.midi) - rowH / 2 + 1, w, rowH - 2, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 时间刻度（每 5 秒）
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= maxT; t += 5) {
      ctx.fillText(`${t}s`, xOf(t), padT + plotH + 4);
    }
  }, [notes, width, height]);

  if (notes.length === 0) return null;
  return <canvas ref={canvasRef} style={{ width: '100%', maxWidth: width, height }} />;
}
