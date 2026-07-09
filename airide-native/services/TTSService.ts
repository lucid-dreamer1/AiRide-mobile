// services/TTSService.ts
// Servizio Text-to-Speech con gestione priorità e coda messaggi

import * as Speech from 'expo-speech';
import { DeviceEventEmitter } from 'react-native';
import { VoicePriority, TTSOptions, VoiceMessage } from '@/types/voice';

class TTSService {
  private speaking: boolean = false;
  private currentMessage: VoiceMessage | null = null;
  private messageQueue: VoiceMessage[] = [];
  private defaultOptions: TTSOptions = {
    language: 'it-IT',
    pitch: 1.0,
    rate: 0.95, // Leggermente più lento per maggiore chiarezza
    volume: 0.9,
  };

  /**
   * Verifica se il TTS sta parlando
   */
  public isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Imposta le configurazioni vocali di default
   */
  public setVoiceSettings(settings: Partial<TTSOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...settings };
  }

  /**
   * Interrompe immediatamente la riproduzione in corso
   */
  public async stop(): Promise<void> {
    try {
      await Speech.stop();
      this.speaking = false;
      this.currentMessage = null;
    } catch (error) {
      console.error('[TTS] Errore durante lo stop:', error);
    }
  }

  /**
   * Parla il testo con gestione priorità
   * I messaggi ad alta priorità interrompono quelli a bassa priorità
   */
  public async speak(
    text: string,
    priority: VoicePriority = VoicePriority.NORMAL,
    options?: TTSOptions
  ): Promise<void> {
    const message: VoiceMessage = {
      text,
      priority,
      timestamp: Date.now(),
    };

    // Se sta parlando, decidi se interrompere
    if (this.speaking && this.currentMessage) {
      if (priority > this.currentMessage.priority) {
        // Priorità più alta: interrompi e parla subito
        console.log(`[TTS] Interruzione per priorità: ${priority} > ${this.currentMessage.priority}`);
        await this.stop();
        await this._speakNow(message, options);
      } else if (priority === VoicePriority.CRITICAL || priority === VoicePriority.HIGH) {
        // Aggiungi alla coda per messaggi importanti
        this.messageQueue.push(message);
        console.log(`[TTS] Messaggio accodato: ${text}`);
      } else {
        // Ignora messaggi a bassa priorità
        console.log(`[TTS] Messaggio ignorato (priorità bassa): ${text}`);
      }
    } else {
      // Non sta parlando: parla subito
      await this._speakNow(message, options);
    }
  }

  /**
   * Riproduce immediatamente il messaggio
   */
  private async _speakNow(message: VoiceMessage, options?: TTSOptions): Promise<void> {
    try {
      this.speaking = true;
      this.currentMessage = message;

    const mergedOptions = { ...this.defaultOptions, ...options };

      console.log(`[TTS] 🔊 Speaking: "${message.text}"`); 

      // Determina la voce corretta per la lingua
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        
        const languageCode = mergedOptions.language?.split('-')[0] || 'it'; // es: 'it-IT' -> 'it'
        
        // Trova TUTTE le voci disponibili per la lingua richiesta
        const matchingVoices = voices.filter(v => v.language.toLowerCase().startsWith(languageCode.toLowerCase()));
        
        // Preferisci voci di qualità alta se disponibili
        const selectedVoice = matchingVoices.find(v => v.quality === 'Enhanced') 
                           || matchingVoices.find(v => v.quality === 'Default')
                           || matchingVoices[0];
        
        if (selectedVoice) {
          console.log(`[TTS] ✅ Voce selezionata: ${selectedVoice.name} (${selectedVoice.language})`);
          
          await Speech.speak(message.text, {
            language: selectedVoice.language, // USA LA LINGUA DELLA VOCE SELEZIONATA
            voice: selectedVoice.identifier,
            pitch: mergedOptions.pitch,
            rate: mergedOptions.rate,
            volume: mergedOptions.volume,
            onDone: () => this._onSpeechDone(),
            onStopped: () => this._onSpeechDone(),
            onError: (error) => this._onSpeechError(error),
          });
        } else {
          // Nessuna voce trovata per questa lingua, usa default
          console.log(`[TTS] ⚠️ Nessuna voce trovata per ${languageCode}, usando voce di sistema default`);
          
          await Speech.speak(message.text, {
            language: mergedOptions.language,
            pitch: mergedOptions.pitch,
            rate: mergedOptions.rate,
            volume: mergedOptions.volume,
            onDone: () => this._onSpeechDone(),
            onStopped: () => this._onSpeechDone(),
            onError: (error) => this._onSpeechError(error),
          });
        }
      } catch (voiceError) {
        // Se c'è un errore nel recupero delle voci, usa il metodo semplice
        console.error('[TTS] ❌ Errore recupero voci:', voiceError);
        console.log('[TTS] 🔄 Fallback a TTS semplice');
        
        await Speech.speak(message.text, {
          language: mergedOptions.language,
          pitch: mergedOptions.pitch,
          rate: mergedOptions.rate,
          volume: mergedOptions.volume,
          onDone: () => this._onSpeechDone(),
          onStopped: () => this._onSpeechDone(),
          onError: (error) => this._onSpeechError(error),
        });
      }
    } catch (error) {
      console.error('[TTS] Errore durante speak:', error);
      this.speaking = false;
      this.currentMessage = null;
    }
  }

  /**
   * Callback quando il messaggio è terminato
   */
  private _onSpeechDone(): void {
    console.log('[TTS] ✅ Speech completato');
    this.speaking = false;
    this.currentMessage = null;
    
    DeviceEventEmitter.emit('TTS_DONE');

    // Processa il prossimo messaggio in coda
    this._processQueue();
  }

  /**
   * Callback in caso di errore
   */
  private _onSpeechError(error: any): void {
    console.error('[TTS] ❌ Errore TTS:', error);
    this.speaking = false;
    this.currentMessage = null;

    DeviceEventEmitter.emit('TTS_DONE');

    // Prova col prossimo messaggio
    this._processQueue();
  }

  /**
   * Processa la coda dei messaggi
   */
  private _processQueue(): void {
    if (this.messageQueue.length === 0) return;

    // Ordina per priorità decrescente
    this.messageQueue.sort((a, b) => b.priority - a.priority);

    const nextMessage = this.messageQueue.shift()!;
    console.log(`[TTS] Processando dalla coda: ${nextMessage.text}`);
    
    this._speakNow(nextMessage);
  }

  /**
   * Pulisce la coda dei messaggi
   */
  public clearQueue(): void {
    this.messageQueue = [];
    console.log('[TTS] Coda messaggi pulita');
  }

  /**
   * Ottiene la coda attuale (per debug)
   */
  public getQueue(): VoiceMessage[] {
    return [...this.messageQueue];
  }
}

// Singleton instance
export const ttsService = new TTSService();

// Utility per conversione lingua
export function getLanguageCode(lang: string): string {
  const languageMap: Record<string, string> = {
    it: 'it-IT',
    en: 'en-US',
    fr: 'fr-FR',
    de: 'de-DE',
    es: 'es-ES',
  };
  return languageMap[lang] || 'it-IT';
}
