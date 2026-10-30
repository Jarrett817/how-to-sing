// 唱歌片段分析：合成信号验证音符切分 / 颤音 / 抗伴奏 / 端到端
import { describe, expect, it } from 'vitest';
import { freqAxis, magnitudeSpectrum } from '../fft';
import { hannWindow, applyWindow } from '../frames';
import {
  ANALYSIS_RATE,
  analyzeSong,
  analyzeSongReport,
  detectVibrato,
  harmonicSalience,
  segmentNotes,
  splitPhrases,
} from '../song';
import { trackPitch, type PitchFrame } from '../pitch';
import { classifyVoiceRange } from '../voice-range';

const RATE = ANALYSIS_RATE;

/** 单音：f0 谐波叠加，可选颤音（rateHz, ±cents） */
function tone(
  f0: number,
  dur: number,
  harmonics: number[],
  vibRate = 0,
  vibCents = 0,
  amp = 1,
): Float32Array {
  const n = Math.floor(dur * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const inst =
      vibCents > 0 ? f0 * 2 ** ((vibCents * Math.sin((2 * Math.PI * vibRate * i) / RATE)) / 1200) : f0;
    phase += (2 * Math.PI * inst) / RATE;
    for (let h = 0; h < harmonics.length; h++) {
      out[i] += amp * harmonics[h] * Math.sin((h + 1) * phase);
    }
  }
  return out;
}

