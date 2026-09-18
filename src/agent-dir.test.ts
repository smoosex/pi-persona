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

import { updatePersistentState } from "./persistence.js";
import { invalidateSoulCache, loadSoul } from "./soul-loader.js";

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

test("mood state is read back from the agent directory, not HOME", async () => {
  await withBothLocations(async ({ home, agentDir }) => {
    writeFileSync(
      path.join(home, ".pi", "agent", "mood-state.json"),
      JSON.stringify({ version: 2, lastAngle: 180, lastIntensity: 0.9, history: [] }),
      "utf-8",
    );
    await updatePersistentState((state) => ({ ...state, lastAngle: 45 }));

    const raw = JSON.parse(readFileSync(path.join(agentDir, "mood-state.json"), "utf-8")) as {
      lastAngle: number;
    };
    assert.equal(raw.lastAngle, 45, "the HOME copy must not have seeded this");
  });
});
