import EventSource from "react-native-sse";

// ======================================================
// 🌐 SERVER + FAILOVER
// ======================================================
// Primario: server personale (veloce, nessun cold start)
// Backup:   Render (può avere cold start fino a ~60s)
const PRIMARY_URL = "https://api.airideint.com";
const FALLBACK_URL = "https://airide-backend.onrender.com";

const PRIMARY_TIMEOUT_MS = 5000;     // se il primario non risponde entro 5s → backup
const FALLBACK_TIMEOUT_MS = 60000;   // Render può impiegare molto al cold start
const PRIMARY_COOLDOWN_MS = 60000;   // dopo un fallimento, salta il primario per 60s

let primaryDownUntil = 0;

// Status HTTP che indicano "server irraggiungibile" (proxy/Cloudflare/gateway)
function isServerDownStatus(status: number) {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Esegue la richiesta sul primario e, se è down (errore rete, timeout, 502/503/504/52x),
 * passa automaticamente al server Render. Ritorna anche quale server ha risposto.
 */
async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: { primaryTimeoutMs?: number; fallbackTimeoutMs?: number } = {}
): Promise<{ res: Response; base: string }> {
  const primaryTimeout = opts.primaryTimeoutMs ?? PRIMARY_TIMEOUT_MS;
  const fallbackTimeout = opts.fallbackTimeoutMs ?? FALLBACK_TIMEOUT_MS;

  if (Date.now() >= primaryDownUntil) {
    try {
      const res = await fetchWithTimeout(`${PRIMARY_URL}${path}`, init, primaryTimeout);
      if (!isServerDownStatus(res.status)) {
        if (primaryDownUntil !== 0) console.log("[API] ✅ Server primario di nuovo online");
        primaryDownUntil = 0;
        return { res, base: PRIMARY_URL };
      }
      console.warn(`[API] ⚠️ Primario ha risposto ${res.status} su ${path} → passo a Render`);
    } catch (err) {
      console.warn(`[API] ⚠️ Primario irraggiungibile su ${path} → passo a Render`, err);
    }
    primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
  }

  const res = await fetchWithTimeout(`${FALLBACK_URL}${path}`, init, fallbackTimeout);
  return { res, base: FALLBACK_URL };
}

/** Server attualmente preferito (utile per debug/UI). */
export function getActiveServer() {
  return Date.now() >= primaryDownUntil ? PRIMARY_URL : FALLBACK_URL;
}

// Ultimo viaggio avviato: serve a ricreare la sessione se si cambia server
// (le sessioni del backend sono in memoria e non condivise tra server).
let lastTrip: { body: string; base: string } | null = null;

// ======================================================
// 📌 PRENDI IL PERCORSO
// ======================================================
export async function getRoute(lat: number, lon: number, destination: string) {
  const path = `/route_info?start=${lat},${lon}&end=${encodeURIComponent(destination)}`;

  const { res } = await apiFetch(path);
  if (!res.ok) throw new Error("Errore server getRoute");

  return await res.json();
}


// ======================================================
// 📌 START TRIP (Inizializza sessione backend)
// ======================================================
export async function startTrip(start: { lat: number; lon: number }, end: string) {
  const body = JSON.stringify({
    start: `${start.lat},${start.lon}`,
    end: end,
  });

  try {
    const { res, base } = await apiFetch("/start_trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    if (res.ok) lastTrip = { body, base };
    return data;
  } catch (err) {
    console.log("startTrip failed:", err);
    throw err;
  }
}

// Ricrea la sessione di viaggio sul server indicato
async function replayTripOn(base: string) {
  if (!lastTrip) return false;
  try {
    console.log(`[API] 🔁 Ricreo la sessione di viaggio su ${base}`);
    const res = await fetchWithTimeout(
      `${base}/start_trip`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: lastTrip.body },
      base === PRIMARY_URL ? PRIMARY_TIMEOUT_MS * 2 : FALLBACK_TIMEOUT_MS
    );
    if (res.ok) {
      lastTrip = { ...lastTrip, base };
      return true;
    }
  } catch (err) {
    console.warn("[API] Replay sessione fallito:", err);
  }
  return false;
}

// ======================================================
// 📌 INVIA POSIZIONE AL SERVER (POST — ritorna navigazione)
// ======================================================
export async function updatePosition(lat: number, lon: number) {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon }),
  };

  try {
    const { res, base } = await apiFetch("/update_position", init);

    // Il server che ha risposto non ha la sessione del viaggio → ricreala e ripeti
    if (lastTrip && lastTrip.base !== base) {
      if (await replayTripOn(base)) {
        const retry = await fetchWithTimeout(
          `${base}/update_position`,
          init,
          base === PRIMARY_URL ? PRIMARY_TIMEOUT_MS : FALLBACK_TIMEOUT_MS
        );
        return await retry.json();
      }
    }

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
  try {
    // Timeout primario più largo: è una chiamata critica e non va duplicata inutilmente
    const { res } = await apiFetch(
      "/emergency_call",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, lat, lon, contact_phone: contactPhone }),
      },
      { primaryTimeoutMs: 10000, fallbackTimeoutMs: 90000 }
    );

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
    const path = `/search_nearby_poi?lat=${lat}&lon=${lon}&category=${encodeURIComponent(category)}`;
    const { res } = await apiFetch(path);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("[API] searchNearbyPoi backend fallback failed:", err);
  }

  return null;
}


