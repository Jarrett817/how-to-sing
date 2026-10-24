// 七维雷达图（canvas 手绘，不引图表库）
import { useEffect, useRef } from 'react';

interface RadarChartProps {
  /** 标签与 0-100 分数；score < 0 表示数据不足（按 0 画，标签灰显） */
  items: { label: string; score: number }[];
  size?: number;
}

export function RadarChart({ items, size = 320 }: RadarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 44;
    const n = items.length;
    const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

    const style = getComputedStyle(document.documentElement);
    const border = style.getPropertyValue('--border').trim() || '#e5e5e5';
    const fg = style.getPropertyValue('--foreground').trim() || '#171717';
    const primary = style.getPropertyValue('--primary').trim() || '#171717';

    // 网格（25/50/75/100 四圈）
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    for (const ratio of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = angle(i % n);
        const x = cx + Math.cos(a) * radius * ratio;
        const y = cy + Math.sin(a) * radius * ratio;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // 轴线
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle(i)) * radius, cy + Math.sin(angle(i)) * radius);
      ctx.stroke();
    }

    // 数据多边形
    ctx.beginPath();
    items.forEach((item, i) => {
      const r = (Math.max(0, item.score) / 100) * radius;
      const x = cx + Math.cos(angle(i)) * r;
      const y = cy + Math.sin(angle(i)) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = primary + '33';
    ctx.fill();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 标签
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    items.forEach((item, i) => {
      const a = angle(i);
      const x = cx + Math.cos(a) * (radius + 24);
      const y = cy + Math.sin(a) * (radius + 24);
      ctx.fillStyle = item.score < 0 ? '#a3a3a3' : fg;
      const text = item.score < 0 ? `${item.label}(缺)` : `${item.label} ${item.score}`;
      ctx.fillText(text, x, y);
    });
  }, [items, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} />;
}
