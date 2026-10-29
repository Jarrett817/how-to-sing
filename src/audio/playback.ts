// PCM 回放控制器：片段播放、暂停、拖动定位；旧音频节点不会干扰新播放
import type { PcmData } from '@/analysis/types';

export interface PcmPlayer {
  play: (startSec: number, endSec: number) => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
  getCurrentTime: () => number;
  isPlaying: () => boolean;
  destroy: () => void;
}

export function createPcmPlayer(pcm: PcmData): PcmPlayer {
  const duration = pcm.samples.length / pcm.sampleRate;
  const clamp = (seconds: number) => Math.max(0, Math.min(duration, seconds));
  let ctx: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let rangeStart = 0;
  let rangeEnd = duration;
  let position = 0;
  let startedAt = 0;
  let playing = false;
  let destroyed = false;

  const stopSource = () => {
    const old = source;
    source = null;
    if (!old) return;
    old.onended = null;
    old.stop();
    old.disconnect();
  };

  const startSource = () => {
    if (destroyed || rangeEnd <= position) return;
    stopSource();
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!buffer) {
      buffer = ctx.createBuffer(1, pcm.samples.length, pcm.sampleRate);
      const channel = new Float32Array(pcm.samples.length);
      channel.set(pcm.samples);
      buffer.copyToChannel(channel, 0);
    }
    const next = ctx.createBufferSource();
    next.buffer = buffer;
    next.connect(ctx.destination);
    next.onended = () => {
      if (source !== next) return;
      source = null;
      playing = false;
      position = rangeEnd;
      next.disconnect();
    };
    source = next;
    playing = true;
    startedAt = ctx.currentTime;
    next.start(0, position, rangeEnd - position);
  };

  return {
    play(startSec, endSec) {
      rangeStart = clamp(startSec);
      rangeEnd = clamp(endSec);
      position = rangeStart;
      if (rangeEnd > rangeStart) startSource();
    },
    pause() {
      if (!playing || !ctx) return;
      position = Math.min(rangeEnd, position + ctx.currentTime - startedAt);
      playing = false;
      stopSource();
    },
    resume() {
      if (!playing && position < rangeEnd) startSource();
    },
    seek(seconds) {
      position = Math.max(rangeStart, Math.min(rangeEnd, seconds));
      if (playing) startSource();
    },
    getCurrentTime() {
      if (!playing || !ctx) return position;
      return Math.min(rangeEnd, position + ctx.currentTime - startedAt);
    },
    isPlaying: () => playing,
    destroy() {
      destroyed = true;
      playing = false;
      stopSource();
      if (ctx) void ctx.close();
      ctx = null;
      buffer = null;
    },
  };
}
