import { useEffect, useRef, useState } from 'react';
import { Accelerometer, Gyroscope } from 'expo-sensors';

// ==========================================
// CONFIGURAZIONE SOGLIE E PARAMETRI (Tuning)
// ==========================================
export const OVERTAKE_CONFIG = {
  // --- Filtro Passa-Basso (Alpha) ---
  // Valore tra 0 (massimo smoothing/latenza) e 1 (dati grezzi/rumore completo).
  // Un buon compromesso per moto a 20-50Hz di solito sta tra 0.1 e 0.2
  ALPHA: 0.15,

  // --- Frequenza Sensori ---
  // In millisecondi. 50ms = 20Hz (sufficientemente reattivo, non intasa la CPU)
  SENSOR_UPDATE_INTERVAL_MS: 50,

  // --- Soglie Giroscopio (rad/s) ---
  // Scarto iniziale per uscire dalla scia (Stato 1)
  THRESHOLD_GYRO_OUT: 0.6,
  
  // Rientro dopo il sorpasso, con segno opposto. (Stato 3)
  THRESHOLD_GYRO_IN: 0.5,

  // --- Soglia Accelerometro (G) ---
  // Accelerazione longitudinale (Asse Y per specifica, ma spesso è Z se a schermo in su)
  // Nota: expo-sensors usa unità Gravitazionali (1 G = ~9.81 m/s²). 
  // Es: 0.15G = ~1.47 m/s²
  THRESHOLD_ACCEL: 0.15,

  // --- Timer di Finestra (ms) ---
  // Finestra temporale massima per completare tutta la manovra (Stati 1->2->3)
  TIME_WINDOW_MS: 5000, // 5 secondi

  // --- Guardrail di Sicurezza ---
  // Velocità GPS minima (km/h) per attivare la macchina a stati
  MIN_SPEED_KMH: 30,

  // --- Cooldown (ms) ---
  // Tempo minimo tra un sorpasso e l'altro (es. 20 secondi = 20000ms)
  COOLDOWN_MS: 20000,
};

type OvertakeState = 0 | 1 | 2; // lo Stato 3 equivale al completamento + Reset a 0

interface OvertakeDetectionProps {
  currentSpeedKmh: number;
  onOvertakeDetected: () => void;
}

/**
 * Hook Custom per il rilevamento dinamico dei sorpassi in moto usando Sensor Fusion.
 */
