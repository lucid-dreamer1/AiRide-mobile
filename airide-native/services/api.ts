import EventSource from "react-native-sse";

const BASE_URL = "https://airide-backend.onrender.com";

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

// ======================================================
// 📌 EMERGENZA (AiRescue)
// ======================================================
export async function sendEmergencyCall(userId: string, lat: number, lon: number, contactPhone: string) {
  const url = `${BASE_URL}/emergency_call`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, lat, lon, contact_phone: contactPhone }),
    });

    if (!res.ok) {
      console.log(`sendEmergencyCall failed with status ${res.status}`);
      // Ritorna l'errore o il testo raw per debug
      const text = await res.text();
      throw new Error(`Server returned ${res.status}: ${text}`);
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status: "error", message: text };
    }
  } catch (err) {
    console.log("sendEmergencyCall failed:", err);
    throw err;
  }
}

