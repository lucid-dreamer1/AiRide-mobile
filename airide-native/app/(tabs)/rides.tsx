// rides.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  // ScrollView, // <-- REMOVED
  FlatList, // <-- ADDED
  TouchableOpacity,
  Animated,
  Alert,
} from "react-native";

import MapView, { Polyline, PROVIDER_GOOGLE } from "react-native-maps"; // Added PROVIDER_GOOGLE just in case

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

  const renderItem = ({ item }: { item: any }) => {
    const safePolyline =
      item.polyline?.map((p: any) => ({
        latitude: p.lat ?? p.latitude,
        longitude: p.lon ?? p.longitude,
      })) ?? [];

    if (!opacityRefs.current[item.id]) {
        opacityRefs.current[item.id] = new Animated.Value(1);
    }

    return (
      <Swipeable key={item.id} renderRightActions={() => renderRightActions(item)}>
        <Animated.View style={{ opacity: opacityRefs.current[item.id] }}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Feather name="map-pin" size={20} color={themeColors.accent} />
              <Text style={styles.dest}>{item.destination}</Text>

              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => confirmDelete(item.id, item.destination)}
              >
                <Feather name="trash-2" size={20} color={themeColors.accent} />
              </TouchableOpacity>
            </View>

            <View style={styles.mapWrapper}>
              <MapView
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                liteMode={true} // <--- CRITICAL FIX FOR OOM
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
              <View style={styles.infoPill}>
                 <Feather name="map" size={14} color={themeColors.textMuted} />
                 <Text style={styles.info}>{item.distanceKm} km</Text>
              </View>
              <View style={styles.infoPill}>
                 <Feather name="clock" size={14} color={themeColors.textMuted} />
                 <Text style={styles.info}>{item.durationMin} min</Text>
              </View>
            </View>

            {/* Ride Analytics Grid */}
            <View style={styles.statsGrid}>
               <View style={styles.statBox}>
                  <Text style={styles.statLabel}>V. Max</Text>
                  <Text style={styles.statVal}>{item.maxSpeedKmh ?? 0} <Text style={{fontSize:11, color:themeColors.textMuted}}>km/h</Text></Text>
               </View>
               <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Media</Text>
                  <Text style={styles.statVal}>{item.avgSpeedKmh ?? 0} <Text style={{fontSize:11, color:themeColors.textMuted}}>km/h</Text></Text>
               </View>
               <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Piega Sx</Text>
                  <Text style={[styles.statVal, {color: '#4A90E2'}]}>{item.maxLeftRoll ?? 0}°</Text>
               </View>
               <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Piega Dx</Text>
                  <Text style={[styles.statVal, {color: '#E85A2A'}]}>{item.maxRightRoll ?? 0}°</Text>
               </View>
            </View>

            <TouchableOpacity
              style={styles.replayButton}
              onPress={() =>
                router.push({
                  pathname: "/",
                  params: { destination: item.destination },
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
  };

  return (
    <View style={styles.container}>
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

      {/* LISTA ROTTE (FlatList per performance) */}
      <FlatList 
        data={rides}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true} // Unmount offscreen views
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
      />
    </View>
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
    infoPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    info: { fontSize: 14, color: c.textMuted },

    statsGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: 'rgba(0,0,0,0.2)',
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 8,
      marginTop: 2,
      marginBottom: 6,
    },
    statBox: {
      alignItems: 'center',
      flex: 1,
    },
    statLabel: {
      fontSize: 10,
      color: c.textMuted,
      marginBottom: 4,
      textTransform: "uppercase",
      fontWeight: '700'
    },
    statVal: {
      fontSize: 16,
      fontWeight: '800',
      color: c.text,
    },

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
