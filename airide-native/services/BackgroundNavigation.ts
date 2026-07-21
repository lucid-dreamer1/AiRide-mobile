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
import { Audio } from 'expo-av';
import { firebaseFirestore } from './firebaseConfig';
import auth from '@react-native-firebase/auth';
import CallModule from './callModule';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VoskModelManager } from './VoskModelManager';

const sleep = (time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time));

// --- VOICE SETTINGS CACHE ---
const VOICE_STORAGE_KEY = '@airide_voice_settings';

type VoiceSettingsCache = { enabled: boolean; language: string; };
let voiceSettings: VoiceSettingsCache = { enabled: true, language: 'it' };

const loadVoiceSettings = async () => {
    try {
        const raw = await AsyncStorage.getItem(VOICE_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            voiceSettings = { 
                enabled: parsed.enabled !== false, // default true
                language: parsed.language || 'it',
            };
        }
    } catch(e) {}
    console.log('[Background] 🗣️ Voice settings loaded:', voiceSettings);
};

const LANG_CODE_MAP: Record<string, string> = {
    it: 'it-IT', en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES',
};

const DISABLED_MSG: Record<string, string> = {
    it: 'Assistente disattivato. Vuoi attivarlo ora?',
    en: 'Assistant disabled. Do you want to activate it now?',
    fr: "Assistant désactivé. Voulez-vous l'activer maintenant?",
    de: 'Assistent deaktiviert. Möchtest du ihn jetzt aktivieren?',
    es: '¿Asistente desactivado. ¿Desea activarlo ahora?',
};

const CONFIRM_MSGS: Record<string, {
    yes: string; timeout: string; dimmi: string;
    cancelled: string; notUnderstood: string; confirm: string;
    changeRoute: string; recalculate: string; avoidHighways: string;
    noNav: string; remaining: string;
    timePrefix: string; timeSuffix: string;
}> = {
    it: {
        yes: 'Ottimo, avvio la navigazione.',
        timeout: 'Tempo scaduto, annullo.',
        dimmi: 'Dimmi',
        cancelled: 'Ok, annullato.',
        notUnderstood: 'Non ho capito. Confermi?',
        confirm: 'Rotta verso {dest}. Confermi?',
        changeRoute: 'Vuoi cambiare la rotta verso {dest}?',
        recalculate: 'Vuoi ricalcolare il percorso?',
        avoidHighways: 'Provo a evitare autostrade. Confermi?',
        noNav: 'Nessuna navigazione attiva.',
        remaining: 'Mancano ancora {km} chilometri.',
        timePrefix: 'Sono le',
        timeSuffix: 'e',
    },
    en: {
        yes: 'Great, starting navigation.',
        timeout: 'Time out, cancelling.',
        dimmi: 'Yes?',
        cancelled: 'Ok, cancelled.',
        notUnderstood: 'I did not understand. Please confirm?',
        confirm: 'Route to {dest}. Confirm?',
        changeRoute: 'Change route to {dest}?',
        recalculate: 'Do you want to recalculate the route?',
        avoidHighways: 'I will try to avoid highways. Confirm?',
        noNav: 'No active navigation.',
        remaining: '{km} kilometres remaining.',
        timePrefix: "It's",
        timeSuffix: '',
    },
    fr: {
        yes: 'Parfait, je lance la navigation.',
        timeout: 'Temps écoulé, annulation.',
        dimmi: 'Dites-moi',
        cancelled: 'Ok, annulé.',
        notUnderstood: "Je n'ai pas compris. Confirmez?",
        confirm: 'Route vers {dest}. Confirmer?',
        changeRoute: 'Changer la route vers {dest}?',
        recalculate: 'Voulez-vous recalculer l\'itinéraire?',
        avoidHighways: "J'essaie d'éviter les autoroutes. Confirmer?",
        noNav: 'Aucune navigation active.',
        remaining: 'Il reste {km} kilomètres.',
        timePrefix: 'Il est',
        timeSuffix: '',
    },
    de: {
        yes: 'Super, starte die Navigation.',
        timeout: 'Zeit abgelaufen, breche ab.',
        dimmi: 'Bitte',
        cancelled: 'Ok, abgebrochen.',
        notUnderstood: 'Ich habe nicht verstanden. Bitte bestätigen?',
        confirm: 'Route nach {dest}. Bestätigen?',
        changeRoute: 'Route nach {dest} ändern?',
        recalculate: 'Soll ich die Route neu berechnen?',
        avoidHighways: 'Ich versuche, Autobahnen zu vermeiden. Bestätigen?',
        noNav: 'Keine aktive Navigation.',
        remaining: 'Noch {km} Kilometer.',
        timePrefix: 'Es ist',
        timeSuffix: 'Uhr',
    },
    es: {
        yes: 'Genial, iniciando navegación.',
        timeout: 'Tiempo agotado, cancelando.',
        dimmi: 'Dime',
        cancelled: 'Ok, cancelado.',
        notUnderstood: 'No entendí. ¿Confirma?',
        confirm: 'Ruta hacia {dest}. ¿Confirmar?',
        changeRoute: '¿Cambiar ruta hacia {dest}?',
        recalculate: '¿Deseas recalcular la ruta?',
        avoidHighways: 'Intentaré evitar autopistas. ¿Confirmar?',
        noNav: 'Sin navegación activa.',
        remaining: 'Quedan {km} kilómetros.',
        timePrefix: 'Son las',
        timeSuffix: '',
    },
};

