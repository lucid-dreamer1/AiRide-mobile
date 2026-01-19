import { useEffect, useCallback, useRef, useState } from 'react';
<<<<<<< HEAD
import { NativeModules, NativeEventEmitter } from 'react-native';
=======
import { Platform, PermissionsAndroid, Linking, Alert } from 'react-native';
import * as Vosk from 'react-native-vosk';
>>>>>>> d2aac2021e99dc0c5cc5614b5acecf3bd2cd7c2f
import { IntentParser, VoiceIntent } from '../utils/IntentParser';


interface UseVoiceCommandProps {
  enabled: boolean;
<<<<<<< HEAD
  modelPath?: string;
  onIntentDetected: (intent: VoiceIntent) => void;
}

/**
 * Hook per l'ascolto continuo usarendo Vosk (Hands-free)
 */
export function useVoiceCommand({
  enabled,
  modelPath = 'model',
  onIntentDetected,
}: UseVoiceCommandProps) {
  const [isListening, setIsListening] = useState(false);
=======
  onIntentDetected: (intent: VoiceIntent) => void;
}

type VoiceMode = 'WAKE_WORD' | 'COMMAND';

export function useVoiceCommand({
  enabled,
  onIntentDetected,
}: UseVoiceCommandProps) {
  const [isListening, setIsListening] = useState(false);
  const [debugStatus, setDebugStatus] = useState<string>('Inizializzazione...');
  const [lastError, setLastError] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceMode>('WAKE_WORD');

>>>>>>> d2aac2021e99dc0c5cc5614b5acecf3bd2cd7c2f
  const intentParser = useRef(new IntentParser());
  const isModelReady = useRef(false);
  const currentMode = useRef<VoiceMode>('WAKE_WORD');
  const onIntentDetectedRef = useRef(onIntentDetected);
  
  // Timestamp dell'ultima wake word rilevata per gestire comandi spezzati
  const lastWakeWordTime = useRef<number>(0);
  const WAKE_WORD_WINDOW = 5000; // 5 secondi di finestra per il comando

  // Stato per indicare all'UI che siamo in attesa di un comando (Visual Feedback)
  const [isCommandWindowOpen, setIsCommandWindowOpen] = useState(false);

  // Wake Word Grammar - Restricted for accuracy. Removed single "casco" to avoid false positives.
  const WAKE_GRAMMAR = ["hey casco", "ehi casco", "[unk]"];

  useEffect(() => {
    onIntentDetectedRef.current = onIntentDetected;
  }, [onIntentDetected]);

<<<<<<< HEAD
  // Gestione timeout finestra comandi per reset UI
  useEffect(() => {
    let timeout: any;
    if (isCommandWindowOpen) {
      timeout = setTimeout(() => {
        setIsCommandWindowOpen(false);
      }, WAKE_WORD_WINDOW);
    }
    return () => clearTimeout(timeout);
  }, [isCommandWindowOpen]);

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
=======
  const updateStatus = (msg: string) => {
    console.log(msg);
    setDebugStatus(prev => msg + '\n' + prev.split('\n').slice(0, 4).join('\n'));
  };
>>>>>>> d2aac2021e99dc0c5cc5614b5acecf3bd2cd7c2f

  const updateError = (err: string) => {
    console.error(err);
    setLastError(err);
    setDebugStatus(prev => `ERROR: ${err}\n` + prev);
  };

<<<<<<< HEAD
  // Inizializza Vosk Model una sola volta
  useEffect(() => {
    const init = async () => {
      try {
        console.log('[VoiceCommand] Inizializzazione Vosk Model...');
        await VoskModule.initModel(modelPath);
        console.log('[VoiceCommand] Vosk Model pronto!');
        isModelReadyRef.current = true;
        // Se enabled era già true, avvia l'ascolto ora che il modello è pronto
        if (enabled) {
          startVosk();
        }
      } catch (e) {
        console.error('[VoiceCommand] Errore Vosk Init:', e);
      }
    };
    init();
  }, [modelPath]); // Rimosso startVosk/enabled dalle deps qui per evitare loop, gestito in useEffect separato

  // Listener per i risultati Vosk
  useEffect(() => {
    const resultSub = voskEmitter.addListener('onVoskResult', (resultJson: string) => {
      console.log('[VoiceCommand] Vosk Result ricevuto:', resultJson);
      
      // Android SpeechRecognizer si ferma automaticamente dopo un risultato.
      // Segnamo che non è più attivo per permettere il riavvio.
      isVoskActiveRef.current = false;

      try {
        const result = JSON.parse(resultJson);
        const text = (result.text || '').toLowerCase();
        
        if (text) {
          // 1. Controlla se c'è la wake word nel testo corrente (anche a metà frase)
          // Renderla più flessibile per errori di riconoscimento vocale
          // Rimosso ^ per permettere wake word ovunque, non solo all'inizio
          const wakeWordRegex = /\b(hey|ehi|ei|e il|il|a il|al|ok)\s+casco/i;
          const wakeWordMatch = text.match(wakeWordRegex);
          const hasWakeWord = !!wakeWordMatch;
          
          // Estrai il testo del comando (parte DOPO la wake word)
          let textToParse = text;
          if (hasWakeWord && wakeWordMatch) {
             console.log('[VoiceCommand] Wake word rilevata! Apro finestra comandi.');
             lastWakeWordTime.current = Date.now();
             setIsCommandWindowOpen(true); // Attiva feedback UI
             
             // Prendi solo la parte dopo la wake word per il parsing
             const wakeWordEndIndex = wakeWordMatch.index! + wakeWordMatch[0].length;
             textToParse = text.substring(wakeWordEndIndex).trim();
          }

          // 2. Controlla se siamo nella finestra temporale
          const isWithinWindow = (Date.now() - lastWakeWordTime.current) < WAKE_WORD_WINDOW;

          // 3. Prova a parsare il comando
          // Se siamo nella finestra o abbiamo appena sentito la wake word, permettiamo il parsing senza wake word esplicita
          const intent = intentParser.current.parse(textToParse, { 
              skipWakeWordCheck: isWithinWindow || hasWakeWord 
          });

          if (intent.type !== 'UNKNOWN') {
             console.log('[VoiceCommand] Intent valido rilevato:', intent);
             onIntentDetectedRef.current(intent);
             
             lastWakeWordTime.current = 0; 
             setIsCommandWindowOpen(false); // Chiudi feedback UI dopo comando eseguito
          } else {
             if (hasWakeWord) {
                 // Wake word presente ma nessun comando (es. solo "Hey Casco")
                 console.log('[VoiceCommand] In attesa di comando...');
             } else {
                 console.log('[VoiceCommand] Intent UNKNOWN o fuori finestra:', intent.rawText);
             }
          }
        }
      } catch (e) {
        console.error('[VoiceCommand] Errore Vosk Result:', e);
      }
      
      // Riavvia l'ascolto per il loop continuo (Hands-free)
      if (enabled) {
          setTimeout(() => {
             if (enabled) startVosk();
          }, 200); 
      }
    });

    const errorSub = voskEmitter.addListener('onVoskError', (error: string) => {
      const isNoSpeech = error.includes('No speech match');
      
      // Android SpeechRecognizer si ferma su errore.
      isVoskActiveRef.current = false;

      if (isNoSpeech) {
          // "No speech match" è normale se c'è silenzio. Non loggare come errore.
          // console.debug('[VoiceCommand] Silenzio rilevato (timeout)...');
      } else {
          console.error('[VoiceCommand] Vosk Error:', error);
      }

      // Se Vosk si ferma dopo l'errore (timeout), dobbiamo riavviarlo per mantenere l'ascolto continuo.
      if (enabled && isModelReadyRef.current) {
          // Se è solo timeout, riavvia subito o con minimo delay
          const delay = isNoSpeech ? 100 : 2000; 
          
          if (!isNoSpeech) console.log(`[VoiceCommand] Riavvio Vosk tra ${delay}ms...`);
          
          setTimeout(() => {
              // Riavvia solo se ancora abilitato
              if (enabled) startVosk(); 
          }, delay);
      }
    });

    return () => {
      resultSub.remove();
      errorSub.remove();
    };
  }, [enabled, startVosk]); // Aggiunto startVosk

  // Gestisci enabled/disabled
  useEffect(() => {
    if (enabled && isModelReadyRef.current && !isVoskActiveRef.current) {
      startVosk();
    } else if (!enabled && isVoskActiveRef.current) {
      stopVosk();
    }
  }, [enabled, startVosk, stopVosk]);

  return { isListening, isCommandWindowOpen };
=======
  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        console.log('[VoiceCommand] Permission result:', granted);
        
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          return true;
        } else if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          updateError('Permesso microfono negato permanentemente. Vai nelle impostazioni.');
          Alert.alert(
             "Permesso Microfono Necessario",
             "Per usare i comandi vocali devi abilitare il microfono dalle impostazioni.",
             [
               { text: "Annulla", style: "cancel" },
               { text: "Apri Impostazioni", onPress: () => Linking.openSettings() }
             ]
          );
          return false;
        } else {
          updateError('Permesso microfono rifiutato.');
          return false;
        }
      } catch (err: any) {
        updateError(`Errore richiesta permessi: ${err.message}`);
        return false;
      }
    }
    return true;
  };


  const startVosk = useCallback(async (targetMode: VoiceMode) => {
    try {
      if (!isModelReady.current) {
        updateStatus('Attendo caricamento modello...');
        return;
      }

      currentMode.current = targetMode;
      setMode(targetMode);

      Vosk.stop(); // Stop any previous instance

      if (targetMode === 'WAKE_WORD') {
        // WAKE_GRAMMAR is expected to be string[], but the variable I defined was JSON.stringify().
        // Let's redefine WAKE_GRAMMAR as just array of strings in the const definition, or parse it here.
        // Checking the definition above... `const WAKE_GRAMMAR = JSON.stringify(...)` 
        // I should change the const definition instead. But here I will just replace the call to be correct.
        
        // Actually, better to change the specific line where I called it. 
        // Wait, I should change the Definition of WAKE_GRAMMAR too if I want it clean.
        // But for this tool call, let's just change the startVosk function logic slightly or the grammar definition.
        
        // Let's change the definition of WAKE_GRAMMAR first to be an array, then here pass { grammar: WAKE_GRAMMAR }
        
        Vosk.start({ grammar: WAKE_GRAMMAR });

      } else {
        updateStatus('Ascolto comando...');
        Vosk.start(); // No grammar = Full Speech to Text
        setIsListening(true);
      }
    } catch (e: any) {
      updateError(`Errore start Vosk (${targetMode}): ${e.message}`);
    }
  }, []);

  const handleResult = useCallback((text: string) => {
    const cleanText = text.toLowerCase().trim();
    if (!cleanText) return;

    updateStatus(`Vosk [${currentMode.current}]: ${cleanText}`);

    if (currentMode.current === 'WAKE_WORD') {
      if (cleanText.includes('hey casco') || cleanText.includes('ehi casco')) {
        updateStatus('🔥 WAKE WORD RILEVATA! 🔥');
        startVosk('COMMAND');
      }
    } else {
      // COMMAND MODE
      const intent = intentParser.current.parse(cleanText);
      
      // If valid intent found OR if we want to confirm ANY text
      // Check if it's UNKNOWN or actual command
      if (intent.type !== 'UNKNOWN') {
        updateStatus(`Comando riconosciuto: ${intent.type}`);
        onIntentDetectedRef.current(intent);
        
        // Return to Wake Word mode after successful command
        startVosk('WAKE_WORD');
      } else {
        // If unknown, maybe wait for more? Or reset?
        // For now, let's treat it as a failed command and reset, or log it
         updateStatus(`Comando non capito: ${cleanText}`);
         // Optional: Keep listening until timeout or valid command? 
         // Let's reset to Wake Word to avoid stuck loop
         startVosk('WAKE_WORD');
      }
    }
  }, [startVosk]);

  // Initialization
  useEffect(() => {
    let resultSub: any;
    let errorSub: any;

    const init = async () => {
      const hasPerm = await requestPermissions();
      if (!hasPerm) {
        updateError('Permesso microfono negato');
        return;
      }

      try {
        updateStatus('Caricamento modello Vosk (model-it)...');
        await Vosk.loadModel('model-it');
        isModelReady.current = true;
        updateStatus('Modello caricato.');
        
        if (enabled) {
          startVosk('WAKE_WORD');
        }
      } catch (e: any) {
        updateError(`Errore caricamento modello: ${e.message}`);
      }
    };

    resultSub = Vosk.onResult((text: string) => {
       handleResult(text);
    });

    errorSub = Vosk.onError((e: any) => {
      updateError(`Vosk Error: ${e}`);
      // Try to restart if error occurs?
      // startVosk(currentMode.current);
    });

    init();

    return () => {
      if (resultSub) resultSub.remove();
      if (errorSub) errorSub.remove();
      Vosk.stop();
    };
  }, []); // Run once on mount

  // Watch 'enabled' prop
  useEffect(() => {
    if (isModelReady.current) {
      if (enabled) {
        startVosk('WAKE_WORD');
      } else {
        Vosk.stop();
        updateStatus('Vosk disabilitato');
      }
    }
  }, [enabled, startVosk]);

  return { isListening, debugStatus, lastError };
>>>>>>> d2aac2021e99dc0c5cc5614b5acecf3bd2cd7c2f
}
