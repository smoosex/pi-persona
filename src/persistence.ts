// ============================================================
// pi-persona — 持久化
// ============================================================
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { Emotion, PersistentEmotionSnapshot, PersistentState } from "./types.js";

const STATE_FILE = path.join(os.homedir(), ".pi", "agent", "soul-state.json");
const LOCK_DIR = path.join(os.homedir(), ".pi", "agent", "soul-state.lock");
const LOCK_OWNER_FILE = path.join(LOCK_DIR, "owner.json");
const FUTURE_INTERACTION_TOLERANCE_MS = 5 * 60 * 1000;
const LOCK_TIMEOUT_MS = 3000;
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 50;
export const MAX_PERSISTENT_HISTORY = 50;

const EMOTIONS = new Set<Emotion>([
  "joy",
  "trust",
  "fear",
  "surprise",
  "sadness",
  "disgust",
  "anger",
  "anticipation",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function isEmotion(value: unknown): value is Emotion {
  return typeof value === "string" && EMOTIONS.has(value as Emotion);
}

function parseHistorySnapshot(data: unknown, now: number): PersistentEmotionSnapshot | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const snap = data as Record<string, unknown>;
  if (
    typeof snap.id !== "string" ||
    snap.id.length === 0 ||
    typeof snap.sessionId !== "string" ||
    snap.sessionId.length === 0 ||
    typeof snap.sequence !== "number" ||
    !Number.isInteger(snap.sequence) ||
    snap.sequence < 1 ||
    typeof snap.angle !== "number" ||
    typeof snap.intensity !== "number" ||
    !isEmotion(snap.emotion) ||
    (snap.level !== 1 && snap.level !== 2 && snap.level !== 3) ||
    (snap.compound !== undefined && typeof snap.compound !== "string") ||
    typeof snap.timestamp !== "number" ||
    typeof snap.trigger !== "string" ||
    snap.trigger.length === 0 ||
    !Number.isFinite(snap.angle) ||
    !Number.isFinite(snap.intensity) ||
    !Number.isFinite(snap.timestamp)
  ) {
    return null;
  }

  return {
    id: snap.id,
    sessionId: snap.sessionId,
    sequence: snap.sequence,
    angle: normalizeAngle(snap.angle),
    intensity: clamp(snap.intensity, 0, 1),
    emotion: snap.emotion,
    level: snap.level,
    ...(snap.compound ? { compound: snap.compound } : {}),
    timestamp:
      snap.timestamp > 0 && snap.timestamp <= now + FUTURE_INTERACTION_TOLERANCE_MS
        ? snap.timestamp
        : now,
    trigger: snap.trigger,
  };
}

function normalizeHistory(history: unknown, now: number): PersistentEmotionSnapshot[] | null {
  if (!Array.isArray(history)) return null;

  const seen = new Set<string>();
  const snapshots: PersistentEmotionSnapshot[] = [];
  for (const item of history) {
    const snap = parseHistorySnapshot(item, now);
    if (!snap || seen.has(snap.id)) return null;
    seen.add(snap.id);
    snapshots.push(snap);
  }

  return snapshots
    .sort((a, b) => a.sequence - b.sequence || a.timestamp - b.timestamp)
    .slice(-MAX_PERSISTENT_HISTORY);
}

function parsePersistentState(data: unknown, now: number = Date.now()): PersistentState | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const state = data as Record<string, unknown>;
  if (
    state.version !== 2 ||
    typeof state.lastInteraction !== "number" ||
    typeof state.lastAngle !== "number" ||
    typeof state.lastIntensity !== "number" ||
    typeof state.nextHistorySequence !== "number" ||
    !Number.isInteger(state.nextHistorySequence) ||
    state.nextHistorySequence < 1 ||
    !Number.isFinite(state.lastInteraction) ||
    !Number.isFinite(state.lastAngle) ||
    !Number.isFinite(state.lastIntensity)
  ) {
    return null;
  }

  const history = normalizeHistory(state.history, now);
  if (!history) return null;

  const maxSequence = history.reduce((max, snap) => Math.max(max, snap.sequence), 0);
  const nextHistorySequence = Math.max(state.nextHistorySequence, maxSequence + 1);
  const lastInteraction =
    state.lastInteraction > 0 && state.lastInteraction <= now + FUTURE_INTERACTION_TOLERANCE_MS
      ? state.lastInteraction
      : now;

  return {
    version: 2,
    lastInteraction,
    lastAngle: normalizeAngle(state.lastAngle),
    lastIntensity: clamp(state.lastIntensity, 0, 1),
    nextHistorySequence,
    history,
  };
}

