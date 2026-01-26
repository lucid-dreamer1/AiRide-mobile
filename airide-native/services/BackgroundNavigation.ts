import BackgroundService from 'react-native-background-actions';
import Geolocation from 'react-native-geolocation-service';
import { bleService } from './BleSingleton';
import { DeviceEventEmitter } from 'react-native';
import { updatePosition } from './api'; 
import { NavigationStore } from './NavigationStore'; 

const sleep = (time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time));

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

const navigationTask = async (taskDataArguments: any) => {
    const { delay } = taskDataArguments;
    console.log('[Background] 🧠 BRAIN AVVIATO: Logic moved to BG Task');

    await new Promise<void>(async (resolve) => {
        while (BackgroundService.isRunning()) {
            try {
                // 1. CHIEDI IL GPS (Solo se NON in DEMO)
                const currentStore = NavigationStore.get();
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
                const packet = `${currentData.arrow}|${currentData.distance}|${currentData.callStatus}`;

                console.log(`[Background] 🟢 BRAIN LOOP | Packet: ${packet}`);

                // 4. INVIA AL CASCO
                if (bleService.getDevice()) {
                     await bleService.sendToHelmet(packet);
                }

            } catch (error) {
                console.log('[Background] ❌ Errore Ciclo Brain:', error);
            }

            await sleep(delay);
        }
    });
};

export const BackgroundNavigation = {
    start: async () => {
        console.log("[Manager] 🟢 start() richiamato. isRunning?", BackgroundService.isRunning());
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
