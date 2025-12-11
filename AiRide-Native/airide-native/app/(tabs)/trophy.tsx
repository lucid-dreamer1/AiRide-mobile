import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  ScrollView,
  TouchableOpacity,
} from "react-native";

import { firebaseFirestore } from "@/services/firebaseConfig";
import firestore from "@react-native-firebase/firestore";
import { useAuth } from "@/services/useAuth";
import Feather from "@expo/vector-icons/Feather";

import { LEVELS, REWARDS } from "@/constants/achievements";
import { getLevelData, getProgress } from "@/utils/levelUtils";

// 👉 THEME AI-RIDE
import { useTheme } from "@/contexts/ThemeContext";

export default function TrophyScreen() {
  const { themeColors } = useTheme(); // <── USA IL TEMA
  const { user } = useAuth();

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
        Animated.spring(badgeAnims[i], {
          toValue: 1,
          friction: 5,
          useNativeDriver: true,
        }).start();
      }

      if (unlocked && !previousUnlockedRef.current[i]) {
        setJustLeveledUp(lvl.title);
        triggerPopup();
        triggerGlow();
        grantReward(lvl.reward);
      }

      previousUnlockedRef.current[i] = unlocked;
    });
  }, [totalKm]);

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
    shadowColor: themeColors.accent,
    shadowOpacity: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.8],
    }),
    shadowRadius: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 20],
    }),
    shadowOffset: { width: 0, height: 0 },
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
      {justLeveledUp && (
        <Animated.View
          style={[
            styles.popup,
            {
              borderColor: themeColors.accent,
              opacity: popupAnim,
              transform: [
                {
                  scale: popupAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.7, 1],
                  }),
                },
              ],
              backgroundColor: themeColors.card,
            },
          ]}
        >
          <Feather name="award" size={42} color={themeColors.accent} />
          <Text style={[styles.popupTitle, { color: themeColors.text }]}>
            LEVEL UP!
          </Text>
          <Text style={[styles.popupSubtitle, { color: themeColors.accent }]}>
            {justLeveledUp}
          </Text>
        </Animated.View>
      )}

      <ScrollView style={{ padding: 16 }}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Trophy Room
        </Text>
        {/* DEV TOOLS */}{" "}
        <TouchableOpacity
          onLongPress={async () => {
            const addKm = 20;
            await firebaseFirestore
              .collection("users")
              .doc(user.uid)
              .update({ totalKm: firestore.FieldValue.increment(addKm) });
          }}
        >
          {" "}
          <Text style={{ color: "gray", fontSize: 11, marginBottom: 4 }}>
            {" "}
            (Long press per +20 km di test){" "}
          </Text>{" "}
        </TouchableOpacity>
        <TouchableOpacity
          onLongPress={async () => {
            await firebaseFirestore.collection("users").doc(user.uid).update({
              totalKm: 0,
            });

            console.log("KM AZZERATI");
          }}
        >
          <Text style={{ color: "red", fontSize: 11, marginBottom: 20 }}>
            (Long press per AZZERARE i km)
          </Text>
        </TouchableOpacity>
        {/* LEVEL CARD */}
        <Animated.View
          style={[
            styles.levelCard,
            glowStyle,
            { backgroundColor: themeColors.card },
          ]}
        >
          <Feather name="award" size={42} color={themeColors.accent} />

          <Text style={[styles.levelTitle, { color: themeColors.text }]}>
            {current.title}
          </Text>

          <Text style={[styles.kmText, { color: themeColors.textMuted }]}>
            {totalKm.toFixed(1)} km totali
          </Text>

          <View
            style={[
              styles.progressBar,
              { backgroundColor: themeColors.border },
            ]}
          >
            <Animated.View
              style={[
                styles.progressFill,
                { backgroundColor: themeColors.accent },
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0%", "100%"],
                  }),
                },
              ]}
            />
          </View>

          <Text style={[styles.nextText, { color: themeColors.textMuted }]}>
            {next
              ? `${Math.round(progress * 100)}% verso "${next.title}"`
              : "🎉 Hai raggiunto tutti i trofei!"}
          </Text>
        </Animated.View>
        {/* TROPHY GRID */}
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
          I tuoi trofei
        </Text>
        <View style={styles.grid}>
          {LEVELS.map((lvl, i) => {
            const unlocked = totalKm >= lvl.km;

            return (
              <Animated.View
                key={i}
                style={[
                  styles.badgeItem,
                  {
                    backgroundColor: themeColors.card,
                    opacity: unlocked ? 1 : 0.4,
                    transform: [
                      {
                        scale: badgeAnims[i].interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.9, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View
                  style={[
                    styles.badgeIcon,
                    {
                      backgroundColor: unlocked
                        ? themeColors.accent
                        : themeColors.border,
                    },
                  ]}
                >
                  <Feather
                    name={unlocked ? "check" : "lock"}
                    size={26}
                    color="white"
                  />
                </View>

                <Text style={[styles.badgeTitle, { color: themeColors.text }]}>
                  {lvl.title}
                </Text>
                <Text
                  style={[
                    styles.badgeSubtitle,
                    { color: themeColors.textMuted },
                  ]}
                >
                  {lvl.km} km
                </Text>
              </Animated.View>
            );
          })}
        </View>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
          Ricompense sbloccate
        </Text>
        {unlockedRewards.length === 0 && (
          <Text
            style={{
              color: themeColors.textMuted,
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            Completa tratte e sali di livello per sbloccare ricompense.
          </Text>
        )}
        {unlockedRewards.map((key) => {
          const data = REWARDS[key];
          if (!data) return null;

          return (
            <View key={key} style={styles.rewardItem}>
              <View
                style={[styles.rewardIcon, { borderColor: themeColors.accent }]}
              >
                <Feather name="star" size={20} color={themeColors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rewardTitle, { color: themeColors.text }]}>
                  {data.label}
                </Text>
                <Text
                  style={[styles.rewardDesc, { color: themeColors.textMuted }]}
                >
                  {data.description}
                </Text>
              </View>
            </View>
          );
        })}
        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

/* STYLES */
const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "700", marginBottom: 20 },

  levelCard: {
    padding: 20,
    borderRadius: 22,
    alignItems: "center",
    marginBottom: 30,
  },

  levelTitle: { fontSize: 24, fontWeight: "700", marginTop: 10 },
  kmText: { fontSize: 16, marginTop: 4 },

  progressBar: {
    height: 12,
    width: "100%",
    borderRadius: 10,
    marginTop: 12,
    overflow: "hidden",
  },

  progressFill: { height: "100%", borderRadius: 10 },

  nextText: { marginTop: 10, fontSize: 15, fontStyle: "italic" },

  sectionTitle: { fontSize: 22, fontWeight: "700", marginBottom: 14 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  badgeItem: {
    width: "48%",
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 16,
  },

  badgeIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },

  badgeTitle: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  badgeSubtitle: { fontSize: 14, marginTop: 2, textAlign: "center" },

  popup: {
    position: "absolute",
    top: "32%",
    left: 40,
    right: 40,
    paddingVertical: 20,
    borderRadius: 20,
    alignItems: "center",
    elevation: 20,
  },

  popupTitle: { fontSize: 22, fontWeight: "800", marginTop: 10 },
  popupSubtitle: { fontSize: 18, fontWeight: "600", marginTop: 4 },

  rewardItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 10,
  },

  rewardIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  rewardTitle: { fontSize: 16, fontWeight: "600" },
  rewardDesc: { fontSize: 13, marginTop: 2 },
});
