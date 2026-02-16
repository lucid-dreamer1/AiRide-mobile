import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { VoiceIntent } from '../utils/IntentParser';
import { BackgroundNavigation } from '../services/BackgroundNavigation';

interface UseVoiceCommandProps {
  enabled: boolean;
  modelPath?: string;
  onIntentDetected: (intent: VoiceIntent) => void;
}

export function useVoiceCommand({
  enabled,
  onIntentDetected,
}: UseVoiceCommandProps) {
  const [isCommandWindowOpen, setIsCommandWindowOpen] = useState(false);
  
  // Se enabled è true, assicuriamoci che il servizio background sia avviato (in modalità "ascolto")
  useEffect(() => {
      if (enabled) {
          BackgroundNavigation.start();
      }

      // 🔥 CLEANUP: Quando la screen si smonta o enabled diventa false, FERMIAMO il brain
      // Questo previene Vosk OOM quando si cambia tab (es. Rides)
      return () => {
          console.log("[useVoiceCommand] Cleanup: Stopping Background Service to free memory");
          BackgroundNavigation.stop();
      };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    // Ascolta lo stato del comando ("listening" = wake word rilevata)
    const statusSub = DeviceEventEmitter.addListener('Voice_Status', (event: any) => {
        console.log('[useVoiceCommand] Status Update:', event);
        if (event.status === 'listening') setIsCommandWindowOpen(true);
        if (event.status === 'idle') setIsCommandWindowOpen(false);
    });

    // Ascolta gli intenti rilevati dal background service
    const intentSub = DeviceEventEmitter.addListener('Voice_Intent', (intent: VoiceIntent) => {
        console.log('[useVoiceCommand] Intent Received:', intent);
        onIntentDetected(intent);
    });

    return () => {
        statusSub.remove();
        intentSub.remove();
    };
  }, [enabled, onIntentDetected]);

  return { isListening: true, isCommandWindowOpen };
}