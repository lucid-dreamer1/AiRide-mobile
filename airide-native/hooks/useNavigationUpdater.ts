import { useEffect, useRef } from "react";
import { useHelmet } from "@/contexts/HelmetContext";
import { BackgroundNavigation } from "@/services/BackgroundNavigation";


export interface NavInstruction {
  testo?: string;
  text?: string;
  freccia?: number;
  metri?: number;
  remaining_dist?: number; // metri rimanenti
  total_dist?: number;     // metri totali del percorso
  next?: NavInstruction;
}



export default function useNavigationUpdater(
  instruction: NavInstruction | null,
  setInstruction: (i: NavInstruction | null) => void,
  callStatus: number 
): void {

  const { sendToHelmet, connected } = useHelmet();
  const lastSent = useRef<number>(0);

  // Sync stato background ogni volta che cambiano i dati
  // Sync stato background ogni volta che cambiano i dati
  useEffect(() => {
     console.log("🪝 [useNavUpdater] Instruction Update:", instruction);
     const arrow = instruction?.freccia ?? 0;
     const dist = instruction?.metri ?? 0;
     console.log(`🪝 [useNavUpdater] Updating BG State -> Arrow: ${arrow}, Dist: ${dist}, Call: ${callStatus}`);
     BackgroundNavigation.updateState(arrow, dist, callStatus);
  }, [instruction, callStatus]);

  useEffect(() => {
    if (!connected) return;
    if (!instruction) return;

    const interval = setInterval(() => {
      const dist = instruction.metri ?? 0;
      const now = Date.now();

      // 🔥 throttle invio BLE FOREGROUND
      if (now - lastSent.current >= 250) {
        lastSent.current = now;
        
        const packet = `${instruction.freccia}|${dist}|${callStatus}`;

        sendToHelmet(packet).catch(() => {});
      }

      // 🔄 passaggio alla prossima istruzione
      if (dist <= 20 && instruction.next) {
        setInstruction(instruction.next);
        lastSent.current = 0;
      }
    }, 100);

    return () => clearInterval(interval);
  }, [instruction, connected, callStatus]);
}


