// 本地持久化：IndexedDB 保存录音（22.05kHz 单声道）与完整报告，仅本机、不上传
import type { PcmData } from '@/analysis/types';
import type { SongReport } from '@/analysis/song';
import { ANALYSIS_RATE } from '@/analysis/song';
import { downsample } from '@/analysis/frames';

export interface StoredSession {
  id: string;
  createdAt: string;
  pcm: PcmData;
  report: SongReport;
}

const DB_NAME = 'how-to-sing';
const STORE = 'sessions';
const VERSION = 1;
/** 最多保留的录音条数，超出按时间删除最早的 */
const MAX_SESSIONS = 12;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** 保存一次会话；超过上限时删除最早记录。存储失败（配额/隐私模式）静默降级为仅本次查看 */
export async function saveSession(pcm: PcmData, report: SongReport): Promise<void> {
  const samples =
    pcm.sampleRate === ANALYSIS_RATE ? pcm.samples : downsample(pcm.samples, pcm.sampleRate, ANALYSIS_RATE);
  const stored: StoredSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: report.meta.createdAt,
    pcm: { samples: new Float32Array(samples), sampleRate: ANALYSIS_RATE },
    report,
  };
  try {
    await tx('readwrite', (store) => store.put(stored));
    const all = await listSessions();
    const stale = all.slice(MAX_SESSIONS);
    for (const item of stale) {
      await tx('readwrite', (store) => store.delete(item.id));
    }
  } catch {
    // IndexedDB 不可用（隐私模式/配额）时退化为仅内存会话
  }
}

export async function listSessions(): Promise<StoredSession[]> {
  try {
    const all = await tx<StoredSession[]>('readonly', (store) => store.getAll());
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function getSession(id: string): Promise<StoredSession | null> {
  try {
    return (await tx<StoredSession | undefined>('readonly', (store) => store.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await tx('readwrite', (store) => store.delete(id));
  } catch {
    // 忽略删除失败
  }
}

export async function clearSessions(): Promise<void> {
  try {
    await tx('readwrite', (store) => store.clear());
  } catch {
    // 忽略清空失败
  }
}
