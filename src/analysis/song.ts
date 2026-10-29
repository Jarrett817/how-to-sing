// 唱歌片段分析：KTV/清唱场景（可能有音箱外放伴奏，无伴奏源文件）。
// 无法做回声消除，抗伴奏策略：
//   1) 基频锁人声 + 谐波显著度筛出"人声主导帧"，伴奏过强的帧丢弃；
//   2) 梳状 LTAS：只保留各次谐波附近的能量，剔除谐波之间的伴奏后再算频段/质心/歌手共振峰。
// 歌唱适配：音符切分后取稳定中段算 jitter/shimmer（颤音/转音会污染直接计算）；
//   颤音速率/幅度、音准偏差单独输出；气息按乐句（phrase）评估而非整段包络。
import type { AnalysisReport, DimensionScore, PcmData } from './types';
import { applyWindow, downsample, frameSignal, hannWindow, preEmphasis, rms } from './frames';
import { trackPitch, type PitchFrame } from './pitch';
import { freqAxis, magnitudeSpectrum, toDb } from './fft';
import {
  bandEnergies,
  harmonicAmplitudes,
  ltas,
  singerFormantRatio,
  spectralCentroid,
} from './spectrum';
import { cpp as calcCpp } from './cepstrum';
import { autocorrelate, levinson, lpcSpectrum, pickFormants } from './lpc';
import { rmsEnvelope } from './envelope';
import { THRESHOLDS, bandScore, h1h2Range, levelOf, linmap, weightedMean } from './thresholds';

/** 分析内部统一采样率：人声有效信息 < 8kHz，22.05k 足够且 FFT 更快 */
export const ANALYSIS_RATE = 22050;
const FRAME_SIZE = 2048;
const HOP_SIZE = 512;
const FFT_SIZE = 4096;
const LPC_ORDER = 24;
/** 唱歌场景放宽基频置信度（伴奏会拉低 clarity），后续用人声主导帧筛选兜底 */
const SONG_CLARITY = 0.7;
/** 人声主导帧判定：基频各次谐波附近能量 / 总能量 的下限 */
const SALIENCE_MIN = 0.45;
/** 谱分析上限：人声有效信息 < 8kHz */
const MAX_FREQ = 8000;
/** 音符最短时长（更短的视为过渡/装饰，不进统计） */
const NOTE_MIN_DUR = 0.12;
/** 颤音分析所需的最短音符时长 */
const VIB_MIN_DUR = 0.5;
/** 乐句间允许的最大无声间隔（秒），小于它视为同一乐句 */
const PHRASE_MAX_GAP = 0.3;
const PHRASE_MIN_DUR = 0.8;

export interface NoteSegment {
  startSec: number;
  endSec: number;
  /** 最接近的半音（MIDI 编号，60 = C4） */
  midi: number;
  /** 音名，如 A4 */
  name: string;
  /** 相对该半音的平均偏差（音分，+ 偏高 - 偏低） */
  centsDev: number;
  meanF0: number;
}

/** 内部用：带帧引用的音符 */
export interface TrackedNote extends NoteSegment {
  frames: PitchFrame[];
  startIdx: number;
  endIdx: number;
}

export interface PhraseSegment {
  startSec: number;
  endSec: number;
  /** 乐句内响度 CV% */
  cv: number;
}

export interface VibratoInfo {
  /** 颤音速率 Hz，无颤音或数据不足为 NaN */
  rate: number;
  /** 颤音幅度（峰值，音分） */
  extent: number;
}

