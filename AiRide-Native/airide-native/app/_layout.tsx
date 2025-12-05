// app/_layout.tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { AuthProvider } from "../services/AuthContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { NavigationProvider } from "../navigation/NavigationContext";
import { HelmetProvider } from "@/contexts/HelmetContext";
import Toast from "react-native-toast-message";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <HelmetProvider>
      <NavigationProvider>
        <AuthProvider>
          <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
            <>
              <Stack>
                <Stack.Screen name="login" options={{ headerShown: false }} />
                <Stack.Screen name="register" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="modal" options={{ presentation: "modal" }} />
              </Stack>

              <StatusBar style="auto" />

              {/* 🔥 NECESSARIO: componente che mostra i toast */}
              <Toast />
            </>
          </ThemeProvider>
        </AuthProvider>
      </NavigationProvider>
    </HelmetProvider>
  );
}
