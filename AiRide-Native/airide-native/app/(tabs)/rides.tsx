// AiRide-Native/airide-native/app/(tabs)/rides.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import MapView, { Polyline } from "react-native-maps";
import { firebaseFirestore } from "@/services/firebaseConfig"; // ✅ FIX PATH
import { useAuth } from "@/services/useAuth";
import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";

export default function RidesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [rides, setRides] = useState<any[]>([]);

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
      });

    return sub;
  }, [user]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Rides</Text>

      {rides.length === 0 && (
        <Text style={{ color: "#777", marginTop: 20, fontSize: 16 }}>
          Nessuna tratta salvata 🚀
        </Text>
      )}

      {rides.map((ride) => {
        // ✅ Convertiamo la polyline in formato RN Maps
        const safePolyline =
          ride.polyline?.map((p: any) => ({
            latitude: p.lat ?? p.latitude,
            longitude: p.lon ?? p.longitude,
          })) ?? [];

        return (
          <View key={ride.id} style={styles.card}>
            {/* HEADER */}
            <View style={styles.cardHeader}>
              <Feather name="map-pin" size={20} color="#E85A2A" />
              <Text style={styles.dest}>{ride.destination}</Text>
            </View>

            {/* MINI MAPPA */}
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
                  strokeColor="#E85A2A"
                />
              </MapView>
            </View>

            {/* INFO */}
            <View style={styles.infoRow}>
              <Text style={styles.info}>{ride.distanceKm} km</Text>
              <Text style={styles.info}>{ride.durationMin} min</Text>
            </View>

            {/* BUTTON */}
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
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 10,
    color: "#222",
  },
  card: {
    backgroundColor: "white",
    borderRadius: 22,
    padding: 16,
    marginBottom: 20,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  dest: { fontSize: 18, fontWeight: "600", color: "#111" },

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
  info: { fontSize: 14, color: "#333" },

  replayButton: {
    backgroundColor: "#E85A2A",
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  replayText: { color: "white", fontSize: 15, fontWeight: "600" },
});
