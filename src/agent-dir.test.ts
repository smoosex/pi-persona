// ============================================================
// pi-persona — agent directory resolution
//
// These prove the ordering rather than the paths: with both HOME and
// PI_CODING_AGENT_DIR set to real directories that each hold a persona and a
// mood state, the agent directory must win and HOME must be left untouched.
//
// The other suites delete PI_CODING_AGENT_DIR so they can test the HOME
// fallback in isolation, which means nothing there would notice if the
// precedence reversed. That is the case this file covers.
// ============================================================
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { restorePersistentState, updatePersistentState } from "./persistence.js";
import { invalidateSoulCache, loadSoul } from "./soul-loader.js";
import type { PersistentState } from "./types.js";

interface Dirs {
  /** $HOME, whose .pi/agent must be ignored while the variable is set. */
  home: string;
  /** PI_CODING_AGENT_DIR, which is an agent directory itself, not a home. */
  agentDir: string;
}

/**
 * Runs `fn` with both locations populated and distinguishable.
 *
 * `~/.pi/agent` under the temporary HOME is a decoy: every assertion here is
 * about the agent directory being preferred to it.
 */
async function withBothLocations(fn: (dirs: Dirs) => Promise<void> | void): Promise<void> {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const home = mkdtempSync(path.join(tmpdir(), "pi-persona-home-"));
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-persona-agent-"));

  try {
    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    invalidateSoulCache();
    await fn({ home, agentDir });
  } finally {
    invalidateSoulCache();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(home, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
}

/** SOUL.md is prose; the name lives in IDENTIFY.md, so assert on the body. */
const soulText = (marker: string) => `${marker} body.\n`;

/**
 * A complete PersistentState, distinguishable by angle.
 *
 * Complete matters: a partial object is rejected as invalid and falls back to
 * the default, so a decoy built from a few fields would prove nothing about
 * which file was read.
 */
function validState(lastAngle: number): PersistentState {
  return {
    version: 2,
    lastInteraction: Date.now(),
    lastAngle,
    lastIntensity: 0.5,
    emotionUpdatesEnabled: true,
    nextHistorySequence: 1,
    history: [],
  };
}

function writeState(dir: string, state: PersistentState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mood-state.json"), JSON.stringify(state, null, 2), "utf-8");
}

test("PI_CODING_AGENT_DIR outranks HOME when loading the persona", async () => {
  await withBothLocations(({ home, agentDir }) => {
    writeFileSync(path.join(home, ".pi", "agent", "SOUL.md"), soulText("From HOME"), "utf-8");
    writeFileSync(path.join(agentDir, "SOUL.md"), soulText("From PI_CODING_AGENT_DIR"), "utf-8");

    const soul = loadSoul();

    assert.match(soul?.systemPrompt ?? "", /From PI_CODING_AGENT_DIR body\./);
    assert.doesNotMatch(soul?.systemPrompt ?? "", /From HOME/, "the home copy must not leak in");
  });
});

test("a persona in HOME is not a fallback when the agent directory has none", async () => {
  // The interesting half of the ordering: once the variable is set, the home
  // directory is not consulted at all. A bot with its own agent directory and
  // no SOUL.md must run without a persona rather than borrow the operator's.
  await withBothLocations(({ home }) => {
    writeFileSync(path.join(home, ".pi", "agent", "SOUL.md"), soulText("From HOME"), "utf-8");

    assert.equal(loadSoul(), null);
  });
});

test("PI_CODING_AGENT_DIR outranks HOME when persisting mood state", async () => {
  await withBothLocations(async ({ home, agentDir }) => {
    await updatePersistentState((state) => ({ ...state, lastAngle: 90, lastIntensity: 0.5 }));

    const written = path.join(agentDir, "mood-state.json");
    assert.ok(existsSync(written), "mood state belongs in the agent directory");
    const raw = JSON.parse(readFileSync(written, "utf-8")) as { lastAngle: number };
    assert.equal(raw.lastAngle, 90);

    // The deployment's whole point: nothing leaks into the shared home, where
    // every other pi on the machine would see it.
    assert.equal(
      existsSync(path.join(home, ".pi", "agent", "mood-state.json")),
      false,
      "and must not also be written under HOME",
    );
  });
});

test("restorePersistentState reads the agent directory, not HOME", async () => {
  // Both locations hold a *valid* state, differing only in angle, and both
  // exist before the read. That is what makes this a read test: with only one
  // populated, or with an invalid decoy, the default state is returned and the
  // assertion would hold no matter which file was consulted.
  await withBothLocations(({ home, agentDir }) => {
    writeState(path.join(home, ".pi", "agent"), validState(180));
    writeState(agentDir, validState(45));

    assert.equal(restorePersistentState().lastAngle, 45);
  });
});

test("a valid state in HOME is not read when the agent directory has none", async () => {
  // The other half: no silent fallback to the operator's mood.
  await withBothLocations(({ home }) => {
    writeState(path.join(home, ".pi", "agent"), validState(180));

    assert.notEqual(restorePersistentState().lastAngle, 180, "HOME must not be consulted");
  });
});
