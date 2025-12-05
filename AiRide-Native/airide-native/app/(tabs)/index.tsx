// HomeScreen.tsx — Fullscreen + DemoPanel + Ripercorri Fixato

import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";

import { saveRide } from "@/services/saveRide";
import Toast from "react-native-toast-message";
import { useAuth } from "@/services/useAuth";
import InstructionCard from "@/components/InstructionCard";

import MapView, { Marker, Polyline } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";

import { getRoute, updatePosition, openInstructionStream } from "@/services/api";
import { useNavigationContext } from "@/navigation/NavigationContext";
import { useHelmet } from "@/contexts/HelmetContext";
import useNavigationUpdater from "@/hooks/useNavigationUpdater";

const DEMO_MODE = true;

type Point = { latitude: number; longitude: number };

const interpolate = (p1: Point, p2: Point, t: number): Point => ({
  latitude: p1.latitude + (p2.latitude - p1.latitude) * t,
  longitude: p1.longitude + (p2.longitude - p1.longitude) * t,
});

export default function HomeScreen() {
  const {
    routeCoords,
    setRouteCoords,
    currentPosition,
    setCurrentPosition,
    routeInfo,
    setRouteInfo,
    currentInstruction,
    setCurrentInstruction,
  } = useNavigationContext();

  const { connected, error } = useHelmet();
  const { user } = useAuth();
  const params = useLocalSearchParams();

  const [destination, setDestination] = useState("");
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [showInstructionCard, setShowInstructionCard] = useState(false);
  const [demoCanStart, setDemoCanStart] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState(3);
  const [showDemoPanel, setShowDemoPanel] = useState(false);

  const mapRef = useRef<MapView | null>(null);
  const streamRef = useRef<any>(null);

  // ⭐ FIX: evita doppio/triplo fetchRoute quando arrivi da RIPERCORRI
  const hasLoadedFromRides = useRef(false);

  const demoIndexRef = useRef(0);
  const demoTRef = useRef(0);
  const lastCameraUpdate = useRef(0);
  const lastGPSUpdate = useRef(0);

  // -------------------------------------------------------------
  // ⭐ RIPERCORRI: auto-carica destinazione in modo sicuro
  // -------------------------------------------------------------
  useEffect(() => {
    if (!params?.destination) return;

    if (hasLoadedFromRides.current) return; // 🔥 BLOCCA richiami multipli
    hasLoadedFromRides.current = true;

    const dest = String(params.destination);
    setDestination(dest);

    fetchRoute(dest);
  }, [params]);

  // -------------------------------------------------------------
  // GPS INIT
  // -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;

        const pos = await Location.getCurrentPositionAsync({});
        const p = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };

        setCurrentPosition(p);
        mapRef.current?.animateCamera({ center: p, zoom: 16 }, { duration: 500 });
      } catch (e) {}
    })();
  }, []);

  // -------------------------------------------------------------
  // GET ROUTE
  // -------------------------------------------------------------
  const fetchRoute = async (overrideDest?: string) => {
    try {
      setLoadingRoute(true);

      const dest = overrideDest ?? destination;

      const pos = await Location.getCurrentPositionAsync({});
      const start = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };

      setCurrentPosition(start);

      const data = await getRoute(start.latitude, start.longitude, dest);

      setRouteInfo({
        duration: data.duration,
        distance: data.distance,
      });

      const coords = data.coordinates.map((p: any) => ({
        latitude: p.lat,
        longitude: p.lon,
      }));

      setRouteCoords(coords);
      setDemoCanStart(false);

      setShowInstructionCard(true);
      setCurrentInstruction({
        testo: "Percorso pronto 🚀",
        freccia: 2,
        metri: null,
        next: null,
        fase: "ready",
      });
    } finally {
      setLoadingRoute(false);
    }
  };

  // -------------------------------------------------------------
  // DEMO MOVEMENT
  // -------------------------------------------------------------
  useEffect(() => {
    if (!DEMO_MODE || !demoCanStart) return;
    if (routeCoords.length < 2) return;

    const interval = setInterval(() => {
      const index = demoIndexRef.current;
      const t = demoTRef.current;

      const p1 = routeCoords[index];
      const p2 = routeCoords[index + 1];
      if (!p2) return;

      let newT = t + 0.05 * demoSpeed;
      let newIndex = index;

      if (newT >= 1) {
        newT = 0;
        newIndex++;
        if (newIndex >= routeCoords.length - 1) return;
      }

      const pos = interpolate(p1, p2, newT);
      setCurrentPosition(pos);

      const now = Date.now();

      if (now - lastGPSUpdate.current > 300) {
        lastGPSUpdate.current = now;
        updatePosition(pos.latitude, pos.longitude).catch(() => {});
      }

      if (now - lastCameraUpdate.current > 350) {
        lastCameraUpdate.current = now;
        mapRef.current?.animateCamera({ center: pos, zoom: 16 }, { duration: 180 });
      }

      demoIndexRef.current = newIndex;
      demoTRef.current = newT;
    }, 110);

    return () => clearInterval(interval);
  }, [routeCoords, demoSpeed, demoCanStart]);

  // -------------------------------------------------------------
  // INVIA AL CASCO + SALVA TRATTA
  // -------------------------------------------------------------
  const handleSend = async () => {
    if (!destination.trim()) return;
    if (!currentPosition) return;

    if (!routeCoords || routeCoords.length < 2) {
      Toast.show({ type: "error", text1: "Calcola prima il percorso" });
      return;
    }

    setDemoCanStart(true);

    try {
      await saveRide({
        destination,
        startCoords: {
          lat: currentPosition.latitude,
          lon: currentPosition.longitude,
        },
        polyline: routeCoords.map((p) => ({
          lat: p.latitude,
          lon: p.longitude,
        })),
        distanceKm: Number(String(routeInfo?.distance).replace(" km", "")),
        durationMin: Number(String(routeInfo?.duration).replace(" min", "")),
        createdAt: Date.now(),
      });

      Toast.show({
        type: "success",
        text1: "Tratta salvata!",
        text2: "La trovi nella sezione Rides.",
      });

      if (streamRef.current?.close) streamRef.current.close();

      streamRef.current = openInstructionStream(
        `${currentPosition.latitude},${currentPosition.longitude}`,
        destination,
        (msg: any) => {
          setCurrentInstruction({
            testo: msg?.testo,
            freccia: msg?.freccia,
            metri: msg?.metri,
            next: msg?.next,
            fase: msg?.fase,
          });
        }
      );
    } catch (err) {
      console.log("Errore salvataggio tratta:", err);
      Toast.show({
        type: "error",
        text1: "Errore",
        text2: "Impossibile salvare la tratta",
      });
    }
  };

  useNavigationUpdater(currentInstruction, setCurrentInstruction);

  // DEMO PANEL
  const panelAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(panelAnim, {
      toValue: showDemoPanel ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showDemoPanel]);

  const panelTranslate = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  return (
    <View style={styles.container}>
      {/* MAPPA FULLSCREEN */}
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation={false}
        initialRegion={{
          latitude: currentPosition?.latitude || 0,
          longitude: currentPosition?.longitude || 0,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        {currentPosition && (
          <Marker coordinate={currentPosition}>
            <View style={styles.gpsMarkerOuter}>
              <View style={styles.gpsMarkerInner} />
            </View>
          </Marker>
        )}

        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={6} strokeColor="#E85A2A" />
        )}
      </MapView>

      {/* SEARCH BAR */}
      <View style={styles.searchCard}>
        <Feather name="search" size={20} color="#E85A2A" />

        <TextInput
          placeholder="Dove vuoi andare?"
          placeholderTextColor="#777"
          style={styles.input}
          value={destination}
          onChangeText={setDestination}
          onSubmitEditing={() => fetchRoute()}
        />

        {loadingRoute ? (
          <ActivityIndicator size="small" color="#E85A2A" />
        ) : (
          <TouchableOpacity onPress={() => fetchRoute()}>
            <Feather name="arrow-right-circle" size={26} color="#E85A2A" />
          </TouchableOpacity>
        )}
      </View>

      {/* DEMO PANEL */}
      {DEMO_MODE && (
        <>
          <TouchableOpacity
            onPress={() => setShowDemoPanel(!showDemoPanel)}
            style={styles.demoFab}
          >
            <Feather name="settings" size={22} color="white" />
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.demoPanel,
              { opacity: panelAnim, transform: [{ translateY: panelTranslate }] },
            ]}
          >
            <Text style={styles.demoLabel}>Velocità demo</Text>

            <View style={styles.demoButtons}>
              {["0.5", "1", "3", "5"].map((v) => {
                const s = Number(v);
                return (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setDemoSpeed(s)}
                    style={[
                      styles.demoButton,
                      demoSpeed === s && styles.demoButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.demoButtonText,
                        demoSpeed === s && styles.demoButtonTextActive,
                      ]}
                    >
                      {v}x
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.bleStatus}>
              <Feather
                name={connected ? "check-circle" : "bluetooth"}
                size={16}
                color={connected ? "#1DB954" : "#E85A2A"}
              />
              <Text style={styles.bleStatusText}>
                {connected ? "Casco connesso" : "Casco non connesso"}
              </Text>
            </View>

            {error && (
              <Text style={{ fontSize: 11, color: "#C62828", marginTop: 6 }}>
                {error}
              </Text>
            )}
          </Animated.View>
        </>
      )}

      {/* INSTRUCTION CARD */}
      {showInstructionCard && <InstructionCard instruction={currentInstruction} />}

      {/* SEND BUTTON */}
      <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
        <Feather name="send" size={20} color="white" />
        <Text style={styles.sendButtonText}>Invia al casco</Text>
      </TouchableOpacity>
    </View>
  );
}

