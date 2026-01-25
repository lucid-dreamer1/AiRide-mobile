import { BleManager, Device } from "react-native-ble-plx";
import base64 from "react-native-base64";

class BleService {
  manager: BleManager;
  device: Device | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  setConnectedDevice(device: Device | null) {
    this.device = device;
  }

  getDevice(): Device | null {
    return this.device;
  }

  async sendToHelmet(text: string) {
    if (!this.device) {
      console.log("[BleSingleton] Nessun casco connesso");
      return;
    }

    const SERVICE_UUID = "0000FFE0-0000-1000-8000-00805F9B34FB";
    const CHARACTERISTIC_UUID = "0000FFE1-0000-1000-8000-00805F9B34FB";

    try {
      // Tronca e prepara payload come nel Context originale
      const payload = (text.endsWith("\n") ? text : text + "\n").slice(0, 20);
      const msg = base64.encode(payload);

      await this.device.writeCharacteristicWithoutResponseForService(
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        msg
      );

      console.log("[BleSingleton] 📤 Inviato al casco:", payload);
    } catch (err) {
      console.error("[BleSingleton] Errore invio dati:", err);
      throw err;
    }
  }

  destroy() {
    this.manager.destroy();
  }
}

export const bleService = new BleService();
