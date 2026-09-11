// services/FriendsService.ts
// Gestione Amici, Posizione in tempo reale, Privacy e Radar per AiRide

import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseFirestore, firebaseAuth } from './firebaseConfig';

export interface FriendLocation {
  latitude: number;
  longitude: number;
  speedKmh?: number;
  heading?: number;
  updatedAt: number;
}

export interface FriendProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  bikeModel?: string;
  isLocationShared: boolean;
  location?: FriendLocation;
  isOnline?: boolean;
  lastSeen?: number;
  intercomActive?: boolean;
}

const STORAGE_PRIVACY_KEY = '@airide_share_location';
const LOCATION_UPDATE_THROTTLE_MS = 3000; // Massimo un aggiornamento ogni 3s per risparmio dati/batteria

class FriendsService {
  private currentUserId: string | null = null;
  private isLocationShared: boolean = true;
  private friends: FriendProfile[] = [];
  private unsubscribeUserDoc: (() => void) | null = null;
  private unsubscribeFriendsListeners: Map<string, () => void> = new Map();
  private lastLocationUpdateTime: number = 0;
  private lastKnownCoords: { latitude: number; longitude: number; speedKmh?: number; heading?: number } | null = null;

  constructor() {
    this._restorePrivacySetting();
  }

  private async _restorePrivacySetting(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_PRIVACY_KEY);
      if (saved !== null) {
        this.isLocationShared = saved === 'true';
      }
    } catch (e) {
      console.warn('[FriendsService] Errore lettura privacy:', e);
    }
  }

  /**
   * Inizializza il servizio per l'utente loggato
   */
  public init(user: any): void {
    if (!user?.uid) return;
    if (this.currentUserId === user.uid) return;

    this.cleanup();
    this.currentUserId = user.uid;
    console.log(`[FriendsService] Inizializzazione per utente: ${user.uid}`);

    this._ensureUserProfile(user);
    this._startListeningToFriends(user.uid);
  }

  /**
   * Pulisce i listener attivi
   */
  public cleanup(): void {
    if (this.unsubscribeUserDoc) {
      this.unsubscribeUserDoc();
      this.unsubscribeUserDoc = null;
    }
    this.unsubscribeFriendsListeners.forEach(unsub => unsub());
    this.unsubscribeFriendsListeners.clear();
    this.friends = [];
    this.currentUserId = null;
  }

  /**
   * Assicura che l'utente abbia i campi necessari su Firestore
   */
  private async _ensureUserProfile(user: any): Promise<void> {
    try {
      const docRef = firebaseFirestore.collection('users').doc(user.uid);
      const snap = await docRef.get();
      const defaultName = user.displayName || user.email?.split('@')[0] || 'Pilota AiRide';

      const docExists = typeof snap.exists === 'function' ? snap.exists() : snap.exists;
      if (!docExists) {
        await docRef.set({
          uid: user.uid,
          displayName: defaultName,
          email: user.email || '',
          isLocationShared: this.isLocationShared,
          friends: [],
          updatedAt: Date.now(),
        }, { merge: true });
      } else {
        const data = snap.data() || {};
        if (data.isLocationShared !== undefined) {
          this.isLocationShared = data.isLocationShared;
        }
        if (!data.displayName) {
          await docRef.update({ displayName: defaultName });
        }
      }
    } catch (e) {
      console.warn('[FriendsService] Errore _ensureUserProfile:', e);
    }
  }

  /**
   * Ascolta il documento dell'utente per aggiornare la lista amici
   */
  private _startListeningToFriends(userId: string): void {
    const docRef = firebaseFirestore.collection('users').doc(userId);

    this.unsubscribeUserDoc = docRef.onSnapshot(
      (doc) => {
        const docExists = typeof doc.exists === 'function' ? doc.exists() : doc.exists;
        if (!docExists) return;
        const data = doc.data() || {};
        const friendUids: string[] = Array.isArray(data.friends) ? data.friends : [];

        if (data.isLocationShared !== undefined && data.isLocationShared !== this.isLocationShared) {
          this.isLocationShared = data.isLocationShared;
          AsyncStorage.setItem(STORAGE_PRIVACY_KEY, String(data.isLocationShared));
        }

        this._syncFriendListeners(friendUids);
      },
      (err) => {
        console.warn('[FriendsService] Errore ascolto utente:', err);
      }
    );
  }

  /**
   * Sincronizza i listener Firestore per ogni singolo amico
   */
  private _syncFriendListeners(friendUids: string[]): void {
    // 1. Rimuovi listener non più necessari
    for (const [uid, unsub] of this.unsubscribeFriendsListeners.entries()) {
      if (!friendUids.includes(uid)) {
        unsub();
        this.unsubscribeFriendsListeners.delete(uid);
      }
    }

    // Se non ci sono amici, pulisci la lista
    if (friendUids.length === 0) {
      this.friends = [];
      this._emitChange();
      return;
    }

    // 2. Aggiungi listener per nuovi amici
    friendUids.forEach((friendUid) => {
      if (!this.unsubscribeFriendsListeners.has(friendUid)) {
        const friendDocRef = firebaseFirestore.collection('users').doc(friendUid);
        const unsub = friendDocRef.onSnapshot(
          (doc) => {
            const docExists = typeof doc.exists === 'function' ? doc.exists() : doc.exists;
            if (docExists) {
              const d = doc.data() || {};
              const updatedProfile: FriendProfile = {
                uid: friendUid,
                displayName: d.displayName || d.email?.split('@')[0] || 'Amico',
                email: d.email || '',
                photoURL: d.photoURL,
                bikeModel: d.bikeModel,
                isLocationShared: d.isLocationShared ?? true,
                location: d.isLocationShared !== false ? d.location : undefined,
                lastSeen: d.updatedAt || d.location?.updatedAt,
                isOnline: (Date.now() - (d.updatedAt || d.location?.updatedAt || 0)) < 120000, // Attivo negli ultimi 2 min
                intercomActive: d.intercomState?.isActive ?? false,
              };

              // Aggiorna o inserisci nella lista
              const idx = this.friends.findIndex(f => f.uid === friendUid);
              if (idx >= 0) {
                this.friends[idx] = updatedProfile;
              } else {
                this.friends.push(updatedProfile);
              }
              this._emitChange();
            }
          },
          (err) => {
            console.warn(`[FriendsService] Errore ascolto amico ${friendUid}:`, err);
          }
        );

        this.unsubscribeFriendsListeners.set(friendUid, unsub);
      }
    });
  }

  /**
   * Aggiorna la posizione GPS dell'utente corrente (con throttling di 3s)
   */
  public async updateMyLocation(coords: {
    latitude: number;
    longitude: number;
    speedKmh?: number;
    heading?: number;
  }): Promise<void> {
    this.lastKnownCoords = coords;
    if (!this.currentUserId) return;

    const now = Date.now();
    if (now - this.lastLocationUpdateTime < LOCATION_UPDATE_THROTTLE_MS) {
      return;
    }
    this.lastLocationUpdateTime = now;

    try {
      const loc: FriendLocation = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speedKmh: coords.speedKmh ?? 0,
        heading: coords.heading ?? 0,
        updatedAt: now,
      };

      await firebaseFirestore.collection('users').doc(this.currentUserId).update({
        location: loc,
        updatedAt: now,
      });
    } catch (e) {
      // Ignora silenziosamente errori di rete temporanei
    }
  }

  /**
   * Attiva o disattiva la privacy per la condivisione della propria posizione
   */
  public async setLocationSharing(enabled: boolean): Promise<void> {
    this.isLocationShared = enabled;
    await AsyncStorage.setItem(STORAGE_PRIVACY_KEY, String(enabled));

    if (this.currentUserId) {
      try {
        await firebaseFirestore.collection('users').doc(this.currentUserId).update({
          isLocationShared: enabled,
          updatedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[FriendsService] Errore update privacy:', e);
      }
    }
    this._emitChange();
  }

  public getIsLocationShared(): boolean {
    return this.isLocationShared;
  }

  /**
   * Restituisce la lista amici attuale
   */
  public getFriends(): FriendProfile[] {
    return [...this.friends];
  }

  /**
   * Cerca un amico per nome con tolleranza fuzzy (per comandi vocali: "raggiungi Marco")
   */
  public findFriendByName(nameQuery: string): FriendProfile | null {
    if (!nameQuery || this.friends.length === 0) return null;
    const clean = nameQuery.trim().toLowerCase();

    // 1. Corrispondenza esatta sul nome
    const exact = this.friends.find(
      f => f.displayName.toLowerCase() === clean
    );
    if (exact) return exact;

    // 2. Nome inizia con la query o è contenuto
    const partial = this.friends.find(
      f => f.displayName.toLowerCase().startsWith(clean) ||
           f.displayName.toLowerCase().includes(clean)
    );
    if (partial) return partial;

    // 3. Prima parola del displayName corrisponde (es. "Marco Rossi" -> "Marco")
    const firstNameMatch = this.friends.find(
      f => f.displayName.toLowerCase().split(' ')[0] === clean
    );
    if (firstNameMatch) return firstNameMatch;

    return null;
  }

  /**
   * Aggiunge un amico tramite email o nickname
   */
  public async addFriend(query: string): Promise<{ success: boolean; message: string; friend?: FriendProfile }> {
    if (!this.currentUserId) {
      return { success: false, message: 'Devi essere autenticato per aggiungere amici.' };
    }

    const clean = query.trim().toLowerCase();
    if (!clean) {
      return { success: false, message: 'Inserisci un nome utente o email valido.' };
    }

    try {
      // Cerca per email
      let snap = await firebaseFirestore
        .collection('users')
        .where('email', '==', clean)
        .limit(1)
        .get();

      // Se non trova per email, cerca per displayName
      if (snap.empty) {
        snap = await firebaseFirestore
          .collection('users')
          .where('displayName', '==', query.trim())
          .limit(1)
          .get();
      }

      if (snap.empty) {
        return { success: false, message: `Nessun motociclista trovato con "${query}".` };
      }

      const targetDoc = snap.docs[0];
      const targetUid = targetDoc.id;

      if (targetUid === this.currentUserId) {
        return { success: false, message: 'Non puoi aggiungere te stesso come amico.' };
      }

      if (this.friends.some(f => f.uid === targetUid)) {
        return { success: false, message: 'Questo motociclista è già nella tua lista amici!' };
      }

      // Aggiungi reciprocamente l'amico
      const userRef = firebaseFirestore.collection('users').doc(this.currentUserId);
      const targetRef = firebaseFirestore.collection('users').doc(targetUid);

      // @ts-ignore
      const FieldValue = require('@react-native-firebase/firestore').default.FieldValue;

      await userRef.update({
        friends: FieldValue.arrayUnion(targetUid),
        updatedAt: Date.now(),
      });

      await targetRef.update({
        friends: FieldValue.arrayUnion(this.currentUserId),
        updatedAt: Date.now(),
      });

      const targetData = targetDoc.data();
      const friendProfile: FriendProfile = {
        uid: targetUid,
        displayName: targetData.displayName || targetData.email?.split('@')[0] || 'Amico',
        email: targetData.email || '',
        photoURL: targetData.photoURL,
        bikeModel: targetData.bikeModel,
        isLocationShared: targetData.isLocationShared ?? true,
        location: targetData.location,
      };

      return {
        success: true,
        message: `Amico aggiunto: ${friendProfile.displayName}!`,
        friend: friendProfile,
      };
    } catch (e: any) {
      console.error('[FriendsService] Errore aggiunta amico:', e);
      return { success: false, message: e.message || 'Errore durante l\'aggiunta dell\'amico.' };
    }
  }

  /**
   * Rimuove un amico dalla lista
   */
  public async removeFriend(friendUid: string): Promise<boolean> {
    if (!this.currentUserId) return false;

    try {
      const userRef = firebaseFirestore.collection('users').doc(this.currentUserId);
      // @ts-ignore
      const FieldValue = require('@react-native-firebase/firestore').default.FieldValue;

      await userRef.update({
        friends: FieldValue.arrayRemove(friendUid),
        updatedAt: Date.now(),
      });

      this.friends = this.friends.filter(f => f.uid !== friendUid);
      this._emitChange();
      return true;
    } catch (e) {
      console.warn('[FriendsService] Errore rimozione amico:', e);
      return false;
    }
  }

  private _emitChange(): void {
    DeviceEventEmitter.emit('Friends_Updated', {
      friends: this.getFriends(),
      isLocationShared: this.isLocationShared,
    });
  }
}

export const friendsService = new FriendsService();
