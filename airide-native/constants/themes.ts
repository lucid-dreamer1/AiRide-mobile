export type ThemeKey = "default" | "grey" | "premium";

export const THEMES: Record<
  ThemeKey,
  { background: string; card: string; text: string; accent: string; dim: string }
> = {
  default: {
    background: "#000",
    card: "#111",
    text: "#fff",
    accent: "#E85A2A",
    dim: "#888",
  },
  grey: {
    background: "#0f0f0f",
    card: "#1a1a1a",
    text: "#eee",
    accent: "#888",
    dim: "#999",
  },
  premium: {
    background: "#050505",
    card: "#151515",
    text: "#fff",
    accent: "#9b59ff",
    dim: "#aaa",
  },
};
