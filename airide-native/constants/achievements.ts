// AiRide-Native/airide-native/constants/achievements.ts

export const BASE_LEVEL = {
  title: "Rider Novizio",
  km: 0,
};

export type LevelDef = {
  km: number;
  title: string;
  reward?: string | null;
};

export const LEVELS: LevelDef[] = [
  { km: 25, title: "Rookie Rider", reward: "theme-grey" },
  { km: 75, title: "Stradista", reward: "intro-animation" },
  { km: 150, title: "Bestia dell’Asfalto", reward: "hud-plus" },
  { km: 300, title: "Re delle Strade", reward: "pro-mode" },
  { km: 600, title: "Leggenda del Circuito", reward: "theme-premium" },
];

export const REWARDS: Record<
  string,
  { label: string; description: string }
> = {
  "theme-grey": {
    label: "Tema Asphalt Grey",
    description: "Sblocca un tema più scuro e minimale per l’app.",
  },
  "intro-animation": {
    label: "Intro Speciale",
    description: "Animazione personalizzata all’avvio delle tue sessioni.",
  },
  "hud-plus": {
    label: "HUD Plus",
    description: "Visualizza più info sul casco nelle tratte supportate.",
  },
  "pro-mode": {
    label: "AirRide Pro Mode",
    description: "Modalità avanzata con layout dedicati al riding intenso.",
  },
  "theme-premium": {
    label: "Tema Premium",
    description: "Palette esclusiva con accenti neon per veri malati di strada.",
  },
};
