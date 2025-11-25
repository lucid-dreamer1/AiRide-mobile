// 🔥 INDEX.TSX — AirRide
// DEMO MODE avanzata (parte dopo INVIA e si ferma alla fine)
// PALLE
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";

import InstructionCard from "@/components/InstructionCard";
import MapView, { Marker, Polyline } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";

import {
  getRoute,
  updatePosition,
  openInstructionStream,
} from "@/services/api";
import { useNavigationContext } from "@/navigation/NavigationContext";
import { useHelmet } from "@/contexts/HelmetContext";
import useNavigationUpdater from "@/hooks/useNavigationUpdater";

// DEMO MODE
const DEMO_MODE = true;

// Punto
type Point = { latitude: number; longitude: number };

// Interpolazione veloce
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

  const { scanAndConnect, connected, scanning, error } = useHelmet();

  const [destination, setDestination] = useState("");
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [showInstructionCard, setShowInstructionCard] = useState(false);

  const [demoSpeed, setDemoSpeed] = useState(3);
  const [demoPanelHeight, setDemoPanelHeight] = useState(0);
  const [demoActive, setDemoActive] = useState(false);
  const [demoFinished, setDemoFinished] = useState(false);

  const mapRef = useRef<MapView | null>(null);
  const streamRef = useRef<any>(null);

  const demoIndexRef = useRef(0);
  const demoTRef = useRef(0);
  const lastUpdateRef = useRef(0);

  // -----------------------------
  // DEMO RESET QUANDO CAMBIA ROUTE
  // -----------------------------
  useEffect(() => {
    if (DEMO_MODE && routeCoords.length > 1) {
      demoIndexRef.current = 0;
      demoTRef.current = 0;
    }
  }, [routeCoords]);

  // -----------------------------
  // DEMO (parte SOLO dopo invio + si ferma alla fine)
  // -----------------------------
  useEffect(() => {
    if (!DEMO_MODE || !demoActive || demoFinished) return;

    if (!routeCoords || routeCoords.length < 2) return;

    const interval = setInterval(() => {
      const index = demoIndexRef.current;
      const t = demoTRef.current;

      const p1 = routeCoords[index];
      const p2 = routeCoords[index + 1];

      if (!p2) {
        setDemoFinished(true);
        setDemoActive(false);
        return;
      }

      let newT = t + 0.05 * demoSpeed;
      let newIndex = index;

      if (newT >= 1) {
        newT = 0;
        newIndex++;

        if (newIndex >= routeCoords.length - 1) {
          setDemoFinished(true);
          setDemoActive(false);
          return;
        }
      }

      const pos = interpolate(p1, p2, newT);
      setCurrentPosition(pos);

      const now = Date.now();
      if (now - lastUpdateRef.current > 300) {
        lastUpdateRef.current = now;
        updatePosition(pos.latitude, pos.longitude).catch(() => {});
      }

      mapRef.current?.animateCamera(
        { center: pos, zoom: 16 },
        { duration: 150 }
      );

      demoIndexRef.current = newIndex;
      demoTRef.current = newT;
    }, 100);

    return () => clearInterval(interval);
  }, [routeCoords, demoSpeed, demoActive, demoFinished]);

  // -----------------------------
  // CALCOLO PERCORSO
  // -----------------------------
  const fetchRoute = async () => {
    // Casco NON obbligatorio
    // ⛔ Casco OBBLIGATORIO
    if (!connected) {
      alert("Connetti prima il casco per procedere.");
      try {
        await scanAndConnect();
      } catch {
        return; // 🔥 se non si connette, blocchiamo tutto
      }
    }

    try {
      setLoadingRoute(true);

      let start: Point;
      if (DEMO_MODE) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({});
          start = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
          setCurrentPosition(start);
        } else {
          start = currentPosition || { latitude: 0, longitude: 0 };
        }
      } else {
        start = currentPosition || { latitude: 0, longitude: 0 };
      }

      const data = await getRoute(start.latitude, start.longitude, destination);

      setRouteInfo({ duration: data.duration, distance: data.distance });

      const coords: Point[] = data.coordinates.map((p: any) => ({
        latitude: p.lat,
        longitude: p.lon,
      }));

      setRouteCoords(coords);
      setDemoFinished(false); // permette nuova DEMO
    } finally {
      setLoadingRoute(false);
    }
  };

  // -----------------------------
  // STREAM ISTRUZIONI
  // -----------------------------
  const handleSend = async () => {
    if (!destination.trim()) return;
    if (!currentPosition) return;

    // ⛔ CASCO OBBLIGATORIO
    if (!connected) {
      alert("Connetti prima il casco.");
      try {
        await scanAndConnect();
      } catch {
        return; // se fallisce → STOP
      }
      if (!connected) return;
    }

    try {
      const start = currentPosition;

      // ⭐ AVVIA DEMO SOLO DOPO CHE IL CASCO È CONNESSO
      setDemoActive(true);
      setDemoFinished(false);

      setShowInstructionCard(true);

      if (streamRef.current?.close) streamRef.current.close();

      streamRef.current = openInstructionStream(
        `${start.latitude},${start.longitude}`,
        destination,
        async (msg: any) => {
          const testo =
            msg?.testo || msg?.text || msg?.instruction || "Istruzione";
          const metri = msg?.metri || msg?.distance || 0;
          const freccia = msg?.freccia || msg?.arrow || 0;

          setCurrentInstruction({ testo, metri, freccia, next: msg?.next });
        }
      );
    } catch (err) {}
  };

  // -----------------------------------------
  // AGGIORNA istruzioni e metri + BLE ogni 50m
  // -----------------------------------------
  useNavigationUpdater(currentInstruction, setCurrentInstruction);

  return (
    <View style={styles.container}>
      {/* DEMO controls */}
      {DEMO_MODE && (
        <View
          style={styles.demoControlsOverlay}
          onLayout={(e) => setDemoPanelHeight(e.nativeEvent.layout.height)}
        >
          <Text style={styles.demoLabel}>Velocità DEMO</Text>

          <View style={styles.demoButtons}>
            {["0.5", "1", "3", "5"].map((val) => {
              const s = Number(val);
              return (
                <TouchableOpacity
                  key={val}
                  style={[
                    styles.demoButton,
                    demoSpeed === s && styles.demoButtonActive,
                  ]}
                  onPress={() => setDemoSpeed(s)}
                >
                  <Text
                    style={[
                      styles.demoButtonText,
                      demoSpeed === s && styles.demoButtonTextActive,
                    ]}
                  >
                    {val}x
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* MAPPA */}
      <View style={styles.mapWrapper}>
        <MapView
          ref={mapRef}
          style={styles.map}
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
            <Polyline
              coordinates={routeCoords}
              strokeWidth={5}
              strokeColor="#E85A2A"
            />
          )}
        </MapView>
      </View>

      {showInstructionCard && (
        <InstructionCard instruction={currentInstruction} />
      )}

      {/* SEARCH BAR */}
      <View
        style={[
          styles.searchCard,
          { top: DEMO_MODE ? demoPanelHeight + 30 : 20 },
        ]}
      >
        <Feather name="navigation" size={20} color="#E85A2A" />
        <TextInput
          placeholder="Inserisci destinazione"
          placeholderTextColor="#999"
          style={styles.input}
          value={destination}
          onChangeText={setDestination}
          onSubmitEditing={fetchRoute}
        />

        {loadingRoute ? (
          <ActivityIndicator size="small" color="#E85A2A" />
        ) : (
          <TouchableOpacity onPress={fetchRoute}>
            <Feather name="search" size={20} color="#E85A2A" />
          </TouchableOpacity>
        )}
      </View>

      {/* BLE STATUS */}
      <View style={styles.bleStatus}>
        <Feather
          name={connected ? "check-circle" : scanning ? "loader" : "bluetooth"}
          size={16}
          color={connected ? "#1DB954" : scanning ? "#E8A22A" : "#999"}
        />

        <Text style={styles.bleStatusText}>
          {connected
            ? "Casco connesso"
            : scanning
            ? "Connessione al casco..."
            : "Casco non connesso"}
        </Text>

        {error ? <Text style={styles.bleStatusError}>{error}</Text> : null}
      </View>

      {/* PULSANTE INVIA */}
      <TouchableOpacity onPress={handleSend} style={styles.sendButtonFixed}>
        <Feather name="send" size={18} color="white" />
        <Text style={styles.sendText}>Invia al Casco</Text>
      </TouchableOpacity>
    </View>
  );
}

// -----------------------------
// STILI
// -----------------------------
const styles = StyleSheet.create({
  container: { flex: 1 },

  mapWrapper: { height: 420 },
  map: { flex: 1 },

  gpsMarkerOuter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(232,90,42,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  gpsMarkerInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#E85A2A",
    borderWidth: 3,
    borderColor: "white",
  },

  demoControlsOverlay: {
    position: "absolute",
    top: 20,
    left: 16,
    right: 16,
    zIndex: 999,
    backgroundColor: "white",
    padding: 12,
    borderRadius: 18,
    elevation: 5,
  },
  demoLabel: { fontSize: 13, color: "#555", marginBottom: 8 },
  demoButtons: { flexDirection: "row", gap: 8 },
  demoButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
  },
  demoButtonActive: { backgroundColor: "#E85A2A", borderColor: "#E85A2A" },
  demoButtonText: { color: "#444", fontSize: 13 },
  demoButtonTextActive: { color: "white" },

  searchCard: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    padding: 14,
    backgroundColor: "white",
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    elevation: 5,
  },
  input: { flex: 1, fontSize: 16, color: "#222" },

  bleStatus: {
    position: "absolute",
    left: 16,
    bottom: 90,
    flexDirection: "column",
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  bleStatusText: { fontSize: 11, color: "#333", marginTop: 2 },
  bleStatusError: { fontSize: 10, color: "#E53935", marginTop: 2 },

  sendButtonFixed: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 20,
    backgroundColor: "#E85A2A",
    height: 56,
    borderRadius: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    elevation: 10,
  },
  sendText: { color: "white", fontSize: 16, fontWeight: "600" },
});
console.error = (...args) => {
  args = args.map(a => typeof a === "string" ? a : JSON.stringify(a));
  console.log("[ERR]", ...args);
};
console.warn = (...args) => {
  args = args.map(a => typeof a === "string" ? a : JSON.stringify(a));
  console.log("[WARN]", ...args);
};
