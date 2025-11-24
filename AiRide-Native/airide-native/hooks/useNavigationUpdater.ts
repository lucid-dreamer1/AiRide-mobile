import { useEffect, useRef } from "react";
import { useHelmet } from "@/contexts/HelmetContext";

// Tipo locale
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
  const { sendToHelmet } = useHelmet();

  // 👇 evita spam BLE (HM-10 si blocca se arrivano troppi pacchetti)
  const lastSent = useRef<number>(0);

  useEffect(() => {
    if (!instruction) return;

    const interval = setInterval(() => {
      const dist = instruction.metri ?? 0;
      const now = Date.now();

      // -------------------------------------
      // 📤 INVIO BLE OGNI 250ms (THROTTLE)
      // -------------------------------------
      if (now - lastSent.current >= 250) {
        lastSent.current = now;

        // HM-10: max 20 bytes -> testo corto
        const shortText = (instruction.testo || instruction.text || "").slice(0, 10);

        // Pacchetto SICURO
        const packet = `${instruction.freccia}|${dist}|${shortText}`;

        sendToHelmet(packet).catch(() => {});
      }

      // -------------------------------------
      // 🔄 PASSAGGIO AUTOMATICO ALLA NEXT
      // -------------------------------------
      if (dist <= 20 && instruction.next) {
        setInstruction(instruction.next);

        // reset throttle → nuovo pacchetto inviato SUBITO
        lastSent.current = 0;
      }
    }, 100); // controllo molto rapido → UI fluida

    return () => clearInterval(interval);
  }, [instruction]);
}
