// ============================================================
// pi-persona — 持久化
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PersistentState } from "./types.js";

const STATE_FILE = path.join(os.homedir(), ".pi", "agent", "soul-state.json");

function isPersistentState(data: unknown): data is PersistentState {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const state = data as Record<string, unknown>;
  const keys = Object.keys(state);
  return (
    keys.length === 3 &&
    keys.includes("lastInteraction") &&
    keys.includes("lastAngle") &&
    keys.includes("lastIntensity") &&
    typeof state.lastInteraction === "number" &&
    typeof state.lastAngle === "number" &&
    typeof state.lastIntensity === "number"
  );
}

function readStateFile(): PersistentState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (isPersistentState(data)) return data;
  } catch {}
  return null;
}

function writeStateFile(state: PersistentState): void {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("[pi-persona] 写入状态文件失败:", err);
  }
}

export function restorePersistentState(): PersistentState {
  const now = Date.now();
  const state = readStateFile();

  if (state) {
    // lastInteraction 保持原文时间戳，衰减由 MoodEngine.restoreState() 使用它计算时间差
    return state;
  }

  return {
    lastInteraction: now,
    lastAngle: 0,
    lastIntensity: 0.15,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

export function persistState(_pi: ExtensionAPI, state: PersistentState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeStateFile(state);
    saveTimer = null;
  }, DEBOUNCE_MS);
}

export function flushState(state: PersistentState): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  writeStateFile(state);
}

/** 同步引擎情绪坐标到持久化状态 */
export function syncMoodToPersistent(engine: { persistent: PersistentState; state: { angle: number; intensity: number } }): void {
  engine.persistent.lastAngle = engine.state.angle;
  engine.persistent.lastIntensity = engine.state.intensity;
}
