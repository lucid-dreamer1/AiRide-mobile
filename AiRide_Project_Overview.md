# 🏍️ Panoramica del Progetto AiRide

AiRide è un sistema avanzato di navigazione e sicurezza per motociclisti che combina un'applicazione mobile intelligente con un dispositivo hardware dedicato (HUD per casco). L'obiettivo principale è fornire indicazioni di guida in tempo reale, telemetria e un sistema di emergenza automatico in caso di incidente, minimizzando le distrazioni e massimizzando la sicurezza stradale.

---

## 💻 1. Architettura Software

L'ecosistema software di AiRide è suddiviso in un'app mobile lato client e in un'infrastruttura backend cloud-based, assicurando reattività e scalabilità.

### 📱 Applicazione Mobile (Frontend)
- **Tecnologia:** Sviluppata in React Native / Expo (nella cartella `airide-native`), offre un'esperienza fluida cross-platform, con un focus particolare su Android.
- **Interfaccia Utente (UI):** Caratterizzata da un design scuro (Dark Theme) con accenti "Electric Blue" e "Neon Orange", basata su un layout "Bento Box" moderno.
- **Funzionalità Core:**
  - **Motore di Navigazione:** Interfaccia dedicata all'inserimento delle destinazioni e alla visualizzazione in tempo reale del percorso tramite una mappa integrata.
  - **Loop di Tracking GPS:** Monitoraggio in real-time della posizione dell'utente per aggiornare l'itinerario e rilevare eventuali uscite fuori percorso (off-route detection).
  - **Comunicazione BLE:** Modulo dedicato alla gestione della connessione Bluetooth Low Energy con l'hardware del casco. L'app formatta i pacchetti dati in 4 campi specifici e gestisce il "chunking" dei payload per trasmettere in modo affidabile le istruzioni di navigazione.

### ☁️ Infrastruttura Backend
- **Tecnologia:** Costruito in Python utilizzando il framework **Flask** (nella cartella `backend`), predisposto per il deploy su servizi cloud come Render.
- **Integrazioni e API:**
  - **TomTom APIs:** Il cuore pulsante del sistema di navigazione, utilizzato per il calcolo dei percorsi, il ricalcolo dinamico e le stime sui tempi di arrivo.
  - **Firebase:** Gestisce l'autenticazione degli utenti, il database NoSQL in tempo reale (Firestore) e la sicurezza. Sono implementate rigide Firebase Security Rules, App Check e audit logging per garantire la conformità al GDPR e proteggere i dati.

### 🆘 Sistema di Sicurezza "AiRescue"
Un sistema salvavita integrato che si attiva in caso di anomalie o cadute.
- **Rilevamento Impatto:** Sfrutta i sensori del telefono o dell'hardware per identificare un potenziale incidente.
- **Verifica Utente (STT):** Utilizza un sistema robusto di Speech-to-Text per chiedere conferma all'utente ("Stai bene?").
- **Notifica d'Emergenza:** In caso di mancata risposta, il backend si interfaccia con **Twilio** per inviare in automatico SMS ai contatti di emergenza con la posizione precisa dell'utente.

---

## 🪖 2. Architettura Hardware

La componente hardware trasforma l'esperienza dell'app portandola direttamente nel campo visivo del motociclista.

### 🕶️ Helmet OLED Display (HUD)
- **Componente Principale:** Un display OLED custom integrabile nel casco, progettato per mostrare informazioni cruciali senza che il pilota debba distogliere lo sguardo dalla strada.
- **Funzionamento:** 
  - All'accensione, il display mostra una schermata di avvio "AiRide" (Idle State).
  - Una volta connesso all'app mobile, inizia a ricevere e decodificare le istruzioni di navigazione (frecce direzionali, distanza, notifiche).
- **Comunicazione BLE:** Riceve pacchetti di dati dal telefono. Grazie a un sistema di pacchettizzazione ottimizzato, supera i limiti standard della larghezza di banda Bluetooth, garantendo che lo schermo si aggiorni senza ritardi.

---

## ✨ 3. Elenco Completo delle Feature

