// ------------------------------------------------------------
// OtaContext.tsx
// Context React per la gestione della macchina a stati OTA.
// Espone stato, progresso e azioni all'UI.
// ------------------------------------------------------------

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { bleService } from "../services/BleSingleton";
import { bleOtaService, OTA_RESP } from "../services/BleOtaService";

// ────────────────────────────────────────────────────────────
// Tipi
// ────────────────────────────────────────────────────────────
export type OtaState =
  | "IDLE"
  | "PREPARING"       // Lettura file + calcolo CRC
  | "UPLOADING"       // Streaming in corso
  | "VERIFYING"       // In attesa SUCCESS da ESP32
  | "SUCCESS"
  | "ERROR"
  | "ABORTED";

export type OtaSource =
  | { type: "file" }               // Selezione tramite DocumentPicker
  | { type: "url"; url: string };  // Download da URL

export type OtaFirmwareInfo = {
  name: string;
  sizeBytes: number;
  crc32: string; // hex
};

type OtaContextType = {
  otaState: OtaState;
  progress: number;             // 0–100
  bytesSent: number;
  totalBytes: number;
  errorMessage: string | null;
  firmwareInfo: OtaFirmwareInfo | null;
  lastEspOpcode: number | null; // ultimo opcode ricevuto dall'ESP32
  /** Avvia il flusso OTA: selezione file → upload */
  startOta: (source?: OtaSource) => Promise<void>;
  /** Seleziona solo il file, senza avviare l'upload */
  pickFirmwareFile: () => Promise<void>;
  /** Avvia l'upload del file già selezionato */
  beginUpload: () => Promise<void>;
  /** Annulla l'upload in corso */
  abortOta: () => void;
  /** Resetta a IDLE dopo SUCCESS/ERROR */
  resetOta: () => void;
};

// ────────────────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────────────────
const OtaContext = createContext<OtaContextType>({
  otaState: "IDLE",
  progress: 0,
  bytesSent: 0,
  totalBytes: 0,
  errorMessage: null,
  firmwareInfo: null,
  lastEspOpcode: null,
  startOta: async () => {},
  pickFirmwareFile: async () => {},
  beginUpload: async () => {},
  abortOta: () => {},
  resetOta: () => {},
});

export const useOta = () => useContext(OtaContext);

