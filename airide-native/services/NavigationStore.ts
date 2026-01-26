// Questo file vive fuori da React e gestisce lo stato condiviso
// tra il Background Service (JS Thread) e la UI (React Thread).

export type NavState = {
    arrow: number;
    distance: number;
    callStatus: number;
    text: string;           // Istruzione principale
    nextText?: string;      // Prossima istruzione (opzionale)
    nextArrow?: number;     // Prossima freccia (opzionale)
    totalDist?: number;     // Distanza totale
    remainingDist?: number; // Distanza rimanente
    isNavigating: boolean;  // Se la navigazione è attiva
    isDemo?: boolean;       // Se siamo in modalità demo
};

// Stato iniziale
let currentData: NavState = {
    arrow: 0,
    distance: 0,
    callStatus: 0,
    text: "Pronto",
    isNavigating: false,
};

type Listener = (data: NavState) => void;
let listeners: Listener[] = [];

export const NavigationStore = {
    // Aggiorna lo stato (parziale)
    set: (newData: Partial<NavState>) => {
        currentData = { ...currentData, ...newData };
        NavigationStore.notifyUI();
    },

    // Leggi lo stato corrente
    get: () => currentData,

    // Iscriviti agli aggiornamenti (usato dalla UI)
    subscribe: (cb: Listener) => {
        listeners.push(cb);
        // Ritorni funzione di cleanup
        return () => {
            listeners = listeners.filter((l) => l !== cb);
        };
    },

    // Notifica tutti i listener (metodo interno o pubblico)
    notifyUI: () => {
        listeners.forEach((cb) => cb(currentData));
    },
    
    // Reset stato
    reset: () => {
        currentData = {
            arrow: 0,
            distance: 0,
            callStatus: 0,
            text: "Pronto",
            isNavigating: false,
        };
        NavigationStore.notifyUI();
    }
};
