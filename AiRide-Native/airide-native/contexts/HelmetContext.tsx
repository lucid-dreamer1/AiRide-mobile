// contexts/HelmetContext.tsx
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

const manager = new BleManager();

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
// PERMESSI ANDROID
// ------------------------------------------------------------
async function requestAndroidPermissions() {
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
      manager.destroy();
    };
  }, []);

  // ------------------------------------------------------------
  // SCAN + CONNECT
  // ------------------------------------------------------------
  const scanAndConnect = useCallback(async () => {
    if (connected) {
      console.log("Già connesso al casco.");
      return;
    }

    const ok = await requestAndroidPermissions();
    if (!ok) {
      setError("Permessi Bluetooth non concessi.");
      return;
    }

    console.log("🔍 Avvio scansione BLE...");
    setScanning(true);
    setError(null);

    return new Promise<void>((resolve) => {
      manager.startDeviceScan(null, null, async (scanError, found) => {
        if (scanError) {
          console.log("Scan error:", scanError);
          setError("Errore scansione BLE");
          setScanning(false);
          manager.stopDeviceScan();
          return resolve();
        }

        if (!found) return;

        const name = found.name ?? ""; // Fix: niente localName

        console.log("Trovato:", name, found.id);

        // Moduli riconosciuti
        const targetNames = [
          "DSD TECH",
          "DSD-TECH",
          "68:5E:1C:33:FB:EB",
          "HM-10",
        ];
        const nameMatches = targetNames.some((n) => name.includes(n));

        // Moduli HM-10 / BH-10 senza nome → match sui servizi
        const serviceMatches =
          found.serviceUUIDs?.some((s) =>
            ["FFE0", "FFE1", "0000ffe0", "0000ffe1"].includes(
              s.replace(/-/g, "").toLowerCase()
            )
          ) || false;

        if (nameMatches || serviceMatches) {
          console.log("🎯 Casco identificato:", name || "(senza nome)");

          manager.stopDeviceScan();

          try {
            const connectedDevice = await found.connect();
            await connectedDevice.discoverAllServicesAndCharacteristics();

            setDevice(connectedDevice);
            setConnected(true);
            setError(null);

            console.log("✅ Connesso al casco!");
          } catch (err) {
            console.log("Errore connessione:", err);
            setError("Errore connessione al casco");
          } finally {
            setScanning(false);
            resolve();
          }
        }
      });

      // Timeout sicurezza 10s
      setTimeout(() => {
        if (scanning) {
          console.log("⏳ Timeout scansione");
          manager.stopDeviceScan();
          setScanning(false);
          if (!connected) setError("Casco non trovato");
          resolve();
        }
      }, 10000);
    });
  }, [connected, scanning]);

  // ------------------------------------------------------------
  // SEND BLE
  // ------------------------------------------------------------
  const sendToHelmet = useCallback(
  async (text: string) => {
    if (!device || !connected) {
      console.log("❌ Nessun casco connesso, impossibile inviare:", text);
      return;
    }

    const SERVICE_UUID = "0000FFE0-0000-1000-8000-00805F9B34FB";
    const CHARACTERISTIC_UUID = "0000FFE1-0000-1000-8000-00805F9B34FB";

    try {
      // 🔥 AGGIUNGE IL NEWLINE AUTOMATICAMENTE
      const payload = text.endsWith("\n") ? text : text + "\n";

      // 🔥 LIMITE HM-10: max 20 bytes → tronca tutto il resto
      const safePayload = payload.slice(0, 20);

      const msg = base64.encode(safePayload);

      await device.writeCharacteristicWithoutResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        msg
      );

      console.log("📤 Inviato al casco:", safePayload);
    } catch (err) {
      console.log("Errore invio BLE:", err);
      setError("Errore invio dati");
    }
  },
  [device, connected]
);

  // ------------------------------------------------------------
  // DISCONNECT
  // ------------------------------------------------------------
  const disconnect = useCallback(async () => {
    try {
      if (device) await device.cancelConnection();
    } catch (e) {
      console.log("Errore disconnessione:", e);
    } finally {
      setDevice(null);
      setConnected(false);
    }
  }, [device]);

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
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