// --- VOSK CONFIG ---
const WAKE_WORD_REGEX = /\b(hey|ehy|ehi|hei|ei|eh|hai|ok|ciao|e|è|i|il|el|al|un|a)(\s+(il|i|lo|l|un))?\s+casco\b/i;
const WAKE_WORD_WINDOW = 5000;
let isVoskInitialized = false;
let isOtaActive = false;
let currentLoadedLang = 'it'; // lingua del modello Vosk attualmente caricato
let isCommandWindowOpen = false;
let lastWakeWordTime = 0;
const intentParser = new IntentParser();

// --- CONVERSATION STATE ---
type VoiceSessionState = 'IDLE' | 'CONFIRM_NAV' | 'CONFIRM_CHANGE';
let sessionState: VoiceSessionState = 'IDLE';
let pendingIntent: VoiceIntent | null = null;
let sessionTimeout: any = null;

// --- AI RESCUE EMERGENCY STATE ---
let isEmergencyMode = false;

// --- ANTI-ECHO FLAG ---
// Impedisce a Vosk di processare l'audio prodotto dal TTS stesso
let isTTSSpeaking = false;

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
const TTS_COOLDOWN_MS = 900; // ms di silenzio dopo il TTS prima di riascoltare
let ttsSafetyTimer: any = null;

const clearTTSFlag = (delay = TTS_COOLDOWN_MS) => {
    if (ttsSafetyTimer) clearTimeout(ttsSafetyTimer);
    ttsSafetyTimer = setTimeout(() => {
        isTTSSpeaking = false;
        console.log('[Background] ✅ TTS terminato — Vosk riprende ad ascoltare');
    }, delay);
};

const speak = (text: string, langOverride?: string) => {
    const langCode = LANG_CODE_MAP[langOverride || voiceSettings.language] || 'it-IT';
    console.log(`[Background] 🗣️ TTS (${langCode}): "${text}"`);
    isTTSSpeaking = true;

    // Safety fallback: se onDone non scatta mai (bug Android), sblocca dopo 10s
    if (ttsSafetyTimer) clearTimeout(ttsSafetyTimer);
    ttsSafetyTimer = setTimeout(() => {
        isTTSSpeaking = false;
        console.log('[Background] ⚠️ TTS safety timeout — Vosk riabilitato');
    }, 10000);

    Speech.speak(text, {
        language: langCode,
        onDone:    () => clearTTSFlag(TTS_COOLDOWN_MS),
        onStopped: () => clearTTSFlag(TTS_COOLDOWN_MS),
        onError:   () => clearTTSFlag(0), // su errore sblocca subito
    });

    // Salva le parole chiave del testo appena detto per il filtro eco
    lastSpokenWords = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
};

