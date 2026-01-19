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
  private cancelRegex = /(annulla|elimina|cancella|termina|stop)\s+(la\s+)?(navigazione|rotta|rutta|percorso|viaggio)/i;
  private backRegex = /torna alla rotta precedente/i;
  private wakeWordRegex = /\b(hey|ehi|ei|e il|il|a il|al|ok)\s+casco/i;

  /**
   * Normalizza l'indirizzo dal formato parlato al formato "indirizzo, città"
   * Esempio: "san prisco in via circumvallazione 65" -> "via circumvallazione 65, san prisco"
   * Esempio: "caserta via roma 13" -> "via roma 13, caserta"
   */
  private normalizeAddress(rawAddress: string): string {
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
    
    // Se non matcha il pattern, ritorna l'indirizzo così com'è
    return rawAddress;
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
