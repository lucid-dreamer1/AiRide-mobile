// rides.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Alert,
} from "react-native";

import MapView, { Polyline } from "react-native-maps";

import { firebaseFirestore } from "@/services/firebaseConfig";
import { useAuth } from "@/services/useAuth";
import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import Swipeable from "react-native-gesture-handler/Swipeable";

import { useTheme } from "@/contexts/ThemeContext";

export default function RidesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { themeColors } = useTheme(); // ⭐ TEMA AIRIDE

  const [rides, setRides] = useState<any[]>([]);
  const opacityRefs = useRef<{ [key: string]: Animated.Value }>({});

  // empty state anim
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (!user) return;

    const sub = firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .collection("rides")
      .orderBy("createdAt", "desc")
      .onSnapshot((snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRides(arr);

        arr.forEach((r) => {
          if (!opacityRefs.current[r.id]) {
            opacityRefs.current[r.id] = new Animated.Value(1);
          }
        });

        if (arr.length === 0) {
          fadeAnim.setValue(0);
          slideAnim.setValue(20);
          Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]).start();
        }
      });

    return sub;
  }, [user]);

  // DELETE FLOW
  const confirmDelete = (id: string, destination: string) => {
    Alert.alert(
      "Elimina tratta",
      `Vuoi eliminare la rotta per "${destination}"?`,
      [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: "destructive", onPress: () => animateDelete(id) },
      ]
    );
  };

  const animateDelete = (id: string) => {
    Animated.timing(opacityRefs.current[id], {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => deleteRide(id));
  };

  const deleteRide = async (id: string) => {
    if (!user) return;

    try {
      await firebaseFirestore
        .collection("users")
        .doc(user.uid)
        .collection("rides")
        .doc(id)
        .delete();
    } catch (err) {
      console.log("Errore eliminazione:", err);
    }
  };

  const renderRightActions = (ride: any) => (
    <TouchableOpacity
      style={[styles.swipeDelete, { backgroundColor: themeColors.accent }]}
      onPress={() => confirmDelete(ride.id, ride.destination)}
    >
      <Feather name="trash" size={26} color="white" />
    </TouchableOpacity>
  );

  const styles = createStyles(themeColors);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Rides</Text>

      {/* EMPTY STATE */}
      {rides.length === 0 && (
        <Animated.View
          style={[
            styles.emptyState,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <Feather name="map" size={64} color={themeColors.textMuted} />

          <Text style={styles.emptyTitle}>Nessuna rotta salvata</Text>

          <Text style={styles.emptySubtitle}>
            Quando completi un percorso potrai rivederlo qui ✨
          </Text>

          <TouchableOpacity style={styles.emptyButton} onPress={() => router.push("/")}>
            <Text style={styles.emptyButtonText}>Inizia un percorso</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* LISTA ROTTE */}
      {rides.map((ride) => {
        const safePolyline =
          ride.polyline?.map((p: any) => ({
            latitude: p.lat ?? p.latitude,
            longitude: p.lon ?? p.longitude,
          })) ?? [];

        return (
          <Swipeable key={ride.id} renderRightActions={() => renderRightActions(ride)}>
            <Animated.View style={{ opacity: opacityRefs.current[ride.id] }}>
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Feather name="map-pin" size={20} color={themeColors.accent} />
                  <Text style={styles.dest}>{ride.destination}</Text>

                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => confirmDelete(ride.id, ride.destination)}
                  >
                    <Feather name="trash-2" size={20} color={themeColors.accent} />
                  </TouchableOpacity>
                </View>

                <View style={styles.mapWrapper}>
                  <MapView
                    style={styles.map}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    initialRegion={{
                      latitude: safePolyline[0]?.latitude ?? 0,
                      longitude: safePolyline[0]?.longitude ?? 0,
                      latitudeDelta: 0.02,
                      longitudeDelta: 0.02,
                    }}
                  >
                    <Polyline
                      coordinates={safePolyline}
                      strokeWidth={4}
                      strokeColor={themeColors.accent}
                    />
                  </MapView>
                </View>

                <View style={styles.infoRow}>
                  <Text style={styles.info}>{ride.distanceKm} km</Text>
                  <Text style={styles.info}>{ride.durationMin} min</Text>
                </View>

                <TouchableOpacity
                  style={styles.replayButton}
                  onPress={() =>
                    router.push({
                      pathname: "/",
                      params: { destination: ride.destination },
                    })
                  }
                >
                  <Feather name="rotate-cw" size={18} color="white" />
                  <Text style={styles.replayText}>Ripercorri</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </Swipeable>
        );
      })}
    </ScrollView>
  );
}

////////////////////////////////////////////////////////////
// ⭐ THEMED STYLES
////////////////////////////////////////////////////////////
const createStyles = (c: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: 16,
      backgroundColor: c.bg,
    },

    title: {
      fontSize: 32,
      fontWeight: "700",
      marginBottom: 10,
      color: c.text,
    },

    /* EMPTY */
    emptyState: {
      marginTop: 60,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    emptyTitle: { fontSize: 22, fontWeight: "700", marginTop: 12, color: c.text },
    emptySubtitle: {
      fontSize: 15,
      textAlign: "center",
      marginTop: 6,
      lineHeight: 20,
      color: c.textMuted,
    },

    emptyButton: {
      marginTop: 25,
      backgroundColor: c.accent,
      paddingVertical: 12,
      paddingHorizontal: 24,
      borderRadius: 14,
    },
    emptyButtonText: { color: "white", fontSize: 16, fontWeight: "600" },

    /* CARD */
    card: {
      backgroundColor: c.card,
      borderRadius: 22,
      padding: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: c.border,
    },

    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },

    dest: { fontSize: 18, fontWeight: "600", color: c.text },

    deleteBtn: { marginLeft: "auto", padding: 6 },

    mapWrapper: {
      height: 160,
      borderRadius: 18,
      overflow: "hidden",
      marginVertical: 10,
    },

    map: { flex: 1 },

    infoRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginVertical: 8,
    },
    info: { fontSize: 14, color: c.textMuted },

    replayButton: {
      backgroundColor: c.accent,
      paddingVertical: 12,
      borderRadius: 14,
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 8,
      marginTop: 6,
    },
    replayText: { color: "white", fontSize: 15, fontWeight: "600" },

    swipeDelete: {
      width: 80,
      justifyContent: "center",
      alignItems: "center",
      borderRadius: 20,
      marginVertical: 10,
    },
  });
