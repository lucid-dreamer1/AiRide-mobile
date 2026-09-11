// services/RadioService.ts
// Servizio per la gestione dello streaming Web Radio con expo-av e audio ducking

import { Audio, AVPlaybackStatus } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

export interface RadioStation {
  id: string;
  name: string;
  genre: string;
  streamUrl: string;
  keywords: string[];
  color?: string;
}

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'deejay',
    name: 'Radio Deejay',
    genre: 'Pop / Hits / Talk',
    streamUrl: 'https://4c4b867c89244861ac216426883d1ad0.msvdn.net/radiodeejay/radiodeejay/master_ma.m3u8',
    keywords: ['deejay', 'dj', 'radio deejay', 'dijey'],
    color: '#FF6B00',
  },
  {
    id: 'ibiza_global',
    name: 'Ibiza Global Radio',
    genre: 'Electronic / Deep House',
    streamUrl: 'http://cdn-peer022.streaming-pro.com:8024/ibizaglobalradio.mp3',
    keywords: ['ibiza', 'ibiza global', 'ibiza global radio', 'ibiza radio'],
    color: '#00D2FF',
  },
  {
    id: 'r105',
    name: 'Radio 105',
    genre: 'Hits / Hip-Hop / Urban',
    streamUrl: 'https://icy.unitedradio.it/Radio105.mp3',
    keywords: ['105', 'radio 105', 'centocinque', 'radio centocinque'],
    color: '#F9D423',
  },
  {
    id: 'virgin',
    name: 'Virgin Radio',
    genre: 'Rock / Classic Rock',
    streamUrl: 'https://icy.unitedradio.it/Virgin.mp3',
    keywords: ['virgin', 'virgin radio', 'rock'],
    color: '#E50914',
  },
  {
    id: 'rtl1025',
    name: 'RTL 102.5',
    genre: 'Very Normal People / Hits',
    streamUrl: 'https://dd782ed59e2a4e86aabf6fc508674b59.msvdn.net/live/S97044836/tbbP8T1ZRPBL/playlist_audio.m3u8',
    keywords: ['rtl', 'rtl 1025', 'centodue e cinque', 'radio rtl'],
    color: '#E60000',
  },
  {
    id: 'rds',
    name: 'RDS',
    genre: '100% Grandi Successi',
    streamUrl: 'https://icstream.rds.radio/rds',
    keywords: ['rds', 'radio dimensione suono'],
    color: '#00A859',
  },
  {
    id: 'm2o',
    name: 'm2o',
    genre: 'Dance / EDM / Club',
    streamUrl: 'https://4c4b867c89244861ac216426883d1ad0.msvdn.net/radiom2o/radiom2o/master_ma.m3u8',
    keywords: ['m2o', 'emme due o', 'dance'],
    color: '#9B51E0',
  },
  {
    id: 'radio24',
    name: 'Radio 24',
    genre: 'News / Informazione / Talk',
    streamUrl: 'http://shoutcast2.radio24.it:8000/;',
    keywords: ['radio 24', 'radio24', 'ventiquattro', 'notizie', 'sole 24 ore'],
    color: '#2D9CDB',
  },
  {
    id: 'capital',
    name: 'Radio Capital',
    genre: '70s 80s 90s Classics',
    streamUrl: 'https://4c4b867c89244861ac216426883d1ad0.msvdn.net/radiocapital/radiocapital/master_ma.m3u8',
    keywords: ['capital', 'radio capital'],
    color: '#F2994A',
  },
  {
    id: 'ibiza_sonica',
    name: 'Ibiza Sonica',
    genre: 'Underground / Chillout',
    streamUrl: 'https://ibizasonica.streaming-pro.com:8000/ibizasonica',
    keywords: ['sonica', 'ibiza sonica'],
    color: '#27AE60',
  },
];

export interface RadioState {
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  currentStation: RadioStation | null;
  volume: number;
  isDucked: boolean;
  error: string | null;
}

const STORAGE_LAST_STATION_KEY = '@airide_last_radio_station';
const STORAGE_VOLUME_KEY = '@airide_radio_volume';

class RadioService {
  private sound: Audio.Sound | null = null;
  private currentStation: RadioStation | null = null;
  private isPlaying: boolean = false;
  private isBuffering: boolean = false;
  private isLoading: boolean = false;
  private volume: number = 0.85; // Volume base normale (0.0 - 1.0)
  private isDucked: boolean = false; // Se attivo, volume abbassato per TTS / assistente
  private lastError: string | null = null;
  private isAudioModeConfigured: boolean = false;
  private duckingTimeout: any = null;

  constructor() {
    this._initListeners();
    this._restorePreferences();
  }

