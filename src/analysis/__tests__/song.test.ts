// 唱歌片段分析：合成信号验证音符切分 / 颤音 / 抗伴奏 / 端到端
import { describe, expect, it } from 'vitest';
import { ANALYSIS_RATE } from '../analyze';
import { freqAxis, magnitudeSpectrum } from '../fft';
import { hannWindow, applyWindow } from '../frames';
import {
  analyzeSong,
  analyzeSongReport,
  harmonicSalience,
  segmentNotes,
} from '../song';
import { trackPitch } from '../pitch';
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
  it('低中位基频与 E2–E4 音域识别为男低音参考', () => {
    const result = classifyVoiceRange([82.41, 329.63], 120);
    expect(result?.genderText).toBe('更接近男声常见音区');
    expect(result?.typeText).toContain('男低音');
    expect(result?.reliable).toBe(true);
  });

  it('高中位基频与 C4–C6 音域识别为女高音参考', () => {
    const result = classifyVoiceRange([261.63, 1046.5], 300);
    expect(result?.genderText).toBe('更接近女声常见音区');
    expect(result?.typeText).toContain('女高音');
    expect(result?.reliable).toBe(true);
  });

  it('交界音区不硬判男女，跨度不足时不判断声部', () => {
    const result = classifyVoiceRange([220, 246.94], 170);
    expect(result?.genderText).toBe('处于男女声交界音区');
    expect(result?.typeText).toContain('不足以判断声部');
    expect(result?.reliable).toBe(false);
  });
});
