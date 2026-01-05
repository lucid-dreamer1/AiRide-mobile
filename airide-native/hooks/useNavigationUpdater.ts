import { useEffect, useRef } from "react";
import { useHelmet } from "@/contexts/HelmetContext";


export interface NavInstruction {
  testo?: string;
  text?: string;
  freccia?: number;
  metri?: number;
  next?: NavInstruction;
}

export default function useNavigationUpdater(
  instruction: NavInstruction | null,
  setInstruction: (i: NavInstruction | null) => void
): void {

  const { sendToHelmet, connected } = useHelmet();

  // 👇 Gli hook devono sempre esistere, anche se non connesso
  const lastSent = useRef<number>(0);

  useEffect(() => {
    // Se non connesso → non fare nulla
    if (!connected) return;
    if (!instruction) return;

    const interval = setInterval(() => {
      const dist = instruction.metri ?? 0;
      const now = Date.now();

      // 🔥 throttle invio BLE
      if (now - lastSent.current >= 250) {
        lastSent.current = now;

        const packet = `${instruction.freccia}|${dist}`;

        sendToHelmet(packet).catch(() => {});
      }

      // 🔄 passaggio alla prossima istruzione
      if (dist <= 20 && instruction.next) {
        setInstruction(instruction.next);
        lastSent.current = 0;
      }
    }, 100);

    return () => clearInterval(interval);
  }, [instruction, connected]); // attenzione: aggiunto connected
}
