// AiRide-Native/airide-native/app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import React from "react";
import { Alert, TouchableOpacity, Text } from "react-native";
import Feather from "@expo/vector-icons/Feather";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { HelmetProvider } from "@/contexts/HelmetContext";

import auth from "@react-native-firebase/auth";

export default function TabLayout() {
  const colorScheme = useColorScheme();

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
    <HelmetProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}
      >
        {/* HOME */}
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={28} name="house.fill" color={color} />
            ),
          }}
        />
        {/* RIDES */}
        <Tabs.Screen
          name="rides"
          options={{
            title: "Rides",
            tabBarIcon: ({ color }) => (
              <Feather name="map" size={26} color={color} />
            ),
          }}
        />

        {/* SLOT VUOTO CHE OCCUPA UNA POSIZIONE NELLA TAB BAR */}
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
  );
}
