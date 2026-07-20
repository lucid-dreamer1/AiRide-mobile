// app/_layout.tsx
import {
  DarkTheme as NavDark,
  DefaultTheme as NavLight,
  ThemeProvider as NavThemeProvider,
} from "@react-navigation/native";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import React, { useEffect, useState, useCallback } from "react";
import * as SplashScreen from "expo-splash-screen";
import { View } from "react-native";

import { AuthProvider } from "../services/AuthContext";
import { NavigationProvider } from "../navigation/NavigationContext";
import { HelmetProvider } from "@/contexts/HelmetContext";
import { VoiceSettingsProvider } from "@/contexts/VoiceSettingsContext";
import { OtaProvider } from "@/contexts/OtaContext";

import Toast from "react-native-toast-message";

// ⭐ TEMA AiRide
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";

// ⭐ Animated Splash
import AnimatedSplash from "@/components/AnimatedSplash";

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync().catch(() => {
  /* reloading the app might trigger some race conditions, ignore them */
});

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

// ⭐ AiRescue Context
import { AiRescueProvider } from "@/contexts/AiRescueContext";

import { useKeepAwake } from "expo-keep-awake";

export default function RootLayout() {
  useKeepAwake();
  
  const [appIsReady, setAppIsReady] = useState(false);
  const [splashAnimationFinished, setSplashAnimationFinished] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load fonts, make any API calls you need to do here
        // await Font.loadAsync(Entypo.font);
        
        // Artificially delay for a split second to ensure native splash is visible if needed
        // await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.warn(e);
      } finally {
        // Tell the application to render
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      // This tells the native splash screen to hide immediately!
      // We do this as soon as the app is ready to render.
      // If we are showing our custom AnimatedSplash, it will be rendered now.
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  if (!appIsReady) {
    return null;
  }

  // Se l'app è pronta ma l'animazione non è finita, mostriamo l'animazione
  if (!splashAnimationFinished) {
    return (
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <AnimatedSplash
          onAnimationFinish={() => {
            setSplashAnimationFinished(true);
          }}
        />
      </View>
    );
  }

  return (
    <HelmetProvider>
      <OtaProvider>
        <NavigationProvider>
          <AuthProvider>
            {/* ⭐ Voice Settings Provider */}
            <VoiceSettingsProvider>
              {/* ⭐ 1) Theme globale AiRide */}
              <ThemeProvider>
                {/* ⭐ AiRescue Provider */}
                <AiRescueProvider>
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
                </AiRescueProvider>
              </ThemeProvider>
            </VoiceSettingsProvider>
          </AuthProvider>
        </NavigationProvider>
      </OtaProvider>
    </HelmetProvider>
  );
}
