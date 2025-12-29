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
// 📌 START TRIP (Inizializza sessione backend)
// ======================================================
export async function startTrip(start: { lat: number; lon: number }, end: string) {
  const url = `${BASE_URL}/start_trip`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start: `${start.lat},${start.lon}`,
        end: end,
      }),
    });
    return await res.json();
  } catch (err) {
    console.log("startTrip failed:", err);
    throw err;
  }
}

// ======================================================
// 📌 INVIA POSIZIONE AL SERVER (POST — ritorna navigazione)
// ======================================================
export async function updatePosition(lat: number, lon: number) {
  const url = `${BASE_URL}/update_position`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon }),
    });
    return await res.json();
  } catch (err) {
    console.log("updatePosition failed:", err);
    return null;
  }
}


