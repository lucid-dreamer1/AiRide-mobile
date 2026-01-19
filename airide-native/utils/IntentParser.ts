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
  private cancelRegex = /(annulla|elimina|cancella|termina|stop)\s+(la\s+)?(navigazione|rotta|rutta|percorso|viaggio)/i;
  private backRegex = /torna alla rotta precedente/i;
  private wakeWordRegex = /\b(hey|ehi|ei|e il|il|a il|al|ok)\s+casco/i;

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

    // Pattern: "[città] (in) via/viale... [indirizzo]"
    // L'uso di "in" è ora opzionale
    const addressPattern = /^(.+?)\s+(?:in\s+)?(via|viale|piazza|corso|largo|vicolo|strada)\s+(.+)$/i;
    const match = rawAddress.match(addressPattern);
    
    if (match) {
      const city = match[1].trim();
      const streetType = match[2].trim();
      const streetAddress = match[3].trim();
      // Ricostruisci: "via roma 13, caserta"
      return `${streetType} ${streetAddress}, ${city}`;
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

  /**
   * Effettua il parsing del testo.
   * @param text Il testo da analizzare
   * @param options Opzioni di parsing. 
   *                skipWakeWordCheck: se true, analizza il comando anche se manca la wake word (es. comando in un secondo segmento).
   */
  parse(text: string, options?: { skipWakeWordCheck?: boolean }): VoiceIntent {
    const cleanText = text.trim().toLowerCase();
    const hasWakeWord = this.wakeWordRegex.test(cleanText);

    // Se dobbiamo controllare la wake word e non c'è -> UNKNOWN
    if (!options?.skipWakeWordCheck && !hasWakeWord) {
        return { type: 'UNKNOWN', rawText: text };
    }

    // Rimuovi la wake word se presente per analizzare il comando
    let commandText = cleanText;
    if (hasWakeWord) {
        commandText = cleanText.replace(this.wakeWordRegex, '').trim();
    }

    // Se dopo aver rimosso la wake word il testo è vuoto, significa che l'utente ha detto solo "Hey Casco"
    if (commandText.length === 0 && hasWakeWord) {
        // Aggiungiamo un tipo speciale o gestiamo come UNKNOWN ma sapendo che è una wake word?
        // Per ora ritorniamo UNKNOWN ma l'hook potrà usare hasWakeWord logic se volessimo esporlo.
        // Meglio: ritorniamo un intent nullo o specifico.
        // Dato che VoiceIntent è un tipo definito, aggiungiamo 'WAKE_WORD_ONLY' agli intent possibili ma richiederebbe refactoring dei tipi.
        // Per semplicità, consideriamolo UNKNOWN per ora, MA l'hook deve sapere che abbiamo rilevato la wake word.
        // Facciamo che parse ritorna anche info extra? No, manteniamo l'interfaccia.
        
        // TRUCCO: Ritorniamo un intent speciale temporaneo se vogliamo, ma per ora l'hook gestirà la logica wake word based su regex raw.
        return { type: 'UNKNOWN', rawText: text };
    }

    // Verifica "portami a..."
    const navMatch = commandText.match(this.navRegex);
    if (navMatch) {
      const rawDestination = navMatch[1] || 'destinazione';
      const destination = this.normalizeAddress(rawDestination);
      return { type: 'NAVIGATE_TO', destination };
    }

    // Verifica "evita autostrade"
    if (this.avoidHighwaysRegex.test(commandText)) {
      return { type: 'CHANGE_ROUTE', avoid: ['highways'] };
    }

    // Verifica altri comandi fissi
    if (this.changeRegex.test(commandText)) return { type: 'CHANGE_ROUTE' };
    if (this.cancelRegex.test(commandText)) return { type: 'CANCEL_NAVIGATION' };
    if (this.backRegex.test(commandText)) return { type: 'RETURN_TO_PREVIOUS_ROUTE' };
    if (commandText.includes('ricalcola')) return { type: 'RECALCULATE_ROUTE' };

    return { type: 'UNKNOWN', rawText: text };
  }
}
