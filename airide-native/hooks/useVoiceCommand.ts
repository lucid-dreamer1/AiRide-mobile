import { useEffect, useCallback, useRef, useState } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { IntentParser, VoiceIntent } from '../utils/IntentParser';


const { VoskModule } = NativeModules;
const voskEmitter = new NativeEventEmitter(VoskModule);

interface UseVoiceCommandProps {
  enabled: boolean;
  modelPath?: string;
  onIntentDetected: (intent: VoiceIntent) => void;
}

type VoiceMode = 'WAKE_WORD' | 'COMMAND';

/**
 * Hook per l'ascolto continuo usarendo Vosk (Hands-free)
 */
export function useVoiceCommand({
  enabled,
  modelPath = 'model',
  onIntentDetected,
}: UseVoiceCommandProps) {
  const [isListening, setIsListening] = useState(false);
  const intentParser = useRef(new IntentParser());
  const isModelReady = useRef(false);
  const isModelReadyRef = useRef(false); // Alias for compatibility
  const isVoskActiveRef = useRef(false);
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

  const stopVosk = useCallback(async () => {
    if (!isVoskActiveRef.current) {
      console.log('[VoiceCommand] Vosk già fermo, skip');
      return;
    }
    try {
      console.log('[VoiceCommand] Fermo Vosk STT...');
      await VoskModule.stopListening();
      isVoskActiveRef.current = false;
      setIsListening(false);
    } catch (e) {
      console.error('[VoiceCommand] Errore stop Vosk:', e);
    }
  }, []);

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
}
