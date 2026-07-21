// ------------------------------------------------------------
// BleOtaService.ts
// Gestisce il trasferimento firmware OTA via BLE verso ESP32.
// Protocollo binario su due characteristic:
//   - Control (Write + Notify): comandi e stati
//   - Data    (Write Without Response): streaming chunk
// ------------------------------------------------------------

import { Device, Characteristic } from "react-native-ble-plx";
import base64 from "react-native-base64";

// ────────────────────────────────────────────────────────────
// UUID — devono combaciare con il firmware ESP32
// ────────────────────────────────────────────────────────────
export const OTA_SERVICE_UUID  = "e2697de0-5fae-4a6e-9b3d-21c7f3e4a8b2";
export const OTA_CONTROL_UUID  = "e2697de1-5fae-4a6e-9b3d-21c7f3e4a8b2";
export const OTA_DATA_UUID     = "e2697de2-5fae-4a6e-9b3d-21c7f3e4a8b2";

// ────────────────────────────────────────────────────────────
// Opcode protocollo
// ────────────────────────────────────────────────────────────
const CMD_START = 0x01;
const CMD_END   = 0x02;
const CMD_ABORT = 0x03;

export const OTA_RESP = {
  READY:    0x10,
  OK_START: 0x11,
  PROGRESS: 0x12,
  SUCCESS:  0x13,
  ERROR:    0x14,
} as const;

// ────────────────────────────────────────────────────────────
// Tipi pubblici
// ────────────────────────────────────────────────────────────
export type OtaProgressCallback = (bytesSent: number, totalBytes: number) => void;
export type OtaNotifyCallback   = (opcode: number, payload: number[]) => void;

export interface OtaUpdateOptions {
  onProgress?: OtaProgressCallback;
  onNotify?:   OtaNotifyCallback;
  /** Chunk size override (default: calcolato da MTU negoziato) */
  chunkSizeOverride?: number;
  /** Delay ms tra chunk (default: adattivo) */
  chunkDelayMs?: number;
}

// ────────────────────────────────────────────────────────────
// Helper: converte Uint8Array → base64 per react-native-ble-plx
// ────────────────────────────────────────────────────────────
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64.encode(binary);
}

// ────────────────────────────────────────────────────────────
// Helper: base64 → byte array
// ────────────────────────────────────────────────────────────
function base64ToBytes(b64: string): number[] {
  const decoded = base64.decode(b64);
  const bytes: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    bytes.push(decoded.charCodeAt(i));
  }
  return bytes;
}

// ────────────────────────────────────────────────────────────
// Helper: uint32 little-endian → 4 byte
// ────────────────────────────────────────────────────────────
function uint32ToLeBytes(value: number): [number, number, number, number] {
  return [
    (value >>>  0) & 0xFF,
    (value >>>  8) & 0xFF,
    (value >>> 16) & 0xFF,
    (value >>> 24) & 0xFF,
  ];
}

// ────────────────────────────────────────────────────────────
// Helper: CRC32 (ISO 3309 / zlib)
// ────────────────────────────────────────────────────────────
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ────────────────────────────────────────────────────────────
// BleOtaService
// ────────────────────────────────────────────────────────────
class BleOtaService {
  private abortFlag = false;
  private notifySubscription: { remove: () => void } | null = null;

  // ── Calcola CRC32 del firmware ─────────────────────────────
  computeCrc32(data: Uint8Array): number {
    return crc32(data);
  }

  // ── Avvia aggiornamento OTA ────────────────────────────────
  async startOtaUpdate(
    device: Device,
    firmwareBin: Uint8Array,
    options: OtaUpdateOptions = {}
  ): Promise<void> {
    this.abortFlag = false;

    const {
      onProgress,
      onNotify,
      chunkSizeOverride,
      chunkDelayMs,
    } = options;

    // 1. Negozia MTU più alto possibile
    let mtu = 23; // default BLE 4.0
    try {
      const negotiated = await device.requestMTU(517);
      mtu = negotiated.mtu ?? 185;
      console.log(`[BleOtaService] MTU negoziato: ${mtu}`);
    } catch (e) {
      console.warn("[BleOtaService] MTU negotiation fallita, uso default 23:", e);
    }

    // ATT overhead = 3 byte; margine sicurezza = 3 byte extra
    const chunkSize = chunkSizeOverride ?? Math.max(20, mtu - 6);
    const delayMs   = chunkDelayMs ?? (mtu >= 200 ? 5 : 20);

    console.log(`[BleOtaService] Chunk size: ${chunkSize}, delay: ${delayMs}ms`);

    const totalBytes = firmwareBin.length;

    // 2. Sottoscrivi alle notify della Control characteristic
    await this._subscribeToControl(device, onNotify);

    try {
      // 3. Invia CMD_START con size firmware (uint32 LE)
      const sizeBytes = uint32ToLeBytes(totalBytes);
      await this._writeControl(device, [CMD_START, ...sizeBytes]);
      console.log(`[BleOtaService] CMD_START inviato (${totalBytes} bytes)`);

      // Attende OK_START dalla notify (timeout 10s)
      await this._waitForNotify(device, OTA_RESP.OK_START, 10000);
      console.log("[BleOtaService] OK_START ricevuto, inizio streaming...");

      // 4. Streaming chunk sulla Data characteristic
      let bytesSent = 0;
      let chunkIndex = 0;

      while (bytesSent < totalBytes) {
        if (this.abortFlag) {
          await this._writeControl(device, [CMD_ABORT]).catch(() => {});
          throw new Error("OTA annullato dall'utente");
        }

        const end   = Math.min(bytesSent + chunkSize, totalBytes);
        const chunk = firmwareBin.slice(bytesSent, end);

        await this._writeData(device, chunk);

        bytesSent += chunk.length;
        chunkIndex++;

        onProgress?.(bytesSent, totalBytes);

        // Delay backpressure tra chunk
        await new Promise(r => setTimeout(r, delayMs));
      }

      console.log("[BleOtaService] Tutti i byte inviati, invio CMD_END...");

      // 5. Invia CMD_END
      await this._writeControl(device, [CMD_END]);

      // 6. Attende SUCCESS (timeout 30s — ESP32 ha bisogno di tempo per verificare)
      await this._waitForNotify(device, OTA_RESP.SUCCESS, 30000);
      console.log("[BleOtaService] ✅ OTA completato con successo!");

    } finally {
      // Pulisci subscription — il device potrebbe essersi già disconnesso
      // (l'ESP32 si riavvia dopo il successo), quindi ignoriamo errori
      try {
        this._unsubscribeFromControl();
      } catch (cleanupErr) {
        console.log("[BleOtaService] Cleanup post-OTA (ignorabile):", cleanupErr);
      }
    }
  }

