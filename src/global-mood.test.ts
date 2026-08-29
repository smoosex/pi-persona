import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { applyGlobalMoodEvent, refreshGlobalMood, setGlobalEmotionUpdatesEnabled, setGlobalMood } from "./global-mood.js";
import { MoodEngine } from "./mood-engine.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";

async function withTemporaryHome(fn: (home: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const home = await mkdtemp(path.join(tmpdir(), "pi-persona-home-"));

  try {
    process.env.HOME = home;
    // The agent directory wins over HOME, so a developer with it exported
    // would otherwise run these against their real one.
    delete process.env.PI_CODING_AGENT_DIR;
    await fn(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function stateFile(home: string): string {
  return path.join(home, ".pi", "agent", "mood-state.json");
}

function createPersistentState(overrides: Partial<PersistentState> = {}): PersistentState {
  return {
    version: 2,
    lastInteraction: Date.now(),
    lastAngle: 0,
    lastIntensity: 0.15,
    emotionUpdatesEnabled: true,
    nextHistorySequence: 1,
    history: [],
    ...overrides,
  };
}

function createSoul(): SoulDefinition {
  return {
    name: "Test Soul",
    emoji: "✨",
    description: "Test soul",
    traits: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
      formality: 0.5,
      tsundere: 0,
      sarcasm: 0,
    },
    systemPrompt: "You are Test Soul.",
  };
}

function createEngine(persistent = createPersistentState()): MoodEngine {
  return new MoodEngine(createSoul(), persistent, DEFAULT_EMOTION_CONFIG);
}

function readState(home: string): PersistentState {
  return JSON.parse(readFileSync(stateFile(home), "utf-8")) as PersistentState;
}

test("refreshGlobalMood creates a persisted state when requested", async () => {
  await withTemporaryHome(async (home) => {
    const engine = createEngine();

    await refreshGlobalMood(engine, true);

    const persisted = readState(home);
    assert.equal(persisted.version, 2);
    assert.equal(persisted.lastAngle, engine.state.angle);
    assert.equal(persisted.lastIntensity, engine.state.intensity);
  });
});

test("refreshGlobalMood reads persisted state without writing new event", async () => {
  await withTemporaryHome(async () => {
    const first = createEngine();
    await setGlobalMood(first, "sadness", 0.6, "manual_set");

    const second = createEngine();
    await refreshGlobalMood(second, false);

    assert.equal(second.state.angle, 180);
    assert.equal(second.getCurrentEmotion(), "sadness");
    assert.equal(second.persistent.history.length, 1);
  });
});

test("applyGlobalMoodEvent applies event and appends persistent history", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();

    const change = await applyGlobalMoodEvent(engine, {
      trigger: "test_pass",
      ...DEFAULT_EMOTION_CONFIG.triggers.test_pass,
    });

    assert.equal(change.newAngle, engine.state.angle);
    assert.equal(engine.getCurrentEmotion(), "joy");
    assert.equal(engine.persistent.history.length, 1);
    assert.equal(engine.persistent.history[0]?.trigger, "test_pass");
    assert.equal(engine.persistent.history[0]?.sequence, 1);
  });
});

test("applyGlobalMoodEvent does nothing when emotion updates are disabled", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();
    await setGlobalEmotionUpdatesEnabled(engine, false);

    const change = await applyGlobalMoodEvent(engine, {
      trigger: "test_fail",
      ...DEFAULT_EMOTION_CONFIG.triggers.test_fail,
    });

    assert.equal(change.notify, false);
    assert.equal(engine.state.angle, 0);
    assert.equal(engine.state.intensity, 0.15);
    assert.equal(engine.persistent.history.length, 0);
  });
});

test("setGlobalEmotionUpdatesEnabled persists the switch", async () => {
  await withTemporaryHome(async (home) => {
    const engine = createEngine();

    await setGlobalEmotionUpdatesEnabled(engine, false);

    assert.equal(engine.persistent.emotionUpdatesEnabled, false);
    assert.equal(readState(home).emotionUpdatesEnabled, false);
  });
});

test("setGlobalMood directly sets emotion and appends persistent history", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();

    await setGlobalMood(engine, "anger", 0.8, "manual_set");

    assert.equal(engine.state.angle, 270);
    assert.ok(Math.abs(engine.state.intensity - 0.8) < 0.001);
    assert.equal(engine.persistent.lastAngle, 270);
    assert.ok(Math.abs(engine.persistent.lastIntensity - 0.8) < 0.001);
    assert.equal(engine.persistent.history.length, 1);
    assert.equal(engine.persistent.history[0]?.emotion, "anger");
    assert.equal(engine.persistent.history[0]?.trigger, "manual_set");
  });
});