export function useOvertakeDetection({
  currentSpeedKmh,
  onOvertakeDetected,
}: OvertakeDetectionProps) {
  // Usiamo useRef per leggere velocità e callback nei listener senza ri-sottoscrivere i sensori
  const speedRef = useRef(currentSpeedKmh);
  const onDetectedRef = useRef(onOvertakeDetected);

  useEffect(() => {
    speedRef.current = currentSpeedKmh;
  }, [currentSpeedKmh]);

  useEffect(() => {
    onDetectedRef.current = onOvertakeDetected;
  }, [onOvertakeDetected]);

  // Stato corrente della macchina a stati:
  // 0: Idle / Cruising
  // 1: Inizio Scarto (Gyro Y/Z)
  // 2: Apertura Gas (Accel Y)
  const stepRef = useRef<OvertakeState>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Memorizza la direzione dello scarto (+ o -) per confermare che il rientro sia nel verso opposto
  const initialSwerveSignRef = useRef<number>(1);
  const lastOvertakeTimeRef = useRef<number>(0);

  // Variabili storiche per il Filtro Passa-Basso
  const filteredAccelYRef = useRef<number>(0);
  const filteredGyroZRef = useRef<number>(0);
  const filteredGyroYRef = useRef<number>(0);

  // ==========================================
  // MATEMATICA DEL FILTRO PASSA-BASSO
  // ==========================================
  // Il filtro passa-basso serve a rimuovere i rumori ad alta frequenza,
  // come le vibrazioni del motore, le asperità dell'asfalto e i micromovimenti naturali.
  // 
  // Si usa la formula della media mobile esponenziale (Exponential Moving Average):
  // ValoreFiltrato[i] = α * ValoreGrezzo[i] + (1 - α) * ValoreFiltrato[i-1]
  // 
  // - α (Alpha) è il fattore di smoothing (0 < α ≤ 1).
  // - Più α si avvicina a 0, più il filtro "pesa" i dati storici, annullando 
  //   i picchi improvvisi (vibrazioni) ma al costo di una leggera latenza.
  // ==========================================

  // Funzione di utility per resettare la Window in caso di infrazione del timer o fallimento manovra
  const resetStateMachine = () => {
    stepRef.current = 0;
    initialSwerveSignRef.current = 1; // dummy reset
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    // Configura i ms per aggiornamento (es. 20Hz)
    Accelerometer.setUpdateInterval(OVERTAKE_CONFIG.SENSOR_UPDATE_INTERVAL_MS);
    Gyroscope.setUpdateInterval(OVERTAKE_CONFIG.SENSOR_UPDATE_INTERVAL_MS);

    // ============================
    // LISTENER 1: ACCELEROMETRO
    // ============================
    const accelSubscription = Accelerometer.addListener((data) => {
      // 1. Applica filtro passa basso su asse Y
      const alpha = OVERTAKE_CONFIG.ALPHA;
      filteredAccelYRef.current = alpha * data.y + (1 - alpha) * filteredAccelYRef.current;

      // Se fermi o lenti, ignora
      if (speedRef.current <= OVERTAKE_CONFIG.MIN_SPEED_KMH) return;

      // Valutazione Stato: passiamo da Stato 1 -> Stato 2
      if (stepRef.current === 1) {
        // Rileviamo il picco accelerativo nella finestra di manovra
        if (Math.abs(filteredAccelYRef.current) > OVERTAKE_CONFIG.THRESHOLD_ACCEL) {
          console.log("[OvertakeDetection] 🚀 STATO 2: Gas aperto! (Accel detect)");
          stepRef.current = 2; // Gas rilevato!
        }
      }
    });

    // ============================
    // LISTENER 2: GIROSCOPIO
    // ============================
    const gyroSubscription = Gyroscope.addListener((data) => {
      const alpha = OVERTAKE_CONFIG.ALPHA;
      // Applica filtro passa basso per rollio(Y) e imbardata(Z)
      filteredGyroYRef.current = alpha * data.y + (1 - alpha) * filteredGyroYRef.current;
      filteredGyroZRef.current = alpha * data.z + (1 - alpha) * filteredGyroZRef.current;

      // Guardrail GPS: la macchina a stati si azzera dinamicamente a basse velocità
      if (speedRef.current <= OVERTAKE_CONFIG.MIN_SPEED_KMH) {
        if (stepRef.current !== 0) resetStateMachine();
        return;
      }

      // Prendo il valore dominante tra Rollio e Imbardata per unificare l'algoritmo
      // (a seconda dell'inclinazione su in moto, potrebbe variare l'asse stimolato)
      const absZ = Math.abs(filteredGyroZRef.current);
      const absY = Math.abs(filteredGyroYRef.current);
      
      const primaryValue = absZ > absY ? filteredGyroZRef.current : filteredGyroYRef.current;
      const primaryAbsValue = Math.abs(primaryValue);
      const primarySign = Math.sign(primaryValue);

      // Esecuzione State Machine
      switch (stepRef.current) {
        case 0: // Idle -> Attesa dello Scarto Iniziale
          if (primaryAbsValue > OVERTAKE_CONFIG.THRESHOLD_GYRO_OUT) {
            console.log(`[OvertakeDetection] 🏍️ STATO 1: Inizio scarto (${primarySign > 0 ? 'SX' : 'DX'})`);
            stepRef.current = 1;                    // Passa a Stato 1
            initialSwerveSignRef.current = primarySign; // Salva la direzione di scarto

            // Start Window Timer
            timerRef.current = setTimeout(() => {
              console.log("[OvertakeDetection] ⏱️ Timeout 5s scaduto: Manovra annullata.");
              resetStateMachine(); // Scaduto il tempo, consideriamo manovra annullata
            }, OVERTAKE_CONFIG.TIME_WINDOW_MS);
          }
          break;

        case 1:
          // Siamo in attesa dell'Accelerometro. Lasciamo fare al Listener Accelerometro.
          break;

        case 2: // Accelerazione avvenuta -> Attesa di Rientro
          // Condizioni del rientro: 
          // 1. Oltrepassata la soglia rientro (THRESHOLD_GYRO_IN)
          // 2. Direzione OPPOSTA a quella di scarto in modo da non triggerare in curva infinita
          if (
            primarySign !== 0 &&
            primarySign !== initialSwerveSignRef.current && 
            primaryAbsValue > OVERTAKE_CONFIG.THRESHOLD_GYRO_IN
          ) {
            // ==== STATO 3 Raggiunto: SORPASSO CONVALIDATO ====
            const now = Date.now();
            if (now - lastOvertakeTimeRef.current >= OVERTAKE_CONFIG.COOLDOWN_MS) {
              console.log("[OvertakeDetection] ✅ STATO 3: Rientro completato! Sorpasso convalidato!");
              lastOvertakeTimeRef.current = now;
              onDetectedRef.current();        // Triggera il Sound / Evento
            } else {
              console.log("[OvertakeDetection] ⏳ STATO 3: Rientro completato, ma sorpasso in COOLDOWN (Ignorato).");
            }
            resetStateMachine();            // Resetta per il prossimo
          }
          break;
      }
    });

    // ============================
    // CLEANUP MEMORY (Unmount)
    // ============================
    return () => {
      accelSubscription.remove();
      gyroSubscription.remove();
      resetStateMachine();
    };
  }, []); // Dipendenza [] per avere un listener stabile (leggiamo tramite ref)
}
