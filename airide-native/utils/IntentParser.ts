export type VoiceIntent =
  | { type: 'NAVIGATE_TO'; destination: string; destinationName?: string }
  | { type: 'NAVIGATE_HOME' }
  | { type: 'NAVIGATE_WORK' }
  | { type: 'FIND_GAS_STATION' }
  | { type: 'FIND_FOOD' }
  | { type: 'FIND_MECHANIC' }
  | { type: 'NEXT_POI' }
  | { type: 'REPEAT_INSTRUCTION' }
  | { type: 'GET_SPEED' }
  | { type: 'GET_HELMET_STATUS' }
  | { type: 'GET_ETA' }
  | { type: 'TOGGLE_VOICE_MUTE'; action?: 'mute' | 'unmute' | 'toggle' }
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
  | { type: 'RADIO_PLAY'; station?: string }
  | { type: 'RADIO_STOP' }
  | { type: 'RADIO_NEXT' }
  | { type: 'RADIO_PREV' }
  | { type: 'RADIO_VOLUME'; level: 'up' | 'down' | number }
  | { type: 'RADIO_INFO' }
  | { type: 'INTERCOM_ON' }
  | { type: 'INTERCOM_OFF' }
  | { type: 'INTERCOM_WITH_FRIEND'; friendName: string }
  | { type: 'INTERCOM_REPLAY' }
  | { type: 'INTERCOM_STATUS' }
  | { type: 'REACH_FRIEND'; friendName: string }
  | { type: 'YES' }
  | { type: 'NO' }
  | { type: 'UNKNOWN'; rawText: string };

/**
 * Calcola la distanza di Levenshtein tra due parole per fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Verifica se un token ha una corrispondenza fuzzy con una lista di parole target
 * con tolleranza max di 1 o 2 caratteri (in base alla lunghezza)
 */
function matchesFuzzy(token: string, targets: string[]): boolean {
  const clean = token.toLowerCase();
  for (const t of targets) {
    if (clean === t) return true;
    const maxDist = t.length >= 7 ? 2 : 1;
    if (Math.abs(clean.length - t.length) <= maxDist) {
      if (levenshteinDistance(clean, t) <= maxDist) {
        return true;
      }
    }
  }
  return false;
}

export class IntentParser {

  // Wake word rigorosa: richiede vocativo esplicito (hey, ehi, ok, ciao) + casco.
  // ELIMINATE le vocali singole isolate (e, è, a, i, un) che scattavano per vento o rumore del motore!
  public static readonly WAKE_WORD_REGEX = /\b(hey|ehy|ehi|hei|ok|ciao)(\s+(il|mio))?\s+casco\b/i;

  private wakeWordRegex = IntentParser.WAKE_WORD_REGEX;

