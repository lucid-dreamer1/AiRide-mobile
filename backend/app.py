###############################################################
# APP DI NAVIGAZIONE — AirRide (pulita)
# Flask + TomTom API
# Meccanismo consigliato: /start_trip + /update_position (poll)
# NO SSE necessario
###############################################################

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests, json, math, time, traceback

###############################################################
# FLASK APP
###############################################################

app = Flask(__name__)
CORS(app)

# Memoria temporanea (demo)
active_sessions = {}
current_positions = {}

DEMO_USER_ID = "demo"

# TomTom API
API_KEY = "XeNHiK6pLDHE2MYxOyW5bOmv01ZN73oy"

###############################################################
# UTILITY
###############################################################

def distanza_m(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def translate_instruction_to_italian(txt: str) -> str:
    if not txt:
        return ""

    t = txt.lower()
    replacements = {
        "turn right": "Svolta a destra",
        "turn left": "Svolta a sinistra",
        "keep right": "Mantieni la destra",
        "keep left": "Mantieni la sinistra",
        "go straight": "Prosegui dritto",
        "continue straight": "Continua dritto",
        "u-turn": "Fai inversione",
        "at the roundabout": "Alla rotonda",
        "take the": "Prendi la",
        "exit": "uscita",
    }

    translated = txt
    for eng, ita in replacements.items():
        if eng in t:
            translated = translated.replace(eng, ita)
    return translated


def geocode_address(address: str):
    try:
        url = f"https://api.tomtom.com/search/2/geocode/{requests.utils.quote(address)}.json"
        params = {"key": API_KEY, "limit": 1}
        r = requests.get(url, params=params, timeout=10)
        data = r.json()

        if data.get("results"):
            pos = data["results"][0]["position"]
            return f"{pos['lat']},{pos['lon']}"
    except:
        pass
    return None


def ensure_coordinates(value: str):
    # se è già lat,lon torna così, altrimenti geocode
    try:
        lat, lon = map(float, value.split(","))
        return value
    except:
        return geocode_address(value)


def get_route_from_tomtom(start: str, end: str):
    try:
        slat, slon = map(float, start.split(","))
        elat, elon = map(float, end.split(","))

        url = f"https://api.tomtom.com/routing/1/calculateRoute/{slat},{slon}:{elat},{elon}/json"
        params = {
            "key": API_KEY,
            "instructionsType": "text",
            "routeType": "fastest",
            "traffic": "false",
            "language": "it-IT",
        }

        r = requests.get(url, params=params, timeout=10)
        if r.status_code != 200:
            print("Errore TomTom:", r.text)
            return None

        return r.json()
    except Exception as e:
        print("Errore get_route_from_tomtom:", e)
        return None


def extract_instructions(resp_json):
    results = []
    if not resp_json:
        return results

    try:
        route = resp_json.get("routes", [{}])[0]
        legs = route.get("legs", [])

        for leg in legs:
            guidance = leg.get("guidance", {}) or route.get("guidance", {})

            for instr in guidance.get("instructions", []):
                msg = instr.get("message", "")
                lat = instr.get("point", {}).get("latitude")
                lon = instr.get("point", {}).get("longitude")

                results.append({
                    "text": msg,
                    "text_it": translate_instruction_to_italian(msg),
                    "lat": lat,
                    "lon": lon,
                })
    except Exception as e:
        print("Errore extract_instructions:", e)

    return results


def manovra_to_freccia(text):
    t = (text or "").lower()
    if "right" in t or "destra" in t:
        return 0
    if "left" in t or "sinistra" in t:
        return 1
    if "u-turn" in t or "inversione" in t:
        return 3
    return 2


###############################################################
# FUORI ROTTA
###############################################################

def distanza_punto_segmento(p, a, b):
    px, py = p
    ax, ay = a
    bx, by = b

    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay

    ab_len2 = abx * abx + aby * aby
    if ab_len2 == 0:
        return math.dist(p, a)

    t = max(0, min(1, (apx * abx + apy * aby) / ab_len2))
    closest = (ax + t * abx, ay + t * aby)
    return math.dist(p, closest)


def fuori_rotta(user_lat, user_lon, polyline, soglia=30):
    """
    polyline: lista di dict {"lat":..., "lon":...}
    soglia in "gradi" non è perfetta, ma per demo va bene.
    Se vuoi precisione vera: convertire in metri con Haversine su segmenti.
    """
    p = (user_lat, user_lon)
    for i in range(len(polyline) - 1):
        a = polyline[i]
        b = polyline[i + 1]
        d = distanza_punto_segmento(
            p,
            (a["lat"], a["lon"]),
            (b["lat"], b["lon"])
        )
        if d <= soglia:
            return False
    return True


###############################################################
# NAV PAYLOAD (istruzione corrente)
###############################################################

def compute_navigation_payload(user_id: str):
    pos = current_positions.get(user_id)
    session = active_sessions.get(user_id)
    if not pos or not session:
        return None

    instructions = session.get("instructions") or []
    end_coords = session.get("end_coords")
    idx = int(session.get("idx", 0))

    if not instructions:
        return None

    # ricalcolo se fuori rotta
    if session.get("recalc_needed") and end_coords:
        new_start = f"{pos['lat']},{pos['lon']}"
        route2 = get_route_from_tomtom(new_start, end_coords)
        if route2:
            new_instr = extract_instructions(route2)
            session["instructions"] = new_instr
            session["idx"] = 0
            session["recalc_needed"] = False
            idx = 0
            instructions = new_instr

            # aggiorna polyline
            new_poly = []
            for leg in route2["routes"][0].get("legs", []):
                for p in leg.get("points", []):
                    new_poly.append({"lat": p["latitude"], "lon": p["longitude"]})
            session["polyline"] = new_poly

    # finito
    if idx >= len(instructions):
        return {"testo": "Percorso completato 🎉", "fase": "complete", "metri": 0, "freccia": 2, "next": None}

    instr = instructions[idx]
    d = distanza_m(pos["lat"], pos["lon"], instr["lat"], instr["lon"])

    if d > 120:
        fase = "preview"
    elif d > 70:
        fase = "prepare"
    elif d > 25:
        fase = "near"
    else:
        fase = "turn"

    next_instr = instructions[idx + 1] if (idx + 1 < len(instructions)) else None

    payload = {
        "testo": instr["text_it"],
        "metri": int(d),
        "freccia": manovra_to_freccia(instr["text_it"]),
        "fase": fase,
        "next": {
            "testo": next_instr["text_it"],
            "freccia": manovra_to_freccia(next_instr["text_it"]),
        } if next_instr else None
    }

    if d < 20:
        session["idx"] = idx + 1

    return payload


###############################################################
# ROUTE INFO (per disegnare polyline in app)
###############################################################

@app.route("/route_info")
def route_info():
    try:
        start = request.args.get("start")
        end = request.args.get("end")

        if not start or not end:
            return jsonify({"error": "Start o end mancanti"}), 400

        start_coords = ensure_coordinates(start)
        end_coords = ensure_coordinates(end)

        if not start_coords or not end_coords:
            return jsonify({"error": "Geocoding fallito"}), 400

        route_data = get_route_from_tomtom(start_coords, end_coords)
        if not route_data:
            return jsonify({"error": "Nessuna rotta trovata"}), 400

        route = route_data["routes"][0]
        summary = route.get("summary", {})
        duration_sec = summary.get("travelTimeInSeconds", 0)
        distance_meters = summary.get("lengthInMeters", 0)

        points = []
        for leg in route.get("legs", []):
            for point in leg.get("points", []):
                plat = point.get("latitude")
                plon = point.get("longitude")
                if plat is not None and plon is not None:
                    points.append({"lat": plat, "lon": plon})

        return jsonify({
            "duration": f"{round(duration_sec / 60)} min",
            "distance": f"{round(distance_meters / 1000, 1)} km",
            "coordinates": points
        })

    except Exception as e:
        print("Errore /route_info:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


###############################################################
# START TRIP (crea sessione e pre-calcola istruzioni + polyline)
###############################################################

@app.route("/start_trip", methods=["POST"])
def start_trip():
    try:
        data = request.get_json(force=True) or {}
        start = data.get("start")
        end = data.get("end")

        if not start or not end:
            return jsonify({"error": "start/end mancanti"}), 400

        user_id = DEMO_USER_ID

        start_coords = ensure_coordinates(start)
        end_coords = ensure_coordinates(end)
        if not start_coords or not end_coords:
            return jsonify({"error": "Geocoding fallito"}), 400

        route_data = get_route_from_tomtom(start_coords, end_coords)
        if not route_data:
            return jsonify({"error": "Errore routing"}), 400

        instructions = extract_instructions(route_data)

        polyline = []
        for leg in route_data["routes"][0].get("legs", []):
            for p in leg.get("points", []):
                polyline.append({"lat": p["latitude"], "lon": p["longitude"]})

        active_sessions[user_id] = {
            "end_coords": end_coords,
            "instructions": instructions,
            "polyline": polyline,
            "idx": 0,
            "recalc_needed": False,
            "started_at": time.time(),
        }

        return jsonify({"status": "ok", "instructions": len(instructions)})

    except Exception as e:
        print("Errore /start_trip:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


###############################################################
# GPS UPDATE (ritorna anche nav pronto)
###############################################################

@app.route("/update_position", methods=["POST"])
def update_position():
    try:
        data = request.get_json(force=True) or {}
        if "lat" not in data or "lon" not in data:
            return jsonify({"error": "Lat e Lon mancanti"}), 400

        user_id = DEMO_USER_ID
        lat = float(data["lat"])
        lon = float(data["lon"])

        current_positions[user_id] = {"lat": lat, "lon": lon, "time": time.time()}

        session = active_sessions.get(user_id)

        # check fuori rotta
        if session and session.get("polyline"):
            if fuori_rotta(lat, lon, session["polyline"]):
                session["recalc_needed"] = True

        nav = compute_navigation_payload(user_id)

        return jsonify({"status": "position_updated", "nav": nav})

    except Exception as e:
        print("Errore /update_position:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


###############################################################
# AI RESCUE (Twilio Emergency Call)
###############################################################

import os

# Le credenziali Twilio ora vengono lette dalle variabili d'ambiente di Render
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "IL_TUO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "IL_TUO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER", "+1234567890")

@app.route("/emergency_call", methods=["POST"])
def emergency_call():
    try:
        data = request.get_json(force=True) or {}
        user_id = data.get("user_id", "unknown")
        lat = data.get("lat")
        lon = data.get("lon")
        contact = data.get("contact_phone") # Es: +393331234567

        if not lat or not lon or not contact:
            return jsonify({"error": "Dati mancanti"}), 400

        google_maps_link = f"https://maps.google.com/?q={lat},{lon}"
        # Testo molto corto per non superare il limite del Trial Twilio (errore 30044)
        testo_messaggio = f"🚨 AiRescue: Incidente! Posizione: {google_maps_link}"

        print("\n" + "="*50)
        print("🚨 ALLARME AI RESCUE (TWILIO) 🚨")
        print(f"Destinazione: {contact}")
        print("="*50 + "\n")

        if TWILIO_ACCOUNT_SID != "IL_TUO_ACCOUNT_SID":
            from twilio.rest import Client
            client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            message = client.messages.create(
                body=testo_messaggio,
                from_=TWILIO_PHONE_NUMBER,
                to=contact
            )
            print(f"SMS inviato con SID: {message.sid}")

        return jsonify({"status": "success", "message": "Allarme Twilio processato"})

    except Exception as e:
        print("Errore /emergency_call:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


###############################################################
# AVVIO SERVER
###############################################################

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
