// services/VoiceInstructionService.ts
// Generazione istruzioni vocali ottimizzate per la guida in moto

import { NavInstruction } from "@/hooks/useNavigationUpdater";
import { VoicePriority } from "@/types/voice";

// Template delle istruzioni per lingua
const TEMPLATES = {
  it: {
    turnRight: (dist: string) => `Svolta a destra ${dist}`,
    turnLeft: (dist: string) => `Svolta a sinistra ${dist}`,
    continue: (dist: string) => `Continua dritto ${dist}`,
    sharpLeft: (dist: string) => `Svolta stretta a sinistra ${dist}`,
    arrived: "Sei arrivato a destinazione",
    recalculating: "Ricalcolo del percorso",
    in: "tra",
    meters: "metri",
    kilometers: "chilometri",
    kilometer: "chilometro",
  },
  en: {
    turnRight: (dist: string) => `Turn right ${dist}`,
    turnLeft: (dist: string) => `Turn left ${dist}`,
    continue: (dist: string) => `Continue ${dist}`,
    sharpLeft: (dist: string) => `Sharp left ${dist}`,
    arrived: "You have arrived",
    recalculating: "Recalculating route",
    in: "in",
    meters: "meters",
    kilometers: "kilometers",
    kilometer: "kilometer",
  },
  fr: {
    turnRight: (dist: string) => `Tournez à droite ${dist}`,
    turnLeft: (dist: string) => `Tournez à gauche ${dist}`,
    continue: (dist: string) => `Continuez ${dist}`,
    sharpLeft: (dist: string) => `Tournez fort à gauche ${dist}`,
    arrived: "Vous êtes arrivé",
    recalculating: "Recalcul de l'itinéraire",
    in: "dans",
    meters: "mètres",
    kilometers: "kilomètres",
    kilometer: "kilomètre",
  },
  de: {
    turnRight: (dist: string) => `Rechts abbiegen ${dist}`,
    turnLeft: (dist: string) => `Links abbiegen ${dist}`,
    continue: (dist: string) => `Geradeaus ${dist}`,
    sharpLeft: (dist: string) => `Scharf links ${dist}`,
    arrived: "Sie sind angekommen",
    recalculating: "Route wird neu berechnet",
    in: "in",
    meters: "Meter",
    kilometers: "Kilometer",
    kilometer: "Kilometer",
  },
  es: {
    turnRight: (dist: string) => `Gire a la derecha ${dist}`,
    turnLeft: (dist: string) => `Gire a la izquierda ${dist}`,
    continue: (dist: string) => `Continúe ${dist}`,
    sharpLeft: (dist: string) => `Gire bruscamente a la izquierda ${dist}`,
    arrived: "Ha llegado a su destino",
    recalculating: "Recalculando ruta",
    in: "en",
    meters: "metros",
    kilometers: "kilómetros",
    kilometer: "kilómetro",
  },
};

type Language = keyof typeof TEMPLATES;

/**
 * Formatta la distanza in modo ottimizzato per TTS
 * Sotto 1000m: "tra X metri"
 * Sopra 1000m: "tra X chilometri"
 */
export function formatDistance(meters: number, language: string = 'it'): string {
  const lang = TEMPLATES[language as Language] || TEMPLATES.it;
  
  if (meters < 50) {
    return ''; // Troppo vicino, non serve dire la distanza
  }
  
  if (meters < 1000) {
    // Arrotonda a multipli di 50 per essere più chiaro
    const rounded = Math.round(meters / 50) * 50;
    return `${lang.in} ${rounded} ${lang.meters}`;
  }
  
  // Converti in km con 1 decimale
  const km = (meters / 1000).toFixed(1);
  const kmNum = parseFloat(km);
  const unit = kmNum === 1 ? lang.kilometer : lang.kilometers;
  return `${lang.in} ${km} ${unit}`;
}

/**
 * Determina la priorità del messaggio vocale basandosi sulla distanza
 */
export function getPriorityLevel(instruction: NavInstruction | null): VoicePriority {
  if (!instruction) return VoicePriority.LOW;
  
  const meters = instruction.metri ?? instruction.remaining_dist ?? 0;
  
  // Messaggi speciali hanno priorità alta
  if (instruction.testo?.toLowerCase().includes('ricalcolo')) {
    return VoicePriority.CRITICAL;
  }
  if (instruction.testo?.toLowerCase().includes('arrivato')) {
    return VoicePriority.HIGH;
  }
  
  // Basato sulla distanza
  if (meters <= 50) return VoicePriority.CRITICAL;
  if (meters <= 150) return VoicePriority.HIGH;
  if (meters <= 500) return VoicePriority.NORMAL;
  
  return VoicePriority.LOW;
}

/**
 * Genera l'istruzione vocale ottimizzata per la moto
 * Frasi brevi, chiare, senza informazioni superflue
 */
export function generateVoiceInstruction(
  instruction: NavInstruction | null,
  language: string = 'it'
): string | null {
  if (!instruction) return null;
  
  const lang = TEMPLATES[language as Language] || TEMPLATES.it;
  const meters = instruction.metri ?? 0;
  
  // Casi speciali
  if (instruction.testo?.toLowerCase().includes('arrivato')) {
    return lang.arrived;
  }
  if (instruction.testo?.toLowerCase().includes('ricalcolo')) {
    return lang.recalculating;
  }
  
  // Genera frase basata sul tipo di freccia
  const distanceText = formatDistance(meters, language);
  
  switch (instruction.freccia) {
    case 0: // Svolta destra
      return lang.turnRight(distanceText);
    case 1: // Svolta sinistra
      return lang.turnLeft(distanceText);
    case 2: // Dritto
      return lang.continue(distanceText);
    case 3: // Svolta stretta sinistra
      return lang.sharpLeft(distanceText);
    default:
      // Fallback: usa il testo originale se disponibile
      return instruction.testo || instruction.text || null;
  }
}

/**
 * Determina se un'istruzione dovrebbe essere vocalizzata
 * basandosi sulla frequenza configurata dall'utente
 */
export function shouldSpeak(
  instruction: NavInstruction | null,
  frequency: 'minimal' | 'standard' | 'verbose'
): boolean {
  if (!instruction) return false;
  
  const meters = instruction.metri ?? 0;
  const priority = getPriorityLevel(instruction);
  
  switch (frequency) {
    case 'minimal':
      // Solo svolte imminenti e messaggi critici
      return priority >= VoicePriority.HIGH;
      
    case 'standard':
      // Svolte e preparazione
      return priority >= VoicePriority.NORMAL || meters <= 300;
      
    case 'verbose':
      // Tutto
      return true;
      
    default:
      return true;
  }
}
