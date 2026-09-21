import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { registerPersonaCommands } from "./commands.js";
import { MoodEngine } from "./mood-engine.js";
import { invalidateSoulCache } from "./soul-loader.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";

interface RegisteredCommand {
  description: string;
  handler: (args: string | undefined, ctx: any) => Promise<void>;
}

async function withTemporaryHome(fn: (home: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const home = await mkdtemp(path.join(tmpdir(), "pi-persona-home-"));

  try {
    process.env.HOME = home;
    // The agent directory wins over HOME, so a developer with it exported
    // would otherwise run these against their real one.
    delete process.env.PI_CODING_AGENT_DIR;
    invalidateSoulCache();
    await fn(home);
  } finally {
    invalidateSoulCache();
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
    lastIntensity: 0.15,
    emotionUpdatesEnabled: true,
    nextHistorySequence: 1,
    history: [],
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

function createEngine(): MoodEngine {
  return new MoodEngine(createSoul(), createPersistentState(), DEFAULT_EMOTION_CONFIG);
}

function registerHarness(engine: MoodEngine | null = null) {
  let currentEngine = engine;
  let command: RegisteredCommand | undefined;
  const pi = {
    registerCommand(name: string, registered: RegisteredCommand) {
      assert.equal(name, "persona");
      command = registered;
    },
  };
  registerPersonaCommands(
    pi as any,
    () => currentEngine,
    (nextEngine) => {
      currentEngine = nextEngine;
    },
  );
  assert.ok(command);
  return {
    command,
    get engine() {
      return currentEngine;
    },
  };
}

function createContext() {
  const notifications: Array<{ message: string; level: string }> = [];
  const statuses: Array<{ key: string; value: string }> = [];
  const customs: unknown[] = [];
  return {
    notifications,
    statuses,
    customs,
    ctx: {
      hasUI: true,
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        setStatus(key: string, value: string) {
          statuses.push({ key, value });
        },
        async custom(factory: unknown, options: unknown) {
          customs.push({ factory, options });
        },
      },
    },
  };
}

test("persona status notifies when no soul is active", async () => {
  const harness = registerHarness(null);
  const { ctx, notifications } = createContext();

  await harness.command.handler("status", ctx);

  assert.match(notifications[0]?.message ?? "", /当前无激活灵魂/);
  assert.equal(notifications[0]?.level, "info");
});

test("persona status opens overlay when engine exists", async () => {
  await withTemporaryHome(async () => {
    const harness = registerHarness(createEngine());
    const { ctx, customs } = createContext();

    await harness.command.handler("", ctx);

    assert.equal(customs.length, 1);
  });
});

test("persona set updates global mood and footer", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();
    const harness = registerHarness(engine);
    const { ctx, notifications, statuses } = createContext();

    await harness.command.handler("set anger 80", ctx);

    assert.equal(engine.getCurrentEmotion(), "anger");
    assert.ok(Math.abs(engine.state.intensity - 0.8) < 0.001);
    assert.match(notifications[0]?.message ?? "", /已设置情绪: .*愤怒 \/ 80%/);
    assert.deepEqual(statuses.at(-1), { key: "soul-mood", value: "󰊠 Test Soul·愤怒" });
  });
});

test("persona set reports invalid arguments", async () => {
  const harness = registerHarness(createEngine());
  const { ctx, notifications } = createContext();

  await harness.command.handler("set joy 120", ctx);

  assert.match(notifications[0]?.message ?? "", /强度必须/);
  assert.equal(notifications[0]?.level, "warning");
});

test("persona emotion off disables automatic emotion updates", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();
    const harness = registerHarness(engine);
    const { ctx, notifications } = createContext();

    await harness.command.handler("emotion off", ctx);

    assert.equal(engine.persistent.emotionUpdatesEnabled, false);
    assert.match(notifications[0]?.message ?? "", /已关闭情绪变化/);
  });
});

test("persona emotion on enables automatic emotion updates", async () => {
  await withTemporaryHome(async () => {
    const engine = createEngine();
    engine.persistent.emotionUpdatesEnabled = false;
    const harness = registerHarness(engine);
    const { ctx, notifications } = createContext();

    await harness.command.handler("emotion on", ctx);

    assert.equal(engine.persistent.emotionUpdatesEnabled, true);
    assert.match(notifications[0]?.message ?? "", /已开启情绪变化/);
  });
});

test("persona reload disables soul when SOUL.md is missing", async () => {
  await withTemporaryHome(async () => {
    const harness = registerHarness(createEngine());
    const { ctx, notifications, statuses } = createContext();

    await harness.command.handler("reload", ctx);

    assert.equal(harness.engine, null);
    assert.deepEqual(statuses.at(-1), { key: "soul-mood", value: "" });
    assert.match(notifications[0]?.message ?? "", /灵魂已停用/);
  });
});

test("persona reload activates a soul when no engine exists", async () => {
  await withTemporaryHome(async (home) => {
    writeAgentFile(home, "SOUL.md", "You are Reloaded Soul.");
    writeAgentFile(home, "IDENTIFY.md", "---\nname: Reloaded\nemoji: 🐾\ndescription: Loaded\n---\n");
    const harness = registerHarness(null);
    const { ctx, notifications, statuses } = createContext();

    await harness.command.handler("reload", ctx);

    assert.ok(harness.engine);
    assert.equal(harness.engine.soul.name, "Reloaded");
    assert.deepEqual(statuses.at(-1), { key: "soul-mood", value: "󰊠 Reloaded·喜悦" });
    assert.match(notifications[0]?.message ?? "", /已激活灵魂/);
  });
});

test("persona unknown usage reports supported commands", async () => {
  const harness = registerHarness(createEngine());
  const { ctx, notifications } = createContext();

  await harness.command.handler("wat", ctx);

  assert.match(notifications[0]?.message ?? "", /\/persona set <emotion> <intensity>/);
  assert.equal(notifications[0]?.level, "warning");
});