export interface SongResult {
  duration: number;
  voicedRatio: number;
  /** 人声主导帧 / 浊音帧：伴奏干扰越小越高 */
  dominantRatio: number;
  dominantFrames: number;
  medianF0: number;
  f0Range: [number, number];
  meanRms: number;
  envelope: { times: number[]; rms: number[] };
  notes: NoteSegment[];
  vibrato: VibratoInfo;
  /** 平均音高绝对偏差（音分，含整体起音偏移） */
  pitchAccuracy: number;
  /** 整体起音偏移（音分，时长加权有符号平均）：整段起高/起低多少 */
  pitchOffset: number;
  /** 扣除整体偏移后的音高偏差（音分）：真正反映音准控制能力 */
  pitchStability: number;
  phrases: PhraseSegment[];
  /** 乐句 CV 中位数（气息稳定度） */
  phraseCV: number;
  jitter: number;
  shimmer: number;
  cpp: number;
  h1h2: number;
  centroid: number;
  singerFormantRatio: number;
  bands: { low: number; mid: number; high: number };
  formants: { f1: number; f2: number; f1Prom: number; f2Prom: number };
}

export interface SongReport {
  song: SongResult;
  dimensions: AnalysisReport['dimensions'];
  meta: { snr: number; createdAt: string };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi: number): string {
  const n = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES[n]}${Math.floor(midi / 12) - 1}`;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 谐波显著度：f0 各次谐波附近能量占 80Hz-8kHz 总能量的比例。
 * 清唱/人声主导时高，伴奏盖过人声时低。
 */
export function harmonicSalience(mag: Float32Array, freqs: Float32Array, f0: number): number {
  let harm = 0;
  let total = 0;
  const binHz = freqs[1] ?? 1;
  // Hann 主瓣半宽 = 2 帧 bin；FFT 2 倍零填充后 ≈ 4 个频谱 bin，容差至少覆盖主瓣
  const tol0 = binHz * 4;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    if (f < 80 || f > MAX_FREQ) continue;
    const p = mag[i] * mag[i];
    total += p;
    const k = Math.round(f / f0);
    if (k >= 1 && Math.abs(f - k * f0) <= Math.max(0.03 * k * f0, tol0)) harm += p;
  }
  return total > 0 ? harm / total : 0;
}

/** 把帧内 k*f0 谐波带以外的能量清零（梳状滤波），累加到 acc（功率） */
function combAccumulate(
  acc: Float32Array,
  mag: Float32Array,
  freqs: Float32Array,
  f0: number,
): void {
  const binHz = freqs[1] ?? 1;
  const tol0 = binHz * 4; // 同 harmonicSalience：覆盖 Hann 主瓣
  for (let k = 1; k * f0 <= MAX_FREQ && k <= 10; k++) {
    const target = k * f0;
    const tol = Math.max(0.03 * target, tol0);
    for (let i = 0; i < freqs.length; i++) {
      if (Math.abs(freqs[i] - target) <= tol) acc[i] += mag[i] * mag[i];
    }
  }
}

/** 人声中音域（基频搜索范围） */
const F0_MIN = 70;
const F0_MAX = 1200;

/** 谱峰抛物线插值（log 幅度），把 bin 精度提到亚 bin */
function interpPeakFreq(mag: Float32Array, freqs: Float32Array, i: number): number {
  const y0 = Math.log(mag[i - 1] + 1e-12);
  const y1 = Math.log(mag[i] + 1e-12);
  const y2 = Math.log(mag[i + 1] + 1e-12);
  const denom = y0 - 2 * y1 + y2;
  const d = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
  const shift = Number.isFinite(d) ? Math.max(-1, Math.min(1, d)) : 0;
  return freqs[i] + shift * (freqs[1] ?? 1);
}

/**
 * 谱峰基频精化：伴奏与人声混合时 YIN 容易锁到"公共次谐波"
 * （如 175 伴奏 + 220/262 人声 → 87.5Hz，谐波显著度虚高），或直接丢帧。
 * 策略：在 F0_MIN-F0_MAX 内找有足够能量（≥1% 总功率）的谱峰，
 * 取谐波显著度最高者作为候选；YIN 结果仅在"基频带有真实能量"且
 * 显著度不输候选太多时保留（保住 YIN 的亚 bin 精度）；
 * YIN 丢帧时用谱峰候选找回（显著度需 ≥ SALIENCE_MIN）。
 */
function refineFrame(
  mag: Float32Array,
  freqs: Float32Array,
  yinF0: number | null,
): { f0: number | null; salience: number } {
  let total = 0;
  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    if (f >= 80 && f <= MAX_FREQ) total += mag[i] * mag[i];
  }
  if (total <= 0) return { f0: null, salience: 0 };

  let bestIdx = -1;
  let bestSal = -1;
  for (let i = 1; i < freqs.length - 1; i++) {
    const f = freqs[i];
    if (f < F0_MIN) continue;
    if (f > F0_MAX) break;
    if (!(mag[i] > mag[i - 1] && mag[i] >= mag[i + 1])) continue;
    if ((mag[i] * mag[i]) / total < 0.01) continue;
    const s = harmonicSalience(mag, freqs, f);
    if (s > bestSal) {
      bestSal = s;
      bestIdx = i;
    }
  }
  const specF0 = bestIdx > 0 ? interpPeakFreq(mag, freqs, bestIdx) : null;

  if (yinF0 != null) {
    // YIN 基频带能量占比：次谐波（如 87.5）基频带无真实能量，据此否决
    let fund = 0;
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      if (f >= yinF0 * 0.9 && f <= yinF0 * 1.1) fund += mag[i] * mag[i];
    }
    const yinSal = harmonicSalience(mag, freqs, yinF0);
    if (fund / total >= 0.01 && (specF0 == null || yinSal >= bestSal - 0.1)) {
      return { f0: yinF0, salience: yinSal };
    }
  }
  if (specF0 != null && bestSal >= SALIENCE_MIN) return { f0: specF0, salience: bestSal };
  // YIN 被否决且无可信谱峰：丢帧（伴奏盖过人声）
  return { f0: null, salience: 0 };
}

/**
 * 音符切分：连续同半音的浊音帧归为一个音符，
 * 过短（< NOTE_MIN_DUR）的段视为过渡音丢弃。
 */
export function segmentNotes(frames: PitchFrame[]): TrackedNote[] {
  const groups: { q: number; frames: PitchFrame[]; startIdx: number }[] = [];
  let curQ: number | null = null;
  let cur: PitchFrame[] = [];
  let curStart = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const q = f.f0 != null ? Math.round(69 + 12 * Math.log2(f.f0 / 440)) : null;
    if (q != null && q === curQ) {
      cur.push(f);
    } else {
      if (cur.length > 0) groups.push({ q: curQ as number, frames: cur, startIdx: curStart });
      cur = q != null ? [f] : [];
      curQ = q;
      curStart = i;
    }
  }
  if (cur.length > 0) groups.push({ q: curQ as number, frames: cur, startIdx: curStart });

  const out: TrackedNote[] = [];
  for (const g of groups) {
    const dur = g.frames[g.frames.length - 1].time - g.frames[0].time;
    if (dur < NOTE_MIN_DUR || g.frames.length < 4) continue;
    const f0s = g.frames.map((f) => f.f0 as number);
    const medF0 = median(f0s);
    const midi = Math.round(69 + 12 * Math.log2(medF0 / 440));
    const refF0 = 440 * 2 ** ((midi - 69) / 12);
    let dev = 0;
    for (const f of f0s) dev += 1200 * Math.log2(f / refF0);
    out.push({
      startSec: g.frames[0].time,
      endSec: g.frames[g.frames.length - 1].time,
      midi,
      name: midiToName(midi),
      centsDev: dev / f0s.length,
      meanF0: medF0,
      frames: g.frames,
      startIdx: g.startIdx,
      endIdx: g.startIdx + g.frames.length - 1,
    });
  }
  return out;
}

/**
 * 单音符颤音检测：去线性趋势后的音分序列做自相关，
 * 在 4-8Hz 对应的 lag 区间找峰，相关 ≥ 0.3 判定为有颤音。
 * fps 为基频帧率（rate / hopSize）。
 */
export function detectVibrato(frames: PitchFrame[], fps: number): VibratoInfo {
  const none: VibratoInfo = { rate: NaN, extent: NaN };
  const f0s = frames.map((f) => f.f0 as number);
  const n = f0s.length;
  if (n < Math.floor(VIB_MIN_DUR * fps)) return none;
  const med = median(f0s);
  const cents = f0s.map((f) => 1200 * Math.log2(f / med));

  // 去线性趋势（排除滑音/音高漂移）
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += cents[i];
    sxx += i * i;
    sxy += i * cents[i];
  }
  const slope = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const det = cents.map((c, i) => c - (intercept + slope * i));

  let r0 = 0;
  for (const v of det) r0 += v * v;
  r0 /= n;
  const std = Math.sqrt(r0);
  if (std < 8) return none; // 调制幅度太小，不算颤音

  const lagMin = Math.max(2, Math.round(fps / 8));
  const lagMax = Math.min(Math.round(fps / 4), n >> 1);
  let bestLag = -1;
  let bestR = 0.3;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += det[i] * det[i + lag];
    const r = s / (n - lag) / r0;
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }
  if (bestLag < 0) return none;
  return { rate: fps / bestLag, extent: 2 * Math.SQRT2 * std };
}

/**
 * 音符稳定中段的 jitter / shimmer：
 * 取每个音符 25%-75% 中段，只统计音符内部的相邻帧对，
 * 避免颤音、转音和音符边界污染。
 */
function noteStability(
  notes: TrackedNote[],
  pitchFrames: PitchFrame[],
  frameRms: number[],
): { jitter: number; shimmer: number } {
  let jDiff = 0;
  let jBase = 0;
  let jCount = 0;
  let sDiff = 0;
  let sBase = 0;
  let sCount = 0;
  for (const note of notes) {
    const len = note.frames.length;
    const from = note.startIdx + Math.floor(len * 0.25);
    const to = note.startIdx + Math.ceil(len * 0.75);
    for (let i = from + 1; i <= to && i < pitchFrames.length; i++) {
      const prev = pitchFrames[i - 1].f0;
      const cur = pitchFrames[i].f0;
      if (prev == null || cur == null) continue;
      const diff = Math.abs(cur - prev);
      if (diff / prev > 0.1) continue; // 跟踪错误
      jDiff += diff;
      jBase += (prev + cur) / 2;
      jCount++;
      sDiff += Math.abs(frameRms[i] - frameRms[i - 1]);
      sBase += (frameRms[i] + frameRms[i - 1]) / 2;
      sCount++;
    }
  }
  return {
    jitter: jCount >= 10 && jBase > 0 ? (jDiff / (jBase / jCount)) * 100 : NaN,
    shimmer: sCount >= 10 && sBase > 0 ? (sDiff / (sBase / sCount)) * 100 : NaN,
  };
}

/**
 * 乐句切分：帧响度 ≥ 25% 浊音中位响度视为"在唱"，
 * 允许 ≤ PHRASE_MAX_GAP 的换气间隙，短于 PHRASE_MIN_DUR 的段丢弃。
 */
export function splitPhrases(frameRms: number[], voiced: boolean[], hopSec: number): PhraseSegment[] {
  const voicedRms = frameRms.filter((_, i) => voiced[i]);
  const ref = median(voicedRms);
  if (!Number.isFinite(ref) || ref <= 0) return [];
  const sounding = frameRms.map((v) => v >= ref * 0.25);
  const gapFrames = Math.round(PHRASE_MAX_GAP / hopSec);

  const phrases: PhraseSegment[] = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < sounding.length; i++) {
    if (sounding[i]) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > gapFrames) {
        phrases.push({ startSec: start * hopSec, endSec: (i - gap) * hopSec, cv: NaN });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) {
    phrases.push({ startSec: start * hopSec, endSec: (sounding.length - 1) * hopSec, cv: NaN });
  }

  // 乐句内 CV（响度 ≥ 乐句峰值 30% 的帧）
  for (const p of phrases) {
    const from = Math.round(p.startSec / hopSec);
    const to = Math.min(frameRms.length - 1, Math.round(p.endSec / hopSec));
    const slice = frameRms.slice(from, to + 1);
    const peak = Math.max(...slice);
    const used = slice.filter((v) => v >= peak * 0.3);
    if (used.length < 6) {
      p.cv = NaN;
      continue;
    }
    const mean = used.reduce((a, b) => a + b, 0) / used.length;
    const sd = Math.sqrt(used.reduce((a, b) => a + (b - mean) ** 2, 0) / used.length);
    p.cv = mean > 0 ? (sd / mean) * 100 : NaN;
  }
  return phrases.filter((p) => p.endSec - p.startSec >= PHRASE_MIN_DUR);
}

/** 主入口：唱歌片段 PCM → SongResult */
export function analyzeSong(pcm: PcmData): SongResult {
  const samples =
    pcm.sampleRate === ANALYSIS_RATE
      ? pcm.samples
      : downsample(pcm.samples, pcm.sampleRate, ANALYSIS_RATE);
  const rate = pcm.sampleRate === ANALYSIS_RATE ? pcm.sampleRate : ANALYSIS_RATE;
  const duration = samples.length / rate;
  const hopSec = HOP_SIZE / rate;
  const fps = rate / HOP_SIZE;

  const pitchFrames = trackPitch(samples, rate, FRAME_SIZE, HOP_SIZE, SONG_CLARITY);
  const allFrames = frameSignal(samples, FRAME_SIZE, HOP_SIZE);
  const frameRms = allFrames.map((f) => rms(f));
  const voiced = pitchFrames.map((f) => f.f0 != null);

  // 逐帧谱峰精化基频（纠正 YIN 次谐波/找回丢帧）→ 谐波显著度筛人声主导帧；
  // 主导帧上做梳状谱累加；statFrames 仅保留主导帧基频供音符/颤音/稳定性统计
  const win = hannWindow(FRAME_SIZE);
  const freqs = freqAxis(FFT_SIZE, rate);
  const combAcc = new Float32Array(FFT_SIZE >> 1);
  let combCount = 0;
  const rawDominant: Float32Array[] = [];
  const preDominant: Float32Array[] = [];
  const statFrames: PitchFrame[] = [];
  const domF0s: number[] = [];
  let voicedCount = 0;
  const frameTotal = Math.min(pitchFrames.length, allFrames.length);
  for (let i = 0; i < frameTotal; i++) {
    const raw = allFrames[i];
    const buf = new Float32Array(FRAME_SIZE);
    buf.set(raw);
    applyWindow(buf, win);
    const mag = magnitudeSpectrum(buf, FFT_SIZE);
    const { f0, salience } = refineFrame(mag, freqs, pitchFrames[i].f0);
    if (f0 != null) voicedCount++;
    const dominant = f0 != null && salience >= SALIENCE_MIN;
    statFrames.push({ time: pitchFrames[i].time, clarity: pitchFrames[i].clarity, f0: dominant ? f0 : null });
    if (!dominant) continue;
    domF0s.push(f0);
    rawDominant.push(raw);
    const pre = preEmphasis(raw);
    preDominant.push(pre);
    const pbuf = new Float32Array(FRAME_SIZE);
    pbuf.set(pre);
    applyWindow(pbuf, win);
    const pmag = magnitudeSpectrum(pbuf, FFT_SIZE);
    combAccumulate(combAcc, pmag, freqs, f0);
    combCount++;
  }
  const f0s = domF0s;
  const medianF0 = median(f0s);
  const voicedRatio = frameTotal > 0 ? voicedCount / frameTotal : 0;
  const dominantRatio = voicedCount > 0 ? domF0s.length / voicedCount : 0;
  const dominantCount = domF0s.length;

  // 谱特征：plain LTAS（H1-H2）、预加重 LTAS（CPP）、梳状 LTAS（频段/质心/歌手共振峰）
  const plainSpec = rawDominant.length > 0 ? ltas(rawDominant, FFT_SIZE, rate) : null;
  const preSpec = preDominant.length > 0 ? ltas(preDominant, FFT_SIZE, rate) : null;
  const harmonics = plainSpec
    ? harmonicAmplitudes(plainSpec.ltasDb, plainSpec.freqs, medianF0)
    : [];
  const h1h2 =
    harmonics.length >= 2 && Number.isFinite(harmonics[0]) && Number.isFinite(harmonics[1])
      ? harmonics[0] - harmonics[1]
      : NaN;
  const cpp = preSpec ? calcCpp(preSpec.ltasDb, rate, medianF0) : NaN;

  let bands = { low: NaN, mid: NaN, high: NaN };
  let centroid = NaN;
  let sfRatio = NaN;
  if (combCount > 0) {
    const combMag = new Float32Array(FFT_SIZE >> 1);
    for (let i = 0; i < combMag.length; i++) combMag[i] = Math.sqrt(combAcc[i] / combCount);
    const combDb = toDb(combMag);
    bands = bandEnergies(combDb, freqs);
    centroid = spectralCentroid(combDb, freqs);
    sfRatio = singerFormantRatio(combDb, freqs);
  }

  // LPC 共振峰（主导帧，预加重；超过 200 帧时等距抽稀控制耗时）
  let formants = { f1: NaN, f2: NaN, f1Prom: NaN, f2Prom: NaN };
  if (preDominant.length > 0) {
    const stride = Math.max(1, Math.floor(preDominant.length / 200));
    const acc = new Float32Array(LPC_ORDER + 1);
    let used = 0;
    for (let i = 0; i < preDominant.length; i += stride) {
      const r = autocorrelate(preDominant[i], LPC_ORDER);
      for (let k = 0; k <= LPC_ORDER; k++) acc[k] += r[k];
      used++;
    }
    for (let k = 0; k <= LPC_ORDER; k++) acc[k] /= used;
    const { a, error } = levinson(acc, LPC_ORDER);
    const spec = lpcSpectrum(a, error, FFT_SIZE);
    formants = pickFormants(spec, freqAxis(FFT_SIZE, rate));
  }

  // 音符 / 颤音 / 音准（仅人声主导帧参与）
  const tracked = segmentNotes(statFrames);
  const notes: NoteSegment[] = tracked.map(
    ({ startSec, endSec, midi, name, centsDev, meanF0 }) => ({
      startSec,
      endSec,
      midi,
      name,
      centsDev,
      meanF0,
    }),
  );
  const vibRates: number[] = [];
  const vibExtents: number[] = [];
  for (const note of tracked) {
    if (note.endSec - note.startSec < VIB_MIN_DUR) continue;
    const v = detectVibrato(note.frames, fps);
    if (Number.isFinite(v.rate)) {
      vibRates.push(v.rate);
      vibExtents.push(v.extent);
    }
  }
  // 音准拆成两个口径：
  //   整体偏移 = 各音符偏差的有符号平均（起音起高/起低多少，与"唱得稳不稳"无关）；
  //   去偏移偏差 = 各音符相对整体偏移的偏离（真正的音准控制能力）。
  // 只看"离最近半音多远"会把整体起高 30 音分但唱得很稳的人误判为音准差。
  let accDev = 0;
  let accSigned = 0;
  let accDur = 0;
  for (const note of tracked) {
    const dur = note.endSec - note.startSec;
    if (dur < 0.15) continue;
    accDev += Math.abs(note.centsDev) * dur;
    accSigned += note.centsDev * dur;
    accDur += dur;
  }
  const pitchAccuracy = accDur > 0 ? accDev / accDur : NaN;
  const pitchOffset = accDur > 0 ? accSigned / accDur : NaN;
  let accResid = 0;
  if (accDur > 0) {
    for (const note of tracked) {
      const dur = note.endSec - note.startSec;
      if (dur < 0.15) continue;
      accResid += Math.abs(note.centsDev - pitchOffset) * dur;
    }
  }
  const pitchStability = accDur > 0 ? accResid / accDur : NaN;

  const { jitter, shimmer } = noteStability(tracked, statFrames, frameRms);

  // 乐句与气息
  const phrases = splitPhrases(frameRms, voiced, hopSec);
  const phraseCV = median(phrases.map((p) => p.cv).filter((v) => Number.isFinite(v)));

  const env = rmsEnvelope(samples, rate, 1024, 512);

  return {
    duration,
    voicedRatio,
    dominantRatio,
    dominantFrames: dominantCount,
    medianF0,
    f0Range: f0s.length > 0 ? [Math.min(...f0s), Math.max(...f0s)] : [NaN, NaN],
    meanRms: frameRms.length > 0 ? frameRms.reduce((a, b) => a + b, 0) / frameRms.length : 0,
    envelope: { times: env.times, rms: env.rms },
    notes,
    vibrato: { rate: median(vibRates), extent: median(vibExtents) },
    pitchAccuracy,
    pitchOffset,
    pitchStability,
    phrases,
    phraseCV,
    jitter,
    shimmer,
    cpp,
    h1h2,
    centroid,
    singerFormantRatio: sfRatio,
    bands,
    formants,
  };
}

// ---- 评分（复用通用阈值，唱歌场景对乐句 CV 单独放宽） ----

/** 乐句 CV 阈值：歌曲本身有强弱变化，比长音阈值宽 */
const PHRASE_CV_GOOD = 12;
const PHRASE_CV_BAD = 40;
/** 谱类指标可信度下限：人声主导帧太少说明伴奏盖过人声 */
const MIN_DOMINANT_FRAMES = 20;
const MIN_DOMINANT_RATIO = 0.3;

function insufficient(hint: string, raw: Record<string, number> = {}): DimensionScore {
  return { score: -1, raw, level: 'poor', hint };
}

const ACCOMPANIMENT_HINT = '伴奏占主导片段过多，频谱类指标可信度不足';

function songBreath(s: SongResult): DimensionScore {
  if (s.phrases.length === 0) return insufficient('未识别到完整乐句');
  const cvScore = linmap(s.phraseCV, PHRASE_CV_GOOD, 100, PHRASE_CV_BAD, 0);
  const shimmerScore = linmap(s.shimmer, THRESHOLDS.breath.shimmerGood, 100, THRESHOLDS.breath.shimmerBad, 0);
  const score = weightedMean([
    [cvScore, 0.6],
    [shimmerScore, 0.4],
  ]);
  if (!Number.isFinite(score)) return insufficient('数据不足，无法计算气息指标');
  const hint =
    score >= 75
      ? '乐句内响度稳定'
      : score >= 50
        ? '乐句内响度存在波动'
        : '乐句内响度波动较大';
  return {
    score: Math.round(score),
    raw: { phraseCV: s.phraseCV, shimmer: s.shimmer },
    level: levelOf(score),
    hint,
  };
}

function songStrain(s: SongResult): DimensionScore {
  if (s.dominantFrames < MIN_DOMINANT_FRAMES) return insufficient(ACCOMPANIMENT_HINT);
  const T = THRESHOLDS.strain;
  // H1-H2 按中位基频分档，避免高音被误判为挤卡
  const hRange = h1h2Range(s.medianF0);
  const score = weightedMean([
    [linmap(s.cpp, T.cppBad, 0, T.cppGood, 100), T.wCpp],
    [linmap(s.h1h2, hRange.bad, 0, hRange.good, 100), T.wH1h2],
    [linmap(s.jitter, T.jitterGood, 100, T.jitterBad, 0), T.wJitter],
  ]);
  if (!Number.isFinite(score)) return insufficient('数据不足，无法计算紧张度指标');
  const hint =
    score >= 75
      ? '振动规律性良好，未检测到明显紧张特征'
      : score >= 50
        ? '存在轻微紧张特征'
        : '紧张特征较明显';
  return {
    score: Math.round(score),
    raw: { cpp: s.cpp, h1h2: s.h1h2, jitter: s.jitter },
    level: levelOf(score),
    hint,
  };
}

function songPlacement(s: SongResult): DimensionScore {
  if (s.dominantFrames < MIN_DOMINANT_FRAMES || s.dominantRatio < MIN_DOMINANT_RATIO) {
    return insufficient(ACCOMPANIMENT_HINT);
  }
  const T = THRESHOLDS.placement;
  const score = weightedMean([
    [linmap(s.singerFormantRatio, T.sfBad, 0, T.sfGood, 100), T.wSF],
    [linmap(s.centroid, T.centroidBad, 0, T.centroidGood, 100), T.wCentroid],
  ]);
  if (!Number.isFinite(score)) return insufficient('数据不足，无法计算声音位置指标');
  const hint =
    score >= 75
      ? '高频泛音与歌手共振峰占比较高'
      : score >= 50
        ? '高频泛音占比中等'
        : '高频泛音与歌手共振峰占比偏低';
  return {
    score: Math.round(score),
    raw: { singerFormantRatio: s.singerFormantRatio, centroid: s.centroid },
    level: levelOf(score),
    hint,
  };
}

function songResonance(s: SongResult): DimensionScore {
  if (s.dominantFrames < MIN_DOMINANT_FRAMES || !Number.isFinite(s.formants.f1Prom)) {
    return insufficient(
      s.dominantFrames < MIN_DOMINANT_FRAMES ? ACCOMPANIMENT_HINT : '数据不足，无法估计共振峰',
    );
  }
  const prom =
    (s.formants.f1Prom +
      (Number.isFinite(s.formants.f2Prom) ? s.formants.f2Prom : s.formants.f1Prom)) /
    2;
  const score = linmap(prom, THRESHOLDS.resonance.promBad, 0, THRESHOLDS.resonance.promGood, 100);
  const hint =
    score >= 75
      ? 'F1/F2 共振峰突出度正常'
      : score >= 50
        ? '共振峰突出度中等'
        : '共振峰突出度偏低';
  return {
    score: Math.round(score),
    raw: {
      f1: s.formants.f1,
      f2: s.formants.f2,
      f1Prom: s.formants.f1Prom,
      f2Prom: s.formants.f2Prom,
    },
    level: levelOf(score),
    hint,
  };
}

function songBands(s: SongResult): {
  low: DimensionScore;
  mid: DimensionScore;
  high: DimensionScore;
} {
  const empty = insufficient(
    s.dominantFrames < MIN_DOMINANT_FRAMES || s.dominantRatio < MIN_DOMINANT_RATIO
      ? ACCOMPANIMENT_HINT
      : '数据不足，无法计算频段分布',
  );
  if (
    s.dominantFrames < MIN_DOMINANT_FRAMES ||
    s.dominantRatio < MIN_DOMINANT_RATIO ||
    !Number.isFinite(s.bands.low)
  ) {
    return { low: empty, mid: empty, high: empty };
  }
  const B = THRESHOLDS.bands;
  const make = (
    ratio: number,
    range: { min: number; max: number },
    name: string,
    lowHint: string,
    highHint: string,
  ): DimensionScore => {
    const score = bandScore(ratio, range);
    const hint =
      ratio < range.min ? lowHint : ratio > range.max ? highHint : `${name}能量分布正常`;
    return { score: Math.round(score), raw: { ratio }, level: levelOf(score), hint };
  };
  return {
    low: make(s.bands.low, B.low, '低频', '低频能量占比偏低', '低频能量占比偏高'),
    mid: make(s.bands.mid, B.mid, '中频', '中频能量占比偏低', '中频占比正常'),
    high: make(s.bands.high, B.high, '高频', '高频泛音占比偏低', '高频能量占比偏高'),
  };
}

/** 唱歌片段 → 完整报告（七维评分 + 音准/颤音/乐句等歌唱指标） */
export function analyzeSongReport(pcm: PcmData): SongReport {
  const song = analyzeSong(pcm);
  const bands = songBands(song);
  return {
    song,
    dimensions: {
      breath: songBreath(song),
      strain: songStrain(song),
      placement: songPlacement(song),
      resonance: songResonance(song),
      lowBand: bands.low,
      midBand: bands.mid,
      highBand: bands.high,
    },
    meta: {
      // 唱歌场景不测环境噪声，SNR 不适用
      snr: NaN,
      createdAt: new Date().toISOString(),
    },
  };
}