  /**
   * Configura la sessione audio per funzionare in background e con schermo spento
   */
  private async _ensureAudioMode(): Promise<void> {
    if (this.isAudioModeConfigured) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
      this.isAudioModeConfigured = true;
      console.log('[RadioService] ✅ Modalità Audio configurata per background');
    } catch (e) {
      console.warn('[RadioService] ⚠️ Errore configurazione AudioMode:', e);
    }
  }

  /**
   * Ascolta gli eventi di sistema per attivare/disattivare l'Audio Ducking
   */
  private _initListeners(): void {
    // Quando il TTS comincia a parlare o l'assistente ascolta -> abbassa volume
    DeviceEventEmitter.addListener('TTS_START', () => {
      this.setDucking(true);
    });

    // Quando il TTS termina di parlare -> ripristina volume dopo breve cooldown
    DeviceEventEmitter.addListener('TTS_DONE', () => {
      this._scheduleUnduck(800);
    });

    // Quando l'assistente vocale entra in stato listening -> abbassa volume
    DeviceEventEmitter.addListener('Voice_Status', (event: any) => {
      if (event?.status === 'listening') {
        this.setDucking(true);
      } else if (event?.status === 'idle') {
        this._scheduleUnduck(500);
      }
    });
  }

  private _scheduleUnduck(delayMs: number): void {
    if (this.duckingTimeout) clearTimeout(this.duckingTimeout);
    this.duckingTimeout = setTimeout(() => {
      this.setDucking(false);
    }, delayMs);
  }

  /**
   * Ripristina l'ultima stazione e volume salvati
   */
  private async _restorePreferences(): Promise<void> {
    try {
      const savedStationId = await AsyncStorage.getItem(STORAGE_LAST_STATION_KEY);
      if (savedStationId) {
        const found = RADIO_STATIONS.find(s => s.id === savedStationId);
        if (found) this.currentStation = found;
      }
      if (!this.currentStation) {
        this.currentStation = RADIO_STATIONS[0]; // Default Radio Deejay
      }

      const savedVol = await AsyncStorage.getItem(STORAGE_VOLUME_KEY);
      if (savedVol) {
        const parsed = parseFloat(savedVol);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          this.volume = parsed;
        }
      }
      this._emitState();
    } catch (e) {
      console.warn('[RadioService] Errore ripristino preferenze:', e);
    }
  }

  /**
   * Trova una stazione dal nome o da parole chiave (con supporto fuzzy)
   */
  public findStation(query: string): RadioStation | null {
    if (!query) return null;
    const clean = query.trim().toLowerCase();

    // 1. Match diretto per id o nome
    const exact = RADIO_STATIONS.find(
      s => s.id.toLowerCase() === clean || s.name.toLowerCase() === clean
    );
    if (exact) return exact;

    // 2. Match per keyword inclusa
    const kwMatch = RADIO_STATIONS.find(s =>
      s.keywords.some(kw => clean.includes(kw) || kw.includes(clean))
    );
    if (kwMatch) return kwMatch;

    // 3. Substring nel nome o genere
    const partial = RADIO_STATIONS.find(
      s => s.name.toLowerCase().includes(clean) || clean.includes(s.name.toLowerCase())
    );
    if (partial) return partial;

    return null;
  }

  /**
   * Avvia la riproduzione di una stazione (o di quella corrente/ultima salvata)
   */
  public async play(stationOrQuery?: RadioStation | string): Promise<RadioStation | null> {
    await this._ensureAudioMode();

    let targetStation: RadioStation | null = null;
    if (typeof stationOrQuery === 'object' && stationOrQuery !== null) {
      targetStation = stationOrQuery;
    } else if (typeof stationOrQuery === 'string' && stationOrQuery.trim().length > 0) {
      targetStation = this.findStation(stationOrQuery);
    }

    if (!targetStation) {
      targetStation = this.currentStation || RADIO_STATIONS[0];
    }

    // Se è la stessa stazione e già sta suonando, riprendi o mantieni
    if (this.currentStation?.id === targetStation.id && this.sound && !this.isPlaying) {
      try {
        await this.sound.playAsync();
        this.isPlaying = true;
        this.lastError = null;
        this._emitState();
        return targetStation;
      } catch (e) {
        console.warn('[RadioService] Errore resume, ricarico stream:', e);
      }
    }

    this.isLoading = true;
    this.isBuffering = true;
    this.currentStation = targetStation;
    this.lastError = null;
    this._emitState();

    try {
      // Ferma e dealloca il suono precedente
      if (this.sound) {
        try {
          this.sound.setOnPlaybackStatusUpdate(null);
          await this.sound.stopAsync();
          await this.sound.unloadAsync();
        } catch (_) {}
        this.sound = null;
      }

      console.log(`[RadioService] 📻 Caricamento stream: ${targetStation.name} (${targetStation.streamUrl})`);

      const effectiveVolume = this.isDucked ? Math.min(this.volume * 0.15, 0.15) : this.volume;

      const { sound } = await Audio.Sound.createAsync(
        { uri: targetStation.streamUrl },
        {
          shouldPlay: true,
          volume: effectiveVolume,
          isLooping: false,
        },
        this._onPlaybackStatusUpdate
      );

      this.sound = sound;
      this.isPlaying = true;
      this.isLoading = false;
      this.isBuffering = false;
      this.lastError = null;

      // Salva come ultima stazione
      await AsyncStorage.setItem(STORAGE_LAST_STATION_KEY, targetStation.id);

      this._emitState();
      return targetStation;
    } catch (error: any) {
      console.error('[RadioService] ❌ Errore riproduzione stream:', error);
      this.isPlaying = false;
      this.isLoading = false;
      this.isBuffering = false;
      this.lastError = error?.message || 'Impossibile connettersi alla stazione radio';
      this._emitState();
      return null;
    }
  }

  /**
   * Callback di stato di expo-av
   */
  private _onPlaybackStatusUpdate = (status: AVPlaybackStatus): void => {
    if (!status.isLoaded) {
      if (status.error) {
        console.error(`[RadioService] Errore playback stream: ${status.error}`);
        this.isPlaying = false;
        this.isBuffering = false;
        this.isLoading = false;
        this.lastError = status.error;
        this._emitState();
      }
      return;
    }

    const prevPlaying = this.isPlaying;
    const prevBuffering = this.isBuffering;

    this.isPlaying = status.isPlaying;
    this.isBuffering = status.isBuffering;
    if (status.isPlaying) {
      this.isLoading = false;
    }

    // Se per qualche motivo lo stream live finisce (es. timeout o disconnessione rete), prova a riconnettere
    if (status.didJustFinish) {
      console.log('[RadioService] Stream interrotto, tentativo riconnessione...');
      this.play(this.currentStation || undefined);
    } else if (prevPlaying !== this.isPlaying || prevBuffering !== this.isBuffering) {
      this._emitState();
    }
  };

  /**
   * Ferma/pausa la radio
   */
  public async stop(): Promise<void> {
    if (this.sound) {
      try {
        this.sound.setOnPlaybackStatusUpdate(null);
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
      } catch (e) {
        console.warn('[RadioService] Errore stop:', e);
      }
      this.sound = null;
    }

    this.isPlaying = false;
    this.isBuffering = false;
    this.isLoading = false;
    this.lastError = null;

    this._emitState();
    console.log('[RadioService] ⏹️ Radio fermata');
  }

  /**
   * Alterna play / pausa
   */
  public async togglePlay(): Promise<boolean> {
    if (this.isLoading) return this.isPlaying;
    if (this.isPlaying) {
      await this.stop();
      return false;
    } else {
      await this.play();
      return true;
    }
  }

  /**
   * Passa alla stazione successiva
   */
  public async next(): Promise<RadioStation> {
    const currentIndex = RADIO_STATIONS.findIndex(s => s.id === this.currentStation?.id);
    const nextIndex = (currentIndex + 1) % RADIO_STATIONS.length;
    const nextStation = RADIO_STATIONS[nextIndex];
    await this.play(nextStation);
    return nextStation;
  }

  /**
   * Passa alla stazione precedente
   */
  public async prev(): Promise<RadioStation> {
    const currentIndex = RADIO_STATIONS.findIndex(s => s.id === this.currentStation?.id);
    const prevIndex = (currentIndex - 1 + RADIO_STATIONS.length) % RADIO_STATIONS.length;
    const prevStation = RADIO_STATIONS[prevIndex];
    await this.play(prevStation);
    return prevStation;
  }

  /**
   * Imposta il volume base (0.0 - 1.0)
   */
  public async setVolume(vol: number): Promise<void> {
    const clamped = Math.max(0.0, Math.min(1.0, vol));
    this.volume = clamped;
    await AsyncStorage.setItem(STORAGE_VOLUME_KEY, clamped.toString());

    if (this.sound && this.isPlaying) {
      const effectiveVolume = this.isDucked ? Math.min(clamped * 0.15, 0.15) : clamped;
      try {
        await this.sound.setVolumeAsync(effectiveVolume);
      } catch (e) {
        console.warn('[RadioService] Errore impostazione volume:', e);
      }
    }

    this._emitState();
  }

  /**
   * Aumenta o diminuisce il volume a step
   */
  public async adjustVolume(delta: number): Promise<number> {
    const newVol = this.volume + delta;
    await this.setVolume(newVol);
    return this.volume;
  }

  /**
   * Attiva o disattiva l'audio ducking (es. durante parlato assistente/navigatore)
   */
  public async setDucking(duck: boolean): Promise<void> {
    if (this.isDucked === duck) return;
    this.isDucked = duck;

    if (this.sound && this.isPlaying) {
      const targetVolume = duck ? Math.min(this.volume * 0.15, 0.15) : this.volume;
      try {
        await this.sound.setVolumeAsync(targetVolume);
        console.log(`[RadioService] 🔉 Audio Ducking ${duck ? 'ATTIVO (15%)' : 'DISATTIVATO (100%)'}`);
      } catch (e) {
        console.warn('[RadioService] Errore setDucking:', e);
      }
    }

    this._emitState();
  }

  /**
   * Stato corrente
   */
  public getState(): RadioState {
    return {
      isPlaying: this.isPlaying,
      isBuffering: this.isBuffering,
      isLoading: this.isLoading,
      currentStation: this.currentStation,
      volume: this.volume,
      isDucked: this.isDucked,
      error: this.lastError,
    };
  }

  public getAllStations(): RadioStation[] {
    return [...RADIO_STATIONS];
  }

  private _emitState(): void {
    DeviceEventEmitter.emit('Radio_StateChanged', this.getState());
  }
}

export const radioService = new RadioService();