// ────────────────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────────────────
export function OtaProvider({ children }: { children: React.ReactNode }) {
  const [otaState, setOtaState]       = useState<OtaState>("IDLE");
  const [progress, setProgress]       = useState(0);
  const [bytesSent, setBytesSent]     = useState(0);
  const [totalBytes, setTotalBytes]   = useState(0);
  const [errorMessage, setErrorMsg]   = useState<string | null>(null);
  const [firmwareInfo, setFirmwareInfo] = useState<OtaFirmwareInfo | null>(null);
  const [lastEspOpcode, setLastEspOpcode] = useState<number | null>(null);

  // Buffer del firmware in memoria (Uint8Array)
  const firmwareBinRef = useRef<Uint8Array | null>(null);

  // ── Selezione file .bin ──────────────────────────────────
  const pickFirmwareFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*", // Alcuni Android non riconoscono application/octet-stream
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        console.log("[OtaContext] Selezione file annullata");
        return;
      }

      const asset = result.assets[0];
      const uri   = asset.uri;
      const name  = asset.name ?? "firmware.bin";

      setOtaState("PREPARING");
      setErrorMsg(null);

      // Leggi il file come base64
      console.log("[OtaContext] Lettura file:", uri);
      const b64Content = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Converti base64 → Uint8Array
      const binaryString = atob(b64Content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      firmwareBinRef.current = bytes;

      // Calcola CRC32
      const crc = bleOtaService.computeCrc32(bytes);
      const crcHex = crc.toString(16).toUpperCase().padStart(8, "0");

      setFirmwareInfo({
        name,
        sizeBytes: bytes.length,
        crc32: crcHex,
      });

      setTotalBytes(bytes.length);
      setBytesSent(0);
      setProgress(0);
      setOtaState("IDLE"); // Pronto per l'upload, in attesa del tasto "Avvia"

      console.log(
        `[OtaContext] File pronto: ${name}, ${bytes.length} bytes, CRC32: ${crcHex}`
      );
    } catch (e: any) {
      console.error("[OtaContext] Errore selezione file:", e);
      setErrorMsg(e?.message ?? "Errore nella lettura del file");
      setOtaState("ERROR");
    }
  }, []);

  // ── Scarica firmware da URL ─────────────────────────────
  const downloadFirmwareFromUrl = async (url: string): Promise<Uint8Array> => {
    console.log("[OtaContext] Download da URL:", url);

    const downloadResult = await FileSystem.downloadAsync(
      url,
      FileSystem.cacheDirectory + "firmware_ota.bin"
    );

    if (downloadResult.status !== 200) {
      throw new Error(`Download fallito: HTTP ${downloadResult.status}`);
    }

    const b64Content = await FileSystem.readAsStringAsync(downloadResult.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const binaryString = atob(b64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  };

  // ── Avvia upload del firmware già in memoria ─────────────
  const beginUpload = useCallback(async () => {
    if (!firmwareBinRef.current) {
      setErrorMsg("Nessun file firmware selezionato");
      setOtaState("ERROR");
      return;
    }

    const device = bleService.getDevice();
    if (!device) {
      setErrorMsg("Casco non connesso. Connettiti prima di aggiornare.");
      setOtaState("ERROR");
      return;
    }

    try {
      setOtaState("UPLOADING");
      setProgress(0);
      setBytesSent(0);
      setErrorMsg(null);
      setLastEspOpcode(null);

      await bleOtaService.startOtaUpdate(device, firmwareBinRef.current, {
        onProgress: (sent, total) => {
          setBytesSent(sent);
          setTotalBytes(total);
          setProgress(Math.round((sent / total) * 100));
        },
        onNotify: (opcode, payload) => {
          setLastEspOpcode(opcode);

          if (opcode === OTA_RESP.SUCCESS) {
            setOtaState("SUCCESS");
            setProgress(100);
          } else if (opcode === OTA_RESP.ERROR) {
            const code = payload[0] ?? 0;
            setErrorMsg(`Errore ESP32: 0x${code.toString(16).toUpperCase()}`);
            setOtaState("ERROR");
          } else if (opcode === OTA_RESP.PROGRESS) {
            // bytes_received dall'ESP32 (uint32 LE)
            const espBytes =
              payload[0] |
              (payload[1] << 8) |
              (payload[2] << 16) |
              (payload[3] << 24);
            console.log(`[OtaContext] ESP32 ha ricevuto: ${espBytes} bytes`);
          }
        },
      });

      // Se siamo qui senza SUCCESS via notify, consideriamo VERIFYING
      if (otaState !== "SUCCESS" && otaState !== "ERROR") {
        setOtaState("VERIFYING");
      }
    } catch (e: any) {
      if (e?.message?.includes("annullato")) {
        setOtaState("ABORTED");
      } else {
        console.error("[OtaContext] Errore OTA:", e);
        setErrorMsg(e?.message ?? "Errore durante l'aggiornamento");
        setOtaState("ERROR");
      }
    }
  }, [otaState]);

  // ── startOta (selezione + upload in sequenza) ────────────
  const startOta = useCallback(
    async (source?: OtaSource) => {
      try {
        if (source?.type === "url") {
          setOtaState("PREPARING");
          setErrorMsg(null);

          const bytes = await downloadFirmwareFromUrl(source.url);
          const crc   = bleOtaService.computeCrc32(bytes);
          firmwareBinRef.current = bytes;
          setFirmwareInfo({
            name: source.url.split("/").pop() ?? "firmware.bin",
            sizeBytes: bytes.length,
            crc32: crc.toString(16).toUpperCase().padStart(8, "0"),
          });
          setTotalBytes(bytes.length);
          await beginUpload();
        } else {
          // Selezione file locale
          await pickFirmwareFile();
          // L'upload viene avviato manualmente tramite beginUpload
        }
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Errore");
        setOtaState("ERROR");
      }
    },
    [pickFirmwareFile, beginUpload]
  );

  // ── Abort ────────────────────────────────────────────────
  const abortOta = useCallback(() => {
    bleOtaService.abort();
    setOtaState("ABORTED");
    setProgress(0);
  }, []);

  // ── Reset ────────────────────────────────────────────────
  const resetOta = useCallback(() => {
    bleOtaService.abort(); // no-op se non in corso
    firmwareBinRef.current = null;
    setOtaState("IDLE");
    setProgress(0);
    setBytesSent(0);
    setTotalBytes(0);
    setErrorMsg(null);
    setFirmwareInfo(null);
    setLastEspOpcode(null);
  }, []);

  return (
    <OtaContext.Provider
      value={{
        otaState,
        progress,
        bytesSent,
        totalBytes,
        errorMessage,
        firmwareInfo,
        lastEspOpcode,
        startOta,
        pickFirmwareFile,
        beginUpload,
        abortOta,
        resetOta,
      }}
    >
      {children}
    </OtaContext.Provider>
  );
}
