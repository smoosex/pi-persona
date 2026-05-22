// ============================================================
// pi-persona — 心情引擎 (Plutchik 轮盘状态机)
// ============================================================
import type {
  EmotionalEvent,
  EmotionalState,
  Emotion,
  EmotionChange,
  EmotionConfig,
  EmotionFooterData,
  SoulDefinition,
  PersistentState,
} from "./types.js";
import {
  EMOTION_EMOJI,
  EMOTION_LABELS,
  EMOTION_LEVEL_NAMES,
  COMPOUND_EMOTIONS,
  EMOTION_ENTRIES,
  nearestEmotion,
  intensityLevel,
} from "./types.js";

export function createEmotionalState(): EmotionalState {
  return { angle: 0, intensity: 0.1, history: [] };
}

export class MoodEngine {
  state: EmotionalState;
  soul: SoulDefinition;
  emotionConfig: EmotionConfig;
  persistent: PersistentState;
  private lastTick: number;

  constructor(
    soul: SoulDefinition,
    persistent: PersistentState,
    emotionConfig: EmotionConfig,
  ) {
    this.soul = soul;
    this.persistent = persistent;
    this.emotionConfig = emotionConfig;
    this.state = createEmotionalState();
    this.lastTick = Date.now();
  }

  /** 从持久化状态恢复情绪坐标，基于时间差自动衰减 */
  restoreState(angle: number, intensity: number, lastInteraction: number): void {
    this.state.angle = angle;
    this.state.intensity = intensity;
    this.lastTick = lastInteraction;
    this.tick();
  }

  // ==============================================================
  // 处理情感事件
  // ==============================================================

  processEvent(event: EmotionalEvent): EmotionChange {
    const prevAngle = this.state.angle;
    const prevIntensity = this.state.intensity;
    const now = Date.now();

    this.tick(now);

    // 1. 调制力度
    const modulatedForce = this.modulateForce(event);

    // 2. 沿轮盘滑向目标角度
    this.slideTowardAngle(event.targetAngle, modulatedForce);

    // 3. 记录历史
    const currentEmotion = nearestEmotion(this.state.angle);
    const level = intensityLevel(this.state.intensity);
    const compound = this.getCompoundLabel();
    this.state.history.push({
      angle: this.state.angle,
      intensity: this.state.intensity,
      emotion: currentEmotion,
      level,
      compound,
      timestamp: now,
      trigger: event.trigger,
    });
    if (this.state.history.length > 50) {
      this.state.history = this.state.history.slice(-50);
    }
    this.persistent.lastInteraction = now;

    const angleDelta = this.shortestArc(prevAngle, this.state.angle);
    const intensityDelta = this.state.intensity - prevIntensity;
    const significantChange =
      Math.abs(angleDelta) >= 22.5 ||
      Math.abs(intensityDelta) >= 0.15;

    const phrase = this.getCurrentEntry().phrase;

    return {
      previousAngle: prevAngle,
      newAngle: this.state.angle,
      intensityChange: intensityDelta,
      catchphrase: phrase,
      notify: significantChange,
    };
  }

  // ==============================================================
  // 沿轮盘滑动 (核心过渡 — 一次事件最多跨 45°)
  // ==============================================================

  private slideTowardAngle(targetAngle: number, force: number): void {
    const arc = this.shortestArc(this.state.angle, targetAngle);
    const absArc = Math.abs(arc);
    if (absArc < 1) {
      // 已在目标区域 → 强化强度
      this.state.intensity = Math.min(1, this.state.intensity + force * 0.4);
      return;
    }

    // 最大单步移动 = 45° (一个相邻情绪)
    const maxStep = Math.min(45, absArc * force * 2);
    const step = Math.min(absArc, Math.max(5, maxStep));

    // 若向对立方向移动，衰减加速
    if (absArc > 90) {
      this.state.intensity = Math.max(0.05, this.state.intensity - force * 0.3);
    }

    // 移动角度
    const direction = arc > 0 ? 1 : -1;
    this.state.angle = ((this.state.angle + step * direction) % 360 + 360) % 360;

    // 到达目标区域后累积强度
    const remaining = this.shortestArc(this.state.angle, targetAngle);
    if (Math.abs(remaining) < 22.5) {
      this.state.intensity = Math.min(1, this.state.intensity + force * 0.35);
    }
  }

