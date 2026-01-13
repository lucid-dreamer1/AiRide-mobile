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
  private cancelRegex = /(annulla|elimina|cancella)\s+(la\s+)?(navigazione|rotta|rutta|percorso)/i;
  private backRegex = /torna alla rotta precedente/i;

  /**
   * Normalizza l'indirizzo dal formato parlato al formato "indirizzo, città"
   * Esempio: "san prisco in via circumvallazione 65" -> "via circumvallazione 65, san prisco"
   */
  private normalizeAddress(rawAddress: string): string {
    // Pattern: "[città] in via/viale/piazza/corso [indirizzo]"
    const addressPattern = /^(.+?)\s+in\s+(via|viale|piazza|corso|largo|vicolo)\s+(.+)$/i;
    const match = rawAddress.match(addressPattern);
    
    if (match) {
      const city = match[1].trim();
      const streetType = match[2].trim();
      const streetAddress = match[3].trim();
      return `${streetType} ${streetAddress}, ${city}`;
    }
    
    // Se non matcha il pattern, ritorna l'indirizzo così com'è
    return rawAddress;
  }

  parse(text: string): VoiceIntent {
    const cleanText = text.trim().toLowerCase();

    // Verifica "portami a..."
    const navMatch = cleanText.match(this.navRegex);
    if (navMatch) {
      const rawDestination = navMatch[1] || 'destinazione';
      const destination = this.normalizeAddress(rawDestination);
      return { type: 'NAVIGATE_TO', destination };
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