function defaultPersistentState(now: number = Date.now()): PersistentState {
  return {
    version: 2,
    lastInteraction: now,
    lastAngle: 0,
    lastIntensity: 0.15,
    nextHistorySequence: 1,
    history: [],
  };
}

function normalizePersistentState(state: PersistentState, now: number = Date.now()): PersistentState {
  return parsePersistentState(state, now) ?? defaultPersistentState(now);
}

function readStateFile(): PersistentState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return parsePersistentState(data);
  } catch {}
  return null;
}

async function writeStateFileAtomically(state: PersistentState): Promise<void> {
  const dir = path.dirname(STATE_FILE);
  const tmp = path.join(dir, `.${path.basename(STATE_FILE)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.mkdir(dir, { recursive: true });
  try {
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
    await fsp.rename(tmp, STATE_FILE);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export function restorePersistentState(): PersistentState {
  const state = readStateFile();

  if (state) {
    // 读取时已归一化 angle/intensity/history；lastInteraction 保留合理时间戳，衰减由 MoodEngine.restoreState() 计算。
    return state;
  }

  return defaultPersistentState();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return isErrnoException(err) && err.code === "EPERM";
  }
}

interface LockOwner {
  pid: number;
  token: string;
  createdAt: number;
}

function createLockOwner(): LockOwner {
  return {
    pid: process.pid,
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  };
}

function parseLockOwner(data: unknown): LockOwner | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const owner = data as Record<string, unknown>;
  if (
    typeof owner.pid !== "number" ||
    !Number.isInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.token !== "string" ||
    owner.token.length === 0 ||
    typeof owner.createdAt !== "number" ||
    !Number.isFinite(owner.createdAt)
  ) {
    return null;
  }
  return { pid: owner.pid, token: owner.token, createdAt: owner.createdAt };
}

async function readLockOwner(): Promise<LockOwner | null> {
  const ownerRaw = await fsp.readFile(LOCK_OWNER_FILE, "utf-8");
  return parseLockOwner(JSON.parse(ownerRaw));
}

async function clearStaleLockIfNeeded(now: number = Date.now()): Promise<void> {
  try {
    const owner = await readLockOwner();
    if (!owner) throw new Error("Invalid lock owner");
    if (!isProcessAlive(owner.pid)) {
      await fsp.rm(LOCK_DIR, { recursive: true, force: true });
    }
    return;
  } catch {}

  try {
    const stat = await fsp.stat(LOCK_DIR);
    if (now - stat.mtimeMs > STALE_LOCK_MS) {
      await fsp.rm(LOCK_DIR, { recursive: true, force: true });
    }
  } catch {}
}

async function releaseStateLock(owner: LockOwner): Promise<void> {
  try {
    const current = await readLockOwner();
    if (current?.pid === owner.pid && current.token === owner.token) {
      await fsp.rm(LOCK_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return;
    throw err;
  }
}

async function acquireStateLock(): Promise<() => Promise<void>> {
  const startedAt = Date.now();
  await fsp.mkdir(path.dirname(LOCK_DIR), { recursive: true });

  while (true) {
    try {
      await fsp.mkdir(LOCK_DIR);
      const owner = createLockOwner();
      try {
        await fsp.writeFile(
          LOCK_OWNER_FILE,
          JSON.stringify(owner, null, 2),
          "utf-8",
        );
      } catch (err) {
        await fsp.rm(LOCK_DIR, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      return () => releaseStateLock(owner);
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
      await clearStaleLockIfNeeded();
      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        throw new Error("Timed out acquiring soul-state lock");
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireStateLock();
  try {
    return await fn();
  } finally {
    await release().catch((err) => {
      console.error("[pi-persona] 释放状态锁失败:", err);
    });
  }
}

export async function updatePersistentState(
  updater: (state: PersistentState) => PersistentState | Promise<PersistentState>,
): Promise<PersistentState> {
  return withStateLock(async () => {
    const current = restorePersistentState();
    const next = normalizePersistentState(await updater(current));
    await writeStateFileAtomically(next);
    return next;
  });
}

export async function readPersistentStateLocked(): Promise<PersistentState> {
  return withStateLock(async () => restorePersistentState());
}

/** 同步引擎情绪坐标到持久化状态，不改 history。 */
export function syncMoodToPersistent(engine: { persistent: PersistentState; state: { angle: number; intensity: number } }): void {
  engine.persistent.lastAngle = engine.state.angle;
  engine.persistent.lastIntensity = engine.state.intensity;
}
