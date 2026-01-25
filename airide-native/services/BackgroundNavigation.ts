import BackgroundService from 'react-native-background-actions';
import Geolocation from 'react-native-geolocation-service';
import { bleService } from './BleSingleton';

const sleep = (time: number) => new Promise((resolve) => setTimeout(() => resolve(true), time));

// Configurazione della notifica che DEVE apparire
const options = {
    taskName: 'AirRideNav',
    taskTitle: 'AirRide è attivo',
    taskDesc: 'Navigazione in background...',
    taskIcon: {
        name: 'ic_launcher',
        type: 'mipmap',
    },
    color: '#ff00ff',
    linkingURI: 'airide://',
    parameters: {
        delay: 1000, // Aggiorna ogni secondo
    },
};

const navigationTask = async (taskDataArguments: any) => {
    const { delay } = taskDataArguments;

    await new Promise<void>(async (resolve) => {
        console.log('[Background] 🟢 Servizio AVVIATO');

        // Loop infinito che sopravvive al blocco schermo
        while (BackgroundService.isRunning()) {
            try {
                // Opzione A: Usa GPS Reale
                Geolocation.getCurrentPosition(
                    async (position) => {
                        // console.log('[Background] 📍 Posizione:', position.coords.latitude, position.coords.longitude);
                        // Qui in futuro potresti calcolare la distanza reale o prendere dati dalla navigazione se condivisi
                        
                        // Per ora mandiamo un pacchetto "vivo" con timestamp variabile per dimostrare che non è fisso
                        const time = Math.floor(Date.now() / 1000) % 10000;
                        const lat = position.coords.latitude.toFixed(5);
                        const lon = position.coords.longitude.toFixed(5);
                        
                        // Esempio pacchetto: freccia(0)|dist(0)|lat|lon
                        // Nota: Questo è solo un esempio. L'ideale è condividere lo stato della navigazione (es. via AsyncStorage o SQLite)
                        const realData = `0|0|${lat}|${lon}`;
                        
                        console.log(`[Background] 📡 GPS Reale: ${realData}`);

                        if (bleService.getDevice()) {
                             await bleService.sendToHelmet(realData);
                        }
                    },
                    (error) => console.log('[Background] ❌ Errore GPS', error),
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 }
                );

                /*
                // Opzione B: Simula invio dati (MOCK)
                const mockData = `0|64|600|600`; 
                console.log(`[Background] 🚀 Invio dati a schermo spento: ${mockData}`);
                if (bleService.getDevice()) await bleService.sendToHelmet(mockData);
                */

            } catch (error) {
                console.log('[Background] Errore ciclo:', error);
            }

            // Attesa fondamentale per non bloccare la CPU
            await sleep(delay);
        }
    });
};

export const BackgroundNavigation = {
    start: async () => {
        console.log("[Manager] 🟢 start() richiamato. isRunning?", BackgroundService.isRunning());
        if (!BackgroundService.isRunning()) {
            try {
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
        }
    }
};
