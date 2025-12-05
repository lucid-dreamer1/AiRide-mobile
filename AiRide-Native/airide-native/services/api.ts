import EventSource from "react-native-sse";

const BASE_URL = "https://unmouldering-eliana-unreclaimed.ngrok-free.dev";

// ======================================================
// 📌 PRENDI IL PERCORSO
// ======================================================
export async function getRoute(lat: number, lon: number, destination: string) {
  const url = `${BASE_URL}/route_info?start=${lat},${lon}&end=${encodeURIComponent(
    destination
  )}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Errore server getRoute");

  return await res.json();
}

// ======================================================
// 📌 INVIA POSIZIONE AL SERVER (POST — niente 405)
// ======================================================
export async function updatePosition(lat: number, lon: number) {
  const url = `${BASE_URL}/update_position`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon }),
    });
  } catch (err) {
    console.log("updatePosition failed:", err);
  }
}

// ======================================================
// 📌 STREAM ISTRUZIONI (SSE) — VERSIONE FIXATA
// ======================================================
export function openInstructionStream(
  start: string,
  end: string,
  onMessage: (data: any) => void,
  skipIfNoHelmet: boolean = false
) {
  if (skipIfNoHelmet) {
    console.log("🔵 DEMO MODE: stream disattivato (nessun casco richiesto)");
    return { close() {} };
  }

  const url = `${BASE_URL}/stream?start=${encodeURIComponent(
    start
  )}&end=${encodeURIComponent(end)}`;

  console.log("📡 SSE CONNECT:", url);

  const es = new EventSource(url);

  es.addEventListener("message", (event: any) => {
    try {
      const data = JSON.parse(event.data);

      if (data?.error === "getRoute") {
        console.log("❌ Stream chiuso: errore getRoute");
        es.close();
        return;
      }

      if (!data || typeof data !== "object") return;

      onMessage(data);
    } catch (e) {
      console.log("SSE parse error:", e);
    }
  });

  es.addEventListener("error", (err: any) => {
    console.log("SSE error → stream chiuso");
    es.close();
  });

  return es;
}

