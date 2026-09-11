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
  Linking,
  Platform,
  PermissionsAndroid,
  StatusBar,
  Alert,
  DeviceEventEmitter,
} from "react-native";
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { useTheme } from "@/contexts/ThemeContext";

import { saveRide } from "@/services/saveRide";
import Toast from "react-native-toast-message";
import { useAuth } from "@/services/useAuth";
import InstructionCard from "@/components/InstructionCard";
import { firebaseFirestore } from "@/services/firebaseConfig";
import { DeviceMotion } from 'expo-sensors';

import MapView, { Marker, Polyline } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams } from "expo-router";

import {
  getRoute,
  updatePosition,
  startTrip,
} from "@/services/api";
import { useNavigationContext } from "@/navigation/NavigationContext";
import { useHelmet } from "@/contexts/HelmetContext";
import { useOvertakeDetection } from "@/hooks/useOvertakeDetection";
import { useVoiceAssistant } from "@/hooks/useVoiceAssistant";
import { useVoiceCommand } from "@/hooks/useVoiceCommand";
import { useVoiceSettings } from "@/contexts/VoiceSettingsContext";
import { BackgroundNavigation } from "../../services/BackgroundNavigation";
import CallModule from "@/services/callModule"; 
import * as Contacts from 'expo-contacts'; 
import { NavigationStore } from "@/services/NavigationStore"; // <--- Import Store
import { ttsService } from "@/services/TTSService";
import { VoicePriority } from "@/types/voice";
import { radioService, RadioState } from "@/services/RadioService";
import { RadioPlayerWidget } from "@/components/RadioPlayerWidget";
import { VoiceCommandsModal } from "@/components/VoiceCommandsModal";
import { friendsService, FriendProfile } from "@/services/FriendsService";
import { intercomService, IntercomState } from "@/services/IntercomService";
import { FriendsRadarModal } from "@/components/FriendsRadarModal";

const DEMO_MODE = true;

type Point = { latitude: number; longitude: number };

const interpolate = (p1: Point, p2: Point, t: number): Point => ({
  latitude: p1.latitude + (p2.latitude - p1.latitude) * t,
  longitude: p1.longitude + (p2.longitude - p1.longitude) * t,
});

