// InstructionCard.tsx — AiRide HUD Bento Card (v2)
// Supporta 8 codici manovra, barra di avvicinamento svolta, preview prossima svolta e telemetria distanza

import React, { useEffect, useRef, memo } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";

export interface Instruction {
  testo?: string;
  freccia?: number;
  metri?: number | null;
  fase?: "preview" | "prepare" | "near" | "turn" | "ready" | "complete";
  next?: Instruction | null;
  total_dist?: number;
  remaining_dist?: number;
}

function getManeuverIconName(freccia?: number): keyof typeof Feather.glyphMap {
  switch (freccia) {
    case 0:
      return "arrow-right";
    case 1:
      return "arrow-left";
    case 2:
      return "arrow-up";
    case 3:
      return "corner-up-left";
    case 4:
      return "flag";
    case 5:
      return "arrow-up-right";
    case 6:
      return "arrow-up-left";
    case 7:
      return "rotate-ccw";
    default:
      return "navigation";
  }
}

function formatDistance(meters?: number | null): string {
  if (meters === null || meters === undefined) return "";
  const m = Math.max(0, Math.round(meters));
  if (m >= 1000) {
    return `${(m / 1000).toFixed(1)} km`;
  }
  return `${m} m`;
}

function InstructionCard({ instruction }: { instruction: Instruction | null }) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.95)).current;

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

  const { testo, freccia, metri, fase, next, total_dist, remaining_dist } = instruction;

  const accentColor =
    fase === "turn"
      ? "#FF3B30"
      : fase === "near"
      ? "#E85A2A"
      : fase === "complete"
      ? "#10B981"
      : "#38BDF8";

  const phaseLabel =
    fase === "turn"
      ? "SVOLTA ORA"
      : fase === "near"
      ? "IMMINENTE"
      : fase === "prepare"
      ? "PREPARATI"
      : fase === "complete"
      ? "ARRIVO"
      : "PROSSIMA MANOVRA";

  const formattedMeters = formatDistance(metri);

  // Calcola percentuale di avvicinamento negli ultimi 300 metri
  const showApproachBar = typeof metri === "number" && metri > 0 && metri <= 300;
  const approachPct = showApproachBar
    ? Math.min(100, Math.max(8, Math.round(((300 - metri!) / 300) * 100)))
    : 0;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          borderColor: accentColor + "66",
          opacity: fade,
          transform: [{ scale }],
        },
      ]}
    >
      {/* ICONA PRINCIPALE HUD */}
      <View
        style={[
          styles.iconWrapper,
          {
            backgroundColor: accentColor + "22",
            borderColor: accentColor + "55",
          },
        ]}
      >
        <Feather name={getManeuverIconName(freccia)} size={32} color={accentColor} />
      </View>

      {/* CONTENUTO */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={[styles.phaseBadge, { backgroundColor: accentColor + "26" }]}>
            <Text style={[styles.phaseText, { color: accentColor }]}>{phaseLabel}</Text>
          </View>

          {formattedMeters !== "" && (
            <Text style={[styles.distance, { color: accentColor }]}>
              {formattedMeters}
            </Text>
          )}
        </View>

        {/* Testo principale */}
        <Text style={styles.title} numberOfLines={2}>
          {testo}
        </Text>

        {/* Barra progressiva di avvicinamento alla svolta (< 300m) */}
        {showApproachBar && (
          <View style={styles.approachTrack}>
            <View
              style={[
                styles.approachFill,
                { width: `${approachPct}%`, backgroundColor: accentColor },
              ]}
            />
          </View>
        )}

        {/* Prossima manovra + Telemetria */}
        {(next || (typeof remaining_dist === "number" && remaining_dist > 0)) && (
          <View style={styles.footerRow}>
            {next ? (
              <View style={styles.nextContainer}>
                <View style={styles.nextIconBadge}>
                  <Feather
                    name={getManeuverIconName(next.freccia)}
                    size={13}
                    color="#38BDF8"
                  />
                </View>
                <Text style={styles.nextLabel}>POI:</Text>
                <Text style={styles.nextText} numberOfLines={1}>
                  {next.testo}
                </Text>
              </View>
            ) : <View />}

            {typeof remaining_dist === "number" && remaining_dist > 0 && (
              <Text style={styles.remainingBadge}>
                Rim: {formatDistance(remaining_dist)}
                {typeof total_dist === "number" && total_dist > 0
                  ? ` / ${formatDistance(total_dist)}`
                  : ""}
              </Text>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

/* 🧠 Ottimizzazione: rianima solo su cambio manovra/fase, ma aggiorna i metri */
export default memo(InstructionCard, (prev, next) => {
  const importantChanged =
    prev.instruction?.testo !== next.instruction?.testo ||
    prev.instruction?.freccia !== next.instruction?.freccia ||
    prev.instruction?.fase !== next.instruction?.fase ||
    prev.instruction?.next?.testo !== next.instruction?.next?.testo;

  if (importantChanged) return false;

  return (
    prev.instruction?.metri === next.instruction?.metri &&
    prev.instruction?.remaining_dist === next.instruction?.remaining_dist
  );
});

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: 120,
    left: 16,
    right: 16,
    backgroundColor: "#11151EEE",
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },

  iconWrapper: {
    width: 58,
    height: 58,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  content: {
    flex: 1,
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },

  phaseBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },

  phaseText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },

  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#F8FAFC",
    lineHeight: 22,
  },

  distance: {
    fontSize: 20,
    fontWeight: "800",
  },

  approachTrack: {
    height: 5,
    backgroundColor: "#1E293B",
    borderRadius: 99,
    marginTop: 8,
    overflow: "hidden",
  },

  approachFill: {
    height: "100%",
    borderRadius: 99,
  },

  footerRow: {
    marginTop: 9,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopColor: "#1E293B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },

  nextContainer: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 5,
  },

  nextIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: "#38BDF81A",
    justifyContent: "center",
    alignItems: "center",
  },

  nextLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },

  nextText: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: "600",
    flex: 1,
  },

  remainingBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
});
