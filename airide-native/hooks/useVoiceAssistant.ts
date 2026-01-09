// hooks/useVoiceAssistant.ts
// Hook principale per l'integrazione dell'assistente vocale con la navigazione

import { useEffect, useRef } from 'react';
import { NavInstruction } from './useNavigationUpdater';
import { VoiceSettings } from '@/types/voice';
import { ttsService, getLanguageCode } from '@/services/TTSService';
import {
  generateVoiceInstruction,
  getPriorityLevel,
  shouldSpeak,
} from '@/services/VoiceInstructionService';

interface UseVoiceAssistantProps {
  instruction: NavInstruction | null;
  enabled: boolean;
  settings: VoiceSettings;
}

/**
 * Hook per gestire le istruzioni vocali durante la navigazione
 * 
 * Trigger vocali:
 * - Nuova istruzione (testo cambiato)
 * - Distanze critiche raggiunge (200m, 100m, 50m)
 * - Messaggi speciali (ricalcolo, arrivo)
 */
export function useVoiceAssistant({
  instruction,
  enabled,
  settings,
}: UseVoiceAssistantProps): void {
  
  // Traccia l'ultima istruzione vocalizzata per evitare ripetizioni
  const lastSpokenText = useRef<string | null>(null);
  const lastSpokenDistance = useRef<number | null>(null);
  const distanceThresholds = useRef<Set<number>>(new Set());

  // Aggiorna le impostazioni TTS quando cambiano
  useEffect(() => {
    if (!enabled) return;

    ttsService.setVoiceSettings({
      language: getLanguageCode(settings.language),
      rate: settings.speed,
      volume: settings.volume,
    });
  }, [settings, enabled]);

  // Gestisce i cambiamenti nelle istruzioni
  useEffect(() => {
    if (!enabled || !instruction) {
      return;
    }

    // Determina se vocalizzare basandosi sulla frequenza
    if (!shouldSpeak(instruction, settings.frequency)) {
      return;
    }

    const currentDistance = instruction.metri ?? 0;
    const currentText = instruction.testo || instruction.text || '';

    // Nuova istruzione (testo diverso)
    const isNewInstruction = currentText !== lastSpokenText.current;
    
    if (isNewInstruction) {
      // Reset soglie per nuova istruzione
      distanceThresholds.current.clear();
      lastSpokenText.current = currentText;
      lastSpokenDistance.current = currentDistance;

      // Vocalizza immediatamente
      speakInstruction(instruction);
      return;
    }

    // Stessa istruzione: vocalizza a soglie di distanza specifiche
    if (shouldSpeakAtDistance(currentDistance)) {
      speakInstruction(instruction);
      lastSpokenDistance.current = currentDistance;
    }

  }, [instruction, enabled, settings]);

  /**
   * Determina se vocalizzare alla distanza corrente
   */
  const shouldSpeakAtDistance = (distance: number): boolean => {
    // Soglie di avviso: 200m, 100m, 50m
    const thresholds = [200, 100, 50];
    
    for (const threshold of thresholds) {
      if (distance <= threshold && !distanceThresholds.current.has(threshold)) {
        distanceThresholds.current.add(threshold);
        return true;
      }
    }
    
    return false;
  };

  /**
   * Vocalizza l'istruzione corrente
   */
  const speakInstruction = (inst: NavInstruction) => {
    const voiceText = generateVoiceInstruction(inst, settings.language);
    
    if (!voiceText) {
      console.log('[VoiceAssistant] Nessun testo generato per:', inst);
      return;
    }

    const priority = getPriorityLevel(inst);
    
    console.log(
      `[VoiceAssistant] 🎙️ Vocalizzazione: "${voiceText}" (Priority: ${priority}, Distance: ${inst.metri}m)`
    );

    ttsService.speak(voiceText, priority);
  };

  // Cleanup quando il componente viene smontato
  useEffect(() => {
    return () => {
      if (ttsService.isSpeaking()) {
        ttsService.stop();
      }
    };
  }, []);
}