  // ─────────────────────────────────────────
  // YES / NO  — tutte le lingue con varianti fonetiche Vosk
  // ─────────────────────────────────────────
  private yesRegex = /^(si|sì|certo|ok|vai|confermo|procedi|esatto|yes|yep|sure|confirm|go|ja|oui|ouais|bien|claro|sí|correcto|ex|ies|jes|ia|ui|dai|grande|perfetto|assolutamente|andiamo|facciamolo|ci sto|d'accordo|daccordo|va bene|va benissimo|andiamo lì|andiamo là|portami lì|portami là|mi va bene|quello va bene|quello lì|ok perfetto|sì vai|si vai|forza)$|^gli\s+ex$/i;
  private noRegex  = /^(no|non|annulla|sbagliato|ferma|cancella|aspetta|nope|cancel|stop|nein|stopp|nee|nicht|annuler|não|nau|nou|nò|nain|nop|lascia stare|non mi va|non voglio|basta|lascia perdere|skip|salta|no grazie|neanche|nemmeno)$/i;

  // ─────────────────────────────────────────
  // POI & RICERCHE SMART (MOTO-CENTRIC)
  // ─────────────────────────────────────────
  private gasStationRegex = /\b(benzina|benzinaio|benzinai|benzinaro|distributore|distributori|rifornimento|carburante|benza|fai benzina|pompa di benzina|gas station|petrol|station service|tankstelle|gasolinera)\b/i;
  private foodRegex       = /\b(ristorante|ristoranti|bar|trattoria|pizzeria|osteria|paninoteca|da mangiare|posto per mangiare|ho fame|cibo|pranzo|cena|caffè|caffe|restaurant|food|essen|comida)\b/i;
  private mechanicRegex   = /\b(officina|meccanico|gommista|elettrauto|riparazione moto|officine|garage moto|mechanic|werkstatt|taller)\b/i;
  private nextPoiRegex    = /\b(un\s+altro|un['’]altra|altro|altra|altri|altre|prossimo|prossima|successivo|successiva|ce\s+n['’]è\s+un\s+altro|ce\s+ne\s+sono\s+altri|mostra\s+un\s+altro|mostrami\s+un\s+altro|cambia\s+posto|un\s+posto\s+diverso|secondo|terzo|next|another|autre|autre\s+chose|nächste|otro|otra)\b/i;

  // ─────────────────────────────────────────
  // DESTINAZIONI SALVATE (HOME & WORK)
  // ─────────────────────────────────────────
  private homeRegex = /\b(a\s+casa|verso\s+casa|torniamo\s+casa|rientra\s+a\s+casa|ritorno\s+a\s+casa|go\s+home|take\s+me\s+home|nach\s+hause|à\s+la\s+maison|a\s+mi\s+casa)\b/i;
  private workRegex = /\b(al\s+lavoro|in\s+ufficio|verso\s+il\s+lavoro|al\s+posto\s+di\s+lavoro|to\s+work|to\s+the\s+office|zur\s+arbeit|au\s+travail|al\s+trabajo)\b/i;

  // ─────────────────────────────────────────
  // TELEMETRIA E CONTROLLO VOCALE IN MOTO
  // ─────────────────────────────────────────
  private repeatInstructionRegex = /\b(ripeti|ripeti indicazione|ripeti svolta|cosa devo fare|dove vado|che svolta devo fare|non ho sentito|ripetere|repeat|what should i do|répète|wiederholen|repite)\b/i;
  private speedRegex             = /\b(velocità|velocita|quanto vado|a che velocità|velocità attuale|andatura|current speed|how fast|quelle vitesse|wie schnell|qué velocidad)\b/i;
  private helmetStatusRegex      = /\b(stato (del )?casco|batteria (del )?casco|casco connesso|connessione (del )?casco|helmet status|batterie casque|helm status|estado del casco)\b/i;
  private etaRegex               = /\b(a che ora arrivo|orario di arrivo|ora di arrivo|quando arriviamo|quando arrivo|tempo stimato di arrivo|eta|arrival time|heure d'arrivée|ankunftszeit|hora de llegada)\b/i;

  // ─────────────────────────────────────────
  // MUTE / UNMUTE VOCE GUIDA
  // ─────────────────────────────────────────
  private muteVoiceRegex   = /\b(silenzia( la)? voce|muta( la)? voce|disattiva( la)? voce|silenzia assistente|non parlare|zitto|silenzioso|mute voice|quiet|tais-toi|stummschalten|silenciar)\b/i;
  private unmuteVoiceRegex = /\b(attiva( la)? voce|riattiva( la)? voce|riabilita voce|parla|unmute|unmute voice|parle|laut schalten|activar voz)\b/i;

  // ─────────────────────────────────────────
  // NAVIGAZIONE — IT / EN / FR / DE / ES
  // ─────────────────────────────────────────
  private navRegexIT = /(?:portami|porta\s*(?:mi|me|via|mia)|vai|andiamo|naviga verso|vado a|naviga a|imposta rotta verso|conducimi a)(?:\s+(?:a|ad|in|verso|da|ha))?\s+(.*)/i;
  private navRegexEN = /(?:take\s*me\s*to|teik\s*mi\s*tu|navigate\s*to|navigheita|go\s*to|head\s*to|directions\s*to|drive\s*to|get\s*me\s*to|ghetto)\s+(.*)/i;
  private navRegexFR = /(?:emmène-?moi\s*[àa]|amene\s*mua|aller\s*[àa]|alle\s*a|naviguer\s*vers|va\s*[àa]|conduire\s*[àa])\s+(.*)/i;
  private navRegexDE = /(?:fahr?\s*nach|far\s*nac|navigiere\s*nach|bring\s*mich\s*nach|geh\s*nach|route\s*nach|rut\s*nac)\s+(.*)/i;
  private navRegexES = /(?:ll[eé]vame\s*a|ievame\s*a|ir\s*a|navegar\s*[aàhá]|navegar\s*hacia|conducir\s*a|dir[íi]gete\s*a)\s+(.*)/i;

  // ─────────────────────────────────────────
  // CANCELLA / CAMBIA ROTTA
  // ─────────────────────────────────────────
  private cancelRegex = /\b(annulla|elimina|cancella|termina|stop|cancel|end|stop navigation|chiudi|ferma|beende|abbrechen|annuler|navigation beenden|cancelar|detener)\s*(la\s+)?(navigazione|rotta|percorso|viaggio|navigation|route|Routenführung|navigación|ruta)?\b/i;
  private changeRegex = /cambia\s*(il\s*)?(percorso|rotta)|change\s*route|changer\s*l['']?itinéraire|route\s*ändern|cambiar\s*ruta/i;
  private avoidHighwaysRegex = /evita autostrade|evita autostrada|avoid highways?|éviter autoroutes?|autobahn meiden|evitar autopistas?/i;
  private backRegex   = /torna alla rotta precedente|go back to previous route|revenir à l'itinéraire précédent|zurück zur vorherigen Route|volver a la ruta anterior/i;
  private recalcRegex = /ricalcola|ricalcola rotta|ricalcola percorso|trova altra strada|altra strada|recalculate|recalculer|neu berechnen|recalcular/i;

  // ─────────────────────────────────────────
  // INFO GENERALI
  // ─────────────────────────────────────────
  private timeRegex         = /che\s+ore\s+sono|che\s+ora\s+è|orario|che ore fa|what time is it|quelle heure est.?il|wie spät ist es|qué hora es/i;
  private remainingRegex    = /quanto\s+manca|distanza\s+rimanente|quanti chilometri mancano|chilometri rimanenti|how much further|how far|combien reste.?t.?il|wie weit noch|cuánto falta/i;
  private notificationRegex = /ho\s+notifiche|leggi\s+notifiche|controlla\s+notifiche|any notifications|mes notifications|meine Benachrichtigungen|mis notificaciones/i;

  // ─────────────────────────────────────────
  // CHIAMATE
  // ─────────────────────────────────────────
  private callRegex   = /(?:chiama|telefona a|chiama a|call|appelle|ruf|llama)\s+(.*)/i;
  private answerRegex = /rispondi|pronto|rispondere|accetta chiamata|answer|répondre|annehmen|contestar/i;
  private hangupRegex = /attacca|termina chiamata|chiudi chiamata|metti giù|rifiuta chiamata|hang up|raccrocher|auflegen|colgar/i;

  // ─────────────────────────────────────────
  // INTERFONO & RADAR COMPAGNI HANDS-FREE
  // ─────────────────────────────────────────
  private intercomWithFriendRegex = /\b(?:interfono\s+con|parla\s+con|(?:accendi|attiva|apri|collega|connetti)\s+(?:il\s+|l['’])?interfono\s+con|chiama\s+interfono\s+a)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ]+)/i;
  private intercomOnRegex         = /\b(accendi|attiva|apri|collega|connetti|avvia|start)\s+(il\s+|l['’])?interfono\b/i;
  private intercomOffRegex        = /\b(spegni|spengi|stoppa|ferma|chiudi|disattiva|stacca|disconnetti|stop)\s+(il\s+|l['’])?interfono\b/i;
  private intercomStatusRegex     = /\b(chi\s+(c['’]è|è\s+connesso)|stato\s+interfono|amici\s+online|amici\s+in\s+linea)\b/i;
  private intercomReplayRegex     = /\b(ripeti\s+(l['’])?ultimo\s+messaggio|cosa\s+ha\s+detto|ripeti\s+interfono|ripeti\s+amico)\b/i;
  private reachFriendRegex        = /\b(raggiungi|vai\s+da|porta\s+da|conducimi\s+da|trova|segui)\s+([a-zA-ZàèéìòùÀÈÉÌÒÙ]+)/i;

  // ─────────────────────────────────────────
  // WEB RADIO & STREAMING MUSICALE
  // ─────────────────────────────────────────
  private radioStopRegex    = /\b(spegni|spengi|stoppa|ferma|chiudi|silenzia|disattiva|interrompi|togli|leva|basta|stop|pause)\b/i;
  private radioVolDownRegex = /\b(abbassa|abassa|bassa|riduci|cala|meno\s+forte|più\s+piano|piu\s+piano)\b|\bvolume\s*(giù|giu|basso|meno)\b/i;
  private radioVolUpRegex   = /\b(alza|aumenta|più\s+forte|piu\s+forte|forte)\b|\bvolume\s*(su|alto|più|piu)\b/i;
  private radioNextRegex    = /\b(prossima|cambia|successiva|avanti|altra)\s*(la\s+)?(stazione|radio|canzone|traccia)\b|\b(stazione|radio)\s+(successiva|dopo)\b|\bnext\s*(radio|station)?\b/i;
  private radioPrevRegex    = /\b(precedente|indietro|prima)\s*(la\s+)?(stazione|radio|canzone)\b|\b(stazione|radio)\s+(precedente|prima)\b|\bprev(ious)?\s*(radio|station)?\b/i;
  private radioInfoRegex    = /\b(che\s+(radio|stazione|canzone|brano)\s+(è|suona|sta\s+suonando)|cosa\s+sta\s+suonando|titolo\s+brano|info\s+radio)\b/i;
  private radioPlayRegex    = /\b(metti|accendi|attiva|fai\s+partire|ascolta|fammi\s+sentire|riproduci|apri|sintonizza|collega|connetti|play|start)\b/i;

  private radioStationsList = [
    { id: 'ibiza_global', name: 'Ibiza Global Radio', distinctKeywords: ['ibiza', 'global'] },
    { id: 'ibiza_sonica', name: 'Ibiza Sonica', distinctKeywords: ['sonica'] },
    { id: 'deejay', name: 'Radio Deejay', distinctKeywords: ['deejay', 'dj', 'dijey', 'dejay'] },
    { id: 'r105', name: 'Radio 105', distinctKeywords: ['105', 'centocinque'] },
    { id: 'virgin', name: 'Virgin Radio', distinctKeywords: ['virgin', 'rock'] },
    { id: 'rtl1025', name: 'RTL 102.5', distinctKeywords: ['rtl', '102.5', '1025', 'centodue'] },
    { id: 'rds', name: 'RDS', distinctKeywords: ['rds', 'dimensione suono'] },
    { id: 'm2o', name: 'm2o', distinctKeywords: ['m2o', 'emmedueo'] },
    { id: 'radio24', name: 'Radio 24', distinctKeywords: ['24', 'ventiquattro', 'sole 24'] },
    { id: 'capital', name: 'Radio Capital', distinctKeywords: ['capital'] },
  ];

  private static readonly RADIO_GENERIC_WORDS = new Set(['radio', 'musica', 'canzone', 'brano', 'stazione', 'volume', 'suono', 'la', 'il', 'della', 'dello']);

  private matchRadioStation(cmd: string): string | null {
    const clean = cmd.toLowerCase();
    // 1. Match diretto su keyword distintive con word boundary
    for (const station of this.radioStationsList) {
      for (const kw of station.distinctKeywords) {
        const escaped = kw.replace('.', '\\.');
        const reg = new RegExp(`(^|\\s|\\b)${escaped}(\\s|\\b|$)`, 'i');
        if (reg.test(clean)) {
          return station.name;
        }
      }
    }
    // 2. Fuzzy match solo su token non generici e lunghi almeno 3 lettere
    const tokens = clean.split(/\s+/).filter(t => !IntentParser.RADIO_GENERIC_WORDS.has(t) && t.length >= 3);
    for (const station of this.radioStationsList) {
      for (const kw of station.distinctKeywords) {
        if (kw.indexOf(' ') === -1 && tokens.some(t => matchesFuzzy(t, [kw]))) {
          return station.name;
        }
      }
    }
    return null;
  }

  // ─────────────────────────────────────────
  // NUMBER MAP & CITY FIXES
  // ─────────────────────────────────────────
  private numberMap: Record<string, string> = {
    'uno':'1','due':'2','tre':'3','quattro':'4','cinque':'5',
    'sei':'6','sette':'7','otto':'8','nove':'9','dieci':'10',
    'undici':'11','dodici':'12','trenta':'30','cinquanta':'50','cento':'100',
    'one':'1','two':'2','three':'3','four':'4','five':'5',
    'six':'6','seven':'7','eight':'8','nine':'9','ten':'10',
    'eleven':'11','twelve':'12','thirty':'30','fifty':'50','hundred':'100',
    'un':'1','deux':'2','cinq':'5','dix':'10','onze':'11','douze':'12','trente':'30','cent':'100',
    'ein':'1','zwei':'2','drei':'3','vier':'4','fünf':'5',
    'sechs':'6','sieben':'7','acht':'8','neun':'9','zehn':'10',
    'dos':'2','cuatro':'4','seis':'6','ocho':'8','nueve':'9','diez':'10',
  };

  private cityFixes: Record<string, string> = {
    'sam':'san','hassam':'san','saint':'san','saints':'san',
    'rome':'roma','naples':'napoli','florence':'firenze',
    'venice':'venezia','milan':'milano','turin':'torino',
    'munich':'münchen','cologne':'köln','vienna':'wien',
    'barcelone':'barcelona','paris':'paris','berlin':'berlin',
  };

  public hasWakeWord(text: string): boolean {
    return this.wakeWordRegex.test(text.trim().toLowerCase());
  }

  public stripWakeWord(text: string): { hasWakeWord: boolean; command: string } {
    const clean = text.trim().toLowerCase();
    const match = clean.match(this.wakeWordRegex);
    if (match && match.index !== undefined) {
      const command = clean.substring(match.index + match[0].length).trim();
      return { hasWakeWord: true, command };
    }
    return { hasWakeWord: false, command: clean };
  }

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
    const { hasWakeWord, command } = this.stripWakeWord(clean);

    if (!options?.skipWakeWordCheck && !hasWakeWord) {
      return { type: 'UNKNOWN', rawText: text };
    }

    let cmd = command;
    if (cmd.length === 0 && hasWakeWord) {
      return { type: 'UNKNOWN', rawText: text };
    }

    // 1. YES / NO / NEXT_POI (Priorità massima in sessioni di conferma)
    if (this.nextPoiRegex.test(cmd)) return { type: 'NEXT_POI' };
    if (this.yesRegex.test(cmd))     return { type: 'YES' };
    if (this.noRegex.test(cmd))      return { type: 'NO' };

    // 2. MOTO POI INTELLIGENTI (Prima della navigazione generica per evitare falsi indirizzi)
    if (this.gasStationRegex.test(cmd)) return { type: 'FIND_GAS_STATION' };
    if (this.foodRegex.test(cmd))       return { type: 'FIND_FOOD' };
    if (this.mechanicRegex.test(cmd))   return { type: 'FIND_MECHANIC' };

    // Fuzzy check per POI nel rumore acustico
    const tokens = cmd.split(/\s+/);
    if (tokens.some(t => matchesFuzzy(t, ['prossimo', 'successivo', 'altro']))) {
      return { type: 'NEXT_POI' };
    }
    if (tokens.some(t => matchesFuzzy(t, ['benzinaio', 'distributore', 'carburante', 'rifornimento', 'benzina', 'distributori', 'benza']))) {
      return { type: 'FIND_GAS_STATION' };
    }
    if (tokens.some(t => matchesFuzzy(t, ['ristorante', 'trattoria', 'pizzeria', 'osteria', 'paninoteca', 'mangiare', 'cibo', 'bar']))) {
      return { type: 'FIND_FOOD' };
    }
    if (tokens.some(t => matchesFuzzy(t, ['officina', 'meccanico', 'gommista', 'elettrauto']))) {
      return { type: 'FIND_MECHANIC' };
    }

    // 3. DESTINAZIONI FAVORITE / HOME / WORK
    if (this.homeRegex.test(cmd)) return { type: 'NAVIGATE_HOME' };
    if (this.workRegex.test(cmd)) return { type: 'NAVIGATE_WORK' };

    // 4. CONTROLLI MOTO & TELEMETRIA ISTANTANEA
    if (this.repeatInstructionRegex.test(cmd) || tokens.some(t => matchesFuzzy(t, ['ripeti', 'ripetere']))) {
      return { type: 'REPEAT_INSTRUCTION' };
    }
    if (this.speedRegex.test(cmd) || tokens.some(t => matchesFuzzy(t, ['velocita', 'velocità']))) {
      return { type: 'GET_SPEED' };
    }
    if (this.helmetStatusRegex.test(cmd)) {
      return { type: 'GET_HELMET_STATUS' };
    }
    if (this.etaRegex.test(cmd)) {
      return { type: 'GET_ETA' };
    }

    // 5. MUTE / UNMUTE VOCE
    if (this.muteVoiceRegex.test(cmd))   return { type: 'TOGGLE_VOICE_MUTE', action: 'mute' };
    if (this.unmuteVoiceRegex.test(cmd)) return { type: 'TOGGLE_VOICE_MUTE', action: 'unmute' };

    // 6. INFO VIAGGIO GENERALI
    if (this.timeRegex.test(cmd))         return { type: 'GET_TIME' };
    if (this.remainingRegex.test(cmd))    return { type: 'GET_REMAINING_INFO' };
    if (this.notificationRegex.test(cmd)) return { type: 'CHECK_NOTIFICATIONS' };

    // 7. GESTIONE ROTTA & CANCELLAZIONE
    if (this.avoidHighwaysRegex.test(cmd)) return { type: 'CHANGE_ROUTE', avoid: ['highways'] };
    if (this.cancelRegex.test(cmd))       return { type: 'CANCEL_NAVIGATION' };
    if (this.backRegex.test(cmd))         return { type: 'RETURN_TO_PREVIOUS_ROUTE' };
    if (this.recalcRegex.test(cmd))       return { type: 'RECALCULATE_ROUTE' };

    if (this.changeRegex.test(cmd)) {
      const destPart = cmd.replace(this.changeRegex, '').replace(/^(in|per|a|to|nach|à|en|a)\s+/i, '').trim();
      if (destPart.length > 2) return { type: 'NAVIGATE_TO', destination: this.normalizeAddress(destPart) };
      return { type: 'CHANGE_ROUTE' };
    }

    // 8. CONTROLLI INTERFONO HANDS-FREE & COMPAGNI
    const intercomFriendMatch = cmd.match(this.intercomWithFriendRegex);
    if (intercomFriendMatch && intercomFriendMatch[1]) {
      const targetFriend = intercomFriendMatch[1].trim();
      if (!this.homeRegex.test(targetFriend) && !this.workRegex.test(targetFriend) && !this.gasStationRegex.test(targetFriend) && !this.foodRegex.test(targetFriend)) {
        return { type: 'INTERCOM_WITH_FRIEND', friendName: targetFriend };
      }
    }

    if (this.intercomOnRegex.test(cmd))     return { type: 'INTERCOM_ON' };
    if (this.intercomOffRegex.test(cmd))    return { type: 'INTERCOM_OFF' };
    if (this.intercomReplayRegex.test(cmd)) return { type: 'INTERCOM_REPLAY' };
    if (this.intercomStatusRegex.test(cmd)) return { type: 'INTERCOM_STATUS' };

    const reachMatch = cmd.match(this.reachFriendRegex);
    if (reachMatch && reachMatch[2]) {
      const targetFriend = reachMatch[2].trim();
      // Escludi parole chiave di navigazione generica
      if (!this.homeRegex.test(targetFriend) && !this.workRegex.test(targetFriend) && !this.gasStationRegex.test(targetFriend) && !this.foodRegex.test(targetFriend)) {
        return { type: 'REACH_FRIEND', friendName: targetFriend };
      }
    }

    // 9. CONTROLLI RADIO & STREAMING MUSICALE
    const isRadioContext = /\b(radio|stazione|musica|brano|canzone)\b/i.test(cmd);

    // STOP HA PRECEDENZA ASSOLUTA: non deve MAI avviare la radio!
    if (this.radioStopRegex.test(cmd) && (isRadioContext || /\b(tutto|audio)\b/i.test(cmd))) {
      return { type: 'RADIO_STOP' };
    }

    // VOLUME (abbassa / alza volume o radio)
    if (this.radioVolDownRegex.test(cmd) && (isRadioContext || /\bvolume\b/i.test(cmd))) {
      return { type: 'RADIO_VOLUME', level: 'down' };
    }
    if (this.radioVolUpRegex.test(cmd) && (isRadioContext || /\bvolume\b/i.test(cmd))) {
      return { type: 'RADIO_VOLUME', level: 'up' };
    }

    // NEXT / PREV / INFO
    if (this.radioNextRegex.test(cmd)) return { type: 'RADIO_NEXT' };
    if (this.radioPrevRegex.test(cmd)) return { type: 'RADIO_PREV' };
    if (this.radioInfoRegex.test(cmd)) return { type: 'RADIO_INFO' };

    // PLAY STAZIONE SPECIFICA (es: "metti ibiza", "metti deejay", "radio 24")
    const stationFound = this.matchRadioStation(cmd);
    if (stationFound) {
      return { type: 'RADIO_PLAY', station: stationFound };
    }

    // PLAY GENERICO (es: "metti la radio", "accendi la musica")
    if (this.radioPlayRegex.test(cmd) && isRadioContext) {
      return { type: 'RADIO_PLAY' };
    }

    // 9. NAVIGAZIONE GENERICA (Tutte le lingue)
    for (const regex of [this.navRegexIT, this.navRegexEN, this.navRegexFR, this.navRegexDE, this.navRegexES]) {
      const m = cmd.match(regex);
      if (m) {
        let dest = (m[1] || '').trim();
        // Controllo aggiuntivo su casa/lavoro/poi estratti per sbaglio
        if (this.homeRegex.test(dest)) return { type: 'NAVIGATE_HOME' };
        if (this.workRegex.test(dest)) return { type: 'NAVIGATE_WORK' };
        if (this.gasStationRegex.test(dest)) return { type: 'FIND_GAS_STATION' };
        if (this.foodRegex.test(dest)) return { type: 'FIND_FOOD' };
        if (this.mechanicRegex.test(dest)) return { type: 'FIND_MECHANIC' };

        const destination = this.normalizeAddress(dest || 'destinazione');
        return { type: 'NAVIGATE_TO', destination };
      }
    }

    // 10. CHIAMATE TELEFONICHE
    const callMatch = cmd.match(this.callRegex);
    if (callMatch) return { type: 'CALL_CONTACT', contactName: callMatch[1].trim() };
    if (this.answerRegex.test(cmd)) return { type: 'ANSWER_CALL' };
    if (this.hangupRegex.test(cmd)) return { type: 'HANG_UP' };

    return { type: 'UNKNOWN', rawText: text };
  }
}