  // ── Abort (chiamabile dall'esterno) ───────────────────────
  abort() {
    console.log("[BleOtaService] Abort richiesto");
    this.abortFlag = true;
  }

  // ── Scrivi sulla Control characteristic ───────────────────
  private async _writeControl(device: Device, bytes: number[]): Promise<void> {
    const data = new Uint8Array(bytes);
    const b64  = uint8ArrayToBase64(data);
    await device.writeCharacteristicWithResponseForService(
      OTA_SERVICE_UUID,
      OTA_CONTROL_UUID,
      b64
    );
  }

  // ── Scrivi sulla Data characteristic (Write Without Response) ─
  private async _writeData(device: Device, chunk: Uint8Array): Promise<void> {
    const b64 = uint8ArrayToBase64(chunk);
    await device.writeCharacteristicWithoutResponseForService(
      OTA_SERVICE_UUID,
      OTA_DATA_UUID,
      b64
    );
  }

  // ── Sottoscrivi notify Control ─────────────────────────────
  private async _subscribeToControl(
    device: Device,
    onNotify?: OtaNotifyCallback
  ): Promise<void> {
    this._unsubscribeFromControl(); // Pulisce eventuale sub precedente

    this.notifySubscription = device.monitorCharacteristicForService(
      OTA_SERVICE_UUID,
      OTA_CONTROL_UUID,
      (error, characteristic) => {
        if (error) {
          console.warn("[BleOtaService] Notify error:", error.message);
          return;
        }
        if (!characteristic?.value) return;

        const bytes = base64ToBytes(characteristic.value);
        const opcode = bytes[0];
        const payload = bytes.slice(1);

        console.log(`[BleOtaService] Notify ricevuta: 0x${opcode.toString(16).toUpperCase()}`);
        onNotify?.(opcode, payload);

        // Risolvi le promise in attesa (gestito tramite polling su flag)
        this._lastNotifyOpcode = opcode;
        this._lastNotifyPayload = payload;
      }
    );
  }

  // ── Annulla subscription notify ───────────────────────────
  private _unsubscribeFromControl() {
    if (this.notifySubscription) {
      const sub = this.notifySubscription;
      this.notifySubscription = null;
      try {
        if (typeof sub?.remove === "function") {
          sub.remove();
        }
      } catch (e) {
        // Il device potrebbe essersi già disconnesso (riavvio ESP32 post-OTA)
        console.log("[BleOtaService] Subscription cleanup (dispositivo disconnesso):", e);
      }
    }
  }

  // ── Variabili interne per polling notify ──────────────────
  private _lastNotifyOpcode: number | null = null;
  private _lastNotifyPayload: number[] = [];

  // ── Attende una notify specifica con timeout ───────────────
  private _waitForNotify(
    _device: Device,
    expectedOpcode: number,
    timeoutMs: number
  ): Promise<number[]> {
    // Reset ultimo opcode ricevuto (per non triggerare su notify vecchie)
    this._lastNotifyOpcode = null;
    this._lastNotifyPayload = [];

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const poll = setInterval(() => {
        // Abort check
        if (this.abortFlag) {
          clearInterval(poll);
          reject(new Error("OTA annullato"));
          return;
        }

        // Timeout check
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(poll);
          reject(new Error(`Timeout attesa risposta 0x${expectedOpcode.toString(16).toUpperCase()} (${timeoutMs}ms)`));
          return;
        }

        // ERROR check — qualsiasi ERROR termina il wait
        if (this._lastNotifyOpcode === OTA_RESP.ERROR) {
          clearInterval(poll);
          const errorCode = this._lastNotifyPayload[0] ?? 0;
          reject(new Error(`ESP32 OTA Error: codice 0x${errorCode.toString(16).toUpperCase()}`));
          return;
        }

        // Success check
        if (this._lastNotifyOpcode === expectedOpcode) {
          clearInterval(poll);
          resolve(this._lastNotifyPayload);
        }
      }, 50);
    });
  }
}

// Singleton
export const bleOtaService = new BleOtaService();
