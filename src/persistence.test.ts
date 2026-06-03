import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readPersistentStateLocked,
  restorePersistentState,
  syncMoodToPersistent,
  updatePersistentState,
} from "./persistence.js";
import type { PersistentState } from "./types.js";

async function withTemporaryHome(fn: (home: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const home = await mkdtemp(path.join(tmpdir(), "pi-persona-home-"));

  try {
    process.env.HOME = home;
    await fn(home);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function stateFile(home: string): string {
  return path.join(home, ".pi", "agent", "mood-state.json");
}

function lockDir(home: string): string {
  return path.join(home, ".pi", "agent", "mood-state.lock");
}

function writeState(home: string, state: unknown): void {
  mkdirSync(path.dirname(stateFile(home)), { recursive: true });
  writeFileSync(stateFile(home), JSON.stringify(state, null, 2), "utf-8");
}

function createState(overrides: Partial<PersistentState> = {}): PersistentState {
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

test("restorePersistentState returns defaults when state file is missing", async () => {
  await withTemporaryHome(async () => {
    const state = restorePersistentState();

    assert.equal(state.version, 2);
    assert.equal(state.lastAngle, 0);
    assert.equal(state.lastIntensity, 0.15);
    assert.equal(state.emotionUpdatesEnabled, true);
    assert.equal(state.nextHistorySequence, 1);
    assert.deepEqual(state.history, []);
  });
});

test("restorePersistentState normalizes persisted angle, intensity, and history", async () => {
  await withTemporaryHome(async (home) => {
    const now = Date.now();
    writeState(home, {
      version: 2,
      lastInteraction: now,
      lastAngle: -90,
      lastIntensity: 2,
      emotionUpdatesEnabled: false,
      nextHistorySequence: 1,
      history: [
        {
          id: "b",
          sessionId: "s",
          sequence: 2,
          angle: 450,
          intensity: -1,
          emotion: "trust",
          level: 1,
          timestamp: now,
          trigger: "manual_set",
        },
        {
          id: "a",
          sessionId: "s",
          sequence: 1,
          angle: -45,
          intensity: 0.5,
          emotion: "anticipation",
          level: 2,
          timestamp: now,
          trigger: "manual_set",
        },
      ],
    });

    const state = restorePersistentState();

    assert.equal(state.lastAngle, 270);
    assert.equal(state.lastIntensity, 1);
    assert.equal(state.emotionUpdatesEnabled, false);
    assert.equal(state.nextHistorySequence, 3);
    assert.deepEqual(
      state.history.map((snap) => [snap.id, snap.angle, snap.intensity]),
      [
        ["a", 315, 0.5],
        ["b", 90, 0],
      ],
    );
  });
});

test("restorePersistentState falls back to defaults for invalid state file", async () => {
  await withTemporaryHome(async (home) => {
    writeState(home, { version: 1, history: [] });

    const state = restorePersistentState();

    assert.equal(state.version, 2);
    assert.equal(state.lastAngle, 0);
    assert.equal(state.lastIntensity, 0.15);
  });
});

test("updatePersistentState writes normalized state and releases lock", async () => {
  await withTemporaryHome(async (home) => {
    const updated = await updatePersistentState((state) => ({
      ...state,
      lastAngle: 765,
      lastIntensity: -0.5,
    }));

    const raw = JSON.parse(readFileSync(stateFile(home), "utf-8")) as PersistentState;
    assert.equal(updated.lastAngle, 45);
    assert.equal(updated.lastIntensity, 0);
    assert.equal(raw.lastAngle, 45);
    assert.equal(raw.lastIntensity, 0);
    assert.equal(existsSync(lockDir(home)), false);
  });
});

test("readPersistentStateLocked reads state while cleaning stale invalid lock", async () => {
  await withTemporaryHome(async (home) => {
    const staleLock = lockDir(home);
    mkdirSync(staleLock, { recursive: true });
    writeFileSync(path.join(staleLock, "owner.json"), "not json", "utf-8");
    const old = new Date(Date.now() - 60_000);
    utimesSync(staleLock, old, old);
    writeState(home, createState({ lastAngle: 180, lastIntensity: 0.4 }));

    const state = await readPersistentStateLocked();

    assert.equal(state.lastAngle, 180);
    assert.equal(state.lastIntensity, 0.4);
    assert.equal(existsSync(staleLock), false);
  });
});

test("syncMoodToPersistent copies engine state coordinates", () => {
  const persistent = createState();
  syncMoodToPersistent({ persistent, state: { angle: 225, intensity: 0.65 } });

  assert.equal(persistent.lastAngle, 225);
  assert.equal(persistent.lastIntensity, 0.65);
});
