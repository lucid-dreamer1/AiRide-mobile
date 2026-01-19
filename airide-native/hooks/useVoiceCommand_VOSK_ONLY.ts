import { useEffect, useCallback, useRef, useState } from 'react';
import { Platform, PermissionsAndroid, Linking, Alert } from 'react-native';
import * as Vosk from 'react-native-vosk';
import { IntentParser, VoiceIntent } from '../utils/IntentParser';


interface UseVoiceCommandProps {
  enabled: boolean;
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

  const intentParser = useRef(new IntentParser());
  const isModelReady = useRef(false);
  const currentMode = useRef<VoiceMode>('WAKE_WORD');
  const onIntentDetectedRef = useRef(onIntentDetected);

  // Wake Word Grammar - Restricted for accuracy. Removed single "casco" to avoid false positives.
  const WAKE_GRAMMAR = ["hey casco", "ehi casco", "[unk]"];

  useEffect(() => {
    onIntentDetectedRef.current = onIntentDetected;
  }, [onIntentDetected]);

  const updateStatus = (msg: string) => {
    console.log(msg);
    setDebugStatus(prev => msg + '\n' + prev.split('\n').slice(0, 4).join('\n'));
  };

  const updateError = (err: string) => {
    console.error(err);
    setLastError(err);
    setDebugStatus(prev => `ERROR: ${err}\n` + prev);
  };

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
}
