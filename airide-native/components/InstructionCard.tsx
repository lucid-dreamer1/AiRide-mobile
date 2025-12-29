// InstructionCard.tsx — Material You B2 (Medium)
// Totalmente compatibile con AirRide + Demo Mode

import React, { useEffect, useRef, memo } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";

export interface Instruction {
  testo?: string;
  freccia?: number;
  metri?: number | null;
  fase?: "preview" | "prepare" | "near" | "turn" | "ready" | "complete";
  next?: Instruction | null;
}

function InstructionCard({ instruction }: { instruction: Instruction | null }) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.95)).current;

  // Animazione più elegante Material You
  useEffect(() => {
    if (!instruction) return;

    fade.setValue(0);
    scale.setValue(0.95);

    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    instruction?.testo,
    instruction?.freccia,
    instruction?.fase,
    instruction?.next?.testo,
  ]);

  if (!instruction) return null;

  const { testo, freccia, metri, fase, next } = instruction;

  // Icona Material You-style
  const getIcon = () => {
    const color =
      fase === "turn" ? "#D32F2F" : fase === "near" ? "#E85A2A" : "#555";

    switch (freccia) {
      case 0:
        return <Feather name="arrow-right" size={32} color={color} />;
      case 1:
        return <Feather name="arrow-left" size={32} color={color} />;
      case 2:
        return <Feather name="arrow-up" size={32} color={color} />;
      case 3:
        return <Feather name="corner-up-left" size={30} color={color} />;
      default:
        return <Feather name="navigation" size={30} color={color} />;
    }
  };

  const formattedMeters =
    metri === null || metri === undefined ? "" : `${metri} m`;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: fade,
          transform: [{ scale }],
        },
      ]}
    >
      {/* ICONA */}
      <View style={styles.iconWrapper}>{getIcon()}</View>

      {/* CONTENUTO */}
      <View style={styles.content}>

        {/* Testo principale */}
        <Text style={styles.title} numberOfLines={2}>
          {testo}
        </Text>

        {/* Distanza */}
        {metri !== null && (
          <Text style={[styles.distance, fase === "turn" && styles.distanceTurn]}>
            {formattedMeters}
          </Text>
        )}

        {/* Separator + Next */}
        {next && (
          <View style={styles.nextContainer}>
            <Text style={styles.nextLabel}>Prossima</Text>
            <Text style={styles.nextText} numberOfLines={1}>
              {next.testo}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

/* 🧠 Ottimizzazione: non rianimare quando cambiano solo i metri */
export default memo(InstructionCard, (prev, next) => {
  const importantChanged =
    prev.instruction?.testo !== next.instruction?.testo ||
    prev.instruction?.freccia !== next.instruction?.freccia ||
    prev.instruction?.fase !== next.instruction?.fase ||
    prev.instruction?.next?.testo !== next.instruction?.next?.testo;

  if (importantChanged) return false;

  return prev.instruction?.metri === next.instruction?.metri;
});

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: "#FFFFFFEE", // Material You translucent card
    borderRadius: 22,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },

  iconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 99,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
  },

  content: {
    flex: 1,
  },

  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111",
    lineHeight: 22,
    marginBottom: 6,
  },

  distance: {
    fontSize: 15,
    fontWeight: "600",
    color: "#444",
  },
  distanceTurn: {
    color: "#D32F2F",
  },

  nextContainer: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },

  nextLabel: {
    fontSize: 11,
    color: "#888",
    marginBottom: 2,
  },

  nextText: {
    fontSize: 14,
    color: "#555",
    fontWeight: "500",
  },
});
