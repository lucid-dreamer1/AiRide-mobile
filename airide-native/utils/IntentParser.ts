export type VoiceIntent =
  | { type: 'NAVIGATE_TO'; destination: string }
  | { type: 'CHANGE_ROUTE'; avoid?: string[] }
  | { type: 'CANCEL_NAVIGATION' }
  | { type: 'RECALCULATE_ROUTE' }
  | { type: 'RETURN_TO_PREVIOUS_ROUTE' }
  | { type: 'CALL_CONTACT'; contactName: string }
  | { type: 'ANSWER_CALL' }
  | { type: 'HANG_UP' }
  | { type: 'GET_TIME' }
  | { type: 'GET_REMAINING_INFO' }
  | { type: 'CHECK_NOTIFICATIONS' }
  | { type: 'UNKNOWN'; rawText: string };

export class IntentParser {
  // Regex navigazione (invariata)
  private navRegex = /(?:portami|porta\s+(?:mi|me|via|mia)|portano|vai|andiamo)(?:\s+(?:a|ad|in|verso|da|ha))?\s+(.*)/i;
  // Altre regex (invariate)
  private changeRegex = /cambia percorso/i;
  private avoidHighwaysRegex = /evita autostrade/i;
  private cancelRegex = /(annulla|elimina|cancella|termina|stop)\s+(la\s+)?(navigazione|rotta|rutta|percorso|viaggio)/i;
  private backRegex = /torna alla rotta precedente/i;
  private wakeWordRegex = /\b(hey|ehy|ehi|hei|ei|eh|hai|ok|ciao|e|è|i|il|el|al|un|a)(\s+(il|i|lo|l|un))?\s+casco\b/i;

  // New Regexes
  private timeRegex = /(che\s+(ore|ora)\s+(sono|è)|orario)/i;
  private remainingRegex = /(quanto\s+manca|tempo\s+rimanente|distanza\s+rimanente)/i;
  private notificationRegex = /(ho\s+notifiche|leggi\s+notifiche|controlla\s+notifiche)/i;

  // --- MAPPA PAROLE -> NUMERI ---
  // Vosk trascrive spesso i numeri civici in lettere. Li convertiamo per la regex.
  private numberMap: { [key: string]: string } = {
    'uno': '1', 'due': '2', 'tre': '3', 'quattro': '4', 'cinque': '5',
    'sei': '6', 'sette': '7', 'otto': '8', 'nove': '9', 'dieci': '10',
    'undici': '11', 'dodici': '12', 'tredici': '13', 'quattordici': '14', 'quindici': '15',
    'sedici': '16', 'diciassette': '17', 'diciotto': '18', 'diciannove': '19', 'venti': '20',
    'ventuno': '21', 'ventidue': '22', 'ventitre': '23', 'ventiquattro': '24', 'venticinque': '25',
    'trenta': '30', 'quaranta': '40', 'cinquanta': '50', 'sessanta': '60', 'settanta': '70', 
    'ottanta': '80', 'novanta': '90', 'cento': '100'
    // Puoi estendere se necessario, ma copre il 99% dei civici comuni dettati
  };

  /**
   * Converte le parole numeriche in cifre nella stringa
   * Es: "via roma dodici" -> "via roma 12"
   */
  private textToDigits(text: string): string {
    return text.split(/\s+/).map(word => {
      const lower = word.toLowerCase();
      // Ritorna il numero se esiste nella mappa, altrimenti la parola originale
      return this.numberMap[lower] || word;
    }).join(' ');
  }

