// services/GeminiVoiceService.ts
// Servizio per l'integrazione con Google Gemini (Gemini 2.0 Flash) per comprensione NLU, contesto e audio in moto

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ParsedIntent } from '../utils/IntentParser';

const STORAGE_GEMINI_KEY = '@airide_gemini_api_key';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-1.5-flash';

export interface GeminiIntentResult {
  intent: ParsedIntent;
  spokenResponse?: string;
  transcript?: string;
}

export interface VoiceContext {
  isNavigating?: boolean;
  destination?: string | null;
  radioPlaying?: boolean;
  currentStation?: string | null;
  intercomActive?: boolean;
  friendsList?: string[];
  currentSpeed?: number;
}

class GeminiVoiceService {
  private apiKey: string | null = null;
  private isInitialized: boolean = false;

  constructor() {
    this._loadApiKey();
  }

  private async _loadApiKey(): Promise<void> {
    try {
      // 1. Priorità a variabile d'ambiente Expo
      const envKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
      if (envKey && envKey.trim().length > 10) {
        this.apiKey = envKey.trim();
        this.isInitialized = true;
        console.log('[GeminiVoiceService] ✅ API Key caricata da ambiente EXPO_PUBLIC_GEMINI_API_KEY');
        return;
      }

      // 2. Fallback a AsyncStorage
      const storedKey = await AsyncStorage.getItem(STORAGE_GEMINI_KEY);
      if (storedKey && storedKey.trim().length > 10) {
        this.apiKey = storedKey.trim();
        this.isInitialized = true;
        console.log('[GeminiVoiceService] ✅ API Key caricata da AsyncStorage');
      }
    } catch (e) {
      console.warn('[GeminiVoiceService] Errore caricamento API key:', e);
    }
  }

  public async setApiKey(key: string): Promise<void> {
    const clean = key.trim();
    this.apiKey = clean;
    this.isInitialized = true;
    await AsyncStorage.setItem(STORAGE_GEMINI_KEY, clean);
    console.log('[GeminiVoiceService] 🔑 Nuova API Key impostata');
  }

  public async getApiKey(): Promise<string | null> {
    if (!this.apiKey) {
      await this._loadApiKey();
    }
    return this.apiKey;
  }

  public isAvailable(): boolean {
    return !!(this.apiKey && this.apiKey.length > 10);
  }

  /**
   * Genera il prompt di sistema per istruire Gemini a comportarsi come l'assistente AiRide
   */
  private _buildSystemInstruction(context?: VoiceContext): string {
    const friendsText = context?.friendsList && context.friendsList.length > 0
      ? `Amici salvati del pilota: ${context.friendsList.join(', ')}.`
      : '';
    const navText = context?.isNavigating
      ? `Navigazione attualmente ATTIVA verso: "${context.destination}".`
      : 'Nessuna navigazione attualmente attiva.';
    const radioText = context?.radioPlaying
      ? `Web radio in riproduzione: "${context.currentStation}".`
      : 'Web radio spenta.';
    const intercomText = context?.intercomActive
      ? 'Interfono attualmente ATTIVO.'
      : 'Interfono spento.';

    return `Sei l'assistente vocale di AiRide, un'applicazione per motociclisti con HUD nel casco.
Il pilota sta guidando una moto in mezzo al traffico, con vento e rumore del motore.
Devi analizzare la frase pronunciata (o l'audio trascritto), comprendere l'intento dell'utente tenendo conto del contesto e restituire ESCLUSIVAMENTE un oggetto JSON valido secondo lo schema richiesto.

CONTESTO ATTUALE DELLA MOTO:
- ${navText}
- ${radioText}
- ${intercomText}
- ${friendsText}

ELENCO INTENTI POSSIBILI (campo "type"):
1. Navigazione:
   - "NAVIGATE_TO": il pilota vuole andare in un posto/indirizzo/città. Campo "destination" (string con nome città/indirizzo pulito).
   - "NAVIGATE_HOME": vuole tornare a casa.
   - "NAVIGATE_WORK": vuole andare al lavoro.
   - "CANCEL_NAVIGATION": vuole annullare/fermare/chiudere la navigazione.
   - "RECALCULATE_ROUTE": vuole ricalcolare la rotta o trovare un'altra strada.
   - "CHANGE_ROUTE": vuole cambiare percorso, o evitare pedaggi/autostrade. Se chiede di evitare autostrade, imposta campo "avoid": ["highways"].
2. Punti di Interesse (POI) da raggiungere:
   - "FIND_GAS_STATION": benzina, distributore, fare il pieno, rimasto a secco, carburante.
   - "FIND_FOOD": ristorante, trattoria, cibo, ho fame, panino, bar, pizza, pranzo, cena.
   - "FIND_MECHANIC": officina, meccanico, gomma bucata, riparazione moto, gommista.
   - "NEXT_POI": il pilota chiede "un altro", "il prossimo", "mostramene un altro".
3. Info Viaggio & Telemetria:
   - "REPEAT_INSTRUCTION": "cosa devo fare?", "ripeti svolta", "ripeti".
   - "GET_SPEED": "a quanto vado?", "velocità attuale".
   - "GET_ETA": "a che ora arrivo?", "orario di arrivo".
   - "GET_TIME": "che ore sono?".
   - "GET_REMAINING_INFO": "quanto manca?", "quanti chilometri mancano?".
   - "GET_HELMET_STATUS": "stato casco", "batteria casco".
   - "TOGGLE_VOICE_MUTE": silenziamento voce guida ("mute" o "unmute"). Campo "action": "mute"|"unmute".
4. Web Radio:
   - "RADIO_PLAY": accendere la radio o mettere una stazione specifica. Se specificata, campo "station" (es. "Ibiza Global Radio", "Radio Deejay", "Radio 105", "Virgin Radio", "RTL 102.5", "RDS", "m2o", "Radio 24", "Radio Capital", "Ibiza Sonica"). Se dice "metti musica rilassante/chill" metti "Ibiza Sonica". Se dice "metti musica dance/techno" metti "Ibiza Global Radio" o "m2o". Se dice "rock" metti "Virgin Radio".
   - "RADIO_STOP": spegnere/stoppare la musica o la radio.
   - "RADIO_NEXT": stazione successiva.
   - "RADIO_PREV": stazione precedente.
   - "RADIO_VOLUME": alzare o abbassare il volume. Campo "level": "up"|"down".
   - "RADIO_INFO": "che canzone è?", "che radio sta suonando?".
5. Interfono tra Amici (Hands-Free):
   - "INTERCOM_ON": accendere l'interfono di gruppo ("accendi interfono", "apri linea").
   - "INTERCOM_OFF": spegnere l'interfono ("spegni interfono", "chiudi microfono").
   - "INTERCOM_WITH_FRIEND": parlare con un amico specifico (es. "interfono con Marco", "parla con Luca", "metti in linea Giulia"). Campo "friendName": string con il nome dell'amico.
   - "INTERCOM_STATUS": "chi c'è connesso?", "amici in linea".
   - "INTERCOM_REPLAY": "ripeti ultimo messaggio", "cosa ha detto?".
   - "REACH_FRIEND": "raggiungi Marco", "vai da Luca", "dov'è Marco?". Campo "friendName": string.
6. Telefonia & Conferme:
   - "CALL_CONTACT": chiamare un contatto telefonico vivavoce. Campo "contactName".
   - "ANSWER_CALL": rispondere a chiamata in arrivo.
   - "HANG_UP": chiudere la chiamata.
   - "YES": sì, confermo, procedi, vai, d'accordo.
   - "NO": no, annulla, aspetta, non voglio.
   - "UNKNOWN": frase incomprensibile o non pertinente alla guida moto.

FORMATO RISPOSTA (SOLO JSON, NIENTE TESTO EXTRA, NIENTE BACKTICKS MARKDOWN):
{
  "intent": {
    "type": "NOME_TIPO_INTENT",
    ...campi_opzionali_richiesti
  },
  "spokenResponse": "Breve frase in italiano da pronunciare al pilota (massimo 10 parole, cordiale e concisa)"
}`;
  }

