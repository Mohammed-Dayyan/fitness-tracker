/**
 * Canonical fitness goals and activity levels, plus tolerant matching of the
 * free text an import (or ChatGPT) may supply: "recomp", "Lean bulk", "cut",
 * "moderate". Stored text is never rewritten; it is interpreted when read.
 */

export const GOAL_LABELS = ["Body recomposition", "Fat loss", "Muscle gain", "Maintenance"] as const;
export type GoalLabel = (typeof GOAL_LABELS)[number];

export const ACTIVITY_LABELS = ["Sedentary", "Lightly active", "Moderately active", "Very active", "Extra active"] as const;
export type ActivityLabel = (typeof ACTIVITY_LABELS)[number];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

const GOAL_ALIASES: Record<GoalLabel, string[]> = {
  "Body recomposition": ["body recomposition", "recomposition", "recomp", "body recomp", "lose fat and build muscle"],
  "Fat loss": ["fat loss", "lose fat", "weight loss", "lose weight", "cut", "cutting", "fat cut", "slim down"],
  "Muscle gain": ["muscle gain", "gain muscle", "build muscle", "bulk", "bulking", "lean bulk", "lean bulking", "muscle building", "mass gain"],
  Maintenance: ["maintenance", "maintain", "maintaining", "maintain weight", "stay the same"],
};

const ACTIVITY_ALIASES: Record<ActivityLabel, string[]> = {
  Sedentary: ["sedentary", "inactive", "desk job", "little exercise"],
  "Lightly active": ["lightly active", "light", "light activity", "lightly"],
  "Moderately active": ["moderately active", "moderate", "moderate activity", "moderately"],
  "Very active": ["very active", "heavy", "hard exercise"],
  "Extra active": ["extra active", "extremely active", "athlete", "physical job"],
};

function match<L extends string>(raw: string | null | undefined, aliases: Record<L, string[]>): L | null {
  if (!raw) return null;
  const q = squash(raw);
  if (!q) return null;
  for (const [label, list] of Object.entries(aliases) as [L, string[]][]) {
    if (squash(label) === q || list.includes(q)) return label;
  }
  return null;
}

export const canonicalGoal = (raw: string | null | undefined) => match<GoalLabel>(raw, GOAL_ALIASES);
export const canonicalActivity = (raw: string | null | undefined) => match<ActivityLabel>(raw, ACTIVITY_ALIASES);
