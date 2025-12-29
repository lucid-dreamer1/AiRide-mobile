// app/_layout.tsx
import {
  DarkTheme as NavDark,
  DefaultTheme as NavLight,
  ThemeProvider as NavThemeProvider,
} from "@react-navigation/native";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { AuthProvider } from "../services/AuthContext";
import { NavigationProvider } from "../navigation/NavigationContext";
import { HelmetProvider } from "@/contexts/HelmetContext";

import Toast from "react-native-toast-message";

// ⭐ TEMA AiRide
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";

function NavigationThemeWrapper({ children }: { children: React.ReactNode }) {
  const { themeColors } = useTheme(); // ✅ FIX: niente "colors"

  const navigationTheme = {
    ...NavLight,
    colors: {
      ...NavLight.colors,
      primary: themeColors.accent,
      background: themeColors.bg,
      card: themeColors.card,
      text: themeColors.text,
      border: themeColors.border,
      notification: themeColors.accent,
    },
  };

  return <NavThemeProvider value={navigationTheme}>{children}</NavThemeProvider>;
}

export default function RootLayout() {
  return (
    <HelmetProvider>
      <NavigationProvider>
        <AuthProvider>
          {/* ⭐ 1) Theme globale AiRide */}
          <ThemeProvider>
            {/* ⭐ 2) Navigation Theme sincronizzato col tuo tema */}
            <NavigationThemeWrapper>
              <>
                <Stack>
                  <Stack.Screen name="login" options={{ headerShown: false }} />
                  <Stack.Screen name="register" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="modal" options={{ presentation: "modal" }} />
                </Stack>

                <StatusBar style="light" />

                <Toast />
              </>
            </NavigationThemeWrapper>
          </ThemeProvider>
        </AuthProvider>
      </NavigationProvider>
    </HelmetProvider>
  );
}
