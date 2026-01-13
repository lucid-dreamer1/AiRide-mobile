/**
 * Rappresenta un intento strutturato derivato dal comando vocale
 */
export type VoiceIntent =
  | { type: 'NAVIGATE_TO'; destination: string }
  | { type: 'CHANGE_ROUTE'; avoid?: string[] }
  | { type: 'CANCEL_NAVIGATION' }
  | { type: 'RECALCULATE_ROUTE' }
  | { type: 'RETURN_TO_PREVIOUS_ROUTE' }
  | { type: 'UNKNOWN'; rawText: string };

/**
 * Modulo per il parsing dei comandi vocali in intent strutturati.
 */
export class IntentParser {
  private navRegex = /portami a (.*)/i;
  private changeRegex = /cambia percorso/i;
  private avoidHighwaysRegex = /evita autostrade/i;
  private cancelRegex = /annulla navigazione/i;
  private backRegex = /torna alla rotta precedente/i;

  parse(text: string): VoiceIntent {
    const cleanText = text.trim().toLowerCase();

    // Verifica "portami a..."
    const navMatch = cleanText.match(this.navRegex);
    if (navMatch) {
      return { type: 'NAVIGATE_TO', destination: navMatch[1] || 'destinazione' };
    }

    // Verifica "evita autostrade"
    if (this.avoidHighwaysRegex.test(cleanText)) {
      return { type: 'CHANGE_ROUTE', avoid: ['highways'] };
    }

    // Verifica altri comandi fissi
    if (this.changeRegex.test(cleanText)) return { type: 'CHANGE_ROUTE' };
    if (this.cancelRegex.test(cleanText)) return { type: 'CANCEL_NAVIGATION' };
    if (this.backRegex.test(cleanText)) return { type: 'RETURN_TO_PREVIOUS_ROUTE' };
    if (cleanText.includes('ricalcola')) return { type: 'RECALCULATE_ROUTE' };

    return { type: 'UNKNOWN', rawText: text };
  }
}
