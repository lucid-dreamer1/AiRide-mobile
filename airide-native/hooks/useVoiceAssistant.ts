// hooks/useVoiceAssistant.ts
// Hook principale per l'integrazione dell'assistente vocale con la navigazione (TTS)

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
 */
export function useVoiceAssistant({
  instruction,
  enabled,
  settings,
}: UseVoiceAssistantProps): void {
  
  const lastSpokenText = useRef<string | null>(null);
  const lastSpokenAt = useRef<number>(0);
  const currentInstructionId = useRef<string | null>(null);
  const spokenThresholds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    ttsService.setVoiceSettings({
      language: getLanguageCode(settings.language),
      rate: settings.speed,
      volume: settings.volume,
    });
  }, [settings, enabled]);

  useEffect(() => {
    if (!enabled || !instruction) return;
    if (!shouldSpeak(instruction, settings.frequency)) return;

    const currentDistance = instruction.metri ?? 0;
    const currentText = instruction.testo || instruction.text || '';
    const instructionId = currentText;

    if (instructionId !== currentInstructionId.current) {
      currentInstructionId.current = instructionId;
      spokenThresholds.current.clear();
      lastSpokenText.current = null;
      
      if (currentDistance > 0 && currentDistance <= 500) {
        speakInstruction(instruction);
        lastSpokenText.current = currentText;
        lastSpokenAt.current = Date.now();
      }
      return;
    }

    const now = Date.now();
    if (now - lastSpokenAt.current < 5000) return;

    const thresholds = [200, 100, 50];
    for (const threshold of thresholds) {
      if (currentDistance <= threshold + 10 && currentDistance >= threshold - 10) {
        if (!spokenThresholds.current.has(threshold)) {
          spokenThresholds.current.add(threshold);
          speakInstruction(instruction);
          lastSpokenAt.current = now;
        }
      }
    }
  }, [instruction, enabled, settings]);

  const speakInstruction = (inst: NavInstruction) => {
    const voiceText = generateVoiceInstruction(inst, settings.language);
    if (!voiceText) return;

    const priority = getPriorityLevel(inst);
    ttsService.speak(voiceText, priority, {
      language: getLanguageCode(settings.language),
      rate: settings.speed,
      volume: settings.volume,
    });
  };

  useEffect(() => {
    return () => {
      if (ttsService.isSpeaking()) ttsService.stop();
    };
  }, []);
}
