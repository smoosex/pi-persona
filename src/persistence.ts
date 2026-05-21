// ============================================================
// pi-persona — 持久化
// ============================================================
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PersistentState } from "./types.js";

const STATE_FILE = path.join(os.homedir(), ".pi", "agent", "soul-state.json");
const FUTURE_INTERACTION_TOLERANCE_MS = 5 * 60 * 1000;

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

function readStateFile(): PersistentState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return parsePersistentState(data);
  } catch {}
  return null;
}

async function writeStateFile(state: PersistentState): Promise<void> {
  try {
    const dir = path.dirname(STATE_FILE);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("[pi-persona] 写入状态文件失败:", err);
  }
}

export function restorePersistentState(): PersistentState {
  const now = Date.now();
  const state = readStateFile();

  if (state) {
    // 读取时已归一化 angle/intensity；lastInteraction 保留合理时间戳，衰减由 MoodEngine.restoreState() 计算。
    return state;
  }

  return {
    lastInteraction: now,
    lastAngle: 0,
    lastIntensity: 0.15,
  };
}

const DEBOUNCE_MS = 2000;

export interface PersistenceController {
  persist(state: PersistentState): void;
  flush(state: PersistentState): Promise<void>;
}

export function createPersistenceController(): PersistenceController {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingWrite: Promise<void> = Promise.resolve();

  function enqueueStateWrite(state: PersistentState): Promise<void> {
    const snapshot = { ...state };
    pendingWrite = pendingWrite
      .catch(() => {})
      .then(() => writeStateFile(snapshot));
    return pendingWrite;
  }

  return {
    persist(state: PersistentState): void {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void enqueueStateWrite(state);
      }, DEBOUNCE_MS);
    },

    async flush(state: PersistentState): Promise<void> {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await enqueueStateWrite(state);
    },
  };
}

/** 同步引擎情绪坐标到持久化状态 */
export function syncMoodToPersistent(engine: { persistent: PersistentState; state: { angle: number; intensity: number } }): void {
  engine.persistent.lastAngle = engine.state.angle;
  engine.persistent.lastIntensity = engine.state.intensity;
}
