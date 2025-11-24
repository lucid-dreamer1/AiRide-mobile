import React, { useEffect, useRef, memo } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import DistanceCounter from "./DistanceCounter";

export interface Instruction {
  testo?: string;
  text?: string;
  freccia?: number;
  metri?: number;
  next?: Instruction;
}

function InstructionCard({ instruction }: { instruction: Instruction | null }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  // 🔥 ANIMAZIONE SOLO SE CAMBIA L'ISTRUZIONE, NON I METRI
  useEffect(() => {
    if (!instruction) return;

    fadeAnim.setValue(0);
    translateY.setValue(20);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    instruction?.testo,
    instruction?.text,
    instruction?.freccia,
    instruction?.next?.testo,
    instruction?.next?.text,
    // ❌ metri esclusi per evitare fade continuo
  ]);

  if (!instruction) return null;

  const displayedText = instruction.testo || instruction.text || "Istruzione...";
  const dist = instruction.metri ?? 0;
  const isNear = dist < 100;
  const next = instruction.next;

  const getIcon = () => {
    switch (instruction.freccia) {
      case 0:
        return <Feather name="arrow-right" size={26} color="#E85A2A" />;
      case 1:
        return <Feather name="arrow-left" size={26} color="#E85A2A" />;
      case 2:
        return <Feather name="arrow-up" size={26} color="#E85A2A" />;
      case 3:
        return <Feather name="corner-up-left" size={26} color="#E85A2A" />;
      default:
        return <Feather name="navigation" size={26} color="#E85A2A" />;
    }
  };

  return (
    <Animated.View
      style={[
        styles.card,
        isNear && styles.cardNear,
        {
          opacity: fadeAnim,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.icon}>{getIcon()}</View>

      <View style={styles.content}>
        <Text style={[styles.title, isNear && styles.nearText]}>
          {displayedText}
        </Text>

        {/* 👉 i metri NON triggerano fading */}
        <DistanceCounter distance={dist} isNear={isNear} />

        {next && (
          <View style={styles.nextContainer}>
            <Text style={styles.nextLabel}>Prossima:</Text>
            <Text style={styles.nextText}>
              {(next.testo || next.text || "").slice(0, 60)}
              {((next.testo || next.text || "").length ?? 0) > 60 ? "..." : ""}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// 🔥 BLOCCA i rerender se cambiano solo i metri
export default memo(InstructionCard, (prev, next) => {
  // ⚡ Se cambiano testo, freccia o la prossima istruzione → RE-RENDER COMPLETO (con animazione)
  const coreChanged =
    prev.instruction?.testo !== next.instruction?.testo ||
    prev.instruction?.text !== next.instruction?.text ||
    prev.instruction?.freccia !== next.instruction?.freccia ||
    prev.instruction?.next?.testo !== next.instruction?.next?.testo ||
    prev.instruction?.next?.text !== next.instruction?.next?.text;

  if (coreChanged) return false;

  // ⚡ Se cambiano SOLO i metri → permettiamo il rerender, ma NON l'animazione
  return prev.instruction?.metri === next.instruction?.metri;
});


const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: "white",
    padding: 18,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    elevation: 4,
  },
  cardNear: {
    borderWidth: 2,
    borderColor: "#E85A2A",
  },
  icon: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  content: { flex: 1 },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: "#222",
  },
  nearText: {
    color: "#E85A2A",
    fontWeight: "700",
  },

  nextContainer: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  nextLabel: {
    fontSize: 11,
    color: "#888",
    marginBottom: 2,
  },
  nextText: {
    fontSize: 13,
    color: "#444",
  },
});