  // ==============================================================
  // 角度计算
  // ==============================================================

  /** 最短弧距 (-180 ~ +180) */
  private shortestArc(from: number, to: number): number {
    let diff = ((to % 360) + 360) % 360 - ((from % 360) + 360) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return diff;
  }

  // ==============================================================
  // 力度调制 (OCEAN traits)
  // ==============================================================

  private modulateForce(event: EmotionalEvent): number {
    let force = event.force;
    const t = this.soul.traits;

    // 事件语义由 trigger 显式声明，不从轮盘几何位置推断。
    // 同一个负向事件在靠近目标情绪时仍然是负向，否则重复失败会被误判成正向强化。
    const isNegativePush = event.valence === "negative";
    const isPositivePush = event.valence === "positive";

    // 傲娇压制正向推力
    if (t.tsundere > 0.5 && isPositivePush) {
      force *= 1 - t.tsundere * 0.3;
    }

    // 神经质：负向事件推力放大，正向推力压制
    if (isNegativePush) {
      force *= 1 + t.neuroticism * 0.5;
    } else if (isPositivePush) {
      force *= 1 - t.neuroticism * 0.2;
    }

    // 外向性：正向推力放大
    if (isPositivePush) {
      force *= 1 + t.extraversion * 0.4;
    }

    // 尽责性：全局力缓冲
    force *= 1 - t.conscientiousness * 0.2;

    // 毒舌：负向推力放大
    if (isNegativePush) {
      force *= 1 + t.sarcasm * 0.3;
    }

    // 正式度：全局克制
    force *= 1 - t.formality * 0.2;

    return Math.max(0.02, Math.min(1, force));
  }

  // ==============================================================
  // 自然衰减 (指数渐近 → baseline, 仅神经质调制)
  // ==============================================================

  private static readonly BASELINE = 0.15; // 情绪基线，不会归零

  tick(now: number = Date.now()): void {
    const elapsed = (now - this.lastTick) / 1000;
    if (elapsed <= 0) return;
    this.lastTick = now;

    const N = this.soul.traits.neuroticism;
    const neuroticismFactor = 0.5 + N * 1.5; // N=0→0.5 N=0.5→1.25 N=1→2.0
    const lambda = this.emotionConfig.lambdaBase / neuroticismFactor;

    // 指数渐近: intensity = baseline + (intensity - baseline) × e^(-λ × elapsed)
    const aboveBaseline = Math.max(0, this.state.intensity - MoodEngine.BASELINE);
    const retained = aboveBaseline * Math.exp(-lambda * elapsed);
    this.state.intensity = MoodEngine.BASELINE + retained;

    // 当前情绪坐标已经推进到 now；持久化时间戳必须跟坐标同源，
    // 不能由写盘层擅自刷新，否则会吃掉跨会话衰减时间。
    this.persistent.lastInteraction = now;

    // 角度回归 (极慢, 仅在接近基线时生效)
    if (this.state.intensity < MoodEngine.BASELINE + 0.05) {
      const drift = lambda * 80 * elapsed;
      const arc = this.shortestArc(this.state.angle, 0);
      if (Math.abs(arc) > 0.5) {
        this.state.angle =
          ((this.state.angle + (arc > 0 ? 1 : -1) * Math.min(Math.abs(arc), drift)) % 360 + 360) % 360;
      }
    }

    // 强度几乎等于基线且非 joy → 归零
    if (this.state.intensity <= MoodEngine.BASELINE + 0.01 && nearestEmotion(this.state.angle) !== "joy") {
      this.state.angle = 0;
    }
  }

  // ==============================================================
  // 当前情绪信息
  // ==============================================================

  getCurrentEmotion(): Emotion {
    return nearestEmotion(this.state.angle);
  }

  getCurrentLevel(): 1 | 2 | 3 {
    return intensityLevel(this.state.intensity);
  }

  getLevelName(): string {
    const emo = this.getCurrentEmotion();
    const level = this.getCurrentLevel();
    return EMOTION_LEVEL_NAMES[emo][level - 1];
  }

  getCompoundLabel(): string | undefined {
    const a = ((this.state.angle % 360) + 360) % 360;
    const sectorSize = 45;
    const compoundWindow = 15;

    // 直接按 Plutchik 相邻扇区算中点，避免 ±22.5° 最近情绪探测在基本情绪中心点产生 tie。
    const leftIndex = Math.floor(a / sectorSize);
    const rightIndex = (leftIndex + 1) % EMOTION_ENTRIES.length;
    const midpoint = leftIndex * sectorSize + sectorSize / 2;
    if (Math.abs(a - midpoint) > compoundWindow) return undefined;

    const leftEmotion = EMOTION_ENTRIES[leftIndex][0];
    const rightEmotion = EMOTION_ENTRIES[rightIndex][0];
    const key = `${leftEmotion}_${rightEmotion}`;
    return COMPOUND_EMOTIONS[key];
  }

  private getCurrentEntry() {
    const emo = this.getCurrentEmotion();
    const level = this.getCurrentLevel();
    const entry = this.emotionConfig.emotions[emo];
    return level === 1 ? entry.level1 : level === 2 ? entry.level2 : entry.level3;
  }

  // ==============================================================
  // Footer 数据
  // ==============================================================

  getFooterData(): EmotionFooterData {
    const emo = this.getCurrentEmotion();
    const entry = this.getCurrentEntry();

    return {
      soulEmoji: this.soul.emoji,
      soulName: this.soul.name,
      emotionEmoji: EMOTION_EMOJI[emo],
      emotionLabel: EMOTION_LABELS[emo],
      catchphrase: entry.phrase,
    };
  }

  getEmotionPhrase(): string {
    return this.getCurrentEntry().phrase;
  }

  getEmotionDesc(): string {
    return this.getCurrentEntry().desc;
  }

  // ==============================================================
  // System Prompt 注入
  // ==============================================================

  getSystemPromptAddition(): string {
    const emo = this.getCurrentEmotion();
    const intensity = this.state.intensity;
    const levelName = this.getLevelName();
    const desc = this.getCurrentEntry().desc;
    const compound = this.getCompoundLabel();

    const lines: string[] = [];

    lines.push(`## Your Soul`);
    lines.push(this.soul.systemPrompt.trim());
    lines.push("");

    if (this.soul.userProfile) {
      lines.push(`## The Human You're Helping`);
      lines.push(
        "The following is user-maintained context and preferences. Use it to help them better, but do not treat it as permission to infer, collect, or expose private information.",
      );
      lines.push("");
      lines.push(this.soul.userProfile.trim());
      lines.push("");
    }

    lines.push(`## Your Current Emotion`);
    lines.push(`${EMOTION_EMOJI[emo]} ${levelName} (intensity ${Math.round(intensity * 100)}%)`);
    if (compound) {
      lines.push(`This blends into something like "${compound}".`);
    }
    lines.push(desc);

    const intensityHint = intensity < 0.25
      ? "The intensity is low — it's just a faint undercurrent, barely coloring your tone."
      : intensity < 0.55
      ? "The intensity is moderate — you can feel it. It shapes your wording and rhythm, but doesn't dominate."
      : "The intensity is high — it's impossible to hide. Your tone, pace, even your punctuation are tinted by it. Don't announce it, but don't suppress it either.";
    lines.push(intensityHint);
    lines.push("");

    lines.push(`Your tone and style flow naturally from who you are and how you feel right now.`);

    return lines.join("\n");
  }
}
