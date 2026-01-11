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
 * - Distanze critiche raggiunte solo UNA volta (200m, 100m, 50m)
 * - Messaggi speciali (ricalcolo, arrivo)
 */
export function useVoiceAssistant({
  instruction,
  enabled,
  settings,
}: UseVoiceAssistantProps): void {
  
  // Traccia l'ultima istruzione vocalizzata per evitare ripetizioni
  const lastSpokenText = useRef<string | null>(null);
  const lastSpokenAt = useRef<number>(0);
  
  // Traccia per quale istruzione abbiamo già parlato (per evitare ripetizioni della stessa istruzione)
  const currentInstructionId = useRef<string | null>(null);
  const spokenThresholds = useRef<Set<number>>(new Set());

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
    
    // Crea un ID univoco per questa istruzione (basato sul testo)
    const instructionId = currentText;

    // NUOVA ISTRUZIONE: Il testo è cambiato
    const isNewInstruction = instructionId !== currentInstructionId.current;
    
    if (isNewInstruction) {
      console.log(`[VoiceAssistant] 🆕 Nuova istruzione rilevata: "${currentText}"`);
      
      // Reset per nuova istruzione
      currentInstructionId.current = instructionId;
      spokenThresholds.current.clear();
      lastSpokenText.current = null;
      
      // Vocalizza solo se siamo a una distanza ragionevole (non troppo lontana)
      // Evita di parlare se siamo a più di 500m dalla svolta
      if (currentDistance > 0 && currentDistance <= 500) {
        speakInstruction(instruction);
        lastSpokenText.current = currentText;
        lastSpokenAt.current = Date.now();
        
        // Marca questa distanza come già vocalizzata
        const threshold = getClosestThreshold(currentDistance);
        if (threshold) {
          spokenThresholds.current.add(threshold);
        }
      }
      return;
    }

    // STESSA ISTRUZIONE: Vocalizza solo a soglie specifiche NON ancora raggiunte
    const now = Date.now();
    const timeSinceLastSpoken = now - lastSpokenAt.current;
    
    // Cooldown minimo di 5 secondi tra vocalizzazioni
    if (timeSinceLastSpoken < 5000) {
      return;
    }

    // Verifica se abbiamo raggiunto una nuova soglia
    const newThreshold = shouldSpeakAtThreshold(currentDistance);
    
    if (newThreshold && !spokenThresholds.current.has(newThreshold)) {
      console.log(`[VoiceAssistant] 📏 Soglia ${newThreshold}m raggiunta`);
      spokenThresholds.current.add(newThreshold);
      speakInstruction(instruction);
      lastSpokenText.current = currentText;
      lastSpokenAt.current = now;
    }

  }, [instruction, enabled, settings]);

  /**
   * Trova la soglia più vicina alla distanza corrente
   */
  const getClosestThreshold = (distance: number): number | null => {
    const thresholds = [200, 100, 50];
    
    for (const threshold of thresholds) {
      // Se siamo entro 10 metri dalla soglia, consideriamola raggiunta
      if (Math.abs(distance - threshold) <= 10) {
        return threshold;
      }
    }
    
    return null;
  };

  /**
   * Determina se vocalizzare alla distanza corrente
   * Ritorna la soglia se dovremmo parlare, null altrimenti
   */
  const shouldSpeakAtThreshold = (distance: number): number | null => {
    // Soglie di avviso: 200m, 100m, 50m
    const thresholds = [200, 100, 50];
    
    for (const threshold of thresholds) {
      // Se siamo tra threshold-10 e threshold+10, e non abbiamo ancora parlato per questa soglia
      if (distance <= threshold + 10 && distance >= threshold - 10) {
        return threshold;
      }
    }
    
    return null;
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
      `[VoiceAssistant] 🎙️ Vocalizzazione: "${voiceText}" (Priority: ${priority}, Distance: ${inst.metri}m, Language: ${settings.language})`
    );

    // IMPORTANTE: Passa la lingua corretta al TTS
    ttsService.speak(voiceText, priority, {
      language: getLanguageCode(settings.language), // Usa la lingua dalle impostazioni utente
      rate: settings.speed,
      volume: settings.volume,
    });
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