////////////////////////////////////////////////////////////
// STILI
////////////////////////////////////////////////////////////

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },

  searchCard: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    padding: 14,
    backgroundColor: "white",
    borderRadius: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    elevation: 6,
  },

  input: {
    flex: 1,
    fontSize: 16,
    color: "#222",
  },

  gpsMarkerOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(232,90,42,0.20)",
    justifyContent: "center",
    alignItems: "center",
  },
  gpsMarkerInner: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#E85A2A",
    borderWidth: 3,
    borderColor: "white",
  },

  demoFab: {
    position: "absolute",
    top: 135,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#E85A2A",
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
  },

  demoPanel: {
    position: "absolute",
    top: 200,
    right: 20,
    width: 170,
    backgroundColor: "white",
    padding: 14,
    borderRadius: 20,
    elevation: 10,
  },
  demoLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 10,
    color: "#222",
  },
  demoButtons: {
    flexDirection: "row",
    gap: 6,
  },
  demoButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
  },
  demoButtonActive: {
    backgroundColor: "#E85A2A",
    borderColor: "#E85A2A",
  },
  demoButtonText: { fontSize: 12, color: "#444" },
  demoButtonTextActive: { color: "white" },

  bleStatus: {
    marginTop: 14,
    backgroundColor: "#FFFFFFEE",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 3,
  },
  bleStatusText: { fontSize: 12, color: "#333" },

  sendButton: {
    position: "absolute",
    bottom: 60,
    left: 16,
    right: 16,
    height: 58,
    borderRadius: 28,
    backgroundColor: "#E85A2A",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    elevation: 12,
  },
  sendButtonText: {
    fontSize: 17,
    fontWeight: "600",
    color: "white",
  },
});
