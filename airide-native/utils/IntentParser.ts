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
  // Regex più flessibile per gestire errori di trascrizione comuni di Vosk (es. "porta mi", "porta via", "porta mi ha", "porta mia")
  // La preposizione è ora opzionale (?:\s+via...)? per gestire casi come "porta mia caserta" in cui la 'a' è assorbita.
  private navRegex = /(?:portami|porta\s+mi|porta\s+via|porta\s+mia|portano|vai|andiamo)(?:\s+(?:a|ad|in|verso|da|ha))?\s+(.*)/i;
  private changeRegex = /cambia percorso/i;
  private avoidHighwaysRegex = /evita autostrade/i;
  private cancelRegex = /(annulla|elimina|cancella)\s+(la\s+)?(navigazione|rotta|rutta|percorso)/i;
  private backRegex = /torna alla rotta precedente/i;

  /**
   * Normalizza l'indirizzo dal formato parlato al formato "indirizzo civico, città"
   * Supporta:
   * 1. "città in via/viale/piazza... indirizzo civico" -> "via... indirizzo civico, città"
   * 2. "via/viale/piazza... indirizzo civico città" -> "via... indirizzo civico, città"
   * 3. "via/viale/piazza... indirizzo civico a/in città" -> "via... indirizzo civico, città"
   */
  private normalizeAddress(rawAddress: string): string {
    const cleanAddress = rawAddress.trim();
    const streetPrefixes = 'via|viale|piazza|corso|largo|vicolo|piazzale|strada';

    // Pattern 1: "[città] in [via...] [indirizzo] [civico]"
    // Es: "san prisco in via circumvallazione 65"
    const cityFirstPattern = new RegExp(`^(.+?)\\s+in\\s+(${streetPrefixes})\\s+(.+)$`, 'i');
    const cityFirstMatch = cleanAddress.match(cityFirstPattern);
    
    if (cityFirstMatch) {
      const city = cityFirstMatch[1].trim();
      const streetType = cityFirstMatch[2].trim();
      const rest = cityFirstMatch[3].trim();
      return `${streetType} ${rest}, ${city}`;
    }

    // Pattern 2 & 3: "[via...] [indirizzo] [civico] (a|in) [città]" oppure "[via...] [indirizzo] [civico] [città]"
    // Questo è più complesso da separare senza un separatore chiaro, proviamo a catturare la città alla fine.
    // Assumiamo che la città sia l'ultima parte della stringa se c'è un numero civico prima.
    
    // Cerchiamo un numero seguito da spazio e poi altro testo (che assumiamo essere la città)
    // Es: "via roma 10 milano" -> "via roma 10", "milano"
    const streetFirstPattern = new RegExp(`^(${streetPrefixes})\\s+(.+?\\s+\\d+)\\s+(?:a\\s+|in\\s+)?(.+)$`, 'i');
    const streetFirstMatch = cleanAddress.match(streetFirstPattern);

    if (streetFirstMatch) {
      const streetType = streetFirstMatch[1].trim();
      const streetAndNumber = streetFirstMatch[2].trim();
      const city = streetFirstMatch[3].trim();
      return `${streetType} ${streetAndNumber}, ${city}`;
    }

    // Se non matcha i pattern complessi ma inizia con via/viale, assumiamo sia solo indirizzo
    // oppure proviamo a formattarlo meglio se possibile, ma per ora ritorniamo raw
    return cleanAddress;
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
