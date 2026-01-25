import BackgroundService from 'react-native-background-actions';
import Geolocation from 'react-native-geolocation-service';
import { bleService } from './BleSingleton';
import { DeviceEventEmitter, Platform } from 'react-native';

const sleep = (time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time));

const options = {
    taskName: 'AirRideNav',
    taskTitle: 'AirRide è attivo',
    taskDesc: 'Navigazione e controllo casco in corso',
    taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
    },
    color: '#ff00ff',
    linkingURI: 'airide://',
    parameters: {
        delay: 1000,
    },
};

// Stato condiviso
let currentState = {
    arrow: 0,
    distance: 0,
    callStatus: 0
};

// GPS Options Aggressive
const gpsOptions = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 10000,
    forceRequestLocation: true,
};

const navigationTask = async (taskDataArguments: any) => {
    const { delay } = taskDataArguments;

    await new Promise<void>(async (resolve) => {
        console.log('[Background] 🟢 Servizio AVVIATO');

        while (BackgroundService.isRunning()) {
            try {
                // Serializziamo la richiesta GPS per evitare "Location request timed out" (Code 3)
                // Se fallisce, usiamo lo stato corrente (last known)
                await new Promise<void>((resolveGPS, rejectGPS) => {
                     Geolocation.getCurrentPosition(
                        (position) => {
                            // Qui potremmo aggiornare la navigazione reale se avessimo logica native
                            resolveGPS();
                        },
                        (error) => {
                            console.log('[Background] ⚠️ GPS Fatica:', error.code, error.message);
                            // Risolviamo comunque per non bloccare il loop per sempre (anche se c'è timeout)
                            resolveGPS();
                        },
                        gpsOptions
                    );
                });

                // Costruiamo e inviamo il pacchetto
                const { arrow, distance, callStatus } = currentState;
                const packet = `${arrow}|${distance}|${callStatus}`;
                
                console.log(`[Background] 🟢 LOOP ALIVE | Data: ${packet}`);

                if (bleService.getDevice()) {
                     await bleService.sendToHelmet(packet);
                }

            } catch (error) {
                console.log('[Background] Errore ciclo:', error);
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
                // Ascolta DIRETTAMENTE gli eventi chiamata nel background service
                // Questo bypassa la UI di React che potrebbe essere freezata
                DeviceEventEmitter.addListener('CallStatusChanged', (event: any) => {
                     console.log("[Manager] 📞 BG Event received:", event);
                     if (event && typeof event.status === 'number') {
                         currentState.callStatus = event.status;
                     }
                });

                await BackgroundService.start(navigationTask, options);
                console.log("[Manager] ✅ Start comando inviato correttamente");
            } catch (e) {
                console.error("[Manager] ❌ Errore in Start:", e);
            }
        } else {
            console.log("[Manager] ⚠️ Il servizio risulta già attivo, skip start.");
        }
    },
    stop: async () => {
        if (BackgroundService.isRunning()) {
            await BackgroundService.stop();
            console.log("[Manager] Stop comando inviato");
            DeviceEventEmitter.removeAllListeners('CallStatusChanged');
        }
    },
    updateState: (arrow: number, distance: number, callStatus: number) => {
        // Aggiorna tutto tranne callStatus se viene da UI (perché callStatus lo gestiamo anche nativamente)
        // Ma per sicurezza teniamo sincronizzato tutto
        currentState = { arrow, distance, callStatus };
        // console.log(`[Manager] Stato aggiornato da UI: ${JSON.stringify(currentState)}`);
    }
};
