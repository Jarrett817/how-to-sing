// 音域 / 声部参考性估计。性别由用户选择，不再根据音高猜测。
// 真正的声部划分还要看舒适音区（tessitura）、换声点与音色，单靠最高/最低音不够。
import type { Gender } from './types';
import { midiToName } from './song';

interface VoiceType {
  name: string;
  /** 常见音域（MIDI 编号，60 = C4） */
  low: number;
  high: number;
}

// 参考音域取声乐教材里常见的"实用音域"，不是极限音域
const MALE_TYPES: VoiceType[] = [
  { name: '男低音', low: 40, high: 64 }, // E2–E4
  { name: '男中音', low: 45, high: 69 }, // A2–A4
  { name: '男高音', low: 48, high: 72 }, // C3–C5
];
const FEMALE_TYPES: VoiceType[] = [
  { name: '女低音', low: 53, high: 77 }, // F3–F5
  { name: '女中音', low: 57, high: 81 }, // A3–A5
  { name: '女高音', low: 60, high: 84 }, // C4–C6
];

export interface VoiceRangeInfo {
  /** 本次唱到的音域，如 A2 – C5 */
  rangeText: string;
  /** 音域跨度（半音数） */
  spanSemitones: number;
  /** 用户选择的声部参考类别 */
  genderText: string;
  /** 最吻合的声部（参考）；跨度太小时为说明文字 */
  typeText: string;
  /** 该声部的常见参考音域 */
  referenceText: string;
  /** 音域跨度是否足以做声部参考（≥ 8 半音） */
  reliable: boolean;
}

function f0ToMidi(f0: number): number {
  return 69 + 12 * Math.log2(f0 / 440);
}

/** 声部匹配：唱到的音域与参考音域的重合度，超出参考范围适当扣分 */
function matchScore(low: number, high: number, t: VoiceType): number {
  const overlap = Math.min(high, t.high) - Math.max(low, t.low);
  const outside = Math.max(0, t.low - low) + Math.max(0, high - t.high);
  return overlap - 0.5 * outside;
}

export function classifyVoiceRange(
  f0Range: [number, number],
  gender: Gender,
): VoiceRangeInfo | null {
  const [lo, hi] = f0Range;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= lo) return null;

  const lowMidi = f0ToMidi(lo);
  const highMidi = f0ToMidi(hi);
  const span = Math.round(highMidi - lowMidi);
  const rangeText = `${midiToName(Math.round(lowMidi))} – ${midiToName(Math.round(highMidi))}`;
  const pool = gender === 'male' ? MALE_TYPES : FEMALE_TYPES;
  const best = pool.reduce((a, b) => (matchScore(lowMidi, highMidi, b) > matchScore(lowMidi, highMidi, a) ? b : a));
  const referenceText = `${best.name}常见音域约 ${midiToName(best.low)} – ${midiToName(best.high)}`;

  return {
    rangeText,
    spanSemitones: span,
    genderText: gender === 'male' ? '男声参考' : '女声参考',
    typeText:
      span >= 8 ? `最接近：${best.name}（参考）` : `本次只跨 ${span} 个半音，不足以判断声部`,
    referenceText,
    reliable: span >= 8,
  };
}
