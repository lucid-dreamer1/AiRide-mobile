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

  private wakeWordRegex = /\b(hey|ehy|ehi|hei|ei|eh|hai|ok|ciao|e|è|i|il|el|al|un|a)(\s+(il|i|lo|l|un))?\s+casco\b/i;

  // ─────────────────────────────────────────
  // YES / NO  — tutte le lingue
  // ─────────────────────────────────────────
  // YES/NO: pronuncia reale + varianti fonetiche Vosk-italiano
  // "yes" -> Vosk trascrive: "ex", "gli ex", "ies", "jes"
  // "ja"  -> "ia"; "oui" -> "ui"
  private yesRegex = /^(si|sì|certo|ok|vai|confermo|procedi|esatto|yes|yep|sure|confirm|go|ja|oui|ouais|bien|claro|sí|correcto|ex|ies|jes|ia|ui|dai|grande|perfetto)$|^gli\s+ex$/i;
  // "no"  -> Vosk trascrive: "nau", "nou"; "nein" -> "nain"
  private noRegex  = /^(no|non|annulla|sbagliato|ferma|cancella|aspetta|nope|cancel|stop|nein|stopp|nee|nicht|annuler|não|nau|nou|nò|nain|nop)$/i;

  // ─────────────────────────────────────────
  // NAVIGAZIONE — IT / EN / FR / DE / ES
  // ─────────────────────────────────────────
  private navRegexIT = /(?:portami|porta\s*(?:mi|me|via|mia)|vai|andiamo|naviga verso|vado a|naviga a)(?:\s+(?:a|ad|in|verso|da|ha))?\s+(.*)/i;
  // EN — pronuncia reale + fonetica italiana di Vosk (es. "teikmito" → "take me to")
  private navRegexEN = /(?:take\s*me\s*to|teik\s*mi\s*tu|navigate\s*to|navigheita|go\s*to|head\s*to|directions\s*to|drive\s*to|get\s*me\s*to|ghetto)\s+(.*)/i;
  // FR — pronuncia reale + fonetica italiana di Vosk
  private navRegexFR = /(?:emmène-?moi\s*[àa]|amene\s*mua|aller\s*[àa]|alle\s*a|naviguer\s*vers|va\s*[àa]|conduire\s*[àa])\s+(.*)/i;
  // DE — pronuncia reale + fonetica italiana di Vosk (es. "far nac" → "fahr nach")
  private navRegexDE = /(?:fahr?\s*nach|far\s*nac|navigiere\s*nach|bring\s*mich\s*nach|geh\s*nach|route\s*nach|rut\s*nac)\s+(.*)/i;
  // ES — pronuncia reale + fonetica italiana di Vosk
  private navRegexES = /(?:ll[eé]vame\s*a|ievame\s*a|ir\s*a|navegar\s*[aàhá]|navegar\s*hacia|conducir\s*a|dir[íi]gete\s*a)\s+(.*)/i;

  // ─────────────────────────────────────────
  // CANCELLA NAVIGAZIONE
  // ─────────────────────────────────────────
  private cancelRegex = /\b(annulla|elimina|cancella|termina|stop|cancel|end|stop navigation|beende|abbrechen|annuler|navigation beenden|cancelar|detener)\s*(la\s+)?(navigazione|rotta|percorso|viaggio|navigation|route|Routenführung|navigación|ruta)?\b/i;

  // ─────────────────────────────────────────
  // CAMBIA ROTTA
  // ─────────────────────────────────────────
  private changeRegex       = /cambia\s*(il\s*)?(percorso|rotta)|change\s*route|changer\s*l['']?itinéraire|route\s*ändern|cambiar\s*ruta/i;
  private avoidHighwaysRegex = /evita autostrade|avoid highways?|éviter autoroutes?|autobahn meiden|evitar autopistas?/i;
  private backRegex         = /torna alla rotta precedente|go back to previous route|revenir à l'itinéraire précédent|zurück zur vorherigen Route|volver a la ruta anterior/i;
  private recalcRegex       = /ricalcola|recalculate|recalculer|neu berechnen|recalcular/i;

  // ─────────────────────────────────────────
  // INFO
  // ─────────────────────────────────────────
  private timeRegex = /che\s+ore\s+sono|che\s+ora\s+è|orario|what time is it|quelle heure est.?il|wie spät ist es|qué hora es/i;
  private remainingRegex = /quanto\s+manca|distanza\s+rimanente|how much further|how far|combien reste.?t.?il|wie weit noch|cuánto falta/i;
  private notificationRegex = /ho\s+notifiche|leggi\s+notifiche|controlla\s+notifiche|any notifications|mes notifications|meine Benachrichtigungen|mis notificaciones/i;

  // ─────────────────────────────────────────
  // CHIAMATE
  // ─────────────────────────────────────────
  private callRegex   = /(?:chiama|call|appelle|ruf|llama)\s+(.*)/i;
  private answerRegex = /rispondi|pronto|rispondere|answer|répondre|annehmen|contestar/i;
  private hangupRegex = /attacca|termina chiamata|chiudi chiamata|metti giù|hang up|raccrocher|auflegen|colgar/i;

  // ─────────────────────────────────────────
  // NUMBER MAP (IT + EN + FR + DE + ES)
  // ─────────────────────────────────────────
  private numberMap: Record<string, string> = {
    // IT
    'uno':'1','due':'2','tre':'3','quattro':'4','cinque':'5',
    'sei':'6','sette':'7','otto':'8','nove':'9','dieci':'10',
    'undici':'11','dodici':'12','trenta':'30','cinquanta':'50','cento':'100',
    // EN
    'one':'1','two':'2','three':'3','four':'4','five':'5',
    'six':'6','seven':'7','eight':'8','nine':'9','ten':'10',
    'eleven':'11','twelve':'12','thirty':'30','fifty':'50','hundred':'100',
    // FR
    'un':'1','deux':'2','cinq':'5','dix':'10','onze':'11','douze':'12','trente':'30','cent':'100',
    // DE
    'ein':'1','zwei':'2','drei':'3','vier':'4','fünf':'5',
    'sechs':'6','sieben':'7','acht':'8','neun':'9','zehn':'10',
    // ES
    'dos':'2','cuatro':'4','seis':'6','ocho':'8','nueve':'9','diez':'10',
  };

  private cityFixes: Record<string, string> = {
    'sam':'san','hassam':'san','saint':'san','saints':'san',
    'rome':'roma','naples':'napoli','florence':'firenze',
    'venice':'venezia','milan':'milano','turin':'torino',
    // EN variants
    'munich':'münchen','cologne':'köln','vienna':'wien',
    // ES/FR
    'barcelone':'barcelona','paris':'paris','berlin':'berlin',
  };

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────
  private textToDigits(text: string): string {
    return text.split(/\s+/).map(w => this.numberMap[w.toLowerCase()] ?? w).join(' ');
  }

  private fixCityNames(text: string): string {
    return text.split(/\s+/).map(w => {
      const lower = w.toLowerCase();
      return this.cityFixes[lower] ?? w;
    }).join(' ');
  }

  private normalizeAddress(raw: string): string {
    let t = this.textToDigits(raw.trim());
    t = this.fixCityNames(t);

    const streetPrefixes = 'via|viale|piazza|corso|largo|vicolo|piazzale|strada|borgo|contrada|lungomare|traversa|street|avenue|road|boulevard|rue|strasse|straße|calle|avenida';
    const streetRegex = new RegExp(`\\b(${streetPrefixes})\\s+(.+?)\\s+(\\d+[a-z/]*)\\b`, 'i');
    const match = t.match(streetRegex);

    if (match) {
      const full = match[0].trim();
      const idx = match.index!;
      let after = t.substring(idx + full.length).trim().replace(/^(a|ad|in|presso|in|at|near)\s+/i, '').replace(/^[,.-]+/, '').trim();
      if (after.length > 0) return `${full}, ${after}`;
      let before = t.substring(0, idx).trim().replace(/\s+(in|a|ad|in|at)$/i, '').replace(/[,.-]+$/, '').trim();
      if (before.length > 0) return `${full}, ${before}`;
      return full;
    }

    return t;
  }

  // ─────────────────────────────────────────
  // PARSE
  // ─────────────────────────────────────────
  parse(text: string, options?: { skipWakeWordCheck?: boolean }): VoiceIntent {
    const clean = text.trim().toLowerCase();
    const hasWakeWord = this.wakeWordRegex.test(clean);

    if (!options?.skipWakeWordCheck && !hasWakeWord) {
      return { type: 'UNKNOWN', rawText: text };
    }

    // Strip wake word from command text
    let cmd = clean;
    if (hasWakeWord) {
      const m = clean.match(this.wakeWordRegex);
      cmd = m ? clean.substring(m.index! + m[0].length).trim() : clean.replace(this.wakeWordRegex, '').trim();
    }

    if (cmd.length === 0 && hasWakeWord) return { type: 'UNKNOWN', rawText: text };

    // YES / NO
    if (this.yesRegex.test(cmd))  return { type: 'YES' };
    if (this.noRegex.test(cmd))   return { type: 'NO' };

    // INFO
    if (this.timeRegex.test(cmd))          return { type: 'GET_TIME' };
    if (this.remainingRegex.test(cmd))     return { type: 'GET_REMAINING_INFO' };
    if (this.notificationRegex.test(cmd))  return { type: 'CHECK_NOTIFICATIONS' };

    // NAVIGAZIONE — prova tutte le lingue
    for (const regex of [this.navRegexIT, this.navRegexEN, this.navRegexFR, this.navRegexDE, this.navRegexES]) {
      const m = cmd.match(regex);
      if (m) {
        const destination = this.normalizeAddress(m[1] || 'destinazione');
        return { type: 'NAVIGATE_TO', destination };
      }
    }

    // CAMBIA ROTTA
    if (this.avoidHighwaysRegex.test(cmd)) return { type: 'CHANGE_ROUTE', avoid: ['highways'] };
    if (this.changeRegex.test(cmd)) {
      const destPart = cmd.replace(this.changeRegex, '').replace(/^(in|per|a|to|nach|à|en|a)\s+/i, '').trim();
      if (destPart.length > 2) return { type: 'NAVIGATE_TO', destination: this.normalizeAddress(destPart) };
      return { type: 'CHANGE_ROUTE' };
    }
    if (this.cancelRegex.test(cmd))  return { type: 'CANCEL_NAVIGATION' };
    if (this.backRegex.test(cmd))    return { type: 'RETURN_TO_PREVIOUS_ROUTE' };
    if (this.recalcRegex.test(cmd))  return { type: 'RECALCULATE_ROUTE' };

    // CHIAMATE
    const callMatch = cmd.match(this.callRegex);
    if (callMatch) return { type: 'CALL_CONTACT', contactName: callMatch[1].trim() };
    if (this.answerRegex.test(cmd)) return { type: 'ANSWER_CALL' };
    if (this.hangupRegex.test(cmd)) return { type: 'HANG_UP' };

    return { type: 'UNKNOWN', rawText: text };
  }
}