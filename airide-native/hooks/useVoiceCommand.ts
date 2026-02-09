import { useEffect, useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { 
  loadModel, 
  start, 
  stop, 
  unload, 
  onPartialResult, 
  onResult, 
  onError 
} from 'react-native-vosk';
import { IntentParser, VoiceIntent } from '../utils/IntentParser';

// DEFINIZIONE REGEX AVANZATA (Fuori dal component per performance)
// \b -> inizio parola
// (hey|ehi...|al) -> tutte le varianti fonetiche del saluto o articoli che suonano simili
// (\s+(il|i|lo|l|un))? -> cattura opzionalmente articoli spuri (es. "e il casco")
// \s+casco -> la parola chiave finale
const WAKE_WORD_REGEX = /\b(hey|ehy|ehi|hei|ei|eh|hai|ok|ciao|e|è|i|il|el|al|un|a)(\s+(il|i|lo|l|un))?\s+casco\b/i;

interface UseVoiceCommandProps {
  enabled: boolean;
  modelPath?: string;
  onIntentDetected: (intent: VoiceIntent) => void;
}

export function useVoiceCommand({
  enabled,
  modelPath = 'model',
  onIntentDetected,
}: UseVoiceCommandProps) {
  const [isListening, setIsListening] = useState(false);
  const intentParser = useRef(new IntentParser());
  const isModelReadyRef = useRef(false);
  const isVoskActiveRef = useRef(false);
  
  const lastWakeWordTime = useRef<number>(0);
  const WAKE_WORD_WINDOW = 5000; 
  const [isCommandWindowOpen, setIsCommandWindowOpen] = useState(false);

  // Wake Word Detection Logic
  const checkWakeWord = (text: string) => {
    // Usa la regex unificata per il test
    if (WAKE_WORD_REGEX.test(text)) {
      console.log('⚡ [VoiceCommand] Wake word rilevata!');
      lastWakeWordTime.current = Date.now();
      if (!isCommandWindowOpen) setIsCommandWindowOpen(true);
      return true;
    }
    return false;
  };

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
    try {
      if (isVoskActiveRef.current) {
        console.log('[VoiceCommand] Stop Vosk...');
        stop();
        isVoskActiveRef.current = false;
        setIsListening(false);
      }
    } catch (e) {
      console.error('[VoiceCommand] Stop Error:', e);
    }
  }, []);

  const startVosk = useCallback(async () => {
    if (!isModelReadyRef.current) {
      console.warn('[VoiceCommand] Modello non pronto.');
      return;
    }
    if (isVoskActiveRef.current) return;

    try {
      try {
        stop();
        await new Promise(r => setTimeout(r, 200));
      } catch (e) { // ignore
      }

      console.log('[VoiceCommand] Avvio ascolto...');
      isVoskActiveRef.current = true;
      setIsListening(true);
      
      await start(); 
      console.log('[VoiceCommand] ✅ Vosk avviato!'); 
      
    } catch (e) {
      console.error('[VoiceCommand] Start Error:', e);
      isVoskActiveRef.current = false;
      setIsListening(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        console.log(`[VoiceCommand] Caricamento modello: ${modelPath}`);
        await loadModel(modelPath);
        console.log('[VoiceCommand] Modello caricato!');
        isModelReadyRef.current = true;
        if (enabled) {
          startVosk();
        }
      } catch (e) {
        console.error('[VoiceCommand] Init Error:', e);
      }
    };
    init();

    return () => {
      console.log('[VoiceCommand] 🛑 Unmount...');
      try {
        stop();
        unload();
      } catch(e) { console.warn('Unmount error', e); }
    };
  }, [modelPath, enabled, startVosk]);

  useEffect(() => {
    const partialSub = onPartialResult((res) => {
      try {
        const text = typeof res === 'string' ? res : JSON.stringify(res);
        if (text) {
          checkWakeWord(text);
        }
      } catch(e) { // ignore
      }
    });

    const resultSub = onResult((res) => {
      console.log(`📦Raw:`, res);
      
      try {
        const text = (typeof res === 'string' ? res : String(res)).toLowerCase();
        
        if (text) {
          console.log(`🎤 Sentito: "${text}"`);

          const justWokeUp = checkWakeWord(text);
          const isWithinWindow = (Date.now() - lastWakeWordTime.current) < WAKE_WORD_WINDOW;

          if (isWithinWindow || justWokeUp) {
            // CRUCIALE: Logica migliorata per prendere solo ciò che segue la wake word
            // Se c'è la wake word, scartiamo tutto il testo precedente (rumore, folla, ecc.)
            let cleanText = text;
            const match = text.match(WAKE_WORD_REGEX);
            
            if (match && match.index !== undefined) {
               // Prendi tutto ciò che c'è dopo la fine del match
               cleanText = text.substring(match.index + match[0].length).trim();
            } else {
               // Se siamo qui, o `justWokeUp` è false (quindi usiamo `isWithinWindow`), 
               // oppure la regex ha fallito (impossibile se justWokeUp=true).
               // Se `isWithinWindow` è true e non c'è wake word, assumiamo che tutto il testo sia il comando.
               cleanText = text.trim();
            }
            
            console.log(`🧹 Testo pulito per parser: "${cleanText}"`);

            if (cleanText.length > 0) {
              const intent = intentParser.current.parse(cleanText, { 
                skipWakeWordCheck: true 
              });

              if (intent.type !== 'UNKNOWN') {
                console.log('✅ Comando:', intent.type);
                onIntentDetected(intent);
                setIsCommandWindowOpen(false);
                lastWakeWordTime.current = 0; 
              } else {
                console.log('⚠️ Comando sconosciuto:', cleanText);
              }
            } else if (justWokeUp) {
              console.log('🦻 In attesa di comando...');
            }
          }
        }
      } catch (e) {
        console.error('Process Error', e);
      }
    });

    const errorSub = onError((err) => {
      const errStr = String(err);
      if (!errStr.includes('No speech')) console.log('[VoiceCommand] Error:', err);
      
      isVoskActiveRef.current = false;
      if (enabled) {
        setTimeout(() => startVosk(), 1000);
      }
    });

    return () => {
      partialSub.remove();
      resultSub.remove();
      errorSub.remove();
    };
  }, [enabled, startVosk, onIntentDetected]);

  useEffect(() => {
    if (enabled && isModelReadyRef.current && !isVoskActiveRef.current) {
      startVosk();
    } else if (!enabled) {
      stopVosk();
    }
  }, [enabled, startVosk, stopVosk]);

  return { isListening, isCommandWindowOpen };
}