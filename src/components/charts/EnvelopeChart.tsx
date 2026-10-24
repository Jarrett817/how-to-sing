// 响度包络折线图（canvas 手绘）
import { useEffect, useRef } from 'react';

interface EnvelopeChartProps {
  times: number[];
  rms: number[];
  width?: number;
  height?: number;
}

export function EnvelopeChart({ times, rms, width = 560, height = 140 }: EnvelopeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const padL = 8;
    const padR = 8;
    const padT = 10;
    const padB = 20;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const maxT = times[times.length - 1] || 1;
    const maxV = Math.max(...rms, 1e-6);

    const style = getComputedStyle(document.documentElement);
    const border = style.getPropertyValue('--border').trim() || '#e5e5e5';
    const fg = style.getPropertyValue('--muted-foreground').trim() || '#737373';
    const primary = style.getPropertyValue('--primary').trim() || '#171717';

    // 参考虚线：平均值
    const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
    ctx.strokeStyle = border;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const meanY = padT + h - (mean / maxV) * h;
    ctx.moveTo(padL, meanY);
    ctx.lineTo(padL + w, meanY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 包络曲线
    ctx.beginPath();
    rms.forEach((v, i) => {
      const x = padL + (times[i] / maxT) * w;
      const y = padT + h - (v / maxV) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 时间轴刻度
    ctx.fillStyle = fg;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const ticks = Math.floor(maxT);
    for (let t = 0; t <= ticks; t++) {
      ctx.fillText(`${t}s`, padL + (t / maxT) * w, height - 6);
    }
  }, [times, rms, width, height]);

  return <canvas ref={canvasRef} style={{ width: '100%', maxWidth: width, height }} />;
}
