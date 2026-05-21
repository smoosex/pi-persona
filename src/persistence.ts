// ============================================================
// pi-persona — 持久化
// ============================================================
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PersistentState } from "./types.js";

const STATE_FILE = path.join(os.homedir(), ".pi", "agent", "soul-state.json");
const LOCK_DIR = path.join(os.homedir(), ".pi", "agent", "soul-state.lock");
const LOCK_OWNER_FILE = path.join(LOCK_DIR, "owner.json");
const FUTURE_INTERACTION_TOLERANCE_MS = 5 * 60 * 1000;
const LOCK_TIMEOUT_MS = 3000;
const STALE_LOCK_MS = 30_000;
const LOCK_RETRY_MS = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function parsePersistentState(data: unknown, now: number = Date.now()): PersistentState | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const state = data as Record<string, unknown>;
  const keys = Object.keys(state);
  if (
    keys.length !== 3 ||
    !keys.includes("lastInteraction") ||
    !keys.includes("lastAngle") ||
    !keys.includes("lastIntensity") ||
    typeof state.lastInteraction !== "number" ||
    typeof state.lastAngle !== "number" ||
    typeof state.lastIntensity !== "number" ||
    !Number.isFinite(state.lastInteraction) ||
    !Number.isFinite(state.lastAngle) ||
    !Number.isFinite(state.lastIntensity)
  ) {
    return null;
  }

  const lastInteraction =
    state.lastInteraction > 0 && state.lastInteraction <= now + FUTURE_INTERACTION_TOLERANCE_MS
      ? state.lastInteraction
      : now;

  return {
    lastInteraction,
    lastAngle: normalizeAngle(state.lastAngle),
    lastIntensity: clamp(state.lastIntensity, 0, 1),
  };
}

function defaultPersistentState(now: number = Date.now()): PersistentState {
  return {
    lastInteraction: now,
    lastAngle: 0,
    lastIntensity: 0.15,
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
    // 读取时已归一化 angle/intensity；lastInteraction 保留合理时间戳，衰减由 MoodEngine.restoreState() 计算。
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

async function clearStaleLockIfNeeded(now: number = Date.now()): Promise<void> {
  try {
    const ownerRaw = await fsp.readFile(LOCK_OWNER_FILE, "utf-8");
    const owner = JSON.parse(ownerRaw) as { pid?: unknown; createdAt?: unknown };
    const createdAt = typeof owner.createdAt === "number" && Number.isFinite(owner.createdAt)
      ? owner.createdAt
      : 0;
    const pid = typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0
      ? owner.pid
      : null;
    const stale = now - createdAt > STALE_LOCK_MS;
    const ownerDead = pid === null || !isProcessAlive(pid);
    if (stale || ownerDead) {
      await fsp.rm(LOCK_DIR, { recursive: true, force: true });
    }
  } catch {
    try {
      const stat = await fsp.stat(LOCK_DIR);
      if (now - stat.mtimeMs > STALE_LOCK_MS) {
        await fsp.rm(LOCK_DIR, { recursive: true, force: true });
      }
    } catch {}
  }
}

async function acquireStateLock(): Promise<() => Promise<void>> {
  const startedAt = Date.now();
  await fsp.mkdir(path.dirname(LOCK_DIR), { recursive: true });

  while (true) {
    try {
      await fsp.mkdir(LOCK_DIR);
      try {
        await fsp.writeFile(
          LOCK_OWNER_FILE,
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }, null, 2),
          "utf-8",
        );
      } catch (err) {
        await fsp.rm(LOCK_DIR, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      return async () => {
        await fsp.rm(LOCK_DIR, { recursive: true, force: true });
      };
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

/** 同步引擎情绪坐标到持久化状态 */
export function syncMoodToPersistent(engine: { persistent: PersistentState; state: { angle: number; intensity: number } }): void {
  engine.persistent.lastAngle = engine.state.angle;
  engine.persistent.lastIntensity = engine.state.intensity;
}
