// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import React from "react";
import { Alert } from "react-native";
import Feather from "@expo/vector-icons/Feather";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useTheme } from "@/contexts/ThemeContext";
import { HelmetProvider } from "@/contexts/HelmetContext";

import auth from "@react-native-firebase/auth";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function TabLayout() {
  // ⛔ NON usare { colors }
  // ✅ Usa themeColors
  const { themeColors } = useTheme();

  const confirmLogout = () => {
    Alert.alert(
      "Logout",
      "Vuoi davvero disconnetterti?",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: async () => {
            try {
              await auth().signOut();
            } catch (err) {
              console.log("Logout error:", err);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HelmetProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: themeColors.accent,
            tabBarStyle: {
              backgroundColor: themeColors.card,
              borderTopColor: themeColors.border,
            },
            tabBarButton: HapticTab,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Home",
              tabBarIcon: ({ color }) => (
                <IconSymbol size={28} name="house.fill" color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="rides"
            options={{
              title: "Rides",
              tabBarIcon: ({ color }) => (
                <Feather name="map" size={26} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="trophy"
            options={{
              title: "Trophy",
              tabBarIcon: ({ color }) => (
                <Feather name="award" size={26} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="settings"
            options={{
              title: "Settings",
              tabBarIcon: ({ color }) => (
                <Feather name="settings" size={26} color={color} />
              ),
            }}
          />

          <Tabs.Screen
            name="logout"
            options={{
              tabBarLabel: "Logout",
              tabBarIcon: ({ color }) => (
                <Feather name="log-out" size={26} color={color} />
              ),
            }}
          />
        </Tabs>
      </HelmetProvider>
    </GestureHandlerRootView>
  );
}