const setImmersiveMode = (enabled: boolean) => {
    if (Platform.OS === 'android') {
        if (enabled) {
            StatusBar.setHidden(true);
            SystemNavigationBar.navigationHide();
            SystemNavigationBar.stickyImmersive();
        } else {
            StatusBar.setHidden(false);
            SystemNavigationBar.navigationShow();
        }
    }
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingModal from "@/components/OnboardingModal"; // <--- Import

// ...

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

  // Voice Assistant
  const { settings: voiceSettings } = useVoiceSettings();

  const { user } = useAuth();
  const params = useLocalSearchParams();

  const [destination, setDestination] = useState("");
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [showInstructionCard, setShowInstructionCard] = useState(false);
  const [demoCanStart, setDemoCanStart] = useState(false);
  const [demoSpeed, setDemoSpeed] = useState(3);
  const [showDemoPanel, setShowDemoPanel] = useState(false);
  const [showBlePanel, setShowBlePanel] = useState(false);
  const [showRadioPanel, setShowRadioPanel] = useState(false);
  const [showVoiceHelp, setShowVoiceHelp] = useState(false);
  const [radioState, setRadioState] = useState<RadioState>(radioService.getState());
  
  // Amici & Interfono Hands-Free
  const [friends, setFriends] = useState<FriendProfile[]>(friendsService.getFriends());
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [intercomState, setIntercomState] = useState<IntercomState>(intercomService.getState());
  
  const [showOnboarding, setShowOnboarding] = useState(false); // <--- New State

  const [isNavigating, setIsNavigating] = useState(false); // <--- NUOVO STATO
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);

  useOvertakeDetection({
    currentSpeedKmh: DEMO_MODE ? 50 : currentSpeedKmh,
    onOvertakeDetected: () => {
      console.log("[HomeScreen] Sorpasso convalidato, emetto evento audio!");
      DeviceEventEmitter.emit('TriggerDemoOvertake');
    }
  });

  const mapRef = useRef<MapView | null>(null);

  const hasLoadedFromRides = useRef(false);

  // -------------------------------------------------------------
  // RADIO STATE LISTENER
  // -------------------------------------------------------------
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('Radio_StateChanged', (state: RadioState) => {
      setRadioState({ ...state });
    });
    return () => {
      sub.remove();
    };
  }, []);

  // -------------------------------------------------------------
  // AMICI & INTERFONO LISTENER & GPS RADAR SYNC
  // -------------------------------------------------------------
  useEffect(() => {
    if (user) {
      friendsService.init(user);
      intercomService.setUser(user);
      setFriends(friendsService.getFriends());
    }
    const subFriends = DeviceEventEmitter.addListener('Friends_Updated', (data: any) => {
      setFriends(data.friends || []);
    });
    const subIntercom = DeviceEventEmitter.addListener('Intercom_StateChanged', (state: IntercomState) => {
      setIntercomState({ ...state });
    });
    const subHelp = DeviceEventEmitter.addListener('Voice_Show_Commands', () => {
      setShowVoiceHelp(true);
    });
    return () => {
      subFriends.remove();
      subIntercom.remove();
      subHelp.remove();
    };
  }, [user]);

  useEffect(() => {
    if (currentPosition) {
      friendsService.updateMyLocation({
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        speedKmh: currentSpeedKmh,
      });
    }
  }, [currentPosition, currentSpeedKmh]);

  const handleNavigateToFriend = async (friend: FriendProfile) => {
    if (!friend.location) {
      Toast.show({ type: 'info', text1: 'Posizione non disponibile' });
      return;
    }
    const coords = `${friend.location.latitude},${friend.location.longitude}`;
    setDestination(friend.displayName);
    ttsService.speak(`Imposto la navigazione verso ${friend.displayName}.`, VoicePriority.HIGH);
    await fetchRoute(coords);
  };

  // -------------------------------------------------------------
  // ONBOARDING CHECK
  // -------------------------------------------------------------
  useEffect(() => {
    (async () => {
      if (!user?.uid) return; // Wait for user to be loaded

      try {
        const key = `hasLaunched_${user.uid}`;
        const hasLaunched = await AsyncStorage.getItem(key);
        console.log(`📝 [Index] hasLaunched Check for ${user.uid}:`, hasLaunched);
        
        if (hasLaunched === null) {
          setShowOnboarding(true);
        }
      } catch (e) {
        console.error('Error checking first launch:', e);
      }
    })();
  }, [user]);

  const handleOnboardingDone = async () => {
    if (!user?.uid) return;
    setShowOnboarding(false);
    await AsyncStorage.setItem(`hasLaunched_${user.uid}`, 'true');
    // Opzionale: Chiedi permessi qui se non fatto nello slide
  };

  // -------------------------------------------------------------
  // RIDE STATS & DEVICE MOTION (ANGOLI DI PIEGA)
  // -------------------------------------------------------------
  useEffect(() => {
    let subscription: any;

    if (isNavigating) {
      DeviceMotion.setUpdateInterval(500); 
      subscription = DeviceMotion.addListener((listener) => {
        if (listener.rotation) {
          const rollDeg = listener.rotation.gamma * (180 / Math.PI);
          
          const currentStore = NavigationStore.get();
          const stats = currentStore.rideStats;

          if (stats && stats.currentRideId) {
            let updated = false;
            const newStats = { ...stats };

            if (rollDeg > 0 && rollDeg > stats.maxRightRoll && rollDeg < 90) {
                newStats.maxRightRoll = rollDeg;
                updated = true;
            } 
            else if (rollDeg < 0 && Math.abs(rollDeg) > stats.maxLeftRoll && Math.abs(rollDeg) < 90) {
                newStats.maxLeftRoll = Math.abs(rollDeg);
                updated = true;
            }

            if (updated) {
               NavigationStore.set({ rideStats: newStats });
            }
          }
        }
      });
    } else {
      // 2. Viaggio terminato, salviamo le stats finali!
      const finalStore = NavigationStore.get();
      const stats = finalStore.rideStats;
      if (stats && stats.currentRideId && user?.uid) {
         const avg = stats.speedsCount > 0 ? (stats.speedsSum / stats.speedsCount) : 0;
         
         firebaseFirestore.collection("users").doc(user.uid).collection("rides").doc(stats.currentRideId).update({
            maxSpeedKmh: Math.round(stats.maxSpeedKmh),
            avgSpeedKmh: Math.round(avg * 10) / 10,
            maxLeftRoll: Math.round(stats.maxLeftRoll),
            maxRightRoll: Math.round(stats.maxRightRoll),
         }).catch(err => console.log("Errore salvataggio final stats", err));

         NavigationStore.set({ rideStats: { ...stats, currentRideId: null } });
      }
    }

    return () => {
       if (subscription) subscription.remove();
    };
  }, [isNavigating]);

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
  // RICHIESTA PERMESSI UNIFICATA
  // -------------------------------------------------------------
  const requestAllPermissions = async () => {
      if (Platform.OS !== 'android') return true;

      try {
          console.log("📝 Richiedendo permessi runtime...");
          
          // 1. Runtime Permissions
          const permissionsToRequest = [
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
              PermissionsAndroid.PERMISSIONS.CALL_PHONE,
              PermissionsAndroid.PERMISSIONS.ANSWER_PHONE_CALLS,
              PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
              PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ];

          if (Platform.Version >= 31) {
              permissionsToRequest.push(
                  PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                  PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
              );
          }

          const result = await PermissionsAndroid.requestMultiple(permissionsToRequest);
          
          // Controllo negati
          const deniedPermissions = Object.entries(result)
              .filter(([key, value]) => value !== PermissionsAndroid.RESULTS.GRANTED)
              .map(([key, value]) => key.split('.').pop());

          if (deniedPermissions.length > 0) {
              console.log("📝 Denied: ", deniedPermissions); 
               Alert.alert(
                  "Permessi Necessari",
                  `Hai negato permessi essenziali:\n${deniedPermissions.join(', ')}\n\nL'app non può funzionare correttamente. Vai nelle Impostazioni e abilitali.`,
                  [
                      { text: "Chiudi", style: "cancel" },
                      { text: "Impostazioni", onPress: () => Linking.openSettings() }
                  ]
              );
              return false; 
          }

          // 2. Battery Optimization
          const isBatteryOptimized = await Linking.canOpenURL("android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
          // Nota: canOpenURL controlla solo se l'intent è valido, non se è già ottimizzato. 
          // Android non ha un'API pubblica semplice per checkare "isIgnoringBatteryOptimizations" da JS senza Native Module custom.
          // Tuttavia, per ora lasciamo l'alert ma potremmo usare un flag in AsyncStorage "batteryAlertShown" per non mostrarlo sempre?
          // OPPURE: Rimuoviamo il timeout e lo mostriamo solo se l'utente lo richiede esplicitamente o se notiamo problemi.
          // PER IL MOMENTO: Lo commentiamo/rimuoviamo se è troppo invasivo, o lo lasciamo. 
          // L'utente dice "a volte appaiono quando non devono". 
          // Se l'utente ha già dato l'ok, Android di solito ignora la richiesta o mostra "già ottimizzato".
          
          // MIGLIORAMENTO: Mostriamo l'alert solo se è la prima volta o se non salvato
          // Per semplicità e stabilità richiesta: Rimuoviamo il timeout aggressivo. Spostiamolo in un "Check Status" manuale o solo prima installazione.
          // MA, per rispettare la richiesta "non devono apparire se non devono":
          // Purtroppo senza Native Module "PowerManager.isIgnoringBatteryOptimizations" non possiamo saperlo con certezza da JS puro.
          // SOLUZIONE COMPROMESSO: Usiamo il flag "hasLaunched" (o simile) per mostrarlo UNA volta sola.
          // O meglio: Lo rimuoviamo dal flusso automatico di avvio per evitare spam, e lo lasciamo nelle impostazioni?
          // L'utente vuole risolvere il bug "appaiono quando non devono".
          // Se appaiono, vuol dire che il codice viene eseguito.
          
          // PROPOSTA: Rimuovo questi alert automatici dal flusso di avvio (loop o timeout) e li lascio solo su richiesta utente o check più intelligente.
          // STEP: Rendo il timeout condizionale o lo rimuovo. L'utente ha detto "a volte appaiono".
          // Facciamo che se PermissionsAndroid dice tutto OK, non rompiamo le scatole con Battery/Overlay a meno che non sia vitale.
          
          // DECISIONE: Commento i timeout per Battery e Overlay nel flusso automatico. 
          // Se l'app non va in background, l'utente andrà nelle impostazioni o resetterà.
          // Questo risolve "appaiono quando non devono" (cioè sempre).
          
          /* 
          setTimeout(() => {
             // ... Code removed to stop spam
          }, 500);
          */

          // 3. Overlay 
          if (Platform.Version >= 29) {
             const canOverlay = await PermissionsAndroid.check("android.permission.SYSTEM_ALERT_WINDOW" as any); 
             // Attenzione: SYSTEM_ALERT_WINDOW non si checka con PermissionsAndroid standard su tutti i device, ma proviamo.
             // Se ritorna false (o non supportato), e Settings.canDrawOverlays è true... 
             // In realtà Settings.canDrawOverlays richiede Native Module.
             
             // PER RISOLVERE IL BUG "appaiono quando non devono": Li rimuovo dall'auto-check all'avvio. 
             // Li sposterò eventualmente in un pulsante "Diagnostica" o se l'utente attiva la navigazione Background.
             
             /*
               setTimeout(() => {
                  Alert.alert(
                      "Visualizzazione sopra app",
                      "Necessario per vedere le indicazioni mentre usi altre app.",
                      [
                           { text: "Ignora", style: "cancel" },
                           {
                              text: "Impostazioni Overlay",
                              onPress: () => {
                                  Linking.sendIntent("android.settings.action.MANAGE_OVERLAY_PERMISSION", [
                                      { key: "package", value: "package:com.anonymous.airidenative" }
                                  ]).catch(() => Linking.openSettings());
                              }
                           }
                      ]
                  );
               }, 3000); 
             */
          }
          
          return true;

      } catch (err) {
          console.warn("Permission parsing error:", err);
          return false;
      }
  };

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
        NavigationStore.set({ currentCoords: p });
        mapRef.current?.animateCamera(
          { center: p, zoom: 16 },
          { duration: 500 }
        );
      } catch {}
    })();

    // -------------------------------------------------------------
    // RICHIESTA PERMESSI UNIFICATA
    // -------------------------------------------------------------
    // Avvio richiesta permessi con delay per non sovrapporsi al GPS request
    setTimeout(() => {
        requestAllPermissions().then((granted) => {
             if (granted) {
                 console.log("✅ Permessi Init OK.");
                 // Avvia il servizio SOLO se Voice Command è abilitato o se serve per altro
                 if (voiceSettings.enabled) {
                      console.log("🎤 Voice Enabled -> Avvio Background Service...");
                      BackgroundNavigation.start();
                 }
             }
        });
    }, 1000);

  }, [voiceSettings.enabled]); // Aggiunto dipendenza voiceSettings

  // -------------------------------------------------------------
  // GET ROUTE
  // -------------------------------------------------------------
  const fetchRoute = async (overrideDest?: string) => {
    try {
      setLoadingRoute(true);
      setIsNavigating(false); // Reset navigazione se ricalcolo

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

      setImmersiveMode(true); // <--- ATTIVA IMMERSIVE MODE
      setShowInstructionCard(true);
      setCurrentInstruction({
        testo: "Percorso pronto 🚀",
        freccia: 2,
        metri: null,
        next: null,
        fase: "ready",
      });
      
      return data; // <--- RETURN DATA
    } catch {
        return null; // <--- RETURN NULL ON ERROR
    } finally {
      setLoadingRoute(false);
    }
  };

  // -------------------------------------------------------------
  // REAL GPS NAVIGATION LOOP (QUANDO NON IN DEMO_MODE)
  // -------------------------------------------------------------
  useEffect(() => {
    // Attiva solo se stiamo navigando e NON siamo in demo mode
    if (!isNavigating || DEMO_MODE) return;

    let subscriber: Location.LocationSubscription | null = null;

    const startWatching = async () => {
      try {
        subscriber = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000, // Aggiorna ogni secondo
            distanceInterval: 5, // O ogni 5 metri
          },
          async (loc) => {
            const { latitude, longitude, speed } = loc.coords;
            const newPos = { latitude, longitude };
            
            setCurrentSpeedKmh((speed || 0) * 3.6);
            
            // 1. Aggiorna posizione locale
            setCurrentPosition(newPos);
            NavigationStore.set({
              currentCoords: newPos,
              currentSpeedKmh: Math.round((speed || 0) * 3.6),
            });

            const now = Date.now();

            // 2. Aggiorna Camera (throttle ~350ms)
            if (now - lastCameraUpdate.current > 350) {
              lastCameraUpdate.current = now;
              mapRef.current?.animateCamera(
                { center: newPos, zoom: 18, heading: loc.coords.heading ?? 0 },
                { duration: 500 }
              );
            }

            // 3. STOP API CALL QUI!
            // Il "Brain" in background si occupa di chiamare updatePosition().
            // Noi aggiorniamo solo la mappa visuale.
            
          }
        );
      } catch (err) {
        console.log("Errore watchPosition:", err);
      }
    };

    startWatching();

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, [isNavigating]); 

  // -------------------------------------------------------------
  // HELPER PERMISSIONS
  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // HELPER PERMISSIONS
  // -------------------------------------------------------------
  const checkPermissions = async () => {
      if (Platform.OS !== 'android') return true;
      
      const hasAudio = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (hasAudio) return true;

      // Se manca qualcosa, rilanciamo il flusso completo (che ha gli alert e la gestione "never_ask_again")
      console.log("🟦 [Index] Permessi mancanti in checkPermissions, avvio requestAllPermissions...");
      return await requestAllPermissions(); 
  };

  // -------------------------------------------------------------
  // GESTIONE BACKGROUND SERVICE E SYNC STORE
  // -------------------------------------------------------------
  useEffect(() => {
    // 1. Sincronizziamo lo stato locale con lo Store (usato dal Background Service)
    NavigationStore.set({ isNavigating });

    const manageService = async () => {
        console.log("🟦 [Index] isNavigating changed:", isNavigating);
        if (isNavigating) {
            const hasPerms = await checkPermissions();
            if (hasPerms) {
                console.log("🟦 [Index] Chiamata a BackgroundNavigation.start()...");
                await BackgroundNavigation.start();
            } else {
                console.log("🟦 [Index] Start bloccato: permessi mancanti");
            }
        } 
        // NOTA: Non chiamiamo stop() qui perché serviamo il servizio attivo per STT (Voice)
    };
    manageService();

  }, [isNavigating]); 


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

      // Incremento più piccolo per movimento più fluido
      let newT = t + 0.02 * demoSpeed;
      let newIndex = index;

      if (newT >= 1) {
        newT = 0;
        newIndex++;
        if (newIndex >= routeCoords.length - 1) return;
      }

      const pos = interpolate(p1, p2, newT);
      setCurrentPosition(pos);

      const now = Date.now();

      // GPS update throttle aumentato per stabilità
      if (now - lastGPSUpdate.current > 800) {
        lastGPSUpdate.current = now;
        updatePosition(pos.latitude, pos.longitude).then((res) => {
          if (res?.nav) {
            const totalMeters = (Number(String(routeInfo?.distance).replace(" km", "")) || 0) * 1000;
            const remainingMeters = res.nav.remaining_dist 
              ? res.nav.remaining_dist * 1000 
              : (totalMeters * (1 - newIndex / routeCoords.length)); // Simulazione metri per demo

            setCurrentInstruction({
              ...res.nav,
              total_dist: totalMeters,
              remaining_dist: remainingMeters
            });

            // ⚡ AGGIORNA STORE PER CASCO (In Demo)
            NavigationStore.set({
                 arrow: res.nav.freccia ?? 0,
                 distance: res.nav.metri ?? 0,
                 text: res.nav.testo ?? '',
                 nextArrow: res.nav.next?.freccia,
                 nextText: res.nav.next?.testo,
                 remainingDist: remainingMeters,
                 totalDist: totalMeters,
            });
          }
        });
      }

      // Camera update meno frequente per evitare sfarfallio
      if (now - lastCameraUpdate.current > 500) {
        lastCameraUpdate.current = now;
        mapRef.current?.animateCamera(
          { center: pos, zoom: 16 },
          { duration: 400 } // Durata più lunga per transizione più smooth
        );
      }

      demoIndexRef.current = newIndex;
      demoTRef.current = newT;
    }, 150); // Intervallo aumentato da 110ms a 150ms per più stabilità

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

    // Se DEMO_MODE è true, avvia la simulazione
    if (DEMO_MODE) {
       setDemoCanStart(true);
    } 

    try {
      const docId = await saveRide({
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

      // Avvia statistiche per la nuova id
      NavigationStore.set({
         rideStats: {
             currentRideId: docId as string,
             maxSpeedKmh: 0,
             speedsSum: 0,
             speedsCount: 0,
             maxLeftRoll: 0,
             maxRightRoll: 0,
         }
      });

      Toast.show({
        type: "success",
        text1: "Tratta salvata!",
        text2: "La trovi nella sezione Rides.",
      });

      await startTrip(
        { lat: currentPosition.latitude, lon: currentPosition.longitude },
        destination
      );

      // 🔥 AVVIA LA NAVIGATION LOOP REALE (Anche in Demo Mode per testare BG)
      if (DEMO_MODE) NavigationStore.set({ isDemo: true });
      setIsNavigating(true);

    } catch (err) {
      Toast.show({
        type: "error",
        text1: "Errore",
        text2: "Impossibile salvare la tratta",
      });
    }
  };

  const handleResetRoute = () => {
    setImmersiveMode(false); // <--- DISATTIVA IMMERSIVE MODE
    setIsNavigating(false);
    NavigationStore.set({ isDemo: false }); // Reset Demo Flag
    setDemoCanStart(false);
    setRouteCoords([]);
    setCurrentInstruction(null);
    setRouteInfo({ duration: "", distance: "" });
    setDestination("");
    setShowInstructionCard(false);
    
    // Reset demo refs
    demoIndexRef.current = 0;
    demoTRef.current = 0;

    Toast.show({
      type: "info",
      text1: "Rotta resettata",
      text2: "Mappa pulita con successo",
    });
  };

  const [callStatus, setCallStatus] = useState<number>(0); 
  // 0: Nessuna, 1: In arrivo, 2: Attiva, 3: Conclusa

  useEffect(() => {
    const sub = CallModule.addStatusListener((event: any) => {
        console.log("📞 STATUS CHANGED:", event);
        setCallStatus(event.status);
        if (event.status === 3) setTimeout(() => setCallStatus(0), 3000); 
    });
    return () => { if(sub) sub.remove(); };
  }, []);

  // 1. Assistente Vocale Navigation (TTS)
  useVoiceAssistant({
    instruction: currentInstruction,
    enabled: voiceSettings.enabled && (isNavigating || demoCanStart),
    settings: voiceSettings,
  });
  
  // 2. Assistente Vocale Hands-free (Hey Casco - STT)
  const { isCommandWindowOpen } = useVoiceCommand({
    enabled: voiceSettings.enabled,
    onIntentDetected: async (intent) => { // <--- ASYNC HERE
      console.log('[HomeScreen] Intento vocale rilevato:', intent);

      switch (intent.type) {
        case 'NAVIGATE_TO':
          setDestination(intent.destinationName || intent.destination);
          const routeData = await fetchRoute(intent.destination);
          
          if (routeData) {
             console.log("🎤 Rotta ottenuta, avvio navigazione...");
             // AVVIO SIMILE A HANDLE SEND
             try {
                // Posizione start presa da routeData o corrente
                const startPos = currentPosition || { latitude: 0, longitude: 0 };
                
                await startTrip(
                    { lat: startPos.latitude, lon: startPos.longitude },
                    intent.destination
                );
                
                if (DEMO_MODE) {
                    setDemoCanStart(true);
                    NavigationStore.set({ isDemo: true });
                }
                
                setIsNavigating(true);
                
                const hasPerms = await checkPermissions();
                if (hasPerms) {
                    BackgroundNavigation.start();
                }
                
                ttsService.speak("Si parte!", VoicePriority.HIGH);
             } catch (e) {
                 console.error("Errore startTrip da voce:", e);
                 ttsService.speak("Errore nell'avvio del viaggio", VoicePriority.HIGH);
             }
          } else {
              ttsService.speak("Non riesco a calcolare il percorso", VoicePriority.HIGH);
          }
          break;
        case 'GET_TIME':
            console.log('[HomeScreen] Eseguo GET_TIME');
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setTimeout(() => {
                ttsService.speak(`Sono le ${timeString}`, VoicePriority.HIGH);
            }, 500);
            break;

        case 'GET_REMAINING_INFO':
            console.log('[HomeScreen] Eseguo GET_REMAINING_INFO');
            if (isNavigating && routeInfo.duration && routeInfo.distance) {
                setTimeout(() => {
                    ttsService.speak(`Mancano ${routeInfo.distance} e circa ${routeInfo.duration}`, VoicePriority.HIGH);
                }, 500);
            } else {
                setTimeout(() => {
                  ttsService.speak("Non c'è nessuna navigazione attiva.", VoicePriority.HIGH);
                }, 500);
            }
            break;

        case 'CHECK_NOTIFICATIONS':
             console.log('[HomeScreen] Eseguo CHECK_NOTIFICATIONS');
            // TODO: Integrare con un vero NotificationListener
            setTimeout(() => {
                ttsService.speak("Al momento non hai nuove notifiche.", VoicePriority.HIGH);
            }, 500);
            break;

        case 'NAVIGATE_HOME': {
          console.log('[HomeScreen] Eseguo NAVIGATE_HOME');
          const homeAddr = await AsyncStorage.getItem('@airide_home_address');
          if (homeAddr) {
            setDestination(homeAddr);
            const routeData = await fetchRoute(homeAddr);
            if (routeData) {
              const startPos = currentPosition || { latitude: 0, longitude: 0 };
              await startTrip({ lat: startPos.latitude, lon: startPos.longitude }, homeAddr);
              setIsNavigating(true);
              BackgroundNavigation.start();
              ttsService.speak("Rotta verso casa avviata!", VoicePriority.HIGH);
            }
          } else {
            ttsService.speak("Indirizzo di casa non impostato. Puoi configurarlo nel tuo profilo.", VoicePriority.HIGH);
          }
          break;
        }

        case 'NAVIGATE_WORK': {
          console.log('[HomeScreen] Eseguo NAVIGATE_WORK');
          const workAddr = await AsyncStorage.getItem('@airide_work_address');
          if (workAddr) {
            setDestination(workAddr);
            const routeData = await fetchRoute(workAddr);
            if (routeData) {
              const startPos = currentPosition || { latitude: 0, longitude: 0 };
              await startTrip({ lat: startPos.latitude, lon: startPos.longitude }, workAddr);
              setIsNavigating(true);
              BackgroundNavigation.start();
              ttsService.speak("Rotta verso il lavoro avviata!", VoicePriority.HIGH);
            }
          } else {
            ttsService.speak("Indirizzo di lavoro non impostato.", VoicePriority.HIGH);
          }
          break;
        }

        case 'REPEAT_INSTRUCTION':
          console.log('[HomeScreen] Eseguo REPEAT_INSTRUCTION');
          if (isNavigating && currentInstruction) {
             const spoken = currentInstruction.testo || currentInstruction.text;
             if (spoken) {
                const distStr = currentInstruction.metri ? `Tra ${currentInstruction.metri} metri, ` : '';
                ttsService.speak(`${distStr}${spoken}`, VoicePriority.HIGH);
             }
          } else {
             ttsService.speak("Nessuna navigazione attiva.", VoicePriority.HIGH);
          }
          break;

        case 'GET_SPEED': {
          console.log('[HomeScreen] Eseguo GET_SPEED');
          const spd = Math.round(NavigationStore.get().currentSpeedKmh || 0);
          if (spd > 3) {
             ttsService.speak(`Stai viaggiando a ${spd} chilometri orari.`, VoicePriority.HIGH);
          } else {
             ttsService.speak("Velocità non rilevabile al momento.", VoicePriority.HIGH);
          }
          break;
        }

        case 'GET_HELMET_STATUS': {
          console.log('[HomeScreen] Eseguo GET_HELMET_STATUS');
          const connected = NavigationStore.get().isHelmetConnected;
          ttsService.speak(connected ? "Il casco è connesso e operativo." : "Il casco non risulta connesso.", VoicePriority.HIGH);
          break;
        }

        case 'CANCEL_NAVIGATION':
          handleResetRoute();
          BackgroundNavigation.stop(); // Stop anche da voce
          break;
        case 'RECALCULATE_ROUTE':
          fetchRoute();
          break;
        case 'CHANGE_ROUTE':
          if (intent.avoid?.includes('highways')) {
            Toast.show({ type: 'info', text1: 'Ricalcolo: evita autostrade' });
            fetchRoute();
          }
          break;
        
        // 📞 CHIAMATE
        case 'CALL_CONTACT':
          console.log('📞 Chiamata a:', intent.contactName);
          
          const target = intent.contactName.trim();
          
          // Se è un numero, chiama diretto
          if (target.match(/^[0-9+]+$/)) {
             CallModule.makeCall(target);
             return; 
          }

          // Altrimenti cerca in rubrica
          (async () => {
             const { status } = await Contacts.requestPermissionsAsync();
             if (status === 'granted') {
                const { data } = await Contacts.getContactsAsync({
                   name: target,
                   fields: [Contacts.Fields.PhoneNumbers],
                });

                if (data.length > 0) {
                   const contact = data[0];
                   const number = contact.phoneNumbers?.[0]?.number;
                   
                   if (number) {
                      // Pulisci il numero da spazi o caratteri strani se necessario
                      const cleanNumber = number.replace(/[\s()-]/g, ''); 
                      console.log(`📞 Contatto trovato: ${contact.name} -> ${cleanNumber}`);
                      Toast.show({ type: 'success', text1: 'Chiamata in corso', text2: `${contact.name}` });
                      CallModule.makeCall(cleanNumber);
                   } else {
                     Toast.show({ type: 'error', text1: 'Contatto senza numero', text2: contact.name });
                   }
                } else {
                   Toast.show({ type: 'error', text1: 'Contatto non trovato', text2: target });
                }
             } else {
               Toast.show({ type: 'error', text1: 'Permessi contatti negati' });
             }
          })();
          break;
        case 'ANSWER_CALL':
          console.log('📞 Rispondo alla chiamata...');
          CallModule.answerCall();
          break;
        case 'HANG_UP':
          console.log('📞 Chiudo la chiamata...');
          CallModule.hangUp();
          break;

        // 📻 WEB RADIO & STREAMING
        case 'RADIO_PLAY': {
          console.log('[HomeScreen] Eseguo RADIO_PLAY:', intent.station);
          setShowRadioPanel(true);
          (async () => {
            const station = await radioService.play(intent.station);
            if (station) {
              Toast.show({
                type: 'success',
                text1: '📻 Web Radio',
                text2: `Sintonizzato su ${station.name}`,
              });
              ttsService.speak(`Sintonizzato su ${station.name}`, VoicePriority.HIGH);
            } else {
              ttsService.speak("Impossibile connettersi alla stazione radio.", VoicePriority.HIGH);
            }
          })();
          break;
        }

        case 'RADIO_STOP': {
          console.log('[HomeScreen] Eseguo RADIO_STOP');
          (async () => {
            const st = radioService.getState();
            if (!st.isPlaying) {
              ttsService.speak("La radio è già spenta.", VoicePriority.HIGH);
              return;
            }
            await radioService.stop();
            Toast.show({
              type: 'info',
              text1: '📻 Web Radio',
              text2: 'Riproduzione interrotta',
            });
            ttsService.speak("Radio disattivata.", VoicePriority.HIGH);
          })();
          break;
        }

        case 'RADIO_NEXT': {
          console.log('[HomeScreen] Eseguo RADIO_NEXT');
          setShowRadioPanel(true);
          (async () => {
            const nextStation = await radioService.next();
            Toast.show({
              type: 'success',
              text1: '📻 Web Radio',
              text2: nextStation.name,
            });
            ttsService.speak(`Passo a ${nextStation.name}`, VoicePriority.HIGH);
          })();
          break;
        }

        case 'RADIO_PREV': {
          console.log('[HomeScreen] Eseguo RADIO_PREV');
          setShowRadioPanel(true);
          (async () => {
            const prevStation = await radioService.prev();
            Toast.show({
              type: 'success',
              text1: '📻 Web Radio',
              text2: prevStation.name,
            });
            ttsService.speak(`Passo a ${prevStation.name}`, VoicePriority.HIGH);
          })();
          break;
        }

        case 'RADIO_VOLUME': {
          console.log('[HomeScreen] Eseguo RADIO_VOLUME:', intent.level);
          const delta = intent.level === 'up' ? 0.15 : intent.level === 'down' ? -0.15 : 0;
          (async () => {
            const newVol = await radioService.adjustVolume(delta);
            const pct = Math.round(newVol * 100);
            Toast.show({
              type: 'info',
              text1: '🔊 Volume Radio',
              text2: `${pct}%`,
            });
            const st = radioService.getState();
            if (st.isPlaying) {
              ttsService.speak(`Volume radio ${pct} percento`, VoicePriority.HIGH);
            } else {
              ttsService.speak(`Volume radio impostato al ${pct} percento.`, VoicePriority.HIGH);
            }
          })();
          break;
        }

        case 'RADIO_INFO': {
          console.log('[HomeScreen] Eseguo RADIO_INFO');
          const st = radioService.getState();
          if (st.isPlaying && st.currentStation) {
            ttsService.speak(`Stai ascoltando ${st.currentStation.name}, genere ${st.currentStation.genre}`, VoicePriority.HIGH);
          } else {
            ttsService.speak("La radio non è attiva in questo momento.", VoicePriority.HIGH);
          }
          break;
        }

        // 👥 INTERFONO HANDS-FREE & COMPAGNI DI VIAGGIO
        case 'INTERCOM_ON': {
          console.log('[HomeScreen] Eseguo INTERCOM_ON');
          (async () => {
            await intercomService.turnOn();
            Toast.show({
              type: 'success',
              text1: '🎙️ Interfono Acceso',
              text2: 'Sei in linea hands-free con i compagni',
            });
            ttsService.speak('Interfono acceso. Sei in linea con i tuoi compagni.', VoicePriority.HIGH);
          })();
          break;
        }

        case 'INTERCOM_WITH_FRIEND': {
          console.log('[HomeScreen] Eseguo INTERCOM_WITH_FRIEND:', intent.friendName);
          const target = friendsService.findFriendByName(intent.friendName);
          if (!target) {
            ttsService.speak(`Non ho trovato nessun compagno di nome ${intent.friendName} nella tua lista amici.`, VoicePriority.HIGH);
            break;
          }
          (async () => {
            await intercomService.turnOnWithFriend(target);
            Toast.show({
              type: 'success',
              text1: `🎙️ In linea con ${target.displayName}`,
              text2: 'Canale 1-a-1 hands-free attivo',
            });
            ttsService.speak(`Interfono attivato con ${target.displayName}. Sei in linea diretta.`, VoicePriority.HIGH);
          })();
          break;
        }

        case 'INTERCOM_OFF': {
          console.log('[HomeScreen] Eseguo INTERCOM_OFF');
          (async () => {
            await intercomService.turnOff();
            Toast.show({
              type: 'info',
              text1: '🔇 Interfono Spento',
              text2: 'Microfono chiuso',
            });
            ttsService.speak('Interfono disattivato.', VoicePriority.HIGH);
          })();
          break;
        }

        case 'INTERCOM_REPLAY': {
          console.log('[HomeScreen] Eseguo INTERCOM_REPLAY');
          (async () => {
            const played = await intercomService.replayLastMessage();
            if (!played) {
              ttsService.speak('Nessun messaggio recente da riascoltare.', VoicePriority.HIGH);
            }
          })();
          break;
        }

        case 'INTERCOM_STATUS': {
          console.log('[HomeScreen] Eseguo INTERCOM_STATUS');
          const st = intercomService.getState();
          const activeFriends = friends.filter(f => f.isOnline);
          if (!st.isOn) {
            ttsService.speak(`L'interfono è spento. Ci sono ${activeFriends.length} compagni attivi. Dì Ciao casco accendi interfono per parlare.`, VoicePriority.HIGH);
          } else {
            const names = activeFriends.map(f => f.displayName).join(', ');
            ttsService.speak(`Interfono attivo. Compagni in linea: ${names || 'nessun compagno al momento'}.`, VoicePriority.HIGH);
          }
          break;
        }

        case 'REACH_FRIEND': {
          console.log('[HomeScreen] Eseguo REACH_FRIEND:', intent.friendName);
          const target = friendsService.findFriendByName(intent.friendName);
          if (!target) {
            ttsService.speak(`Non ho trovato nessun compagno con il nome ${intent.friendName} nella tua lista amici.`, VoicePriority.HIGH);
            break;
          }
          if (!target.isLocationShared || !target.location) {
            ttsService.speak(`${target.displayName} non condivide la sua posizione GPS o è offline al momento.`, VoicePriority.HIGH);
            break;
          }
          (async () => {
            const destCoords = `${target.location!.latitude},${target.location!.longitude}`;
            setDestination(target.displayName);
            ttsService.speak(`Calcolo il percorso per raggiungere ${target.displayName}.`, VoicePriority.HIGH);
            await fetchRoute(destCoords);
          })();
          break;
        }

        case 'GET_HELP': {
          setShowVoiceHelp(true);
          ttsService.speak('Ecco la guida con tutti i comandi che puoi chiedere.', VoicePriority.HIGH);
          break;
        }
      }
    },
  });

  // -------------------------------------------------------------
  // LISTENING PANEL ANIMATION
  // -------------------------------------------------------------
  const listeningAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(listeningAnim, {
      toValue: isCommandWindowOpen ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isCommandWindowOpen]);

  const listeningTranslate = listeningAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [50, 0], // Slide up from bottom
  });

  // -------------------------------------------------------------
  // PANEL ANIMATION
  // -------------------------------------------------------------
  const panelAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(panelAnim, {
      toValue: showDemoPanel ? 1 : 0,
      duration: 180,
      useNativeDriver: false, // useNativeDriver: false because of layout properties if any, but checking below it uses translateY only so true could work but keeping consistency
    }).start();
  }, [showDemoPanel]);

  const panelTranslate = panelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  // -------------------------------------------------------------
  // BLE PANEL ANIMATION
  // -------------------------------------------------------------
  const blePanelAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(blePanelAnim, {
      toValue: showBlePanel ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [showBlePanel]);

  const blePanelTranslate = blePanelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
  });

  // -------------------------------------------------------------
  // RADIO PANEL ANIMATION
  // -------------------------------------------------------------
  const radioPanelAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(radioPanelAnim, {
      toValue: showRadioPanel ? 1 : 0,
      useNativeDriver: true,
      tension: 65,
      friction: 9,
    }).start();
  }, [showRadioPanel]);

  const radioPanelTranslate = radioPanelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
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

        {/* 🔹 AMICI / COMPAGNI DI MOTO RADAR ON MAP */}
        {friends.map((friend) => {
          if (!friend.isLocationShared || !friend.location) return null;
          return (
            <Marker
              key={`friend-${friend.uid}`}
              coordinate={{
                latitude: friend.location.latitude,
                longitude: friend.location.longitude,
              }}
              title={friend.displayName}
              description={`Velocità: ${Math.round(friend.location.speedKmh || 0)} km/h`}
              onPress={() => setShowFriendsModal(true)}
            >
              <View style={styles.friendMarkerContainer}>
                <View style={[styles.friendMarkerBubble, { borderColor: friend.intercomActive ? '#10B981' : themeColors.accent }]}>
                  <Feather name="user" size={12} color={themeColors.accent} />
                  <Text style={styles.friendMarkerText} numberOfLines={1}>
                    {friend.displayName.split(' ')[0]}
                  </Text>
                </View>
                <View style={styles.friendMarkerArrow} />
              </View>
            </Marker>
          );
        })}

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


      {/* 🔹 COMANDI VOCALI / GUIDA ASSISTENTE FAB */}
      <TouchableOpacity
        onPress={() => setShowVoiceHelp(true)}
        style={styles.helpFab}
      >
        <Feather name="help-circle" size={22} color={themeColors.accent} />
      </TouchableOpacity>

      {/* 🔹 BLE FAB (SEMPRE VISIBILE) */}
      <TouchableOpacity
        onPress={() => setShowBlePanel(!showBlePanel)}
        style={[styles.bleFab, { backgroundColor: connected ? "#1DB954" : themeColors.card, borderWidth: 2, borderColor: connected ? "#1DB954" : themeColors.accent }]}
      >
        <Feather name="bluetooth" size={22} color={connected ? "white" : themeColors.accent} />
      </TouchableOpacity>

      {/* 🔹 RADIO FAB (SEMPRE VISIBILE, SI ESTENDE AL TAP) */}
      <TouchableOpacity
        onPress={() => setShowRadioPanel(!showRadioPanel)}
        style={[
          styles.radioFab,
          {
            backgroundColor: radioState.isPlaying
              ? (radioState.currentStation?.color || themeColors.accent)
              : (showRadioPanel ? "rgba(0, 210, 255, 0.2)" : themeColors.card),
            borderWidth: 2,
            borderColor: radioState.isPlaying
              ? (radioState.currentStation?.color || themeColors.accent)
              : (showRadioPanel ? themeColors.accent : "rgba(255, 255, 255, 0.15)"),
          },
        ]}
      >
        <Feather
          name="radio"
          size={22}
          color={radioState.isPlaying ? "#0B101B" : (showRadioPanel ? themeColors.accent : themeColors.text)}
        />
        {radioState.isPlaying && (
          <View style={styles.radioFabLiveDot} />
        )}
      </TouchableOpacity>

      {/* 🔹 AMICI & INTERFONO FAB */}
      <TouchableOpacity
        onPress={() => setShowFriendsModal(true)}
        style={[
          styles.friendsFab,
          {
            backgroundColor: intercomState.isOn ? '#10B981' : themeColors.card,
            borderWidth: 2,
            borderColor: intercomState.isOn ? '#10B981' : themeColors.accent,
          },
        ]}
      >
        <Feather
          name="users"
          size={22}
          color={intercomState.isOn ? '#0B101B' : themeColors.accent}
        />
        {intercomState.isOn && (
          <View style={styles.intercomFabLiveDot} />
        )}
      </TouchableOpacity>

      {/* 🔹 BLE PANEL */}
      <Animated.View
        style={[
          styles.blePanel,
          {
            opacity: blePanelAnim,
            transform: [{ translateY: blePanelTranslate }],
          },
        ]}
      >
        <Text style={styles.demoLabel}>Stato Casco</Text>
        
        <View style={styles.bleStatus}>
          <Feather
            name={connected ? "check-circle" : "bluetooth"}
            size={16}
            color={connected ? "#1DB954" : themeColors.accent}
          />
          <Text style={styles.bleStatusText}>
            {connected ? "Connesso" : "Non connesso"}
          </Text>
        </View>

        {!connected && (
          <TouchableOpacity
            onPress={scanAndConnect}
            style={styles.connectButton}
          >
            <Feather name="link" size={16} color="white" />
            <Text style={styles.connectButtonText}>Connetti</Text>
          </TouchableOpacity>
        )}

        {error && (
          <Text style={{ fontSize: 11, color: "#C62828", marginTop: 6 }}>
            {error}
          </Text>
        )}
      </Animated.View>

      {/* 🔹 RESET ROUTE FAB (Visibile solo se c'è una rotta) */}
      {(routeCoords.length > 0 || isNavigating) && (
        <TouchableOpacity
          onPress={handleResetRoute}
          style={styles.resetFab}
        >
          <Feather name="trash-2" size={22} color="white" />
        </TouchableOpacity>
      )}

      {/* 🔹 LISTENING INDICATOR (VISIBILE QUANDO "HEY CASCO" ATTIVO) */}
      {isCommandWindowOpen && (
        <Animated.View
          style={[
            styles.listeningIndicator,
            {
              transform: [{ translateY: listeningTranslate }],
              opacity: listeningAnim,
            },
          ]}
        >
          <View style={styles.listeningPulse} />
          <Feather name="mic" size={24} color="white" />
          <Text style={styles.listeningText}>Ti ascolto...</Text>
        </Animated.View>
      )}

      {/* DEMO PANEL (SOLO SE DEMO_MODE) */}
      {DEMO_MODE && (
        <>
          <TouchableOpacity
            onPress={() => setShowDemoPanel(!showDemoPanel)}
            style={styles.demoFab}
          >
            <Feather name="settings" size={22} color="white" />
          </TouchableOpacity>
          { /* ... resto del pannello demo omesso per brevità se non richiesto, ma mantengo logica esistente se serve ... */ }
          <Animated.View
            style={[
              styles.demoPanel,
              {
                // top: 270, (removed inline override)
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

            <TouchableOpacity
              style={[styles.demoButton, { marginTop: 10, borderColor: '#E74C3C' }]}
              onPress={async () => {
                  if (user?.uid) {
                      await AsyncStorage.removeItem(`hasLaunched_${user.uid}`);
                      setShowOnboarding(true);
                      Toast.show({ type: 'info', text1: 'Intro resettata', text2: 'Al prossimo avvio vedrai lo slider' });
                  }
              }}
            >
              <Text style={[styles.demoButtonText, { color: '#E74C3C' }]}>Reset Intro</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}

      {/* PHONE STATUS ICON */}
      {callStatus > 0 && (
        <View style={[styles.phoneStatusIcon, { backgroundColor: callStatus === 3 ? '#E74C3C' : '#2ECC71' }]}>
             <Feather 
                name={callStatus === 1 ? "phone-incoming" : (callStatus === 2 ? "phone-call" : "phone-off")} 
                size={22} 
                color="white" 
             />
        </View>
      )}

      {/* INSTRUCTION CARD */}
      {showInstructionCard && (
        <InstructionCard instruction={currentInstruction} />
      )}

      {/* 📻 WEB RADIO MINI-PLAYER (ESTESO SOLO SE SELEZIONATO) */}
      {showRadioPanel && (
        <Animated.View
          style={[
            styles.radioWidgetWrapper,
            {
              bottom: isNavigating ? 220 : 126,
              opacity: radioPanelAnim,
              transform: [{ translateY: radioPanelTranslate }],
            },
          ]}
        >
          <RadioPlayerWidget
            accentColor={themeColors.accent}
            onClose={() => setShowRadioPanel(false)}
          />
        </Animated.View>
      )}

      {/* SEND BUTTON */}
      <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
        <Feather name="send" size={20} color="white" />
        <Text style={styles.sendButtonText}>Invia al casco</Text>
      </TouchableOpacity>

      <OnboardingModal visible={showOnboarding} onDone={handleOnboardingDone} />

      {/* MODAL GUIDA COMANDI VOCALI */}
      <VoiceCommandsModal
        visible={showVoiceHelp}
        onClose={() => setShowVoiceHelp(false)}
        accentColor={themeColors.accent}
      />

      {/* MODAL AMICI & RADAR COMPAGNI */}
      <FriendsRadarModal
        visible={showFriendsModal}
        onClose={() => setShowFriendsModal(false)}
        accentColor={themeColors.accent}
        myPosition={currentPosition}
        onNavigateToFriend={handleNavigateToFriend}
      />

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

    phoneStatusIcon: {
      position: "absolute",
      top: 135,
      left: 20,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: "#2ECC71", // Green default
      justifyContent: "center",
      alignItems: "center",
      elevation: 8,
      zIndex: 999 
    },

    demoFab: {
      position: "absolute",
      top: 135,
      left: 20,
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
      left: 20,
      width: 170,
      backgroundColor: colors.card,
      padding: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      elevation: 10,
    },

    helpFab: {
      position: "absolute",
      top: 135,
      left: 82,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.card,
      borderWidth: 2,
      borderColor: colors.accent,
      justifyContent: "center",
      alignItems: "center",
      elevation: 8,
    },

    bleFab: {
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

    radioFab: {
      position: "absolute",
      top: 135,
      right: 82,
      width: 52,
      height: 52,
      borderRadius: 26,
      justifyContent: "center",
      alignItems: "center",
      elevation: 8,
    },

    radioFabLiveDot: {
      position: "absolute",
      top: 9,
      right: 9,
      width: 9,
      height: 9,
      borderRadius: 4.5,
      backgroundColor: "#EF4444",
      borderWidth: 1.5,
      borderColor: "#0B101B",
    },

    friendsFab: {
      position: "absolute",
      top: 135,
      right: 144,
      width: 52,
      height: 52,
      borderRadius: 26,
      justifyContent: "center",
      alignItems: "center",
      elevation: 8,
    },

    intercomFabLiveDot: {
      position: "absolute",
      top: 9,
      right: 9,
      width: 9,
      height: 9,
      borderRadius: 4.5,
      backgroundColor: "#10B981",
      borderWidth: 1.5,
      borderColor: "#0B101B",
    },

    friendMarkerContainer: {
      alignItems: 'center',
    },

    friendMarkerBubble: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(15, 23, 42, 0.94)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      borderWidth: 1.5,
      gap: 4,
      elevation: 5,
    },

    friendMarkerText: {
      color: '#F8FAFC',
      fontSize: 11,
      fontWeight: '700',
      maxWidth: 80,
    },

    friendMarkerArrow: {
      width: 0,
      height: 0,
      borderLeftWidth: 5,
      borderRightWidth: 5,
      borderTopWidth: 5,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: 'rgba(15, 23, 42, 0.94)',
      alignSelf: 'center',
    },

    blePanel: {
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

    resetFab: {
      position: "absolute",
      top: 198,
      right: 20,
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: "#C62828", // Rosso scuro
      justifyContent: "center",
      alignItems: "center",
      elevation: 8,
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

    listeningIndicator: {
        position: "absolute",
        bottom: 110, // Sopra Instruction Card
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.accent,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 30,
        gap: 10,
        elevation: 10,
        zIndex: 999,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
    },
    
    listeningPulse: {
        position: "absolute",
        alignSelf: "center",
        width: "120%",
        height: "140%",
        backgroundColor: colors.accent,
        borderRadius: 40,
        opacity: 0.3,
        zIndex: -1,
    },

    listeningText: {
        color: "white",
        fontSize: 16,
        fontWeight: "bold",
    },

    radioWidgetWrapper: {
      position: "absolute",
      left: 0,
      right: 0,
      zIndex: 900,
    },
  });
