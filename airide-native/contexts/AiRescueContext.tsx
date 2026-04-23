// contexts/AiRescueContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, Alert } from "react-native";
import { Accelerometer } from "expo-sensors";
import * as Location from "expo-location";
import { useAuth } from "../services/useAuth";
import { firebaseFirestore } from "../services/firebaseConfig";
import { ttsService } from "../services/TTSService";
import { VoicePriority } from "../types/voice";
import Feather from "@expo/vector-icons/Feather";
import { sendEmergencyCall } from "../services/api";
import { DeviceEventEmitter } from "react-native";
import { BackgroundNavigation } from "../services/BackgroundNavigation";

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

  // Fetch settings from Firebase
  useEffect(() => {
    if (!user) return;
    const unsub = firebaseFirestore
      .collection("users")
      .doc(user.uid)
      .onSnapshot((doc) => {
        const data = doc.data();
        if (data && data.settings) {
          setEnabled(data.settings.aiRescueEnabled || false);
          setContact(data.settings.emergencyContact || "");
        }
      });
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
    setIsCrashDetected(true);
    setCountdown(30);
    setIsSending(false);
    
    // TTS
    ttsService.speak("Incidente rilevato. Stai bene?", VoicePriority.CRITICAL);

    // Attiviamo STT in modo sicuro tramite BackgroundNavigation
    BackgroundNavigation.enableEmergencySTT();
    if (sttListener.current) sttListener.current.remove();
    sttListener.current = DeviceEventEmitter.addListener('AiRescue_Emergency_Cancel', () => {
        handleCancel();
    });

    // Start countdown
    countdownTimer.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer.current as NodeJS.Timeout);
          setIsSending(true);
          sendEmergencyMessage();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCancel = () => {
    if (isSending) return; // Se ha già mandato il messaggio, ignora il click ritardato
    
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
    }
    
    if (sttListener.current) {
        sttListener.current.remove();
        sttListener.current = null;
    }
    BackgroundNavigation.disableEmergencySTT();
    
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
      
      await sendEmergencyCall(
        user?.uid || "unknown", 
        location.coords.latitude, 
        location.coords.longitude, 
        contact || "unknown"
      );
      
      Alert.alert("AiRescue", `Messaggio di emergenza inviato al ${contact}`);
    } catch (e) {
      console.error("Emergency message failed", e);
      Alert.alert("Errore", "Impossibile inviare il messaggio di emergenza. Controlla la connessione.");
    } finally {
      setIsCrashDetected(false);
      setIsSending(false);
    }
  };

  return (
    <AiRescueContext.Provider value={{ isCrashDetected }}>
      {children}
      <Modal visible={isCrashDetected} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Feather name="alert-triangle" size={80} color="#E85A2A" style={{ marginBottom: 20 }} />
            <Text style={styles.title}>INCIDENTE RILEVATO</Text>
            <Text style={styles.subtitle}>Invio messaggio di emergenza a:</Text>
            <Text style={styles.contact}>{contact || "Nessun contatto impostato!"}</Text>
            
            <Text style={styles.timer}>{countdown}</Text>
            
            {!isSending ? (
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                <Text style={styles.cancelText}>STO BENE</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.subtitle}>Invio in corso...</Text>
            )}
          </View>
        </View>
      </Modal>
    </AiRescueContext.Provider>
  );
};

export const useAiRescue = () => useContext(AiRescueContext);

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "#111",
    padding: 30,
    borderRadius: 20,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E85A2A"
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 10,
    textAlign: "center"
  },
  subtitle: {
    fontSize: 16,
    color: "#aaa",
    marginBottom: 5,
    textAlign: "center"
  },
  contact: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#E85A2A",
    marginBottom: 30,
    textAlign: "center"
  },
  timer: {
    fontSize: 72,
    fontWeight: "bold",
    color: "#E85A2A",
    marginBottom: 40,
  },
  cancelButton: {
    backgroundColor: "#E85A2A",
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderRadius: 15,
    width: "100%",
  },
  cancelText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  }
});
