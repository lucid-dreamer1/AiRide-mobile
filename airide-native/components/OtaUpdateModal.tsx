// ------------------------------------------------------------
// OtaUpdateModal.tsx
// Modal fullscreen per l'aggiornamento firmware OTA del casco.
// Design: glassmorphism scuro, animazioni fluide, stato real-time.
// ------------------------------------------------------------

import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  ScrollView,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useOta, OtaState } from "../contexts/OtaContext";
import { useHelmet } from "../contexts/HelmetContext";
import { useTheme } from "@/contexts/ThemeContext";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function stateLabel(state: OtaState): string {
  switch (state) {
    case "IDLE":       return "Pronto";
    case "PREPARING":  return "Lettura file...";
    case "UPLOADING":  return "Trasferimento in corso...";
    case "VERIFYING":  return "Verifica firmware...";
    case "SUCCESS":    return "Aggiornamento completato! 🎉";
    case "ERROR":      return "Errore";
    case "ABORTED":    return "Annullato";
  }
}

function stateColor(state: OtaState, accent: string): string {
  switch (state) {
    case "SUCCESS":  return "#1DB954";
    case "ERROR":    return "#E74C3C";
    case "ABORTED":  return "#F39C12";
    case "UPLOADING":
    case "VERIFYING":
    case "PREPARING": return accent;
    default:         return "#888";
  }
}

