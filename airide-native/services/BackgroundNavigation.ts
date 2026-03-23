import BackgroundService from 'react-native-background-actions';
import Geolocation from 'react-native-geolocation-service';
import { bleService } from './BleSingleton';
import { DeviceEventEmitter, Platform, PermissionsAndroid } from 'react-native';
import { updatePosition } from './api'; 
import { NavigationStore } from './NavigationStore'; 
import { 
  loadModel, 
  start as startVosk, 
  stop as stopVosk, 
  onResult, 
  onPartialResult, 
  onError,
  unload
} from 'react-native-vosk';
import { IntentParser, VoiceIntent } from '../utils/IntentParser';
import * as Speech from 'expo-speech';

const sleep = (time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time));

// --- VOSK CONFIG ---
const WAKE_WORD_REGEX = /\b(hey|ehy|ehi|hei|ei|eh|hai|ok|ciao|e|è|i|il|el|al|un|a)(\s+(il|i|lo|l|un))?\s+casco\b/i;
const WAKE_WORD_WINDOW = 5000;
let isVoskInitialized = false;
let isCommandWindowOpen = false;
let lastWakeWordTime = 0;
const intentParser = new IntentParser();

// --- CONVERSATION STATE ---
type VoiceSessionState = 'IDLE' | 'CONFIRM_NAV' | 'CONFIRM_CHANGE';
let sessionState: VoiceSessionState = 'IDLE';
let pendingIntent: VoiceIntent | null = null;
let sessionTimeout: any = null;

const RESET_SESSION_TIMEOUT = 10000; // 10s per rispondere

const options = {
    taskName: 'AirRideNav',
    taskTitle: 'AirRide è attivo',
    taskDesc: 'Navigazione smart in corso',
    taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
    },
    color: '#ff00ff',
    linkingURI: 'airide://',
    parameters: {
        delay: 1000,
    },
    progressBar: {
        max: 100,
        value: 0,
        indeterminate: true,
    },
};

// GPS Options Aggressive
const gpsOptions = {
    enableHighAccuracy: true,
    timeout: 10000, 
    maximumAge: 5000,
    forceRequestLocation: true,
};

// --- HELPERS ---
const speak = (text: string) => {
    console.log(`[Background] 🗣️ TTS: "${text}"`);
    Speech.speak(text, { language: 'it-IT' });
};

const resetSession = () => {
    sessionState = 'IDLE';
    pendingIntent = null;
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = null;
    DeviceEventEmitter.emit('Voice_Status', { status: 'idle' });
};

const startSessionTimeout = () => {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        console.log('[Background] ⌛ Sessione scaduta');
        if (sessionState !== 'IDLE') {
            speak("Tempo scaduto, annullo.");
        }
        resetSession();
    }, RESET_SESSION_TIMEOUT);
};

// --- VOSK HANDLERS ---
const checkWakeWord = (text: string) => {
    // Se siamo in attesa di conferma, accettiamo tutto come potenziale input
    // MA se l'utente dice la wake word, resetteremo il timer implicitamente nel loop principale
    if (sessionState !== 'IDLE') return true;

    if (WAKE_WORD_REGEX.test(text)) {
        console.log('[Background] ⚡ Wake word rilevata!');
        lastWakeWordTime = Date.now();
        if (!isCommandWindowOpen) {
            isCommandWindowOpen = true;
            DeviceEventEmitter.emit('Voice_Status', { status: 'listening' });
        }
        return true;
    }
    return false;
};

