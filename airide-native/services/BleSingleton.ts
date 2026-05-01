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
      // Assicurati che il testo finisca con un a-capo per l'Arduino
      const fullText = text.endsWith("\n") ? text : text + "\n";
      
      // Il BLE standard accetta massimo 20 byte per pacchetto.
      // Dividiamo la stringa in chunk da 20 caratteri e li inviamo in sequenza.
      // In questo modo l'HM-10 li ricompone in seriale senza perdere dati né il \n finale.
      for (let i = 0; i < fullText.length; i += 20) {
        const chunk = fullText.substring(i, i + 20);
        const msg = base64.encode(chunk);

        await this.device.writeCharacteristicWithoutResponseForService(
          SERVICE_UUID,
          CHARACTERISTIC_UUID,
          msg
        );
        
        // Piccolo delay per evitare che lo stack BLE o il modulo hardware scartino i pacchetti veloci
        await new Promise(r => setTimeout(r, 20));
      }

      console.log("[BleSingleton] 📤 Inviato al casco:", text);
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