// Parole pronunciate dal TTS nell'ultimo ciclo — usate per rilevare eco
let lastSpokenWords: string[] = [];

// Rimuove dal INIZIO della trascrizione le parole che coincidono con l'eco del TTS.
// Es: "rotta verso roma confermi sì" → strip "rotta verso roma confermi" → rimane "sì"
// Se non resta nulla (solo eco, nessun input utente) restituisce stringa vuota.
const removeEchoPrefix = (text: string): string => {
    if (lastSpokenWords.length === 0) return text;
    const inputWords = text.toLowerCase().split(/\s+/);

    let i = 0;
    while (i < inputWords.length) {
        const word = inputWords[i];
        const isEchoWord = lastSpokenWords.some(s => s.includes(word) || word.includes(s));
        if (isEchoWord) { i++; } else { break; }
    }

    if (i > 0) {
        const stripped = inputWords.slice(i).join(' ').trim();
        console.log(`[Background] 🔇 Eco rimossa: "${inputWords.slice(0, i).join(' ')}" | Rimasto: "${stripped || '(vuoto)'}"`);
        return stripped;
    }
    return text;
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
            const msg = CONFIRM_MSGS[voiceSettings.language]?.timeout || 'Tempo scaduto, annullo.';
            speak(msg);
        }
        resetSession();
    }, RESET_SESSION_TIMEOUT);
};

// --- VOSK HANDLERS ---
const checkWakeWord = (text: string) => {
    if (sessionState !== 'IDLE') return true;

    if (WAKE_WORD_REGEX.test(text)) {
        console.log('[Background] ⚡ Wake word rilevata!');
        lastWakeWordTime = Date.now();
        if (!isCommandWindowOpen) {
            isCommandWindowOpen = true;
            
            // Se l'assistente è disabilitato, rispondi e non aprire la sessione
            if (!voiceSettings.enabled) {
                const msg = DISABLED_MSG[voiceSettings.language] || DISABLED_MSG.it;
                speak(msg);
                isCommandWindowOpen = false;
                return false;
            }
            
            const dimmi = CONFIRM_MSGS[voiceSettings.language]?.dimmi || 'Dimmi';
            speak(dimmi);
            DeviceEventEmitter.emit('Voice_Status', { status: 'listening' });
        }
        return true;
    }
    return false;
};

const handleIntent = (intent: VoiceIntent) => {
    console.log('[Background] 🤖 Handling Intent:', intent.type, 'State:', sessionState);

    // 1. GESTIONE STATI DI CONFERMA
    const msgs = CONFIRM_MSGS[voiceSettings.language] || CONFIRM_MSGS.it;
    if (sessionState === 'CONFIRM_NAV' || sessionState === 'CONFIRM_CHANGE') {
        if (intent.type === 'YES') {
            speak(sessionState === 'CONFIRM_NAV' ? msgs.yes : msgs.yes);
            if (pendingIntent) {
                 DeviceEventEmitter.emit('Voice_Intent', pendingIntent);
            }
            resetSession();
            return;
        } else if (intent.type === 'NO' || intent.type === 'CANCEL_NAVIGATION') {
            speak(msgs.cancelled);
            resetSession();
            return;
        } else {
            if (intent.type === 'NAVIGATE_TO') {
                // Nuova richiesta navigazione - sovrascrive la conferma in corso
            } else {
                speak(msgs.notUnderstood);
                return;
            }
        }
    }

    // 2. GESTIONE COMANDI STANDARD (IDLE o Sovrascrittura)
    const m = CONFIRM_MSGS[voiceSettings.language] || CONFIRM_MSGS.it;
    switch (intent.type) {
        case 'NAVIGATE_TO': {
            pendingIntent = intent;
            sessionState = 'CONFIRM_NAV';
            const store = NavigationStore.get();
            const msg = store.isNavigating
                ? m.changeRoute.replace('{dest}', intent.destination)
                : m.confirm.replace('{dest}', intent.destination);
            speak(msg);
            startSessionTimeout();
            break;
        }

        case 'CHANGE_ROUTE':
            if (intent.avoid) {
                speak(m.avoidHighways);
                pendingIntent = intent;
                sessionState = 'CONFIRM_CHANGE';
                startSessionTimeout();
            } else {
                speak(m.recalculate);
                pendingIntent = { type: 'RECALCULATE_ROUTE' };
                sessionState = 'CONFIRM_CHANGE';
                startSessionTimeout();
            }
            break;

        case 'GET_TIME': {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const minStr = minutes.toString().padStart(2, '0');
            const timeStr = m.timeSuffix
                ? `${m.timePrefix} ${hours} ${m.timeSuffix} ${minStr}`
                : `${m.timePrefix} ${hours}:${minStr}`;
            speak(timeStr);
            break;
        }

        case 'GET_REMAINING_INFO': {
            const store = NavigationStore.get();
            if (store.totalDist && store.remainingDist) {
                const km = (store.remainingDist / 1000).toFixed(1);
                speak(m.remaining.replace('{km}', km));
            } else {
                speak(m.noNav);
            }
            break;
        }
            
        default:
            // YES/NO in IDLE non hanno senso — li ignoriamo silenziosamente
            if (intent.type === 'YES' || intent.type === 'NO') break;
            // Altri comandi diretti (Call, etc) → Eseguiamo subito
            DeviceEventEmitter.emit('Voice_Intent', intent);
            break;
    }
};