  /**
   * Normalizza l'indirizzo gestendo numeri in lettere e separazione città
   */
  private normalizeAddress(rawAddress: string): string {
    // 1. PRIMA COSA: Convertiamo "dodici" in "12"
    const textWithDigits = this.textToDigits(rawAddress.trim());
    
    const streetPrefixes = 'via|viale|piazza|corso|largo|vicolo|piazzale|strada|borgo|contrada|lungomare|traversa';

    // Regex che cerca: Prefisso + Nome Via + Numero (ora in cifre)
    // Es: "via roma 12" matcherà anche se l'utente ha detto "dodici" grazie a textToDigits
    const streetRegex = new RegExp(`\\b(${streetPrefixes})\\s+(.+?)\\s+(\\d+[a-z/]*)\\b`, 'i');

    const match = textWithDigits.match(streetRegex);

    if (match) {
      const fullStreetString = match[0].trim(); // "via roma 12"
      const matchIndex = match.index!;
      const matchLength = fullStreetString.length;

      // Cerca città DOPO (es. "via roma 12 caserta")
      let afterText = textWithDigits.substring(matchIndex + matchLength).trim();
      if (afterText) {
        afterText = afterText.replace(/^(a|ad|in|presso)\s+/i, '').trim();
        afterText = afterText.replace(/^[,.-]+/, '').trim();
        if (afterText.length > 0) return `${fullStreetString}, ${afterText}`;
      }

      // Cerca città PRIMA (es. "caserta via roma 12")
      let beforeText = textWithDigits.substring(0, matchIndex).trim();
      if (beforeText) {
        beforeText = beforeText.replace(/\s+(in|a|ad)$/i, '').trim();
        beforeText = beforeText.replace(/[,.-]+$/, '').trim();
        if (beforeText.length > 0) return `${fullStreetString}, ${beforeText}`;
      }

      return fullStreetString;
    }

    return textWithDigits;
  }

  // Metodo parse principale
  parse(text: string, options?: { skipWakeWordCheck?: boolean }): VoiceIntent {
    const cleanText = text.trim().toLowerCase();
    const hasWakeWord = this.wakeWordRegex.test(cleanText);

    if (!options?.skipWakeWordCheck && !hasWakeWord) {
        return { type: 'UNKNOWN', rawText: text };
    }

    let commandText = cleanText;
    if (hasWakeWord) {
        // Miglioramento: scarta tutto ciò che c'è prima della wake word
        const match = cleanText.match(this.wakeWordRegex);
        if (match && match.index !== undefined) {
             commandText = cleanText.substring(match.index + match[0].length).trim();
        } else {
             // Fallback classico (non dovrebbe succedere se hasWakeWord=true)
             commandText = cleanText.replace(this.wakeWordRegex, '').trim();
        }
    }

    if (commandText.length === 0 && hasWakeWord) {
        return { type: 'UNKNOWN', rawText: text };
    }

    // Info
    if (this.timeRegex.test(commandText)) return { type: 'GET_TIME' };
    if (this.remainingRegex.test(commandText)) return { type: 'GET_REMAINING_INFO' };
    if (this.notificationRegex.test(commandText)) return { type: 'CHECK_NOTIFICATIONS' };

    // Navigazione
    const navMatch = commandText.match(this.navRegex);
    if (navMatch) {
      const rawDestination = navMatch[1] || 'destinazione';
      // Ora chiamiamo normalizeAddress che gestisce "dodici" -> "12"
      const destination = this.normalizeAddress(rawDestination);
      return { type: 'NAVIGATE_TO', destination };
    }

    if (this.avoidHighwaysRegex.test(commandText)) return { type: 'CHANGE_ROUTE', avoid: ['highways'] };
    if (this.changeRegex.test(commandText)) return { type: 'CHANGE_ROUTE' };
    if (this.cancelRegex.test(commandText)) return { type: 'CANCEL_NAVIGATION' };
    if (this.backRegex.test(commandText)) return { type: 'RETURN_TO_PREVIOUS_ROUTE' };
    if (commandText.includes('ricalcola')) return { type: 'RECALCULATE_ROUTE' };

    // Chiamate
    if (commandText.match(/chiama\s+(.*)/i)) {
      const match = commandText.match(/chiama\s+(.*)/i);
      return { type: 'CALL_CONTACT', contactName: match ? match[1].trim() : '' };
    }
    if (commandText.match(/(rispondi|pronto|rispondere)/i)) return { type: 'ANSWER_CALL' };
    if (commandText.match(/(attacca|termina|chiudi|metti giù|stop\s+chiamata)/i)) return { type: 'HANG_UP' };

    return { type: 'UNKNOWN', rawText: text };
  }
}