const handleIntent = (intent: VoiceIntent) => {
    console.log('[Background] 🤖 Handling Intent:', intent.type, 'State:', sessionState);

    // 1. GESTIONE STATI DI CONFERMA
    if (sessionState === 'CONFIRM_NAV' || sessionState === 'CONFIRM_CHANGE') {
        if (intent.type === 'YES') {
            speak(sessionState === 'CONFIRM_NAV' ? "Ottimo, avvio la navigazione." : "D'accordo, cambio rotta.");
            
            // Eseguiamo l'azione pendente
            if (pendingIntent) {
                 DeviceEventEmitter.emit('Voice_Intent', pendingIntent); // Invia alla UI per esecuzione effettiva
            }
            resetSession();
            return;
        } else if (intent.type === 'NO' || intent.type === 'CANCEL_NAVIGATION') {
            speak("Ok, annullato.");
            resetSession();
            return;
        } else {
            // Se l'intento è un altro (es. "che ore sono"), forse l'utente ha cambiato idea?
            // O forse Vosk ha capito male.
            // Per ora: se è un comando valido diverso da YES/NO, annulliamo la conferma e eseguiamo quello nuovo?
            // O lo ignoriamo?
            // Facciamo che se è un comando "forte" (es. NAVIGATE_TO), sovrascrive.
            if (intent.type === 'NAVIGATE_TO') {
                // Nuova richiesta navigazione
                // ... flow below handles it
            } else {
                 // Info o altro in mezzo a una conferma -> Eseguiamo e resettiamo?
                 // Meglio chiedere conferma di nuovo? "Non ho capito, confermi?"
                 speak("Non ho capito. Confermi?");
                 return;
            }
        }
    }

    // 2. GESTIONE COMANDI STANDARD (IDLE o Sovrascrittura)
    switch (intent.type) {
        case 'NAVIGATE_TO': {
            pendingIntent = intent;
            sessionState = 'CONFIRM_NAV';
            
            const store = NavigationStore.get();
            if (store.isNavigating) {
                speak(`Vuoi cambiare la rotta verso ${intent.destination}?`);
            } else {
                speak(`Rotta verso ${intent.destination}. Confermi?`);
            }
            startSessionTimeout();
            break;
        }
            
        case 'CHANGE_ROUTE':
            // Se ha una destinazione nel payload (dal parser modificato, CHANGE_ROUTE potrebbe non averlo se non gestito ancora)
            // L'IntentParser attuale separa Navigation da Change.
            // Se CHANGE_ROUTE è generico "cambia percorso", chiediamo info?
            // Se l'utente dice "cambia rotta in X", il parser restituisce NAVIGATE_TO (come da mia logica precedente)
            // Quindi qui arriva solo "evita autostrade" o "cambia percorso" senza args.
            if (intent.avoid) {
                speak("Provo a evitare autostrade. Confermi?");
                pendingIntent = intent;
                sessionState = 'CONFIRM_CHANGE';
                startSessionTimeout();
            } else {
                 // Change generico -> Ricalcolo?
                 speak("Vuoi ricalcolare il percorso?");
                 pendingIntent = { type: 'RECALCULATE_ROUTE' }; // Forziamo un ricalcolo
                 sessionState = 'CONFIRM_CHANGE';
                 startSessionTimeout();
            }
            break;
            
        case 'GET_TIME':
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            speak(`Sono le ${hours} e ${minutes}`);
            break;
            
        case 'GET_REMAINING_INFO': {
            // Leggiamo dallo store
            const store = NavigationStore.get();
            if (store.totalDist && store.remainingDist) {
                const km = (store.remainingDist / 1000).toFixed(1);
                speak(`Mancano ancora ${km} chilometri.`);
            } else {
                speak("Nessuna navigazione attiva.");
            }
            break;
        }
            
        default:
            // Altri comandi diretti (Call, etc) -> Eseguiamo subito
            DeviceEventEmitter.emit('Voice_Intent', intent);
            break;
    }
};