// ────────────────────────────────────────────────────────────
// Progress Bar animata
// ────────────────────────────────────────────────────────────
function AnimatedProgressBar({ progress, color }: { progress: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: progress / 100,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const width = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, { width, backgroundColor: color }]} />
      <View style={styles.progressGlow} pointerEvents="none" />
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// Spinner (pulsing dot)
// ────────────────────────────────────────────────────────────
function PulsingDot({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[styles.pulsingDot, { backgroundColor: color, opacity: anim }]}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────
interface OtaUpdateModalProps {
  visible: boolean;
  onClose: () => void;
}

// ────────────────────────────────────────────────────────────
// Componente principale
// ────────────────────────────────────────────────────────────
export default function OtaUpdateModal({ visible, onClose }: OtaUpdateModalProps) {
  const { themeColors } = useTheme();
  const {
    otaState,
    progress,
    bytesSent,
    totalBytes,
    errorMessage,
    firmwareInfo,
    pickFirmwareFile,
    beginUpload,
    abortOta,
    resetOta,
  } = useOta();

  const { connected, setOtaInProgress } = useHelmet();

  // Sincronizza flag pausa navigazione con lo stato OTA
  useEffect(() => {
    const inProgress = otaState === "UPLOADING" || otaState === "VERIFYING" || otaState === "PREPARING";
    setOtaInProgress(inProgress);
  }, [otaState, setOtaInProgress]);

  // Slide-up animation
  const slideAnim = useRef(new Animated.Value(400)).current;
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : 400,
      damping: 20,
      stiffness: 180,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const accent = themeColors.accent ?? "#E85A2A";
  const currentColor = stateColor(otaState, accent);
  const isActive = otaState === "UPLOADING" || otaState === "VERIFYING" || otaState === "PREPARING";
  const isDone   = otaState === "SUCCESS" || otaState === "ERROR" || otaState === "ABORTED";

  const handleClose = () => {
    if (isActive) {
      abortOta();
    }
    resetOta();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {/* Backdrop */}
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: themeColors.card ?? "#1A1A2E", transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Feather name="upload-cloud" size={22} color={accent} />
              <Text style={[styles.headerTitle, { color: themeColors.text }]}>
                Aggiornamento Firmware
              </Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Feather name="x" size={20} color={themeColors.textMuted ?? "#888"} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>

            {/* Stato connessione */}
            <View style={[styles.connectionBadge, { borderColor: connected ? "#1DB954" : "#E74C3C" }]}>
              <View style={[styles.connectionDot, { backgroundColor: connected ? "#1DB954" : "#E74C3C" }]} />
              <Text style={[styles.connectionText, { color: themeColors.text }]}>
                {connected ? "Casco connesso" : "Casco non connesso — connettiti prima"}
              </Text>
            </View>

            {/* Card file info */}
            {firmwareInfo ? (
              <View style={[styles.fileCard, { backgroundColor: themeColors.bg ?? "#111" }]}>
                <Feather name="file" size={28} color={accent} style={{ marginBottom: 8 }} />
                <Text style={[styles.fileName, { color: themeColors.text }]} numberOfLines={1}>
                  {firmwareInfo.name}
                </Text>
                <View style={styles.fileMetaRow}>
                  <View style={styles.fileMeta}>
                    <Text style={styles.fileMetaLabel}>Dimensione</Text>
                    <Text style={[styles.fileMetaValue, { color: themeColors.text }]}>
                      {formatBytes(firmwareInfo.sizeBytes)}
                    </Text>
                  </View>
                  <View style={styles.fileMeta}>
                    <Text style={styles.fileMetaLabel}>CRC32</Text>
                    <Text style={[styles.fileMetaValue, { color: themeColors.text }]}>
                      {firmwareInfo.crc32}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              /* Placeholder selezione file */
              <TouchableOpacity
                style={[styles.fileDropzone, { borderColor: accent + "66" }]}
                onPress={pickFirmwareFile}
                disabled={isActive || !connected}
                activeOpacity={0.7}
              >
                <Feather name="upload" size={32} color={accent} style={{ marginBottom: 10 }} />
                <Text style={[styles.dropzoneText, { color: themeColors.text }]}>
                  Seleziona file .bin
                </Text>
                <Text style={[styles.dropzoneSubtext, { color: themeColors.textMuted }]}>
                  Tocca per aprire il file manager
                </Text>
              </TouchableOpacity>
            )}

            {/* Sezione progresso */}
            {(isActive || isDone) && (
              <View style={styles.progressSection}>
                {/* Stato label */}
                <View style={styles.stateRow}>
                  {isActive && <PulsingDot color={currentColor} />}
                  {otaState === "SUCCESS" && <Feather name="check-circle" size={16} color="#1DB954" />}
                  {otaState === "ERROR"   && <Feather name="alert-circle" size={16} color="#E74C3C" />}
                  {otaState === "ABORTED" && <Feather name="slash" size={16} color="#F39C12" />}
                  <Text style={[styles.stateLabel, { color: currentColor }]}>
                    {stateLabel(otaState)}
                  </Text>
                </View>

                {/* Barra progresso */}
                <AnimatedProgressBar progress={progress} color={currentColor} />

                {/* Byte counter */}
                <View style={styles.byteRow}>
                  <Text style={[styles.byteText, { color: themeColors.textMuted }]}>
                    {formatBytes(bytesSent)} / {formatBytes(totalBytes)}
                  </Text>
                  <Text style={[styles.percentText, { color: currentColor }]}>
                    {progress}%
                  </Text>
                </View>

                {/* Messaggio di errore */}
                {errorMessage && (
                  <View style={styles.errorBox}>
                    <Feather name="alert-triangle" size={14} color="#E74C3C" />
                    <Text style={styles.errorText}>{errorMessage}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Nota tecnica */}
            <View style={[styles.noteBox, { backgroundColor: themeColors.bg ?? "#111" }]}>
              <Feather name="info" size={13} color={themeColors.textMuted ?? "#666"} />
              <Text style={[styles.noteText, { color: themeColors.textMuted }]}>
                Durante l'aggiornamento, l'invio delle istruzioni di navigazione viene sospeso automaticamente. Non spegnere il casco durante il processo.
              </Text>
            </View>

            {/* Bottoni azione */}
            <View style={styles.actions}>
              {!isActive && !isDone && firmwareInfo && (
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: accent }]}
                  onPress={beginUpload}
                  disabled={!connected}
                  activeOpacity={0.8}
                >
                  <Feather name="zap" size={18} color="white" />
                  <Text style={styles.primaryBtnText}>Avvia aggiornamento</Text>
                </TouchableOpacity>
              )}

              {!isActive && !isDone && (
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: accent + "66" }]}
                  onPress={pickFirmwareFile}
                  disabled={!connected}
                  activeOpacity={0.7}
                >
                  <Feather name="folder" size={16} color={accent} />
                  <Text style={[styles.secondaryBtnText, { color: accent }]}>
                    {firmwareInfo ? "Cambia file" : "Scegli file .bin"}
                  </Text>
                </TouchableOpacity>
              )}

              {isActive && (
                <TouchableOpacity
                  style={[styles.abortBtn]}
                  onPress={abortOta}
                  activeOpacity={0.8}
                >
                  <Feather name="stop-circle" size={18} color="white" />
                  <Text style={styles.primaryBtnText}>Annulla</Text>
                </TouchableOpacity>
              )}

              {isDone && (
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: accent + "66" }]}
                  onPress={resetOta}
                  activeOpacity={0.7}
                >
                  <Feather name="refresh-cw" size={16} color={accent} />
                  <Text style={[styles.secondaryBtnText, { color: accent }]}>
                    Nuovo aggiornamento
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────
// Stili
// ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    maxHeight: "90%",
    // Glassmorphism-like via elevation + borderWidth
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    elevation: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  closeBtn: {
    padding: 6,
  },
  body: {
    padding: 20,
    gap: 16,
    paddingBottom: Platform.OS === "android" ? 28 : 40,
  },
  connectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectionText: {
    fontSize: 13,
    fontWeight: "500",
  },
  fileDropzone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  dropzoneText: {
    fontSize: 16,
    fontWeight: "600",
  },
  dropzoneSubtext: {
    fontSize: 12,
  },
  fileCard: {
    borderRadius: 18,
    padding: 18,
    alignItems: "center",
  },
  fileName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 12,
  },
  fileMetaRow: {
    flexDirection: "row",
    gap: 24,
    justifyContent: "center",
  },
  fileMeta: {
    alignItems: "center",
    gap: 2,
  },
  fileMetaLabel: {
    fontSize: 10,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  fileMetaValue: {
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  progressSection: {
    gap: 10,
  },
  stateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stateLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    position: "relative",
  },
  progressFill: {
    height: "100%",
    borderRadius: 5,
  },
  progressGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 5,
  },
  byteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  byteText: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  percentText: {
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  errorBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: "rgba(231, 76, 60, 0.12)",
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: "#E74C3C",
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  noteBox: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 14,
    padding: 14,
    alignItems: "flex-start",
  },
  noteText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 15,
    borderRadius: 16,
    elevation: 4,
  },
  primaryBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 16,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },
  abortBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: "#C0392B",
    elevation: 4,
  },
});
