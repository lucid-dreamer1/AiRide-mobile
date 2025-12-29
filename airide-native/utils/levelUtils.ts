// AiRide-Native/airide-native/utils/levelUtils.ts
import { BASE_LEVEL, LEVELS, LevelDef } from "@/constants/achievements";

export function getLevelData(totalKm: number): {
  current: { km: number; title: string; reward?: string | null };
  next: LevelDef | null;
} {
  let current = BASE_LEVEL;
  let next: LevelDef | null = LEVELS[0] ?? null;

  for (let i = 0; i < LEVELS.length; i++) {
    const lvl = LEVELS[i];
    if (totalKm >= lvl.km) {
      current = lvl;
      next = LEVELS[i + 1] || null;
    }
  }

  return { current, next };
}

export function getProgress(totalKm: number): number {
  const { current, next } = getLevelData(totalKm);

  if (!next) return 1;

  const distanceBetween = next.km - current.km;
  const gained = totalKm - current.km;

  if (distanceBetween <= 0) return 1;

  const raw = gained / distanceBetween;
  return Math.max(0, Math.min(raw, 1));
}