const setupVosk = async () => {
    try {
        // SafeModel Load
        if (!isVoskInitialized) {
            console.log('[Background] 🎙️ Caricamento Modello Vosk...');
            try {
                await loadModel('model');
                isVoskInitialized = true;
                console.log('[Background] 🎙️ Modello Caricato!');
            } catch (loadErr) {
                console.error('[Background] ❌ Errore LoadModel:', loadErr);
                return; // Se non carica il modello, inutile proseguire
            }

            onResult((res) => {
                try {
                    const text = (typeof res === 'string' ? res : String(res)).toLowerCase();
                    if (!text) return;

                    const justWokeUp = checkWakeWord(text);
                    const isWithinWindow = (Date.now() - lastWakeWordTime) < WAKE_WORD_WINDOW;

                    // Se siamo in Sessione (attesa conferma), processiamo tutto
                    if (sessionState !== 'IDLE' || isWithinWindow || justWokeUp) {
                         let cleanText = text;
                         const match = text.match(WAKE_WORD_REGEX);
                         
                         if (match && match.index !== undefined) {
                            cleanText = text.substring(match.index + match[0].length).trim();
                         } else {
                            // Se in sessione, non serve wake word, prendiamo tutto
                            // Se idle, prendiamo tutto solo se isWithinWindow
                            cleanText = text.trim();
                         }

                         if (cleanText.length > 0) {
                             // Se siamo in attesa di conferma, usiamo skipWakeWordCheck
                             const skipCheck = (sessionState !== 'IDLE') || justWokeUp || isWithinWindow;
                             const intent = intentParser.parse(cleanText, { skipWakeWordCheck: skipCheck });
                             
                             if (intent.type !== 'UNKNOWN') {
                                 handleIntent(intent);
                                 lastWakeWordTime = 0; // Reset window dopo comando
                                 if (sessionState === 'IDLE') {
                                     isCommandWindowOpen = false;
                                     DeviceEventEmitter.emit('Voice_Status', { status: 'idle' });
                                 }
                             }
                         }
                    }
                    
                    if (sessionState === 'IDLE' && isCommandWindowOpen && !isWithinWindow && !justWokeUp) {
                        isCommandWindowOpen = false;
                        DeviceEventEmitter.emit('Voice_Status', { status: 'idle' });
                    }

                } catch (e) {
                    console.error('[Background] Vosk Process Error:', e);
                }
            });

            onPartialResult((res) => {
                const text = typeof res === 'string' ? res : JSON.stringify(res);
                if (text) checkWakeWord(text);
            });
            
            onError((e) => {
                const errStr = String(e);
                if (!errStr.includes('No speech')) console.log('[Background] Vosk Error:', e);
            });
        }
        
        console.log('[Background] 🎙️ Reset Vosk (Stop)...');
        try {
            stopVosk(); 
             // Breve pausa per pulizia
            await new Promise(r => setTimeout(r, 500));
        } catch(e) {}

        console.log('[Background] 🎙️ Avvio Vosk (Start)...');
        // Non awaitiamo all'infinito.
        startVosk().then(() => {
             console.log('[Background] ✅ Vosk Avviato con successo!');
        }).catch(e => {
             console.error('[Background] ❌ Errore Start Vosk:', e);
        });
        
    } catch (e) {
        console.error('[Background] ❌ Errore Setup Vosk Generico:', e);
    }
};

const navigationTask = async (taskDataArguments: any) => {
    const { delay } = taskDataArguments;
    console.log('[Background] 🧠 BRAIN AVVIATO: Logic moved to BG Task');
    
    // START VOSK
    await setupVosk();

    await new Promise<void>(async (resolve) => {
        while (BackgroundService.isRunning()) {
            try {
                // 1. CHIEDI IL GPS (Solo se NON in DEMO)
                const currentStore = NavigationStore.get();
                
                // SE NON NAVIGHIAMO, SALTIAMO TUTTO IL BLOCCO GPS/API
                // Il loop continua solo per tenere vivo Vosk (STT)
                if (currentStore.isNavigating) {
                    if (currentStore.isDemo) {
                         // In DEMO MODE: Saltiamo GPS e API. 
                         // Ci fidiamo che la UI aggiorni lo Store con i dati simulati.
                         // Aspettiamo solo che il loop proceda all'invio BLE.
                         // console.log('[Background] 🎮 Demo Mode Active - Skipping Real GPS');
                    } else {
                        const position = await new Promise<any>((resolveGPS) => {
                             let resolved = false;
                             const onDone = (pos: any) => {
                                 if (!resolved) { resolved = true; resolveGPS(pos); }
                             };
        
                             Geolocation.getCurrentPosition(
                                (pos) => onDone(pos),
                                (err) => {
                                    console.log('[Background] ⚠️ GPS Fatica:', err.code, err.message);
                                    onDone(null);
                                },
                                gpsOptions
                            );
        
                            setTimeout(() => {
                                if (!resolved) {
                                    console.log('[Background] ⚠️ GPS Timeout Manuale - Sblocco Loop');
                                    onDone(null);
                                }
                            }, 5000);
                        });
        
                        // 2. LOGICA NAVIGAZIONE (Chiamata API)
                        if (position && position.coords) {
                            const { latitude, longitude } = position.coords;
                            
                            // Chiamiamo il backend per avere l'istruzione aggiornata
                            const res = await updatePosition(latitude, longitude);
        
                            if (res && res.nav) {
                                // console.log('[Background] 🔍 DEBUG NAV:', JSON.stringify(res.nav, null, 2));
        
                                 const nav = res.nav;
                                 // Aggiorniamo lo Store Globale (così la UI si aggiorna se aperta)
                                 NavigationStore.set({
                                     arrow: nav.freccia ?? 0,
                                     distance: nav.metri ?? 0,
                                     text: nav.testo ?? '',
                                     nextArrow: nav.next?.freccia,
                                     nextText: nav.next?.testo,
                                     remainingDist: nav.remaining_dist,
                                     totalDist: nav.total_dist
                                 });
                            }
                        } else {
                            console.log('[Background] Posizione nulla, skip API call');
                        }
                    }
    
                    // 3. PREPARA DATI DAL STORE
                    const currentData = NavigationStore.get();
                    
                    // Calcolo dati navigazione
                    const total = currentData.totalDist ?? 0;
                    const remaining = currentData.remainingDist ?? 0;
                    
                    // Protocollo: freccia|metri turno|m totali|m mancanti|phone status
                    // Modifica: Inviato 'remaining' invece di 'traveled' perché l'utente si aspetta valore decrescente
                    const packet = `${currentData.arrow}|${currentData.distance}|${total}|${remaining}|${currentData.callStatus}`; // 4th param: remaining instead of traveled

                    console.log(`[Background] 🟢 BRAIN LOOP | Packet: ${packet}`);
    
                    // 4. INVIA AL CASCO
                    if (bleService.getDevice()) {
                         await bleService.sendToHelmet(packet);
                    }
                } // END if(isNavigating)

            } catch (error) {
                console.log('[Background] ❌ Errore Ciclo Brain:', error);
            }

            await sleep(delay);
        }
    });

    try {
        console.log('[Background] 🛑 Vosk Stop...');
        stopVosk();
    } catch(e) {}
};

