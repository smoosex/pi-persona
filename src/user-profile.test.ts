import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MoodEngine } from "./mood-engine.js";
import { invalidateSoulCache, loadSoul } from "./soul-loader.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";

function withTemporaryHome(fn: (home: string) => void): void {
  const originalHome = process.env.HOME;
  const home = mkdtempSync(path.join(tmpdir(), "pi-persona-home-"));

  try {
    process.env.HOME = home;
    invalidateSoulCache();
    fn(home);
  } finally {
    invalidateSoulCache();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function writeAgentFile(home: string, fileName: string, content: string): void {
  const agentDir = path.join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, fileName), content, "utf-8");
}

function createPersistentState(): PersistentState {
  return {
    version: 2,
    lastInteraction: Date.now(),
    lastAngle: 0,
    lastIntensity: 0.1,
    nextHistorySequence: 1,
    history: [],
  };
}

function createSoul(userProfile?: string): SoulDefinition {
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
    ...(userProfile ? { userProfile } : {}),
  };
}

test("loadSoul reads USER.md as optional user profile context", () => {
  withTemporaryHome((home) => {
    writeAgentFile(home, "SOUL.md", "You are Test Soul.");
    writeAgentFile(home, "USER.md", "Name: Sam\nTimezone: UTC");

    const soul = loadSoul();

    assert.equal(soul?.userProfile, "Name: Sam\nTimezone: UTC");
  });
});

test("loadSoul omits userProfile when USER.md is empty or missing", () => {
  withTemporaryHome((home) => {
    writeAgentFile(home, "SOUL.md", "You are Test Soul.");
    writeAgentFile(home, "USER.md", "   \n");

    assert.equal(loadSoul()?.userProfile, undefined);

    rmSync(path.join(home, ".pi", "agent", "USER.md"));
    invalidateSoulCache();

    assert.equal(loadSoul()?.userProfile, undefined);
  });
});

test("USER.md changes invalidate the cached soul", () => {
  withTemporaryHome((home) => {
    writeAgentFile(home, "SOUL.md", "You are Test Soul.");
    writeAgentFile(home, "USER.md", "Name: Sam");

    assert.equal(loadSoul()?.userProfile, "Name: Sam");

    writeAgentFile(home, "USER.md", "Name: Alex\nTimezone: UTC");

    assert.equal(loadSoul()?.userProfile, "Name: Alex\nTimezone: UTC");
  });
});

test("MoodEngine injects user profile as a separate human-context section", () => {
  const engine = new MoodEngine(
    createSoul("Name: Sam\nWhat to call them: Sam"),
    createPersistentState(),
    DEFAULT_EMOTION_CONFIG,
  );

  const prompt = engine.getSystemPromptAddition();

  assert.match(prompt, /## Your Soul/);
  assert.match(prompt, /## The Human You're Helping/);
  assert.match(prompt, /user-maintained context and preferences/);
  assert.match(prompt, /Name: Sam/);
  assert.match(prompt, /## Your Current Emotion/);
  assert.ok(prompt.indexOf("## Your Soul") < prompt.indexOf("## The Human You're Helping"));
  assert.ok(prompt.indexOf("## The Human You're Helping") < prompt.indexOf("## Your Current Emotion"));
});

test("MoodEngine does not inject human-context section without userProfile", () => {
  const engine = new MoodEngine(
    createSoul(),
    createPersistentState(),
    DEFAULT_EMOTION_CONFIG,
  );

  assert.doesNotMatch(engine.getSystemPromptAddition(), /## The Human You're Helping/);
});
