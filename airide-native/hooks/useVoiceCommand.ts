import { useEffect, useCallback, useRef, useState } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { PorcupineManager } from '@picovoice/porcupine-react-native';
import { IntentParser, VoiceIntent } from '../utils/IntentParser';

const { VoskModule } = NativeModules;
const voskEmitter = new NativeEventEmitter(VoskModule);

interface UseVoiceCommandProps {
  enabled: boolean;
  accessKey?: string;
  keywordPath?: string;
  porcupineModelPath?: string;
  modelPath?: string;
  onIntentDetected: (intent: VoiceIntent) => void;
}

/**
 * Hook per l'ascolto continuo della wake word e riconoscimento comandi (Hands-free)
 */
export function useVoiceCommand({
  enabled,
  accessKey = '+0aml9jO2BKifVdFTCZgD93zHnZoP6ZaCBWEdYGWp8rD5TNRCBVZNQ==',
  keywordPath = 'Hey-Casco_it_android_v4_0_0.ppn',
  porcupineModelPath,
  modelPath = 'model',
  onIntentDetected,
}: UseVoiceCommandProps) {
  const [isListening, setIsListening] = useState(false);
  const porcupineManager = useRef<PorcupineManager | null>(null);
  const intentParser = useRef(new IntentParser());
  const isModelReadyRef = useRef(false);
  const isVoskActiveRef = useRef(false);
  const onIntentDetectedRef = useRef(onIntentDetected);

  // Mantieni aggiornata la ref del callback
  useEffect(() => {
    onIntentDetectedRef.current = onIntentDetected;
  }, [onIntentDetected]);

  const startVosk = useCallback(async () => {
    if (!isModelReadyRef.current) {
      console.warn('[VoiceCommand] Impossibile avviare STT: Modello non pronto');
      return;
    }
    if (isVoskActiveRef.current) {
      console.log('[VoiceCommand] Vosk già attivo, skip');
      return;
    }
    try {
      console.log('[VoiceCommand] Avvio Vosk STT...');
      isVoskActiveRef.current = true;
      await VoskModule.startListening();
      setIsListening(true);
    } catch (e) {
      console.error('[VoiceCommand] Errore avvio Vosk:', e);
      isVoskActiveRef.current = false;
    }
  }, []);

  const stopVosk = useCallback(() => {
    if (!isVoskActiveRef.current) return;
    console.log('[VoiceCommand] Stop Vosk STT');
    VoskModule.stopListening();
    isVoskActiveRef.current = false;
    setIsListening(false);
  }, []);

  const restartPorcupine = useCallback(async () => {
    try {
      console.log('[VoiceCommand] Riavvio Porcupine...');
      await porcupineManager.current?.start();
    } catch (e) {
      console.error('[VoiceCommand] Errore riavvio Porcupine:', e);
    }
  }, []);

  // Inizializza Vosk Model una sola volta
  useEffect(() => {
    const init = async () => {
      try {
        console.log('[VoiceCommand] Inizializzazione Vosk Model...');
        await VoskModule.initModel(modelPath);
        console.log('[VoiceCommand] Vosk Model pronto!');
        isModelReadyRef.current = true;
      } catch (e) {
        console.error('[VoiceCommand] Errore Vosk Init:', e);
      }
    };
    init();
  }, [modelPath]);

  // Inizializza Porcupine una sola volta
  useEffect(() => {
    const initPorcupine = async () => {
      // Aspetta che il modello sia pronto
      await new Promise<void>((resolve) => {
        const check = () => {
          if (isModelReadyRef.current) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      if (porcupineManager.current) return;

      try {
        console.log('[VoiceCommand] Inizializzazione Porcupine...');
        porcupineManager.current = await PorcupineManager.fromKeywordPaths(
          accessKey,
          [keywordPath],
          async (keywordIndex) => {
            if (keywordIndex === 0) {
              console.log('[VoiceCommand] Wake word rilevata!');
              await porcupineManager.current?.stop();
              await startVosk();
            }
          },
          undefined,
          porcupineModelPath
        );

        if (enabled) {
          await porcupineManager.current.start();
        }
      } catch (e) {
        console.error('[VoiceCommand] Errore Porcupine:', e);
      }
    };

    initPorcupine();

    return () => {
      porcupineManager.current?.delete();
      porcupineManager.current = null;
    };
  }, [accessKey, keywordPath, porcupineModelPath, enabled, startVosk]);

  // Listener per i risultati Vosk - separato per evitare re-render
  useEffect(() => {
    const resultSub = voskEmitter.addListener('onVoskResult', (resultJson: string) => {
      console.log('[VoiceCommand] Vosk Result ricevuto:', resultJson);
      try {
        const result = JSON.parse(resultJson);
        const text = result.text || '';
        if (text) {
          const intent = intentParser.current.parse(text);
          onIntentDetectedRef.current(intent);
        }
      } catch (e) {
        console.error('[VoiceCommand] Errore Vosk Result:', e);
      }
      // Stop Vosk e riavvia Porcupine
      stopVosk();
      restartPorcupine();
    });

    const errorSub = voskEmitter.addListener('onVoskError', (error: string) => {
      console.error('[VoiceCommand] Vosk Error:', error);
      stopVosk();
      restartPorcupine();
    });

    return () => {
      resultSub.remove();
      errorSub.remove();
    };
  }, [stopVosk, restartPorcupine]);

  // Gestisci enabled/disabled
  useEffect(() => {
    if (porcupineManager.current) {
      if (enabled && !isVoskActiveRef.current) {
        porcupineManager.current.start();
      } else if (!enabled) {
        porcupineManager.current.stop();
        stopVosk();
      }
    }
  }, [enabled, stopVosk]);

  return { isListening };
}
