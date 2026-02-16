// contexts/ThemeContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { firebaseFirestore } from "../services/firebaseConfig";
import auth from "@react-native-firebase/auth";

/* -------------------------------------------------------
   🎨 DEFINIZIONE TEMA AiRide
------------------------------------------------------- */
export const THEMES = {
  default: {
    bg: "#000000",
    card: "#111111",
    text: "#ffffff",
    textMuted: "#aaaaaa",
    border: "#222222",
    accent: "#E85A2A",
  },

  grey: {
    bg: "#121212", // Asfalto scuro
    card: "#1E1E1E", // Pannello leggermente più chiaro
    text: "#E6E6E6", // Leggero off-white più morbido
    textMuted: "#808080", // Grigio elegante, non slavato
    border: "#2A2A2A", // Linee sottili, non pesanti
    accent: "#A6A6A6", // Metallo satinato (molto più premium)
  },

  premium: {
    bg: "#050505", // Deepest Black/Charcoal
    card: "#121212", // Elegant Dark
    text: "#EDEDED", // Off-White
    textMuted: "#A3A3A3", // Neutral Grey
    border: "#332B00", // Dark Gold Border
    accent: "#D4AF37", // Gold Luxury
  },
};

export type ThemeName = keyof typeof THEMES;

type ThemeContextType = {
  theme: ThemeName;
  themeColors: typeof THEMES.default;
  setTheme: (t: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "default",
  themeColors: THEMES.default,
  setTheme: () => {},
});

export const ThemeProvider = ({ children }: { children: any }) => {
  const [theme, setThemeState] = useState<ThemeName>("default");
  const user = auth().currentUser;

  /* -------------------------------------------------------
     🔄 CARICA TEMA DA FIREBASE
  ------------------------------------------------------- */
  useEffect(() => {
    if (!user) return;

    const unsub = firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .onSnapshot(
        (doc) => {
          if (doc && doc.exists) {
            const data = doc.data() || {};

            // 🔥 CERCA IL TEMA IN ENTRAMBI I PUNTI
            const savedTheme =
              (data.settings?.theme as ThemeName) ??
              (data.theme as ThemeName) ??
              "default";

            if (THEMES[savedTheme]) setThemeState(savedTheme);
          }
        },
        (error: any) => {
            if (error?.code && error?.code.includes("permission-denied")) {
                // Expected on logout
                return;
            }
            console.log("ThemeContext snapshot error (ignorable during logout):", error);
        }
      );

    return () => unsub();
  }, [user]);

  /* -------------------------------------------------------
     💾 SALVA TEMA SU FIREBASE
     (lo salva nel posto NUOVO = users.settings.theme)
  ------------------------------------------------------- */
  const setTheme = async (t: ThemeName) => {
    setThemeState(t);
    if (!user) return;

    await firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .update({
        settings: { theme: t },
      });
  };

  const themeColors = THEMES[theme] ?? THEMES.default;

  return (
    <ThemeContext.Provider value={{ theme, themeColors, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
