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
  // 先做能力检查，避免在不支持的浏览器里报一个看不懂的 TypeError
  const issue = micSupportIssue();
  if (issue) throw new Error(issue);

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
  } catch (err) {
    // 部分安卓/鸿蒙浏览器不接受这些音频约束，退回最简约束再试一次
    if (isPermissionOrDeviceError(err)) throw new Error(micErrorMessage(err));
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err2) {
      throw new Error(micErrorMessage(err2));
    }
  }
}

/** 麦克风能力检查：返回给用户看的提示，可用时返回 null */
export function micSupportIssue(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return '当前页面不是 HTTPS 安全连接，浏览器不会开放麦克风。请用 https:// 地址打开本页。';
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return '这个浏览器不支持网页录音（缺少麦克风接口）。请换用 Chrome、Edge、Safari，或在浏览器菜单里选择"桌面版网站"后重试。';
  }
  if (typeof MediaRecorder === 'undefined') {
    return '这个浏览器不支持录音编码（缺少 MediaRecorder）。请换用 Chrome、Edge、Safari 再试。';
  }
  return null;
}

function isPermissionOrDeviceError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return [
    'NotAllowedError',
    'PermissionDeniedError',
    'SecurityError',
    'NotFoundError',
    'DevicesNotFoundError',
    'NotReadableError',
    'TrackStartError',
  ].includes(name);
}

/** 把浏览器抛出的权限/设备错误翻译成用户能看懂的提示 */
function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return '麦克风权限被拒绝。请点击地址栏的权限图标允许本站使用麦克风，然后重试。';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '没有检测到麦克风设备。请检查麦克风是否已连接、是否被系统禁用。';
    case 'NotReadableError':
    case 'TrackStartError':
      return '麦克风被其他应用占用。请关闭其他录音/会议/语音软件后重试。';
    default:
      return `无法打开麦克风（${name || '未知错误'}）。请检查浏览器麦克风权限后重试。`;
  }
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

/** 实时电平监视（录音前试音用）：返回停止函数 */
export function monitorLevel(stream: MediaStream, onLevel: (rms: number) => void): () => void {
  return startLevelMonitor(stream, onLevel);
}

/** 线性 RMS → 0-100 显示进度（-60dBFS 以下为 0，接近满幅为 100） */
export function rmsToPercent(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
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
