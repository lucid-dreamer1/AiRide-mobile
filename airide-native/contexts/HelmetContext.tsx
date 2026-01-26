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
const MOCK_BLE = false;

type HelmetContextType = {
  device: Device | null;
  scanning: boolean;
  connected: boolean;
  error: string | null;
  scanAndConnect: () => Promise<void>;
  sendToHelmet: (text: string) => Promise<void>;
  disconnect: () => Promise<void>;
};

const HelmetContext = createContext<HelmetContextType>({
  device: null,
  scanning: false,
  connected: false,
  error: null,
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
        const fakeDevice: Device = {
          id: "MOCK-DEVICE",
          name: "DSD TECH (MOCK)",
          isConnected: async () => true,
          connect: async () => fakeDevice,
          cancelConnection: async () => {},
          discoverAllServicesAndCharacteristics: async () => fakeDevice,
          writeCharacteristicWithoutResponseForService: async () => {}, 
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
        const targetNames = ["DSD TECH", "DSD-TECH", "HM-10", "68:5E:1C:33:FB:EB"];
        const nameMatches = targetNames.some((n) => name.includes(n));

        const serviceMatches =
          found.serviceUUIDs?.some((s) =>
            ["ffe0", "ffe1"].includes(s.replace(/-/g, "").toLowerCase())
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
    [device, connected]
  );

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
        scanAndConnect,
        sendToHelmet,
        disconnect,
      }}
    >
      {children}
    </HelmetContext.Provider>
  );
}