export const BackgroundNavigation = {
    start: async () => {
        console.log("[Manager] 🟢 start() richiamato. isRunning?", BackgroundService.isRunning());
        
        if (Platform.OS === 'android') {
            try {
                // Determine API Level for conditional permissions
                const isAndroid12 = Platform.Version >= 31;
                const isAndroid13 = Platform.Version >= 33;

                const permissionsToRequest = [
                    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
                    ...(isAndroid12 ? [
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
                    ] : []),
                    ...(isAndroid13 ? [
                        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
                    ] : [])
                ];

                const granted = await PermissionsAndroid.requestMultiple(permissionsToRequest);

                console.log("[Manager] 📝 Permissions Result:", granted);

                const hasAudio = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
                const hasLocation = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;

                if (!hasAudio || !hasLocation) {
                    console.warn(`[Manager] 🛑 START ABORTED: Missing critical permissions! Audio: ${hasAudio}, Location: ${hasLocation}`);
                    // Optional: You could show an alert here or callback to UI
                    return;
                }

                if (isAndroid12) {
                    const hasBleConnect = granted[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
                    if (!hasBleConnect) {
                        console.warn("[Manager] 🛑 START ABORTED: Missing BLUETOOTH_CONNECT permission!");
                        return;
                    }
                }
                
                // Note: POST_NOTIFICATIONS failure is acceptable (just no visible notification), so we don't abort based on it.

            } catch (err) {
                console.warn("[Manager] ⚠️ Permission request error:", err);
                return;
            }
        }

        if (!BackgroundService.isRunning()) {
            try {
                // Listener Call Status (indipendente)
                DeviceEventEmitter.addListener('CallStatusChanged', (event: any) => {
                     console.log("[Manager] 📞 Call Event:", event);
                     if (event && typeof event.status === 'number') {
                         NavigationStore.set({ callStatus: event.status });
                     }
                });

                await BackgroundService.start(navigationTask, options);
                console.log("[Manager] ✅ Brain Started");
            } catch (e) {
                console.error("[Manager] ❌ Errore in Start:", e);
            }
        }
    },
    stop: async () => {
        if (BackgroundService.isRunning()) {
            await BackgroundService.stop();
            console.log("[Manager] Brain Stopped");
            DeviceEventEmitter.removeAllListeners('CallStatusChanged');
        }
    },
};
