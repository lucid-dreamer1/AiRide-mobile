import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  DeviceEventEmitter,
} from "react-native";

import { firebaseFirestore } from "@/services/firebaseConfig";
import firestore from "@react-native-firebase/firestore";
import { useAuth } from "@/services/useAuth";
import Feather from "@expo/vector-icons/Feather";

import { LEVELS, REWARDS } from "@/constants/achievements";
import { getLevelData, getProgress } from "@/utils/levelUtils";
import { useTheme } from "@/contexts/ThemeContext";

const { width } = Dimensions.get("window");

export default function TrophyScreen() {
  const { themeColors } = useTheme();
  const { user } = useAuth();
  const styles = createStyles(themeColors);

  const [userData, setUserData] = useState<any>({
    totalKm: 0,
    unlockedRewards: [],
  });

  const progressAnim = useRef(new Animated.Value(0)).current;
  const badgeAnims = useRef(LEVELS.map(() => new Animated.Value(0))).current;
  const previousUnlockedRef = useRef(LEVELS.map(() => false));

  const popupAnim = useRef(new Animated.Value(0)).current;
  const [justLeveledUp, setJustLeveledUp] = useState<string | null>(null);

  const glowAnim = useRef(new Animated.Value(0)).current;

  // -------------------------------------------------------------
  // DATA SYNC
  // -------------------------------------------------------------
  useEffect(() => {
    if (!user) return;

    const unsub = firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .onSnapshot((doc) => {
        const data = doc.data() || { totalKm: 0, unlockedRewards: [] };
        setUserData({
          totalKm: data.totalKm ?? 0,
          unlockedRewards: data.unlockedRewards ?? [],
        });
      });

    return unsub;
  }, [user]);

  const totalKm = userData?.totalKm ?? 0;
  const unlockedRewards: string[] = userData?.unlockedRewards ?? [];

  const { current, next } = getLevelData(totalKm);
  const progress = getProgress(totalKm);

  // -------------------------------------------------------------
  // ANIMATIONS
  // -------------------------------------------------------------
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const grantReward = async (rewardKey?: string | null) => {
    if (!rewardKey || !user) return;

    await firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .update({
        unlockedRewards: firestore.FieldValue.arrayUnion(rewardKey),
      });
  };

  useEffect(() => {
    LEVELS.forEach((lvl, i) => {
      const unlocked = totalKm >= lvl.km;

      if (unlocked) {
        // Se è già sbloccato, porta l'animazione a 1 senza spring (o con spring veloce)
        // Ma solo se l'abbiamo già "visto" bloccato in precedenza facciamo scattare il popup
        Animated.spring(badgeAnims[i], {
          toValue: 1,
          friction: 5,
          useNativeDriver: true,
        }).start();
      }

      // 🔴 CHECK FONDAMENTALE:
      // Se ora è sbloccato (unlocked)
      // E prima era BLOCCATO (previousUnlockedRef.current trascurava il primo load)
      // ALLORA scatta il level up.
      //
      // Per evitare il popup al primo avvio, dobbiamo assicurarci che previousUnlockedRef
      // sia stato inizializzato correttamente.
      //
      // TRUCCO: Se previousUnlockedRef è tutto false (default), potrebbe essere il primo load.
      // Tuttavia, qui controlliamo se lo stato cambia da false -> true.
      //
      // Se l'utente apre l'app con 100km, 'unlocked' è true. 'previousUnlockedRef' è false.
      // Scatterebbe il popup.
      //
      // FIX -> Dobbiamo inizializzare previousUnlockedRef con lo stato attuale SOLO la prima volta,
      // OPPURE usare un flag 'isFirstLoad'.
    });
  }, [totalKm]);

  // FIX: Inizializza i ref la prima volta che abbiamo i dati, SENZA triggerare animazioni
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    if (userData.totalKm >= 0 && !dataLoaded) {
      // Prima volta che leggiamo i km: allineiamo i ref per non far scattare popup
      LEVELS.forEach((lvl, i) => {
        if (userData.totalKm >= lvl.km) {
          previousUnlockedRef.current[i] = true;
          // Porta badge a 1 subito senza spring visibile se vuoi, o lascia l'effetto
          badgeAnims[i].setValue(1);
        }
      });
      setDataLoaded(true);
    }
  }, [userData, dataLoaded]);

  // EFFETTO CHE SCATTA SOLO DOPO IL PRIMO LOAD
  useEffect(() => {
    if (!dataLoaded) return; // Non fare nulla finché non abbiamo inizializzato

    LEVELS.forEach((lvl, i) => {
      const unlocked = totalKm >= lvl.km;
      const wasUnlocked = previousUnlockedRef.current[i];

      // Se sbloccato ora
      if (unlocked) {
        Animated.spring(badgeAnims[i], {
          toValue: 1,
          friction: 5,
          useNativeDriver: true,
        }).start();
      }

      // SE è diventato sbloccato ORA (e prima non lo era)
      if (unlocked && !wasUnlocked) {
        setJustLeveledUp(lvl.title);
        triggerPopup();
        triggerGlow();
        grantReward(lvl.reward);
      }

      // Aggiorna ref
      previousUnlockedRef.current[i] = unlocked;
    });
  }, [totalKm, dataLoaded]);

  const triggerPopup = () => {
    popupAnim.setValue(0);
    Animated.spring(popupAnim, {
      toValue: 1,
      friction: 5,
      useNativeDriver: true,
    }).start(() => {
      setTimeout(() => {
        Animated.timing(popupAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setJustLeveledUp(null));
      }, 2500);
    });
  };

  const triggerGlow = () => {
    glowAnim.setValue(0);
    Animated.timing(glowAnim, {
      toValue: 1,
      duration: 900,
      useNativeDriver: false,
    }).start(() => {
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 900,
        useNativeDriver: false,
      }).start();
    });
  };

  const glowStyle = {
    elevation: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [5, 20],
    }),
    shadowColor: themeColors.accent,
    shadowOpacity: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.8],
    }),
    shadowRadius: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [5, 20],
    }),
  };

  // -------------------------------------------------------------
  // DEV TEST (Hidden logic)
  // -------------------------------------------------------------
  const handleTestKm = async () => {
    await firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .update({ totalKm: firestore.FieldValue.increment(20) });
  };
  const handleResetKm = async () => {
    await firebaseFirestore.collection("users").doc(user.uid).update({
      totalKm: 0,
    });
  };
  const handleTestRiskSong = () => {
    DeviceEventEmitter.emit('TriggerDemoOvertake');
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <View style={styles.container}>
      {/* POPUP LEVEL UP */}
      {justLeveledUp && (
        <Animated.View style={[styles.popup, { opacity: popupAnim }]}>
          <Feather name="award" size={42} color={themeColors.accent} />
          <Text style={styles.popupTitle}>LEVEL UP!</Text>
          <Text style={styles.popupSubtitle}>{justLeveledUp}</Text>
        </Animated.View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sala Trofei</Text>
          <Feather name="shield" size={24} color={themeColors.textMuted} />
        </View>

        {/* LEVEL CARD CENTRALE */}
        <Animated.View style={[styles.levelCard, glowStyle]}>
          <Feather name="award" size={50} color="white" />

          <Text style={styles.levelRank}>{current.title}</Text>
          <Text style={styles.levelKm}>{totalKm.toFixed(1)} km percorsi</Text>

          <View style={styles.progressBarBg}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>

          <Text style={styles.levelNext}>
            {next
              ? `${Math.round(progress * 100)}% per "${next.title}"`
              : "Massimo livello raggiunto! 🏆"}
          </Text>
        </Animated.View>

        {/* TROPHY GRID */}
        <Text style={styles.sectionTitle}>Obiettivi di distanza</Text>
        <View style={styles.grid}>
          {LEVELS.map((lvl, i) => {
            const unlocked = totalKm >= lvl.km;
            return (
              <Animated.View
                key={i}
                style={[
                  styles.badgeItem,
                  {
                    transform: [
                      {
                        scale: badgeAnims[i].interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.95, 1],
                        }),
                      },
                    ],
                    opacity: unlocked ? 1 : 0.6,
                  },
                ]}
              >
                <View
                  style={[
                    styles.badgeIcon,
                    unlocked && styles.badgeIconUnlocked,
                  ]}
                >
                  <Feather
                    name={unlocked ? "check" : "lock"}
                    size={22}
                    color={unlocked ? "white" : themeColors.textMuted}
                  />
                </View>

                <Text
                  style={[
                    styles.badgeTitle,
                    unlocked && styles.badgeTitleUnlocked,
                  ]}
                >
                  {lvl.title}
                </Text>

                <Text style={styles.badgeSubtitle}>{lvl.km} km</Text>
              </Animated.View>
            );
          })}
        </View>

        {/* REWARDS SECTION */}
        <Text style={styles.sectionTitle}>Ricompense Sbloccate</Text>
        {unlockedRewards.length === 0 ? (
          <View style={styles.emptyRewards}>
            <Feather name="gift" size={30} color={themeColors.border} />
            <Text style={styles.emptyText}>
              Nessuna ricompensa sbloccata ancora.
            </Text>
          </View>
        ) : (
          <View style={styles.rewardsList}>
            {unlockedRewards.map((key) => {
              const data = REWARDS[key];
              if (!data) return null;
              return (
                <View key={key} style={styles.rewardCard}>
                  <View style={styles.rewardIconContainer}>
                    <Feather name="star" size={20} color={themeColors.accent} />
                  </View>
                  <View style={styles.rewardInfo}>
                    <Text style={styles.rewardName}>{data.label}</Text>
                    <Text style={styles.rewardDesc}>{data.description}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* DEV TOOLS SECTION */}
        <View style={styles.devSection}>
          <Text style={styles.devTitle}>🛠 Dev Config</Text>
          <View style={styles.devButtons}>
            <TouchableOpacity style={styles.devButton} onPress={handleTestKm}>
              <Feather name="plus-circle" size={16} color={themeColors.text} />
              <Text style={[styles.devButtonText, { color: themeColors.text }]}>
                +20 Km
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.devButton, { borderColor: "#EF4444" }]}
              onPress={handleResetKm}
            >
              <Feather name="trash-2" size={16} color="#EF4444" />
              <Text style={[styles.devButtonText, { color: "#EF4444" }]}>
                Reset
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.devButton} onPress={handleTestRiskSong}>
              <Feather name="music" size={16} color={themeColors.text} />
              <Text style={[styles.devButtonText, { color: themeColors.text }]}>
                Demo Sorpasso
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.versionText}>v1.0.0 (Build 42)</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 40,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 24,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: "800",
      color: colors.text,
      letterSpacing: -0.5,
    },

    // LEVEL CARD
    levelCard: {
      backgroundColor: colors.accent,
      padding: 24,
      borderRadius: 24,
      alignItems: "center",
      shadowColor: colors.accent,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
      marginBottom: 32,
    },
    levelRank: {
      fontSize: 26,
      fontWeight: "800",
      color: "white",
      marginTop: 12,
    },
    levelKm: {
      fontSize: 15,
      color: "rgba(255,255,255,0.8)",
      marginTop: 4,
      marginBottom: 16,
      fontWeight: "500",
    },
    progressBarBg: {
      width: "100%",
      height: 8,
      backgroundColor: "rgba(0,0,0,0.2)",
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: "white",
      borderRadius: 4,
    },
    levelNext: {
      marginTop: 12,
      color: "rgba(255,255,255,0.9)",
      fontSize: 13,
      fontWeight: "600",
    },

    // TITOLI SEZIONI
    sectionTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.text,
      marginBottom: 16,
      marginTop: 8,
    },

    // GRID
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      marginBottom: 24,
    },
    badgeItem: {
      width: (width - 40 - 14) / 2, // 40 = padding vert, 14 = gap
      backgroundColor: colors.card,
      padding: 16,
      borderRadius: 20,
      marginBottom: 14,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    badgeIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.bg,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 12,
    },
    badgeIconUnlocked: {
      backgroundColor: colors.accent,
    },
    badgeTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.textMuted,
      marginBottom: 2,
    },
    badgeTitleUnlocked: {
      color: colors.text,
    },
    badgeSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
    },

    // REWARDS
    rewardsList: {
      gap: 12,
    },
    rewardCard: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rewardIconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.accent + "20",
      marginRight: 14,
    },
    rewardInfo: {
      flex: 1,
    },
    rewardName: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    rewardDesc: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },

    // EMPTY STATE
    emptyRewards: {
      alignItems: "center",
      paddingVertical: 20,
      opacity: 0.6,
    },
    emptyText: {
      marginTop: 8,
      color: colors.textMuted,
      fontSize: 14,
    },

    // POPUP
    popup: {
      position: "absolute",
      zIndex: 100,
      top: "35%",
      left: 40,
      right: 40,
      backgroundColor: colors.card,
      padding: 30,
      borderRadius: 30,
      alignItems: "center",
      // Shadow
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.25,
      shadowRadius: 20,
      elevation: 20,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    popupTitle: {
      fontSize: 24,
      fontWeight: "900",
      color: colors.text,
      marginTop: 16,
      marginBottom: 4,
    },
    popupSubtitle: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.accent,
    },

    // FOOTER & DEV
    footer: {
      marginTop: 40,
      alignItems: "center",
      paddingBottom: 20,
    },
    versionText: {
      color: colors.textMuted,
      fontSize: 11,
      opacity: 0.5,
      marginTop: 20,
    },

    devSection: {
      marginTop: 40,
      alignItems: "center",
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: "dashed",
    },
    devTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textMuted,
      marginBottom: 10,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    devButtons: {
      flexDirection: "row",
      gap: 12,
    },
    devButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 6,
    },
    devButtonText: {
      fontSize: 13,
      fontWeight: "600",
    },
  });

