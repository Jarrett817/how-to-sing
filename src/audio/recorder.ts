// 录音方案：MediaRecorder → blob → decodeAudioData → 单声道 PCM
// v1 为离线分析（录完再算），MediaRecorder 跨浏览器最稳。
import type { PcmData } from '@/analysis/types';

let sharedCtx: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === 'suspended') void sharedCtx.resume();
  return sharedCtx;
}

/** 申请麦克风。关闭降噪/自动增益，避免算法污染声学特征。 */
export async function requestMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });
}

export function releaseMic(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/** 建一个实时电平监视器，返回停止函数 */
function startLevelMonitor(stream: MediaStream, onLevel: (rms: number) => void): () => void {
  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    onLevel(Math.sqrt(sum / buf.length));
  }, 80);
  return () => {
    window.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
  };
}

async function blobToPcm(blob: Blob): Promise<PcmData> {
  const ctx = audioContext();
  const buf = await blob.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  // 单声道化：多声道取平均
  const length = audio.length;
  const samples = new Float32Array(length);
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = audio.getChannelData(ch);
    for (let i = 0; i < length; i++) samples[i] += data[i] / audio.numberOfChannels;
  }
  return { samples, sampleRate: audio.sampleRate };
}

/**
 * 录 durationMs 毫秒，期间通过 onLevel 回调实时电平（0-1 线性 RMS）。
 */
export function recordPcm(
  stream: MediaStream,
  durationMs: number,
  onLevel?: (rms: number) => void,
): Promise<PcmData> {
  return new Promise((resolve, reject) => {
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const stopMonitor = onLevel ? startLevelMonitor(stream, onLevel) : () => {};

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      stopMonitor();
      reject(new Error('录音失败'));
    };
    recorder.onstop = () => {
      stopMonitor();
      const type = recorder.mimeType || mimeType || 'audio/webm';
      blobToPcm(new Blob(chunks, { type })).then(resolve, reject);
    };

    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);
  });
}

export interface RecordingHandle {
  /** 手动停止，返回完整 PCM */
  stop: () => Promise<PcmData>;
  /** 已开始的毫秒时间戳 */
  startedAt: number;
}

/**
 * 手动停止的录音（唱歌片段用）：调用 start 开始，stop 结束并解码。
 * 超过 maxMs 自动停止。
 */
export function startRecording(
  stream: MediaStream,
  onLevel?: (rms: number) => void,
  maxMs = 120_000,
): RecordingHandle {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const stopMonitor = onLevel ? startLevelMonitor(stream, onLevel) : () => {};
  const startedAt = Date.now();

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const done = new Promise<PcmData>((resolve, reject) => {
    recorder.onerror = () => {
      stopMonitor();
      reject(new Error('录音失败'));
    };
    recorder.onstop = () => {
      stopMonitor();
      const type = recorder.mimeType || mimeType || 'audio/webm';
      blobToPcm(new Blob(chunks, { type })).then(resolve, reject);
    };
  });

  window.setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, maxMs);

  return {
    startedAt,
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return done;
    },
  };
}

/**
 * 环境噪声采样：录音前测 durationMs 的背景 RMS，用于 SNR 估计。
 */
export async function measureAmbient(
  stream: MediaStream,
  durationMs = 2000,
  onProgress?: (ratio: number) => void,
): Promise<number> {
  const ctx = audioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const startedAt = performance.now();
  let sum = 0;
  let count = 0;

  return new Promise((resolve) => {
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let frameSum = 0;
      for (let i = 0; i < buf.length; i++) frameSum += buf[i] * buf[i];
      sum += frameSum / buf.length;
      count++;
      const elapsed = performance.now() - startedAt;
      onProgress?.(Math.min(1, elapsed / durationMs));
      if (elapsed >= durationMs) {
        source.disconnect();
        analyser.disconnect();
        resolve(Math.sqrt(sum / Math.max(1, count)));
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
}