const setupVosk = async () => {
    try {
        // Determina percorso modello in base alla lingua selezionata
        const modelPath = await VoskModelManager.getModelPath(voiceSettings.language);
        const targetLang = voiceSettings.language;

        if (!isVoskInitialized) {
            console.log(`[Background] 🎙️ Caricamento Modello Vosk (${targetLang})...`);
            try {
                await loadModel(modelPath ?? 'model');
                isVoskInitialized = true;
                currentLoadedLang = targetLang;
                console.log(`[Background] 🎙️ Modello (${targetLang}) Caricato!`);
            } catch (loadErr) {
                // Fallback al modello italiano se quello richiesto non è disponibile
                console.warn(`[Background] ⚠️ Modello ${targetLang} non disponibile, uso italiano.`);
                try {
                    await loadModel('model');
                    isVoskInitialized = true;
                    currentLoadedLang = 'it';
                } catch (fallbackErr) {
                    console.error('[Background] ❌ Errore LoadModel fallback:', fallbackErr);
                    return;
                }
            }

            onResult((res) => {
                if (isOtaActive) return;
                try {
                    const rawText = (typeof res === 'string' ? res : String(res)).toLowerCase();
                    if (!rawText) return;

                    // Scarta l'input se il TTS sta ancora parlando (anti-echo)
                    if (isTTSSpeaking) {
                        console.log('[Background] 🔇 Vosk input ignorato (TTS in riproduzione)');
                        return;
                    }

                    // Rimuove eco del TTS dal prefisso, tenendo solo la risposta dell'utente
                    // Es: "rotta verso roma confermi sì" → "sì"
                    const text = removeEchoPrefix(rawText);
                    if (!text) return; // Era solo eco, nessun input utente

                    const justWokeUp = checkWakeWord(text);
                    const isWithinWindow = (Date.now() - lastWakeWordTime) < WAKE_WORD_WINDOW;

                    // GESTIONE AI RESCUE (Priorità massima)
                    if (isEmergencyMode) {
                        const t = text.toLowerCase();
                        if (t.includes("sì") || t.includes("si") || t.includes("sto bene") || t.includes("tutto bene") || t.includes("ok") || t.includes("annulla")) {
                             console.log("[Background] 🚨 AiRescue Cancel Rilevato da Vosk!");
                             DeviceEventEmitter.emit('AiRescue_Emergency_Cancel');
                             isEmergencyMode = false;
                        }
                    }

                    // Se siamo in Sessione (attesa conferma), processiamo tutto
                    if (sessionState !== 'IDLE' || isWithinWindow || justWokeUp) {
                         let cleanText = text;
                         const match = text.match(WAKE_WORD_REGEX);
                         
                         if (match && match.index !== undefined) {
                            cleanText = text.substring(match.index + match[0].length).trim();
                         } else {
                            cleanText = text.trim();
                         }

                         // 🔍 LOG RAW: mostra ESATTAMENTE cosa ha trascritto Vosk
                         if (cleanText.length > 0) {
                             console.log(`[VOSK RAW] 🔍 Testo trascritto: "${cleanText}"`);
                         }

                         if (cleanText.length > 0) {
                             const skipCheck = (sessionState !== 'IDLE') || justWokeUp || isWithinWindow;
                             const intent = intentParser.parse(cleanText, { skipWakeWordCheck: skipCheck });
                             
                             console.log(`[VOSK RAW] 🤖 Intent rilevato: ${intent.type}`);
                             
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
                if (isOtaActive) return;
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
        // Abilita microfono auricolari Bluetooth se presenti
        CallModule.startBluetoothSco();

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
    await loadVoiceSettings();
    await setupVosk();

    // Ricarica le impostazioni vocali ogni volta che cambiano dalla UI
    DeviceEventEmitter.addListener('VoiceSettings_Updated', async () => {
        const prevLang = voiceSettings.language;
        await loadVoiceSettings();
        const newLang = voiceSettings.language;

        // Se la lingua è cambiata e il modello richiesto non è già caricato
        if (newLang !== prevLang && newLang !== currentLoadedLang) {
            const modelPath = await VoskModelManager.getModelPath(newLang);
            if (modelPath) {
                console.log(`[Background] 🔄 Cambio modello Vosk: ${currentLoadedLang} → ${newLang}`);
                try {
                    stopVosk();
                    await new Promise(r => setTimeout(r, 500));
                    await loadModel(modelPath);
                    currentLoadedLang = newLang;
                    startVosk();
                    console.log(`[Background] ✅ Modello ${newLang} caricato e Vosk riavviato.`);
                } catch (e) {
                    console.warn(`[Background] ⚠️ Hot-swap modello ${newLang} fallito, rimango su ${currentLoadedLang}.`);
                }
            } else {
                console.log(`[Background] ℹ️ Modello ${newLang} non ancora scaricato, rimango su ${currentLoadedLang}.`);
            }
        }
    });


    // Inizializza riskSongUri da firebase
    try {
        const currentUser = auth().currentUser;
        if (currentUser) {
            const doc = await firebaseFirestore.collection("users").doc(currentUser.uid).get();
            const uri = doc.data()?.settings?.riskSongUri;
            const startTime = doc.data()?.settings?.riskSongStartTime || 0;
            if (uri) {
                NavigationStore.set({ 
                    riskSongUri: uri,
                    riskSongStartTime: startTime 
                });
                console.log("[Background] 🎵 Risk Song URI caricata:", uri);
            }
        }
    } catch(e) {
        console.log("[Background] Errore fetch Risk Song URI:", e);
    }



    // Aggiungo listener per Demo Mode (test manuale del sorpasso)
    DeviceEventEmitter.addListener('TriggerDemoOvertake', async () => {
        const store = NavigationStore.get();
        const uri = store.riskSongUri;
        if (uri) {
            console.log("[Background] 🎮 Demo Overtake Triggered! Suono:", uri);
            try {
                const { sound } = await Audio.Sound.createAsync({ uri });
                const startPosMs = (store.riskSongStartTime || 0) * 1000;
                await sound.playFromPositionAsync(startPosMs);
                
                // Ferma esattamente dopo 20s
                setTimeout(async () => {
                    try {
                        await sound.stopAsync();
                        await sound.unloadAsync();
                    } catch(e) {}
                }, 20000);
            } catch(e) {
                console.error("Errore Demo Risk Song", e);
            }
        } else {
            console.log("[Background] Nessuna Risk Song impostata per la demo.");
        }
    });

    // Helper thread-safe per gestione Vosk durante l'OTA
    let isVoskRunning = true;
    let otaResumeTimer: any = null;

    const safeStopVosk = async () => {
        if (!isVoskRunning) return;
        try {
            console.log('[Background] 🛑 Sospensione sicura Vosk...');
            stopVosk();
        } catch (e) {
            console.warn('[Background] Warning stopVosk:', e);
        } finally {
            isVoskRunning = false;
        }
    };

    const safeStartVosk = async () => {
        if (isVoskRunning) {
            console.log('[Background] Vosk già attivo, skip restart');
            return;
        }
        try {
            console.log('[Background] ▶️ Riavvio sicuro Vosk post-OTA...');
            try { stopVosk(); } catch(e) {}
            await sleep(400);

            CallModule.startBluetoothSco();
            try {
                await startVosk();
            } catch (err: any) {
                console.warn('[Background] startVosk fallito, ripristino con setupVosk():', err?.message || err);
                await setupVosk();
            }
            isVoskRunning = true;
            console.log('[Background] ✅ Vosk riavviato con successo!');
        } catch (e: any) {
            console.warn('[Background] Warning startVosk:', e?.message || e);
        }
    };

    // Listener per lo stato OTA: disattiva Vosk ed evita invii BLE durante il flashing per prevenire crash nativi C++
    DeviceEventEmitter.addListener('OtaStateChanged', async (inProgress: boolean) => {
        if (isOtaActive === inProgress) return; // Deduplica notifiche duplicate
        isOtaActive = inProgress;
        console.log(`[Background] 🔄 OtaStateChanged: ${inProgress}`);

        if (otaResumeTimer) {
            clearTimeout(otaResumeTimer);
            otaResumeTimer = null;
        }

        if (inProgress) {
            await safeStopVosk();
        } else {
            // Quando l'OTA termina o fallisce, attendiamo 3 secondi prima di riavviare Vosk
            otaResumeTimer = setTimeout(async () => {
                await safeStartVosk();
            }, 3000);
        }
    });

    await new Promise<void>(async (resolve) => {
        while (BackgroundService.isRunning()) {
            try {
                if (isOtaActive) {
                    // Sospende il ciclo di navigazione durante l'OTA per non interferire con il flusso BLE
                    await sleep(1000);
                    continue;
                }
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

                            // --- STATISTICHE DEL VIAGGIO (Velocità) ---
                            const speedKmh = (position.coords.speed || 0) * 3.6;
                            
                            const currentStore = NavigationStore.get();
                            const stats = currentStore.rideStats;
                            if (stats && stats.currentRideId) {
                                NavigationStore.set({
                                    rideStats: {
                                        ...stats,
                                        maxSpeedKmh: Math.max(stats.maxSpeedKmh, speedKmh),
                                        speedsSum: stats.speedsSum + speedKmh,
                                        speedsCount: stats.speedsCount + 1,
                                    }
                                });
                            }
                            // -------------------------------
        
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
                    
                    // Protocollo: freccia|metri turno|m totali|m mancanti
                    // Modifica: Rimosso callStatus perché l'Arduino supporta max 4 campi. Se inviamo il 5° (callStatus), 
                    // la funzione safeParseLong di Arduino concatena i numeri sballando la distanza rimanente!
                    const packet = `${currentData.arrow}|${currentData.distance}|${total}|${remaining}`; 

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
        DeviceEventEmitter.removeAllListeners('TriggerDemoOvertake');
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

                // Listener per sospendere STT durante OTA (previene crash __next_prime overflow)
                DeviceEventEmitter.addListener('OtaStateChanged', (isOtaInProgress: boolean) => {
                     if (isOtaInProgress) {
                         console.log("[Background] 🛑 Sospensione temporanea Vosk per OTA in corso...");
                         stopVosk();
                     } else {
                         console.log("[Background] 🎙️ Ripresa Vosk (OTA terminato)");
                         startVosk().catch(e => console.error('[Background] Errore ripresa Vosk:', e));
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
            DeviceEventEmitter.removeAllListeners('OtaStateChanged');
        }
    },
    // Nuova funzione per AiRescue STT
    enableEmergencySTT: async () => {
        isEmergencyMode = true;
        // Se Vosk non è ancora inizializzato (es. navigazione spenta), lo avviamo forzatamente
        if (!isVoskInitialized) {
            await setupVosk();
        }
    },
    disableEmergencySTT: () => {
        isEmergencyMode = false;
    }
};
