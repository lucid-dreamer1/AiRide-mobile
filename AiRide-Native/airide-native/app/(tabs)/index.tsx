// -------------------------------------------------------------
// AiRide - HomeScreen (index.tsx) — VERSIONE COMPLETA + FIX BLE
// -------------------------------------------------------------

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
import { useTheme } from "@/contexts/ThemeContext";

import { saveRide } from "@/services/saveRide";
import Toast from "react-native-toast-message";
import { useAuth } from "@/services/useAuth";
import InstructionCard from "@/components/InstructionCard";

import MapView, { Marker, Polyline } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";

import {
  getRoute,
  updatePosition,
  openInstructionStream,
} from "@/services/api";
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
  const { themeColors } = useTheme();
  const styles = createStyles(themeColors);

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

  // 👇 FIX: usiamo scanAndConnect (quello del tuo HelmetContext)
  const { connected, error, scanAndConnect } = useHelmet();

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

  const hasLoadedFromRides = useRef(false);

  const demoIndexRef = useRef(0);
  const demoTRef = useRef(0);
  const lastCameraUpdate = useRef(0);
  const lastGPSUpdate = useRef(0);

  // -------------------------------------------------------------
  // AUTO RI-PERCORRI
  // -------------------------------------------------------------
  useEffect(() => {
    if (!params?.destination) return;
    if (hasLoadedFromRides.current) return;

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
        mapRef.current?.animateCamera(
          { center: p, zoom: 16 },
          { duration: 500 }
        );
      } catch {}
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
        mapRef.current?.animateCamera(
          { center: pos, zoom: 16 },
          { duration: 180 }
        );
      }

      demoIndexRef.current = newIndex;
      demoTRef.current = newT;
    }, 110);

    return () => clearInterval(interval);
  }, [routeCoords, demoSpeed, demoCanStart]);

  // -------------------------------------------------------------
  // INVIO TRATTA (BLOCCATO SENZA CONNESSIONE AL CASCO)
  // -------------------------------------------------------------
  const handleSend = async () => {
    if (!destination.trim()) return;
    if (!currentPosition) return;

    if (!connected) {
      Toast.show({
        type: "error",
        text1: "Casco non connesso",
        text2: "Connetti il casco prima di inviare il percorso.",
      });
      return;
    }

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
      Toast.show({
        type: "error",
        text1: "Errore",
        text2: "Impossibile salvare la tratta",
      });
    }
  };

  useNavigationUpdater(currentInstruction, setCurrentInstruction);

  // -------------------------------------------------------------
  // PANEL ANIMATION
  // -------------------------------------------------------------
  const panelAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(panelAnim, {
      toValue: showDemoPanel ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [showDemoPanel]);

  const panelTranslate = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  // -------------------------------------------------------------
  // UI
  // -------------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* MAPPA */}
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation={false}
        initialRegion={{
          latitude: currentPosition?.latitude ?? 0,
          longitude: currentPosition?.longitude ?? 0,
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
          <Polyline
            coordinates={routeCoords}
            strokeWidth={6}
            strokeColor="#E85A2A"
          />
        )}
      </MapView>

      {/* SEARCH BAR */}
      <View style={styles.searchCard}>
        <Feather name="search" size={20} color={themeColors.accent} />

        <TextInput
          placeholder="Dove vuoi andare?"
          placeholderTextColor={themeColors.textMuted}
          style={styles.input}
          value={destination}
          onChangeText={setDestination}
          onSubmitEditing={() => fetchRoute()}
        />

        {loadingRoute ? (
          <ActivityIndicator size="small" color={themeColors.accent} />
        ) : (
          <TouchableOpacity onPress={() => fetchRoute()}>
            <Feather
              name="arrow-right-circle"
              size={26}
              color={themeColors.accent}
            />
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
              {
                opacity: panelAnim,
                transform: [{ translateY: panelTranslate }],
              },
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

            {/* ESTENSIONE: STATO BLE */}
            <View style={styles.bleStatus}>
              <Feather
                name={connected ? "check-circle" : "bluetooth"}
                size={16}
                color={connected ? "#1DB954" : themeColors.accent}
              />
              <Text style={styles.bleStatusText}>
                {connected ? "Casco connesso" : "Casco non connesso"}
              </Text>
            </View>

            {/* 🔵 BOTTONE DI CONNESSIONE MANUALE */}
            {!connected && (
              <TouchableOpacity
                onPress={scanAndConnect}
                style={styles.connectButton}
              >
                <Feather name="link" size={16} color="white" />
                <Text style={styles.connectButtonText}>Connetti casco</Text>
              </TouchableOpacity>
            )}

            {error && (
              <Text style={{ fontSize: 11, color: "#C62828", marginTop: 6 }}>
                {error}
              </Text>
            )}
          </Animated.View>
        </>
      )}

      {/* INSTRUCTION CARD */}
      {showInstructionCard && (
        <InstructionCard instruction={currentInstruction} />
      )}

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

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },

    map: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },

    searchCard: {
      position: "absolute",
      top: 50,
      left: 16,
      right: 16,
      padding: 14,
      backgroundColor: colors.card,
      borderRadius: 28,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      elevation: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },

    input: {
      flex: 1,
      fontSize: 16,
      color: colors.text,
    },

    gpsMarkerOuter: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accent + "33",
      justifyContent: "center",
      alignItems: "center",
    },

    gpsMarkerInner: {
      width: 15,
      height: 15,
      borderRadius: 8,
      backgroundColor: colors.accent,
      borderWidth: 3,
      borderColor: colors.card,
    },

    demoFab: {
      position: "absolute",
      top: 135,
      right: 20,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accent,
      justifyContent: "center",
      alignItems: "center",
      elevation: 8,
    },

    demoPanel: {
      position: "absolute",
      top: 200,
      right: 20,
      width: 170,
      backgroundColor: colors.card,
      padding: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 10,
    },

    demoLabel: {
      fontSize: 14,
      fontWeight: "600",
      marginBottom: 10,
      color: colors.text,
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
      borderColor: colors.border,
      alignItems: "center",
    },

    demoButtonActive: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },

    demoButtonText: {
      fontSize: 12,
      color: colors.textMuted,
    },

    demoButtonTextActive: {
      color: "white",
    },

    bleStatus: {
      marginTop: 14,
      backgroundColor: colors.card + "EE",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 3,
    },

    bleStatusText: {
      fontSize: 12,
      color: colors.text,
    },

    connectButton: {
      marginTop: 10,
      backgroundColor: colors.accent,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      justifyContent: "center",
    },

    connectButtonText: {
      color: "white",
      fontSize: 13,
      fontWeight: "600",
    },

    sendButton: {
      position: "absolute",
      bottom: 60,
      left: 16,
      right: 16,
      height: 58,
      borderRadius: 28,
      backgroundColor: colors.accent,
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