Ecco un dettaglio esaustivo di **tutte** le funzionalità integrate nell'ecosistema AiRide:

### 🗺️ Navigazione Intelligente (Smart Navigation)
- **Routing Avanzato (Powered by TomTom):** Generazione di percorsi ottimizzati con calcolo dell'ETA (Estimated Time of Arrival) in tempo reale.
- **Rilevamento Fuori Percorso (Off-Route Detection):** Algoritmo GPS continuo che capisce se il pilota ha sbagliato strada e attiva il ricalcolo dinamico.
- **Interfaccia di Ricerca:** UI dedicata per la ricerca rapida di indirizzi e PDI (Punti di Interesse).

### 🆘 Sistema Salvavita "AiRescue"
- **Rilevamento Urti (Impact Detection):** Analisi dei dati dei sensori per identificare potenziali cadute o incidentes.
- **Protocollo di Sicurezza STT (Speech-to-Text):** Una volta rilevata un'anomalia, l'app interroga vocalmente l'utente ("Stai bene?") ascoltando la risposta senza richiedere interazioni manuali.
- **Dispatching Automatico SOS (Twilio):** In caso di mancata risposta (o richiesta d'aiuto), il sistema invia automaticamente SMS ai contatti di emergenza contenenti le coordinate GPS esatte.
- **Easter Egg Landing Page:** Sulla pagina web promozionale, cliccando 3 volte la card "AiRescue" appare un alert nascosto: *"BeSafe è per le emergenze, AiRide è ANCHE per le emergenze"*.

### 🪖 Integrazione Hardware HUD (Heads-Up Display)
- **OLED Helmet Display:** Mini-schermo montato nel casco che proietta i dati di guida all'interno del campo visivo.
- **Stato di Avvio (Idle Screen):** Schermata di benvenuto personalizzata "AiRide" all'accensione del dispositivo.
- **Sincronizzazione BLE (Bluetooth Low Energy):** Connessione a bassissimo consumo tra smartphone e casco.
- **Gestione Payload Ottimizzata:** Trasmissione dei dati di navigazione divisi in 4 campi specifici e "chunkati" (frammentati) per aggirare i limiti di banda del BLE, garantendo l'aggiornamento istantaneo del display senza latenza o troncamenti.
- **Frecce e Distanze AR-Style:** Visualizzazione minimalista delle svolte e della distanza rimanente, progettata per non distrarre.

### 📊 Telemetria e UI/UX
- **Tracking GPS Continuo:** Loop in background ad alta precisione per monitorare costantemente posizione e velocità.
- **Design "Bento Box" con Glassmorfismo:** Interfaccia utente ultra-moderna, fluida, divisa a griglia.
- **Tema Scuro (Dark Mode):** UI ottimizzata per il contrasto con accenti di colore Electric Blue e Neon Orange.

### 🛡️ Sicurezza Dati e Cloud Backend
- **Firebase Security Rules & App Check:** Protezione militare dei dati degli utenti, impedendo accessi non autorizzati e abusi dell'API.
- **Audit Logging:** Sistema di tracciamento degli eventi per conformità GDPR e risposta agli incidenti.
- **Architettura Serverless/Cloud:** Backend Flask ospitato sul cloud (Render) per scalabilità automatica e uptime garantito.

---

## 🚀 4. Sintesi del Flusso di Lavoro

1. L'utente apre l'app **AiRide** e imposta una destinazione.
2. Il **Backend Flask** comunica con **TomTom API** per generare il percorso ideale e lo invia al telefono.
3. Il telefono inizia il **Tracking GPS** e tramite **BLE** invia le istruzioni immediate all'**Hardware OLED** nel casco.
4. Il motociclista guida seguendo l'HUD. 
5. Se viene rilevato un incidente, si attiva **AiRescue**: il telefono tenta l'interazione vocale e, se necessario, il backend **Twilio** dirama le allerte SOS.

---
*Progetto focalizzato sull'integrazione fluida tra IoT (Internet of Things), Cloud computing e Mobile App per la sicurezza su due ruote.*
