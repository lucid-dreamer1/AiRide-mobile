###############################################################
# APP DI NAVIGAZIONE
# Flask + TomTom API + SSE ISTRUZIONI (modalità DEMO senza auth)
###############################################################

from flask import Flask, request, Response, jsonify
from flask_cors import CORS
import requests, json, math, time, traceback
from datetime import datetime

###############################################################
# FLASK APP
###############################################################

app = Flask(__name__)
CORS(app)

# Memoria temporanea:
# - viaggi attivi per utente
# - posizioni correnti per utente (usate dallo STREAM)
active_sessions = {}
current_positions = {}

# Utente fisso per modalità demo
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
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def geocode_address(address):
    try:
        url = f"https://api.tomtom.com/search/2/geocode/{requests.utils.quote(address)}.json"
        params = {"key": API_KEY, "limit": 1}
        r = requests.get(url, params=params, timeout=10)
        data = r.json()
        if data.get("results"):
            pos = data["results"][0]["position"]
            return f"{pos['lat']},{pos['lon']}"
    except Exception as e:
        print("Errore geocoding:", e, address)
    return None


def get_route_from_tomtom(start, end):
    try:
        start_lat, start_lon = map(float, start.split(","))
        end_lat, end_lon = map(float, end.split(","))
        url = f"https://api.tomtom.com/routing/1/calculateRoute/{start_lat},{start_lon}:{end_lat},{end_lon}/json"
        params = {
            "key": API_KEY,
            "instructionsType": "text",
            "routeType": "fastest",
            "traffic": "false"
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
    """
    Estrae le istruzioni di guida dalla risposta TomTom.
    Ritorna lista di dict: {text, lat, lon, dist}
    """
    try:
        route = resp_json.get("routes", [{}])[0]
        legs = route.get("legs", [])
        instructions = []
        for leg in legs:
            guidance = leg.get("guidance", {}) or route.get("guidance", {})
            for instr in guidance.get("instructions", []):
                msg = instr.get("message", "")
                lat = instr.get("point", {}).get("latitude")
                lon = instr.get("point", {}).get("longitude")
                dist = instr.get("routeOffsetInMeters", 0)
                instructions.append({
                    "text": msg,
                    "lat": lat,
                    "lon": lon,
                    "dist": dist
                })
        return instructions
    except Exception as e:
        print("Errore extract_instructions:", e)
        return []


def manovra_to_freccia(text):
    """Converte una descrizione testuale in un codice direzionale numerico."""
    t = (text or "").lower()
    if any(k in t for k in ("destra", "right")):
        return 0  # destra
    if any(k in t for k in ("sinistra", "left")):
        return 1  # sinistra
    if any(k in t for k in ("dritto", "straight", "continua", "continue")):
        return 2  # dritto
    if any(k in t for k in ("u-turn", "inversione", "indietro")):
        return 3  # inversione
    return 2  # default: avanti

###############################################################
# UPDATE POSIZIONE GPS (DEMO: user fisso)
###############################################################

@app.route("/update_position", methods=["POST"])
def update_position():
    try:
        data = request.get_json(force=True)
        if not data or "lat" not in data or "lon" not in data:
            return jsonify({"error": "Lat e Lon mancanti"}), 400

        user_id = DEMO_USER_ID

        lat = float(data["lat"])
        lon = float(data["lon"])
        current_time = datetime.utcnow()

        current_positions[user_id] = {
            "lat": lat,
            "lon": lon,
            "time": time.time()
        }
        # Se esiste una rotta attiva → controlla uscita dal percorso
        session = active_sessions.get(user_id)
        if session and "polyline" in session:
            if fuori_rotta(lat, lon, session["polyline"]):
                print("🚨 Utente fuori rotta: serve RICALCOLO")
                session["recalc_needed"] = True

        print(f"[GPS] UID={user_id} → {lat},{lon}")

        if user_id not in active_sessions:
            active_sessions[user_id] = {
                "start": (lat, lon),
                "start_time": current_time,
            }
            print(f"[{user_id}] 🟢 Inizio viaggio salvato")
            return jsonify({"status": "start_logged"})

        active_sessions[user_id]["last"] = (lat, lon)
        return jsonify({"status": "position_updated"})

    except Exception as e:
        print("Errore /update_position:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

###############################################################
# COMPLETAMENTO VIAGGIO (SOLO IN MEMORIA)
###############################################################

@app.route("/complete_trip", methods=["POST"])
def complete_trip():
    """Chiamato quando il viaggio termina."""
    try:
        user_id = DEMO_USER_ID

        session = active_sessions.get(user_id)
        if not session:
            return jsonify({"error": "Nessun viaggio attivo"}), 400

        end_time = datetime.utcnow()
        duration_min = round((end_time - session["start_time"]).total_seconds() / 60, 1)
        start_lat, start_lon = session["start"]
        end_lat, end_lon = session.get("last", session["start"])

        # Qui potresti salvare su file o DB in futuro
        print(f"[{user_id}] 🏁 Viaggio completato:")
        print(f"  Da ({start_lat},{start_lon}) a ({end_lat},{end_lon}) in {duration_min} min")

        del active_sessions[user_id]
        return jsonify({"status": "trip_saved"})

    except Exception as e:
        print("Errore /complete_trip:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

###############################################################
# ROUTE INFO (PER MAPPA / POLYLINE)
###############################################################

@app.route("/route_info")
def route_info():
    try:
        start = request.args.get("start")
        end = request.args.get("end")
        if not start or not end:
            return jsonify({"error": "Start o end mancanti"}), 400

        # Start: se non è lat,lon → geocoding
        try:
            lat, lon = map(float, start.split(","))
            start_coords = start
        except:
            start_coords = geocode_address(start)

        if not start_coords:
            return jsonify({"error": "Partenza non valida"}), 400

        # End sempre via geocoding se è indirizzo
        try:
            end_lat, end_lon = map(float, end.split(","))
            end_coords = end
        except:
            end_coords = geocode_address(end)

        if not end_coords:
            return jsonify({"error": "Destinazione non valida"}), 400

        route_data = get_route_from_tomtom(start_coords, end_coords)
        if not route_data or not route_data.get("routes"):
            return jsonify({"error": "Nessuna rotta trovata"}), 400

        route = route_data["routes"][0]
        summary = route.get("summary", {})
        duration_sec = summary.get("travelTimeInSeconds", 0)
        distance_m = summary.get("lengthInMeters", 0)

        points = []
        for leg in route.get("legs", []):
            for point in leg.get("points", []):
                plat = point.get("latitude")
                plon = point.get("longitude")
                if plat is not None and plon is not None:
                    points.append({"lat": plat, "lon": plon})

        return jsonify({
            "duration": f"{round(duration_sec/60)} min",
            "distance": f"{round(distance_m/1000,1)} km",
            "coordinates": points
        })

    except Exception as e:
        print("Errore /route_info:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

###############################################################
# STREAMING ISTRUZIONI (SSE)
###############################################################

@app.route("/stream")
def stream():
    try:
        user_id = DEMO_USER_ID

        start = request.args.get("start")
        end = request.args.get("end")

        if not start or not end:
            return jsonify({"error": "Start o end mancanti"}), 400

        # Gestione coordinate partenza
        try:
            lat, lon = map(float, start.split(","))
            start_coords = start
        except:
            start_coords = geocode_address(start)

        # Destinazione
        try:
            end_lat, end_lon = map(float, end.split(","))
            end_coords = end
        except:
            end_coords = geocode_address(end)

        if not start_coords or not end_coords:
            return jsonify({"error": "Coordinate non valide"}), 400

        # Ottieni rotta e istruzioni
        route_data = get_route_from_tomtom(start_coords, end_coords)
        if not route_data:
            return jsonify({"error": "Errore nel calcolo rotta"}), 400

        instructions = extract_instructions(route_data)
        route = route_data["routes"][0]
        polyline = []
        for leg in route.get("legs", []):
            for point in leg.get("points", []):
                latp = point.get("latitude")
                lonp = point.get("longitude")
                if latp and lonp:
                    polyline.append({"lat": latp, "lon": lonp})

        active_sessions[user_id] = {
            "polyline": polyline,
            "recalc_needed": False
}
        print(f"[STREAM] UID={user_id} → {len(instructions)} istruzioni")

        def generate():
            instr_index = 0

            yield f"data: {json.dumps({'testo': 'Navigazione avviata 🚗'})}\n\n"

            while True:
                session = active_sessions.get(user_id)
                pos = current_positions.get(user_id)

                if not pos:
                    yield ": waiting gps\n\n"
                    time.sleep(1)
                    continue

                ###################################################
                # 🔄 RICALCOLO SE NECESSARIO
                ###################################################
                if session.get("recalc_needed"):
                    yield f"data: {json.dumps({'testo': 'Ricalcolo percorso… 🔄'})}\n\n"

                    new_start = f"{pos['lat']},{pos['lon']}"
                    route_data2 = get_route_from_tomtom(new_start, end_coords)
                    instructions[:] = extract_instructions(route_data2)

                    # ricostruisci polyline
                    new_poly = []
                    for leg in route_data2["routes"][0]["legs"]:
                        for p in leg["points"]:
                            new_poly.append({"lat": p["latitude"], "lon": p["longitude"]})

                    session["polyline"] = new_poly
                    session["recalc_needed"] = False
                    instr_index = 0
                    continue

                ###################################################
                # Fine percorso
                ###################################################
                if instr_index >= len(instructions):
                    yield f"data: {json.dumps({'testo': 'Percorso completato 🎉'})}\n\n"
                    time.sleep(2)
                    continue

                instr = instructions[instr_index]

                d = distanza_m(
                    pos["lat"], pos["lon"],
                    instr["lat"], instr["lon"]
                )

                trigger = 100      # soglia evidenziazione
                step = 20          # quantizzazione nei 100m

                # ✅ MOSTRA SEMPRE L’ISTRUZIONE CORRENTE
                if d > trigger:
                    # LONTANO → preview, metri “reali” arrotondati
                    metri = int(d)
                    payload = {
                        "freccia": manovra_to_freccia(instr["text"]),
                        "metri": metri,
                        "testo": instr["text"],
                        "near": False,        # 👈 preview
                    }
                else:
                    # VICINO → evidenziato, countdown a gradini (100,80,...,0)
                    metri = int(round(d / step) * step)
                    if metri < 0:
                        metri = 0

                    payload = {
                        "freccia": manovra_to_freccia(instr["text"]),
                        "metri": metri,
                        "testo": instr["text"],
                        "near": True,         # 👈 da evidenziare
                    }

                yield f"data: {json.dumps(payload)}\n\n"

                # Quando sei molto vicino → passa alla prossima istruzione
                if d < 20:
                    instr_index += 1

                time.sleep(1)

            instr_index = 0

            # Messaggio iniziale
            yield f"data: {json.dumps({'testo': 'Navigazione avviata 🚗'})}\n\n"

            while instr_index < len(instructions):
                instr = instructions[instr_index]

                pos = current_positions.get(user_id)
                if not pos:
                    yield ": waiting gps\n\n"
                    time.sleep(1)
                    continue

                # Distanza utente → punto istruzione
                if instr["lat"] is not None and instr["lon"] is not None:
                    d = distanza_m(
                        pos["lat"], pos["lon"],
                        instr["lat"], instr["lon"]
                    )
                else:
                    d = 0

                # ===============================
                #     🔥 NUOVA LOGICA UPGRADE
                # ===============================

                trigger_distance = 100      # Mostra l’istruzione già a 100 metri
                next_step_distance = 20     # Scala in multipli da 20 m

                if d > trigger_distance:
                    # Troppo lontano → solo tracking
                    yield ": tracking\n\n"

                else:
                    # Quantizzazione della distanza: 100, 80, 60, 40, 20, 0
                    metri_mostrati = int(round(d / next_step_distance) * next_step_distance)
                    if metri_mostrati < 0:
                        metri_mostrati = 0

                    step_progressivo = {
                        "freccia": manovra_to_freccia(instr["text"]),
                        "metri": metri_mostrati,
                        "testo": instr["text"]
                    }

                    yield f"data: {json.dumps(step_progressivo)}\n\n"

                    # Quando sei molto vicino → passa alla prossima istruzione
                    if d < 20:
                        instr_index += 1

                time.sleep(1)

            # Fine percorso
            yield f"data: {json.dumps({'testo': 'Percorso completato 🎉'})}\n\n"

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*"
            }
        )

    except Exception as e:
        print("Errore /stream:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

    try:
        user_id = DEMO_USER_ID

        start = request.args.get("start")
        end = request.args.get("end")

        if not start or not end:
            return jsonify({"error": "Start o end mancanti"}), 400

        # Gestione coordinate partenza
        try:
            lat, lon = map(float, start.split(","))
            start_coords = start
        except:
            start_coords = geocode_address(start)

        # Destinazione
        try:
            end_lat, end_lon = map(float, end.split(","))
            end_coords = end
        except:
            end_coords = geocode_address(end)

        if not start_coords or not end_coords:
            return jsonify({"error": "Coordinate non valide"}), 400

        # Ottieni rotta e istruzioni
        route_data = get_route_from_tomtom(start_coords, end_coords)
        if not route_data:
            return jsonify({"error": "Errore nel calcolo rotta"}), 400

        instructions = extract_instructions(route_data)
        print(f"[STREAM] UID={user_id} → {len(instructions)} istruzioni")

        def generate():
            instr_index = 0

            # Messaggio iniziale
            yield f"data: {json.dumps({'testo': 'Navigazione avviata 🚗'})}\n\n"

            while instr_index < len(instructions):
                instr = instructions[instr_index]

                step = {
                    "freccia": manovra_to_freccia(instr["text"]),
                    "metri": instr["dist"],
                    "testo": instr["text"]
                }

                pos = current_positions.get(user_id)

                if not pos:
                    yield ": waiting gps\n\n"
                    time.sleep(1)
                    continue

                if instr["lat"] is not None and instr["lon"] is not None:
                    d = distanza_m(
                        pos["lat"], pos["lon"],
                        instr["lat"], instr["lon"]
                    )
                else:
                    d = 0

                if d < 70:
                    yield f"data: {json.dumps(step)}\n\n"
                    instr_index += 1
                else:
                    yield ": tracking\n\n"

                time.sleep(1)

            yield f"data: {json.dumps({'testo': 'Percorso completato 🎉'})}\n\n"

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*"
            }
        )

    except Exception as e:
        print("Errore /stream:", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

###############################################################
# AVVIO SERVER
###############################################################
def distanza_punto_segmento(p, a, b):
    """Calcola distanza minima tra punto p e segmento AB."""
    px, py = p
    ax, ay = a
    bx, by = b

    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay

    ab_len2 = abx*abx + aby*aby
    if ab_len2 == 0:
        return math.dist(p, a)

    t = max(0, min(1, (apx*abx + apy*aby) / ab_len2))
    closest = (ax + t*abx, ay + t*aby)
    return math.dist(p, closest)


def fuori_rotta(user_lat, user_lon, polyline, soglia=30):
    """Ritorna True se il punto è oltre la soglia dalla polyline."""
    p = (user_lat, user_lon)

    for i in range(len(polyline)-1):
        a = polyline[i]
        b = polyline[i+1]
        d = distanza_punto_segmento(
            p,
            (a["lat"], a["lon"]),
            (b["lat"], b["lon"])
        )
        if d <= soglia:
            return False
    return True

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
