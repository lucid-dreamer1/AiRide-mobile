import { BleManager, Device } from "react-native-ble-plx";
import base64 from "react-native-base64";

class BleService {
  manager: BleManager;
  device: Device | null = null;
  private sendChain: Promise<void> = Promise.resolve();

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
    // Accoda gli invii BLE per evitare che due messaggi concomitanti mescolino i rispettivi chunk da 20 byte
    this.sendChain = this.sendChain
      .then(() => this._sendRaw(text))
      .catch((err) => {
        console.warn("[BleSingleton] Errore coda invio:", err);
      });
    return this.sendChain;
  }

  /**
   * Invia un comando HUD esteso (prefisso '$', separatore ':')
   * I firmware precedenti (v1/v2 base) ignorano automaticamente i pacchetti privi di '|'
   */
  async sendHudCommand(command: string) {
    const formatted = command.startsWith("$") ? command : `$${command}`;
    return this.sendToHelmet(formatted);
  }

  private async _sendRaw(text: string) {
    if (!this.device) {
      return;
    }

    // UUID allineati con l'ESP32
    const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    const CHARACTERISTIC_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

    try {
      // Verifica rapida dello stato di connessione se disponibile
      const connected = await this.device.isConnected().catch(() => false);
      if (!connected) {
        console.warn("[BleSingleton] Dispositivo disconnesso, annullo invio");
        this.device = null;
        return;
      }

      // Assicurati che il testo finisca con un a-capo per forzare la chiusura
      const fullText = text.endsWith("\n") ? text : text + "\n";

      // Continuiamo a usare la frammentazione a 20 byte che è universale
      // ed estremamente affidabile per evitare drop di pacchetti BLE.
      for (let i = 0; i < fullText.length; i += 20) {
        const chunk = fullText.substring(i, i + 20);
        const msg = base64.encode(chunk);

        await this.device.writeCharacteristicWithoutResponseForService(
          SERVICE_UUID,
          CHARACTERISTIC_RX_UUID,
          msg
        );

        // Piccolo delay (15-20ms) per evitare l'ingorgo dello stack BLE
        await new Promise((r) => setTimeout(r, 20));
      }

      console.log("[BleSingleton] 📤 Inviato al casco:", text.trim());
    } catch (err: any) {
      console.warn(
        "[BleSingleton] Errore invio dati (dispositivo disconnesso?):",
        err?.message ?? err
      );
      this.device = null;
    }
  }

  destroy() {
    this.manager.destroy();
  }
}

export const bleService = new BleService();