  /**
   * Analizza il testo del comando con Google Gemini (NLU)
   */
  public async parseTextWithGemini(
    commandText: string,
    context?: VoiceContext
  ): Promise<GeminiIntentResult | null> {
    const key = await this.getApiKey();
    if (!key) {
      console.log('[GeminiVoiceService] Nessuna API key configurata.');
      return null;
    }

    const cleanInput = commandText.trim();
    if (!cleanInput) return null;

    console.log(`[GeminiVoiceService] 🧠 Invio a Gemini 2.0 Flash: "${cleanInput}"`);

    const payload = {
      system_instruction: {
        parts: [{ text: this._buildSystemInstruction(context) }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: `Comando pronunciato dal motociclista: "${cleanInput}"` }],
        },
      ],
      generationConfig: {
        temperature: 0.1, // Massima precisione e determinismo
        response_mime_type: 'application/json',
      },
    };

    return await this._callGeminiAPI(payload, key);
  }

  /**
   * Analizza direttamente un frammento audio registrato (Multimodale Audio-to-Intent)
   */
  public async parseAudioWithGemini(
    audioBase64: string,
    mimeType: string = 'audio/mp4',
    context?: VoiceContext
  ): Promise<GeminiIntentResult | null> {
    const key = await this.getApiKey();
    if (!key) {
      console.log('[GeminiVoiceService] Nessuna API key configurata.');
      return null;
    }

    console.log('[GeminiVoiceService] 🎙️ Invio audio multimodale a Gemini 2.0 Flash...');

    const payload = {
      system_instruction: {
        parts: [{ text: this._buildSystemInstruction(context) }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBase64,
              },
            },
            {
              text: 'Ascolta con attenzione l\'audio del pilota della moto, trascrivi le sue parole ed estrai il comando JSON corrispondente.',
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json',
      },
    };

    return await this._callGeminiAPI(payload, key);
  }

  /**
   * Esegue la chiamata HTTP REST verso Google Gemini
   */
  private async _callGeminiAPI(payload: any, key: string): Promise<GeminiIntentResult | null> {
    const modelsToTry = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const startTime = Date.now();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const elapsed = Date.now() - startTime;

        if (!response.ok) {
          const errText = await response.text();
          console.warn(`[GeminiVoiceService] HTTP ${response.status} da ${model} (${elapsed}ms):`, errText);
          // Se il modello non è supportato o fallisce, prova il fallback
          continue;
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!candidate) {
          console.warn('[GeminiVoiceService] Nessuna risposta testuale da Gemini:', data);
          continue;
        }

        console.log(`[GeminiVoiceService] ⚡ Risposta Gemini (${elapsed}ms):`, candidate);

        // Parsing JSON pulito
        const cleanedJson = candidate.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleanedJson);

        if (parsed?.intent && parsed.intent.type) {
          return {
            intent: parsed.intent as ParsedIntent,
            spokenResponse: parsed.spokenResponse,
            transcript: parsed.transcript,
          };
        }
      } catch (err) {
        console.error(`[GeminiVoiceService] Errore chiamata a ${model}:`, err);
      }
    }

    return null;
  }
}

export const geminiVoiceService = new GeminiVoiceService();
