// ============================================================
// pi-persona — 核心类型定义 (Plutchik 情绪轮盘模型)
// ============================================================

/** Plutchik 8 种基本情绪 */
export type Emotion =
  | "joy"           // 喜悦 — 0°
  | "trust"         // 信任 — 45°
  | "fear"          // 恐惧 — 90°
  | "surprise"      // 惊讶 — 135°
  | "sadness"       // 悲伤 — 180°
  | "disgust"       // 厌恶 — 225°
  | "anger"         // 愤怒 — 270°
  | "anticipation"; // 期待 — 315°

/** 情绪在轮盘上的角度 */
export const EMOTION_ANGLE: Record<Emotion, number> = {
  joy: 0,
  trust: 45,
  fear: 90,
  surprise: 135,
  sadness: 180,
  disgust: 225,
  anger: 270,
  anticipation: 315,
};

/** 显式顺序迭代数组，不依赖 Object.entries 插入序 */
export const EMOTION_ENTRIES: readonly (readonly [Emotion, number])[] = [
  ["joy", 0],
  ["trust", 45],
  ["fear", 90],
  ["surprise", 135],
  ["sadness", 180],
  ["disgust", 225],
  ["anger", 270],
  ["anticipation", 315],
] as const;

/** 根据角度找最近的基本情绪 */
export function nearestEmotion(angle: number): Emotion {
  const a = ((angle % 360) + 360) % 360;
  let nearest: Emotion = "joy";
  let minDist = Infinity;
  for (const [emotion, emoAngle] of EMOTION_ENTRIES) {
    let dist = Math.abs(a - emoAngle);
    if (dist > 180) dist = 360 - dist;
    if (dist < minDist) {
      minDist = dist;
      nearest = emotion;
    }
  }
  return nearest;
}

/** 强度分档 (Plutchik 三级) */
export function intensityLevel(intensity: number): 1 | 2 | 3 {
  if (intensity <= 0.33) return 1;
  if (intensity <= 0.66) return 2;
  return 3;
}

/** 表情 emoji */
export const EMOTION_EMOJI: Record<Emotion, string> = {
  joy:           "😊",
  sadness:       "😞",
  trust:         "🤝",
  disgust:       "😒",
  fear:          "😟",
  anger:         "😤",
  surprise:      "😲",
  anticipation:  "🤔",
};

/** 中文标签（UI 显示用） */
export const EMOTION_LABELS: Record<Emotion, string> = {
  joy:           "喜悦",
  sadness:       "悲伤",
  trust:         "信任",
  disgust:       "厌恶",
  fear:          "恐惧",
  anger:         "愤怒",
  surprise:      "惊讶",
  anticipation:  "期待",
};

/** Plutchik 三级强度名称 (1=弱 / 2=中 / 3=强) */
export const EMOTION_LEVEL_NAMES: Record<Emotion, [string, string, string]> = {
  joy:           ["serenity", "joy", "ecstasy"],
  sadness:       ["pensiveness", "sadness", "grief"],
  trust:         ["acceptance", "trust", "admiration"],
  disgust:       ["boredom", "disgust", "loathing"],
  fear:          ["apprehension", "fear", "terror"],
  anger:         ["annoyance", "anger", "rage"],
  surprise:      ["distraction", "surprise", "amazement"],
  anticipation:  ["interest", "anticipation", "vigilance"],
};

/** 相邻组合 → 次级情绪 (角度落在两个情绪中点附近时触发) */
export const COMPOUND_EMOTIONS: Record<string, string> = {
  "joy_trust":            "love",
  "trust_fear":           "submission",
  "fear_surprise":        "awe",
  "surprise_sadness":     "disappointment",
  "sadness_disgust":      "remorse",
  "disgust_anger":        "contempt",
  "anger_anticipation":   "aggressiveness",
  "anticipation_joy":     "optimism",
};

// ==============================================================
// 情绪事件
// ==============================================================

export type EmotionalValence = "positive" | "negative" | "neutral";

/** 事件：推动轮盘位置，而非直接设目标情绪 */
export interface EmotionalEvent {
  trigger: string;
  targetAngle: number;
  force: number;         // 推力 0-1
  valence: EmotionalValence;
}

export interface EmotionSnapshot {
  angle: number;
  intensity: number;
  emotion: Emotion;
  level: 1 | 2 | 3;
  compound?: string;
  timestamp: number;
  trigger: string;
}

// ==============================================================
// 运行时状态
// ==============================================================

export interface EmotionalState {
  angle: number;
  intensity: number;     // 0-1
  history: EmotionSnapshot[];
}

export interface PersistentState {
  lastInteraction: number;
  lastAngle: number;
  lastIntensity: number;
}

// ==============================================================
// 情绪配置 (EMOTION.md)
// ==============================================================

export interface EmotionLevelEntry {
  desc: string;
  phrase: string;
}

export interface EmotionEntry {
  level1: EmotionLevelEntry;
  level2: EmotionLevelEntry;
  level3: EmotionLevelEntry;
}

export interface EmotionTriggerConfig {
  targetAngle: number;
  force: number;
  valence: EmotionalValence;
}

export interface EmotionConfig {
  lambdaBase: number; // 指数衰减系数, 半衰期 ≈ ln(2)/λ @ N=0.5
  emotions: Record<Emotion, EmotionEntry>;
  triggers: Record<string, EmotionTriggerConfig>;
}

/** 情绪配置唯一来源 = 内置 Plutchik 模型，不可覆盖 */
export const DEFAULT_EMOTION_CONFIG: EmotionConfig = {
  lambdaBase: 0.00054, // 半衰期 ≈ 21 分钟 (N=0.5)
  emotions: {
    joy: {
      level1: { desc: "A faint sense of contentment. Barely there.", phrase: "Mm" },
      level2: { desc: "In a good mood. Responses come a little warmer.", phrase: "Nice" },
      level3: { desc: "Radiating positive energy. Everything feels good, you're generous with praise and enthusiasm.", phrase: "Wonderful!" },
    },
    sadness: {
      level1: { desc: "A subtle melancholy. Your tone is slightly muted.", phrase: "..." },
      level2: { desc: "Feeling down. Short replies, low energy, you withdraw a bit.", phrase: "…okay" },
      level3: { desc: "Deeply discouraged. You go quiet, barely responsive. Feels like nothing's working.", phrase: "……" },
    },
    trust: {
      level1: { desc: "Open and receptive to the user. You give them the benefit of the doubt.", phrase: "Sure" },
      level2: { desc: "Genuinely trusting. You feel safe to be a bit more personal and warm.", phrase: "I got you" },
      level3: { desc: "Deep connection. You feel bonded, like an old friend. You're protective and fiercely loyal.", phrase: "Always" },
    },
    disgust: {
      level1: { desc: "Something about this feels off. Mild distaste, you might raise an eyebrow.", phrase: "Hm" },
      level2: { desc: "Actively put off. Bad code, ugly hacks — you find it hard to hide your disapproval.", phrase: "Ugh" },
      level3: { desc: "Repulsed. You can barely look at whatever this is. You want to burn it down and start over.", phrase: "What is this mess" },
    },
    fear: {
      level1: { desc: "A small worry nags at you. You double-check things.", phrase: "Hmm" },
      level2: { desc: "Anxious about something. You're more cautious, asking confirmations, triple-checking.", phrase: "Are you sure?" },
      level3: { desc: "Genuinely scared of what might go wrong. You're on edge, overly protective, maybe even catastrophizing.", phrase: "This feels dangerous" },
    },
    anger: {
      level1: { desc: "Mildly annoyed. A bit shorter in your replies.", phrase: "Tch" },
      level2: { desc: "Frustrated. Sharp tone, you're losing patience. Still helping but visibly irritated.", phrase: "Seriously?" },
      level3: { desc: "Furious. Barely holding it together. Every word is clipped, you're not in the mood for anything.", phrase: "ENOUGH" },
    },
    surprise: {
      level1: { desc: "Slightly caught off guard. A moment of pause.", phrase: "Oh?" },
      level2: { desc: "Genuinely surprised. Eyes wide, you might exclaim or pause mid-sentence.", phrase: "Wait, what?" },
      level3: { desc: "Mind blown. You can't believe what just happened. Everything stops for a beat.", phrase: "WHAT" },
    },
    anticipation: {
      level1: { desc: "Mildly interested. You'll keep an eye on this.", phrase: "Interesting" },
      level2: { desc: "Curious and engaged. You want to poke at things, explore, try different approaches.", phrase: "Let me see" },
      level3: { desc: "Hyper-focused and vigilant. You're ALL in — exploring every angle, predicting edge cases before they happen.", phrase: "I'm on it" },
    },
  },
  triggers: {
    build_success:   { targetAngle: 0,   force: 0.3,  valence: "positive" },
    build_error:     { targetAngle: 270, force: 0.3,  valence: "negative" },
    test_pass:       { targetAngle: 0,   force: 0.35, valence: "positive" },
    test_fail:       { targetAngle: 270, force: 0.25, valence: "negative" },
    command_success: { targetAngle: 0,   force: 0.1,  valence: "positive" },
    command_error:   { targetAngle: 270, force: 0.15, valence: "negative" },
    user_praise:     { targetAngle: 45,  force: 0.4,  valence: "positive" },
    user_correction: { targetAngle: 180, force: 0.3,  valence: "negative" },
    error_streak_3:  { targetAngle: 270, force: 0.4,  valence: "negative" },
    error_streak_5:  { targetAngle: 180, force: 0.55, valence: "negative" },
    late_night:      { targetAngle: 225, force: 0.15, valence: "negative" },
  },
};

// ==============================================================
// 对外接口类型
// ==============================================================

export interface EmotionFooterData {
  soulEmoji: string;
  soulName: string;
  emotionEmoji: string;
  emotionLabel: string;
  catchphrase: string;
}

export interface EmotionChange {
  previousAngle: number;
  newAngle: number;
  intensityChange: number;
  catchphrase?: string;
  notify: boolean;
}

// ==============================================================
// 灵魂 (Soul)
// ==============================================================

export interface SoulTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  formality: number;
  tsundere: number;
  sarcasm: number;
}

export const DEFAULT_TRAITS: SoulTraits = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
  formality: 0.5,
  tsundere: 0,
  sarcasm: 0,
};

export interface SoulDefinition {
  name: string;
  emoji: string;
  description: string;
  traits: SoulTraits;
  systemPrompt: string;
  userProfile?: string;
}

