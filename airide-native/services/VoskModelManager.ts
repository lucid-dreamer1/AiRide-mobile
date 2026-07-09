// services/VoskModelManager.ts
// Gestione download on-demand dei modelli Vosk per ogni lingua

import * as FileSystem from 'expo-file-system/legacy';
import { unzip } from 'react-native-zip-archive';

const MODEL_BASE_URL = 'https://alphacephei.com/vosk/models/';

// Modelli "small" — qualità buona, peso ragionevole
const MODEL_CONFIGS: Record<string, { zip: string; folder: string; sizeMB: number }> = {
  en: { zip: 'vosk-model-small-en-us-0.15.zip', folder: 'vosk-model-small-en-us-0.15', sizeMB: 40 },
  fr: { zip: 'vosk-model-small-fr-0.22.zip',    folder: 'vosk-model-small-fr-0.22',    sizeMB: 41 },
  de: { zip: 'vosk-model-small-de-0.15.zip',    folder: 'vosk-model-small-de-0.15',    sizeMB: 45 },
  es: { zip: 'vosk-model-small-es-0.42.zip',    folder: 'vosk-model-small-es-0.42',    sizeMB: 39 },
};

// Directory di salvataggio persistente
const MODELS_DIR = (FileSystem.documentDirectory ?? '') + 'vosk-models/';

// Converte URI file:// in percorso assoluto nativo (necessario per loadModel di Vosk)
const toNativePath = (uri: string) => uri.replace('file://', '');

export type DownloadProgress = {
  progress: number; // 0.0 → 1.0
  bytesWritten: number;
  totalBytes: number;
};

export const VoskModelManager = {

  getConfig(lang: string) {
    return MODEL_CONFIGS[lang] ?? null;
  },

  getSizeMB(lang: string): number {
    return MODEL_CONFIGS[lang]?.sizeMB ?? 0;
  },

  // Restituisce il percorso nativo del modello per loadModel():
  // - 'it' → 'model' (assets bundled)
  // - altre lingue → percorso assoluto filesystem
  async getModelPath(lang: string): Promise<string | null> {
    if (lang === 'it') return 'model';

    const config = MODEL_CONFIGS[lang];
    if (!config) return null;

    const modelDir = MODELS_DIR + config.folder + '/';
    const info = await FileSystem.getInfoAsync(modelDir);
    if (!info.exists) return null;

    return toNativePath(modelDir);
  },

  // Controlla se il modello è già scaricato
  async isDownloaded(lang: string): Promise<boolean> {
    if (lang === 'it') return true;
    const path = await VoskModelManager.getModelPath(lang);
    return path !== null;
  },

  // Scarica ed estrae il modello per la lingua indicata
  async downloadModel(
    lang: string,
    onProgress?: (p: DownloadProgress) => void
  ): Promise<string> {
    const config = MODEL_CONFIGS[lang];
    if (!config) throw new Error(`Nessun modello configurato per: ${lang}`);

    // Crea la directory se non esiste
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });

    const zipPath = MODELS_DIR + config.zip;

    console.log(`[VoskModel] ⬇️ Download modello ${lang}: ${config.zip}`);

    const downloadResumable = FileSystem.createDownloadResumable(
      MODEL_BASE_URL + config.zip,
      zipPath,
      {},
      (dp) => {
        const progress = dp.totalBytesExpectedToWrite > 0
          ? dp.totalBytesWritten / dp.totalBytesExpectedToWrite
          : 0;
        onProgress?.({
          progress,
          bytesWritten: dp.totalBytesWritten,
          totalBytes: dp.totalBytesExpectedToWrite,
        });
      }
    );

    await downloadResumable.downloadAsync();
    console.log(`[VoskModel] ✅ Download completato. Estrazione in corso...`);

    // Estrai nella cartella modelli
    await unzip(toNativePath(zipPath), toNativePath(MODELS_DIR));
    console.log(`[VoskModel] ✅ Estrazione completata.`);

    // Rimuovi lo zip
    await FileSystem.deleteAsync(zipPath, { idempotent: true });

    const modelPath = toNativePath(MODELS_DIR + config.folder + '/');
    console.log(`[VoskModel] 📂 Modello disponibile in: ${modelPath}`);
    return modelPath;
  },

  // Elimina il modello scaricato (per liberare spazio)
  async deleteModel(lang: string): Promise<void> {
    const config = MODEL_CONFIGS[lang];
    if (!config) return;
    const modelDir = MODELS_DIR + config.folder + '/';
    await FileSystem.deleteAsync(modelDir, { idempotent: true });
    console.log(`[VoskModel] 🗑️ Modello ${lang} eliminato.`);
  },
};
