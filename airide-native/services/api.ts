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

// ======================================================
// ======================================================
// 📌 RICERCA POI MOTO (Benzinai, Cibo, Officine) — TomTom Search API
// ======================================================
const TOMTOM_API_KEY = process.env.EXPO_PUBLIC_TOMTOM_API_KEY || "";

export interface NearbyPoiItem {
  name: string;
  address: string;
  distance_meters: number;
  distance_str: string;
  lat: number;
  lon: number;
  destination: string;
}

export interface NearbyPoiResult {
  status: 'ok' | 'not_found' | 'error';
  items?: NearbyPoiItem[];
  name?: string;
  address?: string;
  distance_meters?: number;
  distance_str?: string;
  lat?: number;
  lon?: number;
  destination?: string;
  prompt_text?: string;
  message?: string;
}

export async function searchNearbyPoi(
  lat: number,
  lon: number,
  category: 'gas_station' | 'restaurant' | 'mechanic' | string,
  radius: number = 15000
): Promise<NearbyPoiResult | null> {
  const cat = category.toLowerCase().trim();

  // 1. Chiamata DIRETTA a TomTom API (latenza ~100ms, zero dipendenza da Render)
  try {
    let url = '';
    if (cat === 'gas_station' || cat === 'petrol' || cat === 'benzinaio' || cat === 'distributore') {
      url = `https://api.tomtom.com/search/2/nearbySearch/.json?key=${TOMTOM_API_KEY}&lat=${lat}&lon=${lon}&radius=${radius}&categorySet=7311&limit=5`;
    } else if (cat === 'restaurant' || cat === 'food' || cat === 'ristorante' || cat === 'bar' || cat === 'pizzeria') {
      url = `https://api.tomtom.com/search/2/nearbySearch/.json?key=${TOMTOM_API_KEY}&lat=${lat}&lon=${lon}&radius=${radius}&categorySet=7315&limit=5`;
    } else if (cat === 'mechanic' || cat === 'officina' || cat === 'gommista') {
      url = `https://api.tomtom.com/search/2/poiSearch/officina%20moto.json?key=${TOMTOM_API_KEY}&lat=${lat}&lon=${lon}&radius=${radius}&limit=5`;
    } else {
      url = `https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(category)}.json?key=${TOMTOM_API_KEY}&lat=${lat}&lon=${lon}&radius=${radius}&limit=5`;
    }

    console.log(`[API] 🔍 Ricerca TomTom diretta per: ${category} @ ${lat},${lon}`);
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];
      if (results.length > 0) {
        results.sort((a: any, b: any) => (a.dist || 0) - (b.dist || 0));

        const items: NearbyPoiItem[] = results.slice(0, 5).map((r: any) => {
          const poiName = r.poi?.name || 'Punto di interesse';
          const address = r.address?.freeformAddress || '';
          const pos = r.position || {};
          const distMeters = Math.round(r.dist || 0);
          const distStr = distMeters >= 1000
            ? `${(distMeters / 1000).toFixed(1).replace('.', ',')} chilometri`
            : `${Math.round(distMeters / 50) * 50 || 50} metri`;

          return {
            name: poiName,
            address,
            distance_meters: distMeters,
            distance_str: distStr,
            lat: pos.lat,
            lon: pos.lon,
            destination: `${pos.lat},${pos.lon}`,
          };
        });

        const best = items[0];
        return {
          status: 'ok',
          items,
          name: best.name,
          address: best.address,
          distance_meters: best.distance_meters,
          distance_str: best.distance_str,
          lat: best.lat,
          lon: best.lon,
          destination: best.destination,
          prompt_text: `Trovato ${best.name} a ${best.distance_str}. Vuoi andare qui?`,
        };
      } else {
        console.log('[API] Nessun POI trovato su TomTom entro il raggio indicato');
        return { status: 'not_found' };
      }
    } else {
      console.warn(`[API] TomTom Search HTTP status: ${res.status}`);
    }
  } catch (tomtomErr) {
    console.warn('[API] Chiamata diretta TomTom fallita, tento fallback backend:', tomtomErr);
  }

  // 2. Fallback su Backend se la chiamata diretta non è andata a buon fine
  try {
    const backendUrl = `${BASE_URL}/search_nearby_poi?lat=${lat}&lon=${lon}&category=${encodeURIComponent(category)}`;
    const res = await fetch(backendUrl);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("[API] searchNearbyPoi backend fallback failed:", err);
  }

  return null;
}


