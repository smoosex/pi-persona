// ============================================================
// pi-persona — 全局共享心情状态
// ============================================================
import { MoodEngine } from "./mood-engine.js";
import { readPersistentStateLocked, syncMoodToPersistent, updatePersistentState } from "./persistence.js";
import type { EmotionalEvent, EmotionChange, PersistentState } from "./types.js";

const MAX_PERSISTENT_HISTORY = 50;
const SESSION_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let localEventCounter = 0;

function restoreEngineFromPersistent(engine: MoodEngine): void {
  engine.restoreState(
    engine.persistent.lastAngle,
    engine.persistent.lastIntensity,
    engine.persistent.lastInteraction,
  );
  engine.state.history = engine.persistent.history.map(({ id: _id, sessionId: _sessionId, sequence: _sequence, ...snapshot }) => snapshot);
  syncMoodToPersistent(engine);
}

function replaceEnginePersistent(engine: MoodEngine, persistent: PersistentState): void {
  engine.persistent.version = persistent.version;
  engine.persistent.lastInteraction = persistent.lastInteraction;
  engine.persistent.lastAngle = persistent.lastAngle;
  engine.persistent.lastIntensity = persistent.lastIntensity;
  engine.persistent.nextHistorySequence = persistent.nextHistorySequence;
  engine.persistent.history = persistent.history;
}

function appendLatestHistorySnapshot(engine: MoodEngine): void {
  const snapshot = engine.state.history.at(-1);
  if (!snapshot) return;

  const sequence = engine.persistent.nextHistorySequence;
  engine.persistent.history = [
    ...engine.persistent.history,
    {
      ...snapshot,
      id: `${SESSION_ID}-${++localEventCounter}`,
      sessionId: SESSION_ID,
      sequence,
    },
  ].slice(-MAX_PERSISTENT_HISTORY);
  engine.persistent.nextHistorySequence = sequence + 1;
}

export async function refreshGlobalMood(engine: MoodEngine, persist: boolean): Promise<void> {
  try {
    if (persist) {
      const next = await updatePersistentState((persistent) => {
        replaceEnginePersistent(engine, persistent);
        restoreEngineFromPersistent(engine);
        return {
          ...persistent,
          lastInteraction: engine.persistent.lastInteraction,
          lastAngle: engine.state.angle,
          lastIntensity: engine.state.intensity,
        };
      });
      replaceEnginePersistent(engine, next);
      restoreEngineFromPersistent(engine);
      return;
    }

    const next = await readPersistentStateLocked();
    replaceEnginePersistent(engine, next);
    restoreEngineFromPersistent(engine);
  } catch (err) {
    console.error("[pi-persona] 刷新全局心情失败:", err);
    if (persist) {
      engine.tick();
      syncMoodToPersistent(engine);
    }
  }
}

export async function applyGlobalMoodEvent(
  engine: MoodEngine,
  event: EmotionalEvent,
): Promise<EmotionChange> {
  let change: EmotionChange | null = null;

  try {
    const next = await updatePersistentState((persistent) => {
      replaceEnginePersistent(engine, persistent);
      restoreEngineFromPersistent(engine);
      change = engine.processEvent(event);
      syncMoodToPersistent(engine);
      appendLatestHistorySnapshot(engine);
      return engine.persistent;
    });

    replaceEnginePersistent(engine, next);
    restoreEngineFromPersistent(engine);
  } catch (err) {
    console.error("[pi-persona] 应用全局心情事件失败，已降级为本地更新:", err);
    if (!change) {
      change = engine.processEvent(event);
      syncMoodToPersistent(engine);
    }
  }

  if (!change) {
    throw new Error("Global mood event did not produce a change");
  }
  return change;
}
