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
  | { type: 'YES' }
  | { type: 'NO' }
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
  
  // Confirmation Regexes
  private yesRegex = /^(sì|si|certo|ok|vai|confermo|procedi|esatto)$/i;
  private noRegex = /^(no|non|annulla|sbagliato|ferma|cancella|aspetta)$/i;

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
  };
  
  // --- CIY FIXES ---
  private cityFixes: { [key: string]: string } = {
      'sam': 'san',
      'hassam': 'san',
      'saint': 'san',
      'saints': 'san',
      'rome': 'roma',
      'naples': 'napoli',
      'florence': 'firenze',
      'venice': 'venezia',
      'milan': 'milano',
      'turin': 'torino'
  };

  /**
   * Converte le parole numeriche in cifre nella stringa
   */
  private textToDigits(text: string): string {
    return text.split(/\s+/).map(word => {
      const lower = word.toLowerCase();
      return this.numberMap[lower] || word;
    }).join(' ');
  }

  private fixCityNames(text: string): string {
      return text.split(/\s+/).map(word => {
          const lower = word.toLowerCase();
          // Simple fuzzy-ish replacement
          for (const wrong in this.cityFixes) {
              if (lower === wrong) return this.cityFixes[wrong];
              // check if word starts with wrong but is longer? maybe dangerous.
          }
          return word;
      }).join(' ');
  }

  /**
   * Normalizza l'indirizzo
   */
  private normalizeAddress(rawAddress: string): string {
    let processed = this.textToDigits(rawAddress.trim());
    processed = this.fixCityNames(processed);
    
    // ... logic for street detection (kept minimal change here to focus on cities)
    // Re-use logic from previous version or minimal update?
    // Let's copy the full previous logic but insert processed text
    
    const streetPrefixes = 'via|viale|piazza|corso|largo|vicolo|piazzale|strada|borgo|contrada|lungomare|traversa';
    const streetRegex = new RegExp(`\\b(${streetPrefixes})\\s+(.+?)\\s+(\\d+[a-z/]*)\\b`, 'i');

    const match = processed.match(streetRegex);

    if (match) {
      const fullStreetString = match[0].trim();
      const matchIndex = match.index!;
      const matchLength = fullStreetString.length;

      let afterText = processed.substring(matchIndex + matchLength).trim();
      if (afterText) {
        afterText = afterText.replace(/^(a|ad|in|presso)\s+/i, '').trim();
        afterText = afterText.replace(/^[,.-]+/, '').trim();
        if (afterText.length > 0) return `${fullStreetString}, ${afterText}`;
      }

      let beforeText = processed.substring(0, matchIndex).trim();
      if (beforeText) {
        beforeText = beforeText.replace(/\s+(in|a|ad)$/i, '').trim();
        beforeText = beforeText.replace(/[,.-]+$/, '').trim();
        if (beforeText.length > 0) return `${fullStreetString}, ${beforeText}`;
      }

      return fullStreetString;
    }

    return processed;
  }

  // Metodo parse principale
  parse(text: string, options?: { skipWakeWordCheck?: boolean }): VoiceIntent {
    const cleanText = text.trim().toLowerCase();
    const hasWakeWord = this.wakeWordRegex.test(cleanText);

    if (!options?.skipWakeWordCheck && !hasWakeWord) {
        // Here we could check for YES/NO directly if we are expecting it?
        // But IntentParser is stateless. The caller knows if it expects YES/NO.
        // We will return YES/NO if it matches, caller decides if valid.
        
        // Wait, if no wake word, we usually return UNKNOWN.
        // But for confirmation flow, user might just say "Si".
        // The BackgroundNavigation will handle "listening without wake word" for confirmations?
        // Or we assume wake word is always needed? User said "pronto a partire? e alla risposta affermativa".
        // Usually, in a convo flow, you don't repeat wake word immediately.
        // So we should allow parsing YES/NO without wake word if checking via specific flow.
        return { type: 'UNKNOWN', rawText: text };
    }

    let commandText = cleanText;
    if (hasWakeWord) {
        const match = cleanText.match(this.wakeWordRegex);
        if (match && match.index !== undefined) {
             commandText = cleanText.substring(match.index + match[0].length).trim();
        } else {
             commandText = cleanText.replace(this.wakeWordRegex, '').trim();
        }
    }
    
    // If just wake word, maybe we return something else? for now OK.

    if (commandText.length === 0 && hasWakeWord) {
        return { type: 'UNKNOWN', rawText: text };
    }
    
    // Check YES/NO
    if (this.yesRegex.test(commandText)) return { type: 'YES' };
    if (this.noRegex.test(commandText)) return { type: 'NO' };

    // Info
    if (this.timeRegex.test(commandText)) return { type: 'GET_TIME' };
    if (this.remainingRegex.test(commandText)) return { type: 'GET_REMAINING_INFO' };
    if (this.notificationRegex.test(commandText)) return { type: 'CHECK_NOTIFICATIONS' };

    // Navigazione
    const navMatch = commandText.match(this.navRegex);
    if (navMatch) {
      const rawDestination = navMatch[1] || 'destinazione';
      const destination = this.normalizeAddress(rawDestination);
      return { type: 'NAVIGATE_TO', destination };
    }

    if (this.avoidHighwaysRegex.test(commandText)) return { type: 'CHANGE_ROUTE', avoid: ['highways'] };
    if (this.changeRegex.test(commandText)) {
         // Se dice "cambia percorso in via roma"
         // Dobbiamo estrarre la destinazione se c'è
         const destMatch = commandText.replace(this.changeRegex, '').trim();
         // remove "in" or "per"
         const destClean = destMatch.replace(/^(in|per|a)\s+/i, '');
         
         if (destClean.length > 2) {
             const destination = this.normalizeAddress(destClean);
             return { type: 'NAVIGATE_TO', destination }; // Treat as new navigation? Or special change?
             // User asked "cambia la rotta in ...". effectively a new navigate to.
         }
         return { type: 'CHANGE_ROUTE' };
    }
    
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