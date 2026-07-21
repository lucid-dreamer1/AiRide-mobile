// ------------------------------------------------------------
// HelmetContext.tsx - Versione con MOCK integrato
// ------------------------------------------------------------
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { BleManager, Device } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import base64 from "react-native-base64";

import { bleService } from "../services/BleSingleton";

// const manager = new BleManager(); // Rimosso: usa Singleton

// 🟦 ATTIVA/DISATTIVA MOCK
const MOCK_BLE = true;

type HelmetContextType = {
  device: Device | null;
  scanning: boolean;
  connected: boolean;
  error: string | null;
  /** True durante un aggiornamento OTA: blocca l'invio di dati di navigazione */
  isOtaInProgress: boolean;
  setOtaInProgress: (v: boolean) => void;
  scanAndConnect: () => Promise<void>;
  sendToHelmet: (text: string) => Promise<void>;
  disconnect: () => Promise<void>;
};

const HelmetContext = createContext<HelmetContextType>({
  device: null,
  scanning: false,
  connected: false,
  error: null,
  isOtaInProgress: false,
  setOtaInProgress: () => {},
  scanAndConnect: async () => {},
  sendToHelmet: async () => {},
  disconnect: async () => {},
});

export const useHelmet = () => useContext(HelmetContext);

// ------------------------------------------------------------
// PERMESSI ANDROID (solo se MOCK_BLE = false)
// ------------------------------------------------------------
async function requestAndroidPermissions() {
  if (MOCK_BLE) return true;

  if (Platform.OS !== "android") return true;
  if (Platform.Version < 23) return true;

  try {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      "android.permission.BLUETOOTH_SCAN" as any,
      "android.permission.BLUETOOTH_CONNECT" as any,
    ]);

    const allGranted = Object.values(res).every(
      (v) => v === PermissionsAndroid.RESULTS.GRANTED
    );

    return allGranted;
  } catch (e) {
    console.log("BLE perm error", e);
    return false;
  }
}

// ------------------------------------------------------------
// PROVIDER
// ------------------------------------------------------------
export function HelmetProvider({ children }: { children: React.ReactNode }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOtaInProgress, setOtaInProgress] = useState(false);

  useEffect(() => {
    return () => {
      // Non distruggiamo il manager qui perché è gestito dal Singleton e serve al background
      // if (!MOCK_BLE) bleService.manager.destroy(); 
    };
  }, []);

  // ------------------------------------------------------------
  // SCAN & CONNECT (con mock)
  // ------------------------------------------------------------
  const scanAndConnect = useCallback(async () => {
    // 🟦 MOCK BLE — Simulazione completa
    if (MOCK_BLE) {
      console.log("🟦 MOCK: Avvio scansione finta (Conn Only)...");
      setScanning(true);
      setError(null);

      setTimeout(() => {
        let currentListener: ((error: any, characteristic: any) => void) | null = null;
        let bytesReceived = 0;
        let expectedBytes = 0;

        const fakeDevice: Device = {
          id: "MOCK-DEVICE",
          name: "AiRide Helmet (MOCK)",
          isConnected: async () => true,
          connect: async () => fakeDevice,
          cancelConnection: async () => {
            console.log("🟦 MOCK: Casco disconnesso");
          },
          discoverAllServicesAndCharacteristics: async () => fakeDevice,
          
          requestMTU: async (mtu: number) => {
            console.log(`🟦 MOCK: Richiesto MTU ${mtu}, concedo 256`);
            return { mtu: 256 };
          },

          monitorCharacteristicForService: (serviceUUID: string, characteristicUUID: string, listener: any) => {
            console.log(`🟦 MOCK: Registrato monitor per ${characteristicUUID}`);
            currentListener = listener;
            return {
              remove: () => {
                console.log(`🟦 MOCK: Rimosso monitor per ${characteristicUUID}`);
                currentListener = null;
              }
            };
          },

          writeCharacteristicWithResponseForService: async (serviceUUID: string, characteristicUUID: string, base64Value: string) => {
            try {
              const decoded = base64.decode(base64Value);
              const bytes = Array.from(decoded as string).map(c => c.charCodeAt(0));
              const opcode = bytes[0];
              console.log(`🟦 MOCK: Ricevuto comando Control OTA, Opcode: 0x${opcode.toString(16).toUpperCase()}`);

              if (opcode === 0x01) { // CMD_START
                expectedBytes = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24);
                bytesReceived = 0;
                console.log(`🟦 MOCK: Inizializzato upload per ${expectedBytes} byte`);
                
                // Simula OK_START dopo 400ms
                setTimeout(() => {
                  if (currentListener) {
                    const responseB64 = base64.encode(String.fromCharCode(0x11)); // RESP_OK_START
                    currentListener(null, { value: responseB64 });
                  }
                }, 400);
              } 
              else if (opcode === 0x02) { // CMD_END
                console.log(`🟦 MOCK: Ricevuto CMD_END, avvio verifica...`);
                
                // Simula SUCCESS dopo 800ms
                setTimeout(() => {
                  if (currentListener) {
                    const responseB64 = base64.encode(String.fromCharCode(0x13)); // RESP_SUCCESS
                    currentListener(null, { value: responseB64 });
                  }
                }, 800);
              }
              else if (opcode === 0x03) { // CMD_ABORT
                console.log(`🟦 MOCK: Ricevuto CMD_ABORT`);
                bytesReceived = 0;
              }
            } catch (e) {
              console.error("Errore decoding mock write", e);
            }
            return {} as any;
          },

          writeCharacteristicWithoutResponseForService: async (serviceUUID: string, characteristicUUID: string, base64Value: string) => {
            try {
              const decoded = base64.decode(base64Value);
              bytesReceived += decoded.length;

              // Invia un aggiornamento di PROGRESS finto ogni 15% circa
              const progressThreshold = Math.floor(expectedBytes / 6);
              if (progressThreshold > 0 && bytesReceived % progressThreshold < decoded.length) {
                if (currentListener) {
                  const payload = String.fromCharCode(
                    0x12, // RESP_PROGRESS
                    (bytesReceived & 0xFF),
                    ((bytesReceived >> 8) & 0xFF),
                    ((bytesReceived >> 16) & 0xFF),
                    ((bytesReceived >> 24) & 0xFF)
                  );
                  currentListener(null, { value: base64.encode(payload) });
                }
              }
            } catch (e) {}
            return {} as any;
          },
        } as any;

        setDevice(fakeDevice);
        setConnected(true);
        bleService.setConnectedDevice(fakeDevice); // SYNC Singleton
        setScanning(false);
        console.log("🟦 MOCK: Casco finto connesso (Ready for BG Service)!");
      }, 1200);

      return;
    }

    // 🟥 CODICE REALE (attivo solo se MOCK_BLE = false)
    const ok = await requestAndroidPermissions();
    if (!ok) {
      setError("Permessi Bluetooth non concessi.");
      return;
    }

    try {
      const state = await bleService.manager.state();
      if (state !== "PoweredOn") {
        setError(`Bluetooth non attivo (Stato: ${state}). Attivalo e riprova.`);
        return;
      }
    } catch (e) {
      console.log("Errore controllo stato BLE:", e);
      // Proceed anyway or handle error? proceeding might fail scan, but let's try
    }

    console.log("🔍 Avvio scansione BLE reale…");
    setScanning(true);
    setError(null);

    return new Promise<void>((resolve) => {
      bleService.manager.startDeviceScan(null, null, async (scanError, found) => {
        if (scanError) {
          console.error("BLE Scan Error:", scanError);
          setError(`Errore scansione BLE: ${scanError.message} (Code: ${scanError.errorCode})`);
          setScanning(false);
          bleService.manager.stopDeviceScan();
          return resolve();
        }

        if (!found) return;

        const name = found.name ?? "";
        // ESP32-S3 con firmware AiRide
        const targetNames = ["AiRide Helmet", "AiRide", "ESP32"];
        const nameMatches = targetNames.some((n) => name.includes(n));

        // Nordic UART Service UUID usato dall'ESP32
        const NUS_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
        const serviceMatches =
          found.serviceUUIDs?.some((s) =>
            s.toLowerCase() === NUS_UUID
          ) || false;

        if (nameMatches || serviceMatches) {
          console.log("🎯 Dispositivo identificato:", name);

          bleService.manager.stopDeviceScan();

          try {
            const connectedDevice = await found.connect();
            await connectedDevice.discoverAllServicesAndCharacteristics();

            setDevice(connectedDevice);
            bleService.setConnectedDevice(connectedDevice); // <--- Sync Singleton
            setConnected(true);
            setError(null);

            console.log("✅ Connesso al casco reale!");

          } catch (err) {
            setError("Errore connessione al casco");
          } finally {
            setScanning(false);
            resolve();
          }
        }
      });

      setTimeout(() => {
        if (scanning) {
          bleService.manager.stopDeviceScan();
          setScanning(false);
          if (!connected) setError("Casco non trovato");
          resolve();
        }
      }, 10000);
    });
  }, [connected, scanning]);

  // ------------------------------------------------------------
  // SEND BLE (mock incluso)
  // ------------------------------------------------------------
  const sendToHelmet = useCallback(
    async (text: string) => {
      if (MOCK_BLE) {
        // console.log("🟦 MOCK SEND:", text); // DISABILITATO: Gestito dal Background Service
        return;
      }

      // ⚠️ OTA in corso: scarta silenziosamente i dati di navigazione
      if (isOtaInProgress) {
        console.log("[HelmetContext] ⚠️ OTA in corso, invio navigazione sospeso");
        return;
      }

      if (!device || !connected) {
        console.log("❌ Nessun casco connesso");
        return;
      }

      try {
        await bleService.sendToHelmet(text);
      } catch (err) {
        setError("Errore invio dati");
      }
    },
    [device, connected, isOtaInProgress]
  );

  // Sincronizza stato OTA col background service
  useEffect(() => {
    import('react-native').then(({ DeviceEventEmitter }) => {
      DeviceEventEmitter.emit('OtaStateChanged', isOtaInProgress);
    });
  }, [isOtaInProgress]);

  // ------------------------------------------------------------
  // DISCONNECT (mock incluso)
  // ------------------------------------------------------------
  const disconnect = useCallback(async () => {
    if (MOCK_BLE) {
      console.log("🟦 MOCK: Disconnessione casco finto");
      setDevice(null);
      bleService.setConnectedDevice(null);
      setConnected(false);
      return;
    }

    try {
      if (device) await device.cancelConnection();
    } catch (e) {
      console.log("Errore disconnessione:", e);
    } finally {
      setDevice(null);
      bleService.setConnectedDevice(null);
      setConnected(false);
    }
  }, [device]);

  return (
    <HelmetContext.Provider
      value={{
        device,
        scanning,
        connected,
        error,
        isOtaInProgress,
        setOtaInProgress,
        scanAndConnect,
        sendToHelmet,
        disconnect,
      }}
    >
      {children}
    </HelmetContext.Provider>
  );
}
