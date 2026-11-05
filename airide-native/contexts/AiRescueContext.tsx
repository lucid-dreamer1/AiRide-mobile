// contexts/AiRescueContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Accelerometer } from "expo-sensors";
import * as Location from "expo-location";
import { useAuth } from "../services/useAuth";
import { firebaseFirestore } from "../services/firebaseConfig";
import { ttsService } from "../services/TTSService";
import { VoicePriority } from "../types/voice";
import Feather from "@expo/vector-icons/Feather";
import { sendEmergencyCall } from "../services/api";
import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import { BackgroundNavigation } from "../services/BackgroundNavigation";
import { bleService } from "../services/BleSingleton";

type AiRescueContextType = {
  isCrashDetected: boolean;
};

const AiRescueContext = createContext<AiRescueContextType>({
  isCrashDetected: false,
});

export const AiRescueProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [contact, setContact] = useState("");
  const [isCrashDetected, setIsCrashDetected] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [isSending, setIsSending] = useState(false);

  const countdownTimer = useRef<NodeJS.Timeout | null>(null);
  const sttListener = useRef<any>(null);
  // Ref (non stato) per evitare closure obsolete nei listener e doppi invii
  const sendingRef = useRef(false);

  // Fetch settings from Firebase
  useEffect(() => {
    if (!user) return;
    const unsub = firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .onSnapshot(
        (doc) => {
          if (!doc) return;
          const data = doc.data();
          if (data && data.settings) {
            setEnabled(data.settings.aiRescueEnabled || false);
            setContact(data.settings.emergencyContact || "");
          }
        },
        (err) => {
          console.warn("AiRescueContext Snapshot Error:", err.message);
        }
      );
    return unsub;
  }, [user]);

  // Accelerometer logic
  useEffect(() => {
    let subscription: any;

    if (enabled) {
      Accelerometer.setUpdateInterval(100);
      subscription = Accelerometer.addListener((accelerometerData) => {
        // If already in crash state, ignore
        if (isCrashDetected) return;

        const { x, y, z } = accelerometerData;
        const totalForce = Math.sqrt(x * x + y * y + z * z);

        // 4G threshold
        if (totalForce > 4.0) {
          handleCrash();
        }
      });
    }

    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [enabled, isCrashDetected]);

  const handleCrash = () => {
    sendingRef.current = false;
    setIsCrashDetected(true);
    setCountdown(30);
    setIsSending(false);
    bleService.sendHudCommand("SOS:30").catch(() => {});
    
    // TTS
    ttsService.speak("Incidente rilevato. Stai bene?", VoicePriority.CRITICAL);

    // Attiviamo STT in modo sicuro DOPO che la voce ha finito di parlare (ascoltando l'evento)
    // Se Vosk ascolta mentre il telefono parla, il microfono impazzisce e genera il crash __next_prime
    let sttActivated = false;
    const activateSTT = () => {
        if (sttActivated) return;
        sttActivated = true;
        ttsListener.remove();
        BackgroundNavigation.enableEmergencySTT();
        if (sttListener.current) sttListener.current.remove();
        sttListener.current = DeviceEventEmitter.addListener('AiRescue_Emergency_Cancel', () => {
            handleCancel();
        });
    };

    const ttsListener = DeviceEventEmitter.addListener('TTS_DONE', activateSTT);

    // Timeout di sicurezza massimo (6 secondi) in caso di blocco del TTS
    setTimeout(activateSTT, 6000);

    // Start countdown (l'updater deve restare PURO: niente side effect qui dentro)
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
  };

  // Quando il countdown arriva a 0 → invio emergenza (fuori dal render)
  // Inoltre mantiene sincronizzato il countdown sull'HUD del casco ogni 5s
  useEffect(() => {
    if (!isCrashDetected) return;

    if (countdown > 0 && countdown < 30 && countdown % 5 === 0) {
      bleService.sendHudCommand(`SOS:${countdown}`).catch(() => {});
    }

    if (countdown !== 0 || sendingRef.current) return;

    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
    sendingRef.current = true;
    setIsSending(true);
    bleService.sendHudCommand("SOS:SENT").catch(() => {});
    sendEmergencyMessage();
  }, [countdown, isCrashDetected]);

  const handleCancel = () => {
    if (sendingRef.current) return; // Se ha già mandato il messaggio, ignora il click ritardato
    
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
    }
    
    if (sttListener.current) {
        sttListener.current.remove();
        sttListener.current = null;
    }
    BackgroundNavigation.disableEmergencySTT();
    // Invia conferma di annullamento falso positivo all'HUD del casco
    bleService.sendHudCommand("SOS:OK").catch(() => {});
    
    ttsService.speak("Allarme annullato. Riprendi il viaggio in sicurezza.", VoicePriority.HIGH);
    setIsCrashDetected(false);
  };

  const sendEmergencyMessage = async () => {
    try {
      if (sttListener.current) {
          sttListener.current.remove();
          sttListener.current = null;
      }
      BackgroundNavigation.disableEmergencySTT();

      ttsService.speak("Nessuna risposta. Invio messaggio di emergenza.", VoicePriority.CRITICAL);
      let location = await Location.getCurrentPositionAsync({});
      
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.SEND_SMS,
          {
            title: 'Permesso SMS Emergenza',
            message: 'AiRide ha bisogno del permesso per inviare SMS in caso di incidente.',
            buttonNeutral: 'Chiedi dopo',
            buttonNegative: 'Annulla',
            buttonPositive: 'OK',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          try {
            const message = `AiRide - Emergenza: Incidente rilevato. Sono qui: https://maps.google.com/?q=${location.coords.latitude},${location.coords.longitude}`;
            await NativeModules.DirectSms.sendDirectSms(contact || "unknown", message);
            Alert.alert("AiRescue", `Messaggio di emergenza inviato via SMS a ${contact}`);
          } catch (smsError) {
            console.warn("Invio SMS nativo fallito, fallback su Twilio:", smsError);
            await sendEmergencyCall(
              user?.uid || "unknown", 
              location.coords.latitude, 
              location.coords.longitude, 
              contact || "unknown"
            );
            Alert.alert("AiRescue", `Messaggio di emergenza inviato via Cloud a ${contact}`);
          }
        } else {
          console.log("Permesso SMS negato, utilizzo fallback su Twilio");
          await sendEmergencyCall(
            user?.uid || "unknown", 
            location.coords.latitude, 
            location.coords.longitude, 
            contact || "unknown"
          );
          Alert.alert("AiRescue", `Messaggio di emergenza inviato via Cloud a ${contact}`);
        }
      } else {
        // Fallback for iOS
        await sendEmergencyCall(
          user?.uid || "unknown", 
          location.coords.latitude, 
          location.coords.longitude, 
          contact || "unknown"
        );
        Alert.alert("AiRescue", `Messaggio di emergenza inviato via Cloud a ${contact}`);
      }
    } catch (e) {
      console.error("Emergency message failed", e);
      Alert.alert("Errore", "Impossibile inviare il messaggio di emergenza. Controlla la connessione.");
    } finally {
      sendingRef.current = false;
      setIsCrashDetected(false);
      setIsSending(false);
    }
  };

  return (
    <AiRescueContext.Provider value={{ isCrashDetected }}>
      {children}
      {isCrashDetected && (
        <View style={styles.bannerWrapper} pointerEvents="box-none">
          <View style={styles.bannerCard}>
            <View style={styles.timerBadge}>
              <Text style={styles.timer}>{countdown}s</Text>
            </View>

            <View style={styles.infoColumn}>
              <View style={styles.headerRow}>
                <Feather name="alert-triangle" size={14} color="#E85A2A" />
                <Text style={styles.title} numberOfLines={1}>
                  AIRESCUE • URTO RILEVATO
                </Text>
              </View>
              <Text style={styles.subtitle} numberOfLines={1}>
                {isSending
                  ? "Invio SOS in corso..."
                  : `SOS a ${contact || "contatto"} • Dì "STO BENE"`}
              </Text>
            </View>

            {!isSending && (
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelText}>STO BENE</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </AiRescueContext.Provider>
  );
};

export const useAiRescue = () => useContext(AiRescueContext);

const styles = StyleSheet.create({
  bannerWrapper: {
    position: "absolute",
    top: 118,
    left: 14,
    right: 14,
    zIndex: 9999,
    elevation: 20,
  },
  bannerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 20, 32, 0.96)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#E85A2A",
    gap: 10,
    shadowColor: "#E85A2A",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  timerBadge: {
    minWidth: 48,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(232, 90, 42, 0.18)",
    borderWidth: 1,
    borderColor: "#E85A2A",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  timer: {
    fontSize: 18,
    fontWeight: "900",
    color: "#E85A2A",
  },
  infoColumn: {
    flex: 1,
    justifyContent: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 11,
    color: "#CBD5E1",
    fontWeight: "600",
  },
  cancelButton: {
    backgroundColor: "#E85A2A",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  cancelText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
});
