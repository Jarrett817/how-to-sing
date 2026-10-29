// 片段回放：报告里点音符听对应录音，用于自我纠错
import type { PcmData } from '@/analysis/types';

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

export function stopPlayback(): void {
  current?.stop();
  current = null;
}

/** 播放 PCM 的 [startSec, endSec] 片段；会自动停掉上一段 */
export function playSegment(pcm: PcmData, startSec: number, endSec: number, onEnd?: () => void): void {
  stopPlayback();
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  const from = Math.max(0, Math.floor(startSec * pcm.sampleRate));
  const to = Math.min(pcm.samples.length, Math.ceil(endSec * pcm.sampleRate));
  if (to <= from) return;
  const buf = ctx.createBuffer(1, to - from, pcm.sampleRate);
  const channel = new Float32Array(to - from);
  channel.set(pcm.samples.subarray(from, to));
  buf.copyToChannel(channel, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => {
    if (current === src) current = null;
    onEnd?.();
  };
  current = src;
  src.start();
}
