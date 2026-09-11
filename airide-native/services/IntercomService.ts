// services/IntercomService.ts
// Servizio per la gestione dell'Interfono Hands-Free tra amici per AiRide

import { Audio, AVPlaybackStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { DeviceEventEmitter } from 'react-native';
import { firebaseFirestore } from './firebaseConfig';
import { radioService } from './RadioService';
import { friendsService, FriendProfile } from './FriendsService';

export interface IntercomState {
  isOn: boolean;
  channelId: string | null;
  channelName: string;
  isTransmitting: boolean;
  isReceiving: boolean;
  currentSpeakerName: string | null;
  activeMembersCount: number;
}

export interface IntercomMessage {
  id: string;
  senderUid: string;
  senderName: string;
  audioBase64: string;
  durationMs: number;
  timestamp: number;
}

class IntercomService {
  private isOn: boolean = false;
  private channelId: string | null = null;
  private currentUserId: string | null = null;
  private currentUserName: string = 'Pilota';
  private isTransmitting: boolean = false;
  private isReceiving: boolean = false;
  private currentSpeakerName: string | null = null;
  private activeMembersCount: number = 0;

  private unsubscribeMessages: (() => void) | null = null;
  private unsubscribeMembers: (() => void) | null = null;
  private lastMessageTimestamp: number = Date.now();
  private lastReceivedMessage: IntercomMessage | null = null;
  private currentSound: Audio.Sound | null = null;

  // VOX / Hands-free recording loop
  private recording: Audio.Recording | null = null;
  private isRecordingLoopActive: boolean = false;
  private voxInterval: any = null;

  constructor() {
    this._ensureAudioConfig();
  }

  private async _ensureAudioConfig(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (e) {
      console.warn('[IntercomService] Errore configurazione AudioMode:', e);
    }
  }

  public setUser(user: any): void {
    if (!user?.uid) return;
    this.currentUserId = user.uid;
    this.currentUserName = user.displayName || user.email?.split('@')[0] || 'Pilota';
  }

  /**
   * Genera un ID canale deterministico per un gruppo di amici o canale personale
   */
  private _getDefaultChannelId(): string {
    return 'group_ride_default';
  }

  /**
   * Accende l'interfono in modalità Hands-Free
   */
  public async turnOn(targetChannelId?: string): Promise<boolean> {
    if (this.isOn) {
      console.log('[IntercomService] Interfono già attivo.');
      return true;
    }

    await this._ensureAudioConfig();
    this.isOn = true;
    this.channelId = targetChannelId || this._getDefaultChannelId();
    this.lastMessageTimestamp = Date.now() - 5000; // Solo messaggi recenti da adesso in poi
    console.log(`[IntercomService] 🎙️ Interfono ACCESO sul canale: ${this.channelId}`);

    // Registra la presenza nel canale Firestore
    await this._registerPresence(true);

    // Ascolta i messaggi audio in arrivo dagli amici
    this._startListeningToChannel();

    // Avvia la trasmissione hands-free (VOX o ciclo audio intelligente)
    this._startHandsFreeRecording();

    this._emitState();
    return true;
  }

  /**
   * Spegne l'interfono Hands-Free
   */
  public async turnOff(): Promise<void> {
    if (!this.isOn) return;

    console.log('[IntercomService] 🔇 Spegnimento interfono...');
    this.isOn = false;
    this.isTransmitting = false;
    this.isReceiving = false;
    this.currentSpeakerName = null;

    // Ferma registrazione in corso
    await this._stopHandsFreeRecording();

    // Rimuovi presenza nel canale Firestore
    await this._registerPresence(false);

    // Pulisci listener Firestore
    if (this.unsubscribeMessages) {
      this.unsubscribeMessages();
      this.unsubscribeMessages = null;
    }
    if (this.unsubscribeMembers) {
      this.unsubscribeMembers();
      this.unsubscribeMembers = null;
    }

    // Ferma audio in riproduzione se presente
    if (this.currentSound) {
      try {
        await this.currentSound.stopAsync();
        await this.currentSound.unloadAsync();
      } catch (_) {}
      this.currentSound = null;
    }

    // Assicura ripristino volume radio se era attenuato
    radioService.setDucking(false);

    this._emitState();
    console.log('[IntercomService] ✅ Interfono SPENTO.');
  }

  /**
   * Alterna stato ON / OFF
   */
  public async toggle(): Promise<boolean> {
    if (this.isOn) {
      await this.turnOff();
      return false;
    } else {
      return await this.turnOn();
    }
  }

  /**
   * Registra o rimuove la presenza dell'utente nella stanza
   */
  private async _registerPresence(isActive: boolean): Promise<void> {
    if (!this.currentUserId || !this.channelId) return;

    try {
      const memberRef = firebaseFirestore
        .collection('intercom_channels')
        .doc(this.channelId)
        .collection('members')
        .doc(this.currentUserId);

      if (isActive) {
        await memberRef.set({
          uid: this.currentUserId,
          name: this.currentUserName,
          isActive: true,
          joinedAt: Date.now(),
          lastPing: Date.now(),
        }, { merge: true });

        // Aggiorna anche stato nel profilo utente per il radar
        await firebaseFirestore.collection('users').doc(this.currentUserId).update({
          'intercomState.isActive': true,
          'intercomState.channelId': this.channelId,
          updatedAt: Date.now(),
        });
      } else {
        await memberRef.delete().catch(() => {});
        await firebaseFirestore.collection('users').doc(this.currentUserId).update({
          'intercomState.isActive': false,
          'intercomState.channelId': null,
          updatedAt: Date.now(),
        });
      }
    } catch (e) {
      console.warn('[IntercomService] Errore presenza:', e);
    }
  }

  /**
   * Ascolta i messaggi audio in arrivo dagli amici nel canale
   */
  private _startListeningToChannel(): void {
    if (!this.channelId) return;

    // Ascolta membri attivi
    this.unsubscribeMembers = firebaseFirestore
      .collection('intercom_channels')
      .doc(this.channelId)
      .collection('members')
      .onSnapshot((snap) => {
        this.activeMembersCount = snap.size;
        this._emitState();
      });

    // Ascolta nuovi messaggi vocali
    this.unsubscribeMessages = firebaseFirestore
      .collection('intercom_channels')
      .doc(this.channelId)
      .collection('messages')
      .where('timestamp', '>', this.lastMessageTimestamp)
      .orderBy('timestamp', 'asc')
      .onSnapshot(
        async (snapshot) => {
          if (!this.isOn || snapshot.empty) return;

          for (const change of snapshot.docChanges()) {
            if (change.type === 'added') {
              const data = change.doc.data() as IntercomMessage;
              if (data.senderUid !== this.currentUserId && data.audioBase64) {
                this.lastMessageTimestamp = Math.max(this.lastMessageTimestamp, data.timestamp);
                await this._playIncomingVoice(data);
              }
            }
          }
        },
        (err) => {
          console.warn('[IntercomService] Errore ascolto messaggi:', err);
        }
      );
  }

  /**
   * Riproduce il messaggio vocale ricevuto da un amico, applicando l'Audio Ducking sulla Web Radio
   */
  private async _playIncomingVoice(msg: IntercomMessage): Promise<void> {
    try {
      this.lastReceivedMessage = msg;
      this.isReceiving = true;
      this.currentSpeakerName = msg.senderName;
      this._emitState();

      console.log(`[IntercomService] 🔊 Ricevuto audio da ${msg.senderName} (${msg.durationMs}ms)`);

      // 1. Abbassa automaticamente la Web Radio al 15% (Audio Ducking)
      await radioService.setDucking(true);

      // 2. Salva temporaneamente il base64 in un file m4a
      // @ts-ignore
      const tempPath = `${FileSystem.cacheDirectory}intercom_incoming_${Date.now()}.m4a`;
      await FileSystem.writeAsStringAsync(tempPath, msg.audioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // 3. Riproduci audio
      const { sound } = await Audio.Sound.createAsync(
        { uri: tempPath },
        { shouldPlay: true, volume: 1.0 }
      );
      this.currentSound = sound;

      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          this.currentSound = null;
          this.isReceiving = false;
          this.currentSpeakerName = null;
          this._emitState();

          // Ripristina volume radio
          setTimeout(() => {
            if (!this.isReceiving) {
              radioService.setDucking(false);
            }
          }, 300);

          // Pulisci file temporaneo
          FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
        }
      });
    } catch (e) {
      console.warn('[IntercomService] Errore riproduzione voce amica:', e);
      this.isReceiving = false;
      this.currentSpeakerName = null;
      radioService.setDucking(false);
      this._emitState();
    }
  }

  /**
   * Avvia il ciclo di registrazione Hands-Free
   * Usa una registrazione a blocchi brevi (VOX style) senza necessità di premere tasti
   */
  private async _startHandsFreeRecording(): Promise<void> {
    this.isRecordingLoopActive = true;
    this._runVoxCycle();
  }

  private async _runVoxCycle(): Promise<void> {
    if (!this.isOn || !this.isRecordingLoopActive) return;

    try {
      // Configurazione registrazione ad alta fedeltà e compressione AAC
      const recordingOptions: Audio.RecordingOptions = {
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 22050,
          numberOfChannels: 1,
          bitRate: 32000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.IOSAudioQuality.LOW,
          sampleRate: 22050,
          numberOfChannels: 1,
          bitRate: 32000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
      };

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(recordingOptions);
      newRecording.setOnRecordingStatusUpdate((status) => {
        if (status.canRecord && status.isRecording) {
          // Se rileva livello audio superiore a rumore di fondo, segna come trasmittente
          if (status.metering !== undefined && status.metering > -35) {
            if (!this.isTransmitting) {
              this.isTransmitting = true;
              this._emitState();
            }
          }
        }
      });

      await newRecording.startAsync();
      this.recording = newRecording;

      // Cattura blocco audio di 4 secondi (tempo ideale per parlare in moto senza latenza)
      this.voxInterval = setTimeout(async () => {
        if (this.recording) {
          try {
            await this.recording.stopAndUnloadAsync();
            const uri = this.recording.getURI();
            const status = await this.recording.getStatusAsync();
            this.recording = null;
            this.isTransmitting = false;
            this._emitState();

            if (uri && status.durationMillis && status.durationMillis > 1000) {
              // Converti in base64 e invia agli amici se l'interfono è ancora attivo
              if (this.isOn && this.channelId && this.currentUserId) {
                const base64 = await FileSystem.readAsStringAsync(uri, {
                  encoding: FileSystem.EncodingType.Base64,
                });

                if (base64 && base64.length > 500) {
                  await firebaseFirestore
                    .collection('intercom_channels')
                    .doc(this.channelId)
                    .collection('messages')
                    .add({
                      senderUid: this.currentUserId,
                      senderName: this.currentUserName,
                      audioBase64: base64,
                      durationMs: status.durationMillis,
                      timestamp: Date.now(),
                    });
                }
              }

              // Elimina cache
              FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
            }
          } catch (recErr) {
            console.warn('[IntercomService] Errore stop registrazione chunk:', recErr);
          }
        }

        // Continua il ciclo se ancora ON
        if (this.isOn && this.isRecordingLoopActive) {
          this._runVoxCycle();
        }
      }, 4000);

    } catch (e) {
      console.warn('[IntercomService] Errore avvio ciclo VOX:', e);
      // Riprova tra 2 secondi se fallisce per mic temporaneamente occupato
      if (this.isOn && this.isRecordingLoopActive) {
        setTimeout(() => this._runVoxCycle(), 2000);
      }
    }
  }

  private async _stopHandsFreeRecording(): Promise<void> {
    this.isRecordingLoopActive = false;
    if (this.voxInterval) {
      clearTimeout(this.voxInterval);
      this.voxInterval = null;
    }
    if (this.recording) {
      try {
        await this.recording.stopAndUnloadAsync();
      } catch (_) {}
      this.recording = null;
    }
  }

  /**
   * Riascolta l'ultimo messaggio ricevuto dagli amici
   */
  public async replayLastMessage(): Promise<boolean> {
    if (!this.lastReceivedMessage) {
      return false;
    }
    await this._playIncomingVoice(this.lastReceivedMessage);
    return true;
  }

  public getState(): IntercomState {
    return {
      isOn: this.isOn,
      channelId: this.channelId,
      channelName: 'Canale Amici',
      isTransmitting: this.isTransmitting,
      isReceiving: this.isReceiving,
      currentSpeakerName: this.currentSpeakerName,
      activeMembersCount: this.activeMembersCount,
    };
  }

  private _emitState(): void {
    DeviceEventEmitter.emit('Intercom_StateChanged', this.getState());
  }
}

export const intercomService = new IntercomService();