/** 音符序列拼接成旋律（gap 为音间静默秒数） */
function melody(notes: { f0: number; dur: number; gap?: number }[], harmonics = [1, 0.6, 0.4, 0.2]): Float32Array {
  const parts: Float32Array[] = [];
  for (const note of notes) {
    parts.push(tone(note.f0, note.dur, harmonics));
    if (note.gap) parts.push(new Float32Array(Math.floor(note.gap * RATE)));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  // 归一化到 0.8 峰值
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.8;
  return out;
}

function mix(a: Float32Array, b: Float32Array, ampA: number, ampB: number): Float32Array {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ampA * a[i] + ampB * b[i];
  return out;
}

/** 峰值归一化（tone 直接输出未归一，多谐波叠加峰值可达谐波幅度之和） */
function normalizePeak(sig: Float32Array, peak = 0.8): Float32Array {
  let max = 0;
  for (let i = 0; i < sig.length; i++) max = Math.max(max, Math.abs(sig[i]));
  if (max > 0) for (let i = 0; i < sig.length; i++) sig[i] = (sig[i] / max) * peak;
  return sig;
}

describe('harmonicSalience（抗伴奏核心）', () => {
  const freqs = freqAxis(4096, RATE);
  const win = hannWindow(2048);

  function spectrumOf(signal: Float32Array): Float32Array {
    const frame = new Float32Array(2048);
    frame.set(signal.subarray(0, 2048));
    applyWindow(frame, win);
    return magnitudeSpectrum(frame, 4096);
  }

  it('纯谐波人声：显著度 > 0.9', () => {
    const signal = tone(220, 0.5, [1, 0.6, 0.4, 0.2]);
    expect(harmonicSalience(spectrumOf(signal), freqs, 220)).toBeGreaterThan(0.9);
  });

  it('叠加强伴奏（非谐波关系 175Hz）：显著度明显下降', () => {
    const voice = tone(220, 0.5, [1, 0.6, 0.4, 0.2]);
    const acc = tone(175, 0.5, [1, 0.7, 0.5, 0.3]);
    const mag = spectrumOf(mix(voice, acc, 0.35, 0.65));
    expect(harmonicSalience(mag, freqs, 220)).toBeLessThan(0.45);
  });
});

describe('segmentNotes 音符切分', () => {
  it('三个音符正确切分并量化到半音', () => {
    // A3=220, B3=246.94, C4=261.63
    const signal = melody([
      { f0: 220, dur: 0.6, gap: 0.15 },
      { f0: 246.94, dur: 0.6, gap: 0.15 },
      { f0: 261.63, dur: 0.6 },
    ]);
    const frames = trackPitch(signal, RATE, 2048, 512, 0.7);
    const notes = segmentNotes(frames);
    expect(notes.length).toBe(3);
    expect(notes[0].midi).toBe(57);
    expect(notes[1].midi).toBe(59);
    expect(notes[2].midi).toBe(60);
    // 合成信号音准偏差应接近 0
    for (const n of notes) expect(Math.abs(n.centsDev)).toBeLessThan(15);
  });
});

describe('颤音检测', () => {
  it('5.5Hz / ±60音分 颤音：速率应在 4-8Hz', () => {
    const signal = tone(220, 3, [1, 0.6, 0.4, 0.2], 5.5, 60);
    const result = analyzeSong({ samples: signal, sampleRate: RATE });
    expect(Number.isFinite(result.vibrato.rate)).toBe(true);
    expect(result.vibrato.rate).toBeGreaterThan(4);
    expect(result.vibrato.rate).toBeLessThan(8);
    // extent 为峰峰幅度估计，±60 cents → 约 120
    expect(result.vibrato.extent).toBeGreaterThan(70);
    expect(result.vibrato.extent).toBeLessThan(170);
  });

  it('恒定基频：不应检出颤音', () => {
    const signal = tone(220, 3, [1, 0.6, 0.4, 0.2]);
    const result = analyzeSong({ samples: signal, sampleRate: RATE });
    expect(Number.isFinite(result.vibrato.rate)).toBe(false);
  });
});

describe('analyzeSong 抗伴奏与乐句', () => {
  it('中等伴奏下仍锁定人声基频，人声主导帧占比高', () => {
    const voice = melody(
      [
        { f0: 220, dur: 1.5, gap: 0.6 },
        { f0: 261.63, dur: 1.5 },
      ],
      [1, 0.6, 0.4, 0.2],
    );
    const acc = normalizePeak(tone(175, voice.length / RATE, [1, 0.7, 0.5, 0.3]));
    const signal = mix(voice, acc, 0.6, 0.4);
    const result = analyzeSong({ samples: signal, sampleRate: RATE });
    expect(Math.abs(result.medianF0 - 220) < 12 || Math.abs(result.medianF0 - 261.63) < 12).toBe(true);
    expect(result.dominantRatio).toBeGreaterThan(0.5);
    expect(Number.isFinite(result.bands.low)).toBe(true);
    expect(result.bands.low + result.bands.mid + result.bands.high).toBeCloseTo(1, 1);
  });

  it('两段音符 + 0.6s 间隙 → 识别为 2 个乐句', () => {
    const signal = melody([
      { f0: 220, dur: 1.5, gap: 0.6 },
      { f0: 246.94, dur: 1.5 },
    ]);
    const result = analyzeSong({ samples: signal, sampleRate: RATE });
    expect(result.phrases.length).toBe(2);
    // 恒定幅度合成信号：乐句 CV 应很小
    expect(result.phraseCV).toBeLessThan(15);
  });
});

describe('analyzeSongReport 端到端', () => {
  it('干净旋律：气息/松弛给分，颤音音符指标齐全', () => {
    const signal = melody([
      { f0: 220, dur: 1.5, gap: 0.4 },
      { f0: 246.94, dur: 1.5, gap: 0.4 },
      { f0: 261.63, dur: 1.5 },
    ]);
    const report = analyzeSongReport({ samples: signal, sampleRate: RATE });
    expect(report.song.voicedRatio).toBeGreaterThan(0.6);
    expect(report.song.notes.length).toBe(3);
    expect(report.dimensions.breath.score).toBeGreaterThanOrEqual(50);
    expect(report.dimensions.strain.score).toBeGreaterThan(0);
    expect(Number.isFinite(report.song.pitchAccuracy)).toBe(true);
    expect(report.song.pitchAccuracy).toBeLessThan(15);
  });

  it('整段起高 40 音分：保留整体偏移，但去偏移后的偏差应很小', () => {
    const offset = 2 ** (40 / 1200);
    const signal = melody([
      { f0: 220 * offset, dur: 1.2, gap: 0.3 },
      { f0: 246.94 * offset, dur: 1.2, gap: 0.3 },
      { f0: 261.63 * offset, dur: 1.2 },
    ]);
    const result = analyzeSong({ samples: signal, sampleRate: RATE });
    expect(result.pitchOffset).toBeGreaterThan(30);
    expect(result.pitchOffset).toBeLessThan(50);
    expect(result.pitchAccuracy).toBeGreaterThan(30);
    expect(result.pitchStability).toBeLessThan(12);
    expect(result.pitchStability).toBeLessThan(result.pitchAccuracy);
  });
});

describe('classifyVoiceRange 音区与声部参考', () => {
  it('选择男声时，E2–E4 音域识别为男低音参考', () => {
    const result = classifyVoiceRange([82.41, 329.63], 'male');
    expect(result?.genderText).toBe('男声参考');
    expect(result?.typeText).toContain('男低音');
    expect(result?.reliable).toBe(true);
  });

  it('选择女声时，C4–C6 音域识别为女高音参考', () => {
    const result = classifyVoiceRange([261.63, 1046.5], 'female');
    expect(result?.genderText).toBe('女声参考');
    expect(result?.typeText).toContain('女高音');
    expect(result?.reliable).toBe(true);
  });

  it('音域跨度不足时不判断声部', () => {
    const result = classifyVoiceRange([220, 246.94], 'female');
    expect(result?.genderText).toBe('女声参考');
    expect(result?.typeText).toContain('不足以判断声部');
    expect(result?.reliable).toBe(false);
  });
});

describe('segmentNotes 纯函数边界', () => {
  const fps = RATE / 512;
  const mk = (f0: number | null, i: number): PitchFrame => ({
    time: i / fps,
    f0,
    clarity: 1,
  });

  it('短于 0.12s 或不足 4 帧的同半音段被丢弃', () => {
    const frames: PitchFrame[] = [];
    // 3 帧 A3（短）→ 静默 → 8 帧 A3（长）
    for (let i = 0; i < 3; i++) frames.push(mk(220, i));
    for (let i = 3; i < 8; i++) frames.push(mk(null, i));
    for (let i = 8; i < 16; i++) frames.push(mk(220, i));
    const notes = segmentNotes(frames);
    expect(notes.length).toBe(1);
    expect(notes[0].midi).toBe(57);
    expect(notes[0].startSec).toBeCloseTo(8 / fps, 3);
  });

  it('相邻半音量化合并、音符名正确', () => {
    const frames: PitchFrame[] = [];
    // 6 帧精确 A3 + 6 帧 A3 +30 音分（仍量化为 57）
    for (let i = 0; i < 6; i++) frames.push(mk(220, i));
    const sharp = 220 * 2 ** (30 / 1200);
    for (let i = 6; i < 12; i++) frames.push(mk(sharp, i));
    const notes = segmentNotes(frames);
    expect(notes.length).toBe(1);
    expect(notes[0].name).toBe('A3');
    expect(notes[0].centsDev).toBeGreaterThan(10);
    expect(notes[0].centsDev).toBeLessThan(25);
  });

  it('全无声帧返回空', () => {
    const frames = Array.from({ length: 20 }, (_, i) => mk(null, i));
    expect(segmentNotes(frames)).toEqual([]);
  });
});

describe('detectVibrato 纯函数', () => {
  const fps = RATE / 512; // ≈43.07
  const mkFrames = (freqAt: (t: number) => number, dur: number): PitchFrame[] => {
    const n = Math.floor(dur * fps);
    return Array.from({ length: n }, (_, i) => ({
      time: i / fps,
      f0: freqAt(i / fps),
      clarity: 1,
    }));
  };

  it('6Hz / ±50 音分正弦调制：速率检出且幅度量级正确', () => {
    const frames = mkFrames(
      (t) => 220 * 2 ** ((50 * Math.sin(2 * Math.PI * 6 * t)) / 1200),
      1.2,
    );
    const v = detectVibrato(frames, fps);
    expect(Number.isFinite(v.rate)).toBe(true);
    expect(v.rate).toBeGreaterThan(5);
    expect(v.rate).toBeLessThan(7);
    // extent 为峰峰值估计 ≈ 2√2·std，±50 正弦 → std≈35.4 → ≈100
    expect(v.extent).toBeGreaterThan(70);
    expect(v.extent).toBeLessThan(130);
  });

  it('恒定基频返回 NaN', () => {
    const v = detectVibrato(mkFrames(() => 220, 1.2), fps);
    expect(Number.isFinite(v.rate)).toBe(false);
    expect(Number.isFinite(v.extent)).toBe(false);
  });

  it('帧数不足 0.5s 返回 NaN', () => {
    const v = detectVibrato(mkFrames(() => 220, 0.3), fps);
    expect(Number.isFinite(v.rate)).toBe(false);
  });
});

describe('splitPhrases 纯函数', () => {
  const hopSec = 512 / RATE;

  it('两段发声夹 0.6s 间隙：切分为 2 个乐句', () => {
    const fps = 1 / hopSec;
    const n = Math.ceil(3.0 * fps);
    const rms: number[] = [];
    const voiced: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      const inGap = t >= 1.0 && t < 1.6;
      rms.push(inGap ? 0 : 0.2);
      voiced.push(!inGap);
    }
    const phrases = splitPhrases(rms, voiced, hopSec);
    expect(phrases.length).toBe(2);
    expect(phrases[0].startSec).toBeCloseTo(0, 2);
    expect(phrases[1].endSec).toBeGreaterThan(2.7);
  });

  it('0.2s 换气间隙（≤ 0.3s）不切分乐句', () => {
    const fps = 1 / hopSec;
    const n = Math.ceil(2.4 * fps);
    const rms: number[] = [];
    const voiced: boolean[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      const inGap = t >= 1.0 && t < 1.2;
      rms.push(inGap ? 0 : 0.2);
      voiced.push(!inGap);
    }
    expect(splitPhrases(rms, voiced, hopSec).length).toBe(1);
  });

  it('恒定响度乐句 CV 接近 0；无发声帧返回空', () => {
    const fps = 1 / hopSec;
    const n = Math.ceil(2 * fps);
    const rms = new Array(n).fill(0.2);
    const voiced = new Array(n).fill(true);
    const phrases = splitPhrases(rms, voiced, hopSec);
    expect(phrases.length).toBe(1);
    expect(phrases[0].cv).toBeLessThan(5);
    expect(splitPhrases(new Array(n).fill(0), new Array(n).fill(false), hopSec)).toEqual([]);
  });
});

describe('analyzeSong 空输入保护', () => {
  it('纯静音：不产出音符/乐句，指标为 NaN 或 0，不抛异常', () => {
    const result = analyzeSong({ samples: new Float32Array(RATE * 2), sampleRate: RATE });
    expect(result.notes.length).toBe(0);
    expect(result.phrases.length).toBe(0);
    expect(result.voicedRatio).toBe(0);
    expect(Number.isFinite(result.pitchAccuracy)).toBe(false);
    expect(Number.isFinite(result.medianF0)).toBe(false);
  });
});
