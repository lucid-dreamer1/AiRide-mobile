/*
 * =============================================================
 *  AiRide Helmet Firmware - XIAO ESP32S3 HUD OS v4.5 (Tactical HUD + Full App Sync)
 *  Seeed Studio XIAO ESP32S3 + SSD1309 Transparent OLED (SPI)
 * 
 *  Servizi BLE (libreria nativa ESP32 BLEDevice):
 *   1) Nordic UART Service  -> ricezione istruzioni (Dual-Core Safe) + Comandi HUD ($)
 *   2) OTA Service          -> Stub di compatibilità per app
 * =============================================================
 */

#include <SPI.h>
#include <U8g2lib.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// =============================================================
// CONFIGURAZIONE PIN OLED (GPIO diretti XIAO ESP32S3)
// Usa direttamente i GPIO interni per evitare conflitti di scheda nell'IDE
// =============================================================
#define OLED_MOSI     9   // Pin 3 Display (DIN) -> D10 (GPIO 9)
#define OLED_CLK      7   // Pin 4 Display (CLK) -> D8  (GPIO 7)
#define OLED_CS       44  // Pin 5 Display (CS)  -> D7  (GPIO 44)
#define OLED_DC       43  // Pin 6 Display (DC)  -> D6  (GPIO 43)
#define OLED_RESET    4   // Pin 7 Display (RST) -> D3  (GPIO 4)

U8G2_SSD1309_128X64_NONAME0_F_4W_HW_SPI u8g2(U8G2_R0, OLED_CS, OLED_DC, OLED_RESET);

// =============================================================
// UUID SERVIZI E CARATTERISTICHE BLE
// =============================================================
#define NAV_SERVICE_UUID   "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NAV_CHAR_RX_UUID   "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"

#define OTA_SERVICE_UUID   "e2697de0-5fae-4a6e-9b3d-21c7f3e4a8b2"
#define OTA_CONTROL_UUID   "e2697de1-5fae-4a6e-9b3d-21c7f3e4a8b2"
#define OTA_DATA_UUID      "e2697de2-5fae-4a6e-9b3d-21c7f3e4a8b2"

// =============================================================
// VARIABILI GLOBALI & SINCRONIZZAZIONE DUAL-CORE
// =============================================================
BLEServer*         pServer         = nullptr;
BLECharacteristic* pOtaControlChar = nullptr;
volatile bool      deviceConnected = false;
volatile bool      needReadyNotify = false;
unsigned long      connectTime     = 0;

// Spinlock hardware per proteggere il buffer tra Core 0 (BLE) e Core 1 (Loop)
portMUX_TYPE       navMux          = portMUX_INITIALIZER_UNLOCKED;
String             rxStagingBuffer = "";
String             readyPacket     = "";
volatile unsigned long lastCharTime = 0;
const unsigned long PACKET_TIMEOUT  = 35;

unsigned long lastPacketTime       = 0;
const unsigned long IDLE_TIMEOUT   = 60000;  // 60s reali di inattività prima dello standby

// Telemetria e stato navigazione
long  lockedTotalMeters = 0;
bool  isTotalLocked     = false;
long  globalRunMeters   = 0;

bool  inNavMode         = false;
int   currentDir        = 2;
long  currentMeters     = 0;
int   nextTurnDir       = -1;   // Prossima manovra (-1 = nessuna)
int   currentSpeedKmh   = 0;    // Velocità istantanea GPS (km/h)

// Stati Overlay Tattici (Assistente Vocale, Interfono, Chiamate, SOS AiRescue)
bool          isVoiceListening   = false;
unsigned long voiceListenStartMs = 0;
const unsigned long VOICE_LISTEN_MAX_MS = 10000; // Safety auto-close

String        intercomSpeaker    = "";
unsigned long intercomStartMs    = 0;
const unsigned long INTERCOM_MAX_MS = 8000;

int           callState          = 0;    // 0=Idle, 1=In Arrivo, 2=Attiva, 3=Terminata, 4=In Uscita, 5=Persa
String        callerId           = "";
unsigned long callStateChangeMs  = 0;
unsigned long callActiveStartMs  = 0;

int           sosState           = 0;    // 0=Idle, 1=Countdown attivo, 2=Falso Positivo Annullato, 3=SOS Inviato
int           sosCountdown       = 0;    // Secondi rimanenti quando sosState == 1
unsigned long sosLastTickMs      = 0;
unsigned long sosStateChangeMs   = 0;

// Motore animazione non-bloccante (25 FPS -> 40ms)
unsigned long lastFrameTime        = 0;
const unsigned long FRAME_INTERVAL = 40;
uint16_t animTick                  = 0;

// Prototipi
void initOledHardwareSafe();
void showBootAnimation();
bool hasSecondaryOverlay();
void drawSecondaryHudDock();
void renderIdleScreen();
void renderNavigationScreen(int dir, long meters);
void processRawBuffer(String rawData);
void parseSingleNavPacket(String packet);
void handleHudCommand(String cmd);

// =============================================================
// CALLBACK BLE (Eseguite su Core 0)
// =============================================================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    connectTime     = millis();
    needReadyNotify = true;
    Serial.println("[BLE] App connessa!");
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected  = false;
    needReadyNotify  = false;
    isVoiceListening = false;
    callState        = 0;
    sosState         = 0;
    sosCountdown     = 0;
    intercomSpeaker  = "";
    Serial.println("[BLE] App disconnessa. Riavvio advertising...");
    BLEDevice::startAdvertising();
  }
};

class NavRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxValue = pCharacteristic->getValue().c_str();
    int len = rxValue.length();
    if (len == 0) return;

    unsigned long now = millis();

    portENTER_CRITICAL(&navMux);
    for (int i = 0; i < len; i++) {
      char c = rxValue[i];
      if (c == '\n' || c == '\r') {
        if (rxStagingBuffer.length() > 0) {
          if (readyPacket.length() > 0) readyPacket += "\n";
          readyPacket += rxStagingBuffer;
          rxStagingBuffer = "";
        }
        continue;
      }
      rxStagingBuffer += c;
      lastCharTime = now;
    }
    portEXIT_CRITICAL(&navMux);
  }
};

class OtaControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String raw = pCharacteristic->getValue().c_str();
    if (raw.length() == 0) return;

    uint8_t opcode = (uint8_t)raw[0];
    if (opcode == 0x01) { // CMD_START
      Serial.println("[OTA] Tentativo aggiornamento da app...");
      uint8_t errResp[2] = { 0x14, 0x01 }; // RESP_ERROR, ERR_BEGIN_FAILED
      if (pOtaControlChar) {
        pOtaControlChar->setValue(errResp, 2);
        pOtaControlChar->notify();
      }
    }
  }
};

// =============================================================
// PROCEDURA ANTI-BLOCCO DISPLAY OLED ALL'AVVIO
// =============================================================
void initOledHardwareSafe() {
  // 1. Attende che l'alimentazione 3.3V e l'USB si stabilizzino
  delay(250);

  // 2. Configura i pin di controllo e forza la scarica del condensatore di Reset
  pinMode(OLED_CS, OUTPUT);
  pinMode(OLED_DC, OUTPUT);
  pinMode(OLED_RESET, OUTPUT);

  digitalWrite(OLED_CS, HIGH);
  digitalWrite(OLED_DC, LOW);

  // Impulso lungo di Reset (scarica eventuali tensioni residue)
  digitalWrite(OLED_RESET, HIGH);
  delay(20);
  digitalWrite(OLED_RESET, LOW);
  delay(150);
  digitalWrite(OLED_RESET, HIGH);
  delay(150);

  // 3. Inizializza SPI Hardware SENZA bloccare OLED_CS (-1 sul parametro SS)
  SPI.end();
  SPI.begin(OLED_CLK, -1, OLED_MOSI, -1);

  // 4. Imposta clock SPI a 4 MHz per massima stabilità sui cavi
  u8g2.setBusClock(4000000);

  // 5. Avvia il controller SSD1309 e forza l'accensione del pannello
  u8g2.begin();
  u8g2.setPowerSave(0);
  u8g2.setContrast(190); // Riduce i picchi di corrente sulla linea 3.3V
  u8g2.clearBuffer();
  u8g2.sendBuffer();
  delay(50);
}

// =============================================================
// SETUP
// =============================================================
void setup() {
  Serial.begin(115200);
  rxStagingBuffer.reserve(128);
  readyPacket.reserve(128);

  // --- Inizializzazione sicura Display OLED ---
  initOledHardwareSafe();
  showBootAnimation();

  // Piccola pausa prima di attivare la radio BLE per evitare cali di tensione
  delay(100);

  // --- BLE ---
  BLEDevice::init("AiRide Helmet");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pNavService = pServer->createService(NAV_SERVICE_UUID);
  BLECharacteristic* pNavRxChar = pNavService->createCharacteristic(
    NAV_CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pNavRxChar->setCallbacks(new NavRxCallbacks());
  pNavService->start();

  BLEService* pOtaService = pServer->createService(OTA_SERVICE_UUID);
  pOtaControlChar = pOtaService->createCharacteristic(
    OTA_CONTROL_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  pOtaControlChar->addDescriptor(new BLE2902());
  pOtaControlChar->setCallbacks(new OtaControlCallbacks());

  BLECharacteristic* pOtaDataChar = pOtaService->createCharacteristic(
    OTA_DATA_UUID,
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  pOtaService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(NAV_SERVICE_UUID);
  pAdvertising->addServiceUUID(OTA_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Pronto. In attesa di connessione...");
}

// =============================================================
// LOOP (Eseguito su Core 1)
// =============================================================
void loop() {
  unsigned long now = millis();

  // Invio differito di RESP_READY dopo la connessione
  if (needReadyNotify && deviceConnected && (now - connectTime >= 300)) {
    needReadyNotify = false;
    uint8_t readyCode = 0x10; // RESP_READY
    if (pOtaControlChar) {
      pOtaControlChar->setValue(&readyCode, 1);
      pOtaControlChar->notify();
    }
  }

  // 1. Estrazione atomica del pacchetto
  String dataToProcess = "";
  portENTER_CRITICAL(&navMux);
  if (readyPacket.length() > 0) {
    dataToProcess = readyPacket;
    readyPacket = "";
  } else if (rxStagingBuffer.length() > 0 && (millis() - lastCharTime > PACKET_TIMEOUT)) {
    dataToProcess = rxStagingBuffer;
    rxStagingBuffer = "";
  }
  portEXIT_CRITICAL(&navMux);

  // 2. Elaborazione pacchetto O controllo timeout
  if (dataToProcess.length() > 0) {
    processRawBuffer(dataToProcess);
  } else if (inNavMode && (millis() - lastPacketTime > IDLE_TIMEOUT)) {
    inNavMode       = false;
    isTotalLocked   = false;
    nextTurnDir     = -1;
    currentSpeedKmh = 0;
  }

  // Timeout di sicurezza per overlay temporanei
  if (isVoiceListening && (millis() - voiceListenStartMs > VOICE_LISTEN_MAX_MS)) {
    isVoiceListening = false;
  }
  if (intercomSpeaker.length() > 0 && (millis() - intercomStartMs > INTERCOM_MAX_MS)) {
    intercomSpeaker = "";
  }
  // Auto-chiusura schermate transitorie Chiamata Terminata (3s), Persa (4s) e safety timeout In Uscita (45s)
  if (callState == 3 && (millis() - callStateChangeMs > 3000)) {
    callState = 0;
    callerId  = "";
  } else if (callState == 5 && (millis() - callStateChangeMs > 4000)) {
    callState = 0;
    callerId  = "";
  } else if (callState == 4 && (millis() - callStateChangeMs > 45000)) {
    callState = 0;
    callerId  = "";
  }

  // Gestione locale fluida del countdown AiRescue (1s) e stati post-countdown
  if (sosState == 1) {
    if (sosCountdown > 0 && (millis() - sosLastTickMs >= 1000)) {
      sosLastTickMs = millis();
      sosCountdown--;
      if (sosCountdown == 0) {
        sosState         = 3; // Passa automaticamente a "SOS INVIATO"
        sosStateChangeMs = millis();
      }
    }
  } else if (sosState == 2 && (millis() - sosStateChangeMs > 3500)) {
    // Mostra conferma "FALSO POSITIVO ANNULLATO" per 3.5s poi chiude il dock secondario
    sosState = 0;
  } else if (sosState == 3 && (millis() - sosStateChangeMs > 6000)) {
    // Mostra conferma "SOS INVIATO AI CONTATTI" per 6s
    sosState = 0;
  }

  // 3. Motore grafico HUD a 25 FPS (non bloccante)
  unsigned long renderNow = millis();
  if (renderNow - lastFrameTime >= FRAME_INTERVAL) {
    lastFrameTime = renderNow;
    animTick++;

    // Ogni ~2 secondi (50 frame) invia un comando di wake-up rapido
    // per garantire che lo schermo non resti mai spento per disturbi elettrici
    if (animTick % 50 == 0) {
      u8g2.setPowerSave(0);
    }

    // Il navigatore (o la schermata principale Idle) resta SEMPRE visibile:
    // Chiamate, AiRescue, Assistente Vocale e Interfono vengono disegnati come
    // grafica secondaria compatta e funzionale nel dock inferiore (drawSecondaryHudDock).
    if (inNavMode) {
      renderNavigationScreen(currentDir, currentMeters);
    } else {
      renderIdleScreen();
    }
  }
}

// =============================================================
// PARSING BLINDATO ANTI-SLITTAMENTO + COMANDI HUD ($)
// =============================================================
long safeParseLong(String s) {
  s.trim();
  String clean = "";
  clean.reserve(10);
  for (unsigned int i = 0; i < s.length(); ++i) {
    char ch = s.charAt(i);
    if (ch == '.' || ch == ',') break;
    if (isDigit(ch)) clean += ch;
  }
  if (clean.length() == 0) return 0;
  return clean.toInt();
}

void handleHudCommand(String cmd) {
  // Rimuove il prefisso '$'
  String body = cmd.substring(1);
  body.trim();
  if (body.length() == 0) return;

  if (body == "IDLE" || body == "RST") {
    isTotalLocked     = false;
    lockedTotalMeters = 0;
    globalRunMeters   = 0;
    nextTurnDir       = -1;
    sosState          = 0;
    sosCountdown      = 0;
    if (body == "IDLE") {
      inNavMode       = false;
      currentSpeedKmh = 0;
    }
    return;
  }

  int c1 = body.indexOf(':');
  String tag  = (c1 == -1) ? body : body.substring(0, c1);
  String rest = (c1 == -1) ? "" : body.substring(c1 + 1);

  if (tag == "NXT") {
    int c2 = rest.indexOf(':');
    if (c2 == -1) {
      nextTurnDir = rest.toInt();
    } else {
      nextTurnDir     = rest.substring(0, c2).toInt();
      currentSpeedKmh = rest.substring(c2 + 1).toInt();
    }
    lastPacketTime = millis();
  } else if (tag == "MIC") {
    isVoiceListening = (rest.toInt() == 1);
    if (isVoiceListening) {
      voiceListenStartMs = millis();
    }
  } else if (tag == "SOS") {
    rest.trim();
    if (rest == "OK") {
      // Utente ha annullato il falso positivo ("Sto bene" o pulsante app)
      sosState         = 2;
      sosCountdown     = 0;
      sosStateChangeMs = millis();
    } else if (rest == "SENT") {
      // Countdown terminato -> SOS inviato ai contatti di emergenza
      sosState         = 3;
      sosCountdown     = 0;
      sosStateChangeMs = millis();
    } else {
      int sec = rest.toInt();
      if (sec > 0) {
        sosState      = 1;
        sosCountdown  = sec;
        sosLastTickMs = millis();
      } else {
        // Se stavamo contando alla rovescia e riceviamo 0 senza SENT, considera annullato
        if (sosState == 1) {
          sosState         = 2;
          sosStateChangeMs = millis();
        } else {
          sosState = 0;
        }
        sosCountdown = 0;
      }
    }
  } else if (tag == "CALL") {
    int c2 = rest.indexOf(':');
    int newState     = (c2 == -1) ? rest.toInt() : rest.substring(0, c2).toInt();
    String newCaller = (c2 == -1) ? "" : rest.substring(c2 + 1);
    newCaller.trim();

    if (newState >= 1 && newState <= 5) {
      if (newState == 2 && callState != 2) {
        callActiveStartMs = millis(); // Avvia cronometro durata chiamata
      }
      callState         = newState;
      callStateChangeMs = millis();
      if (newCaller.length() > 0) {
        callerId = newCaller;
      } else if (callerId.length() == 0) {
        callerId = "Sconosciuto";
      }
    } else {
      callState = 0;
      callerId  = "";
    }
  } else if (tag == "INT") {
    if (rest == "0" || rest.length() == 0) {
      intercomSpeaker = "";
    } else {
      intercomSpeaker = rest;
      intercomStartMs = millis();
    }
  }
}

void processRawBuffer(String rawData) {
  rawData.trim();
  if (rawData.length() == 0) return;

  int nlIndex = rawData.indexOf('\n');
  if (nlIndex != -1) {
    int start = 0;
    while (nlIndex != -1) {
      parseSingleNavPacket(rawData.substring(start, nlIndex));
      start = nlIndex + 1;
      nlIndex = rawData.indexOf('\n', start);
    }
    if (start < (int)rawData.length()) {
      parseSingleNavPacket(rawData.substring(start));
    }
    return;
  }

  if (rawData.startsWith("$")) {
    handleHudCommand(rawData);
    return;
  }

  if (rawData.length() < 7) return;

  int lastValidStart = -1;
  for (int i = 0; i <= (int)rawData.length() - 7; i++) {
    if (rawData.charAt(i + 1) == '|') {
      char c = rawData.charAt(i);
      if (c >= '0' && c <= '7') {
        int pipesAfter = 0;
        for (int j = i + 1; j < (int)rawData.length(); j++) {
          if (rawData.charAt(j) == '|') pipesAfter++;
        }
        if (pipesAfter == 3) {
          lastValidStart = i;
          break;
        }
      }
    }
  }

  if (lastValidStart != -1) {
    parseSingleNavPacket(rawData.substring(lastValidStart));
  } else {
    parseSingleNavPacket(rawData);
  }
}

void parseSingleNavPacket(String packet) {
  packet.trim();
  if (packet.length() == 0) return;

  // Gestione comandi HUD estesi ($IDLE, $RST, $NXT, $MIC, $SOS, $CALL, $INT)
  if (packet.startsWith("$")) {
    handleHudCommand(packet);
    return;
  }

  if (packet.length() < 7 || packet.charAt(0) == '|') return;

  int p1 = packet.indexOf('|');
  if (p1 == -1) return;

  int p2 = packet.indexOf('|', p1 + 1);
  if (p2 == -1) return;

  int p3 = packet.indexOf('|', p2 + 1);
  if (p3 == -1) return;

  int p4 = packet.indexOf('|', p3 + 1);

  String dirStr    = packet.substring(0, p1);
  String metersStr = packet.substring(p1 + 1, p2);
  String totalStr  = packet.substring(p2 + 1, p3);
  String runStr    = (p4 == -1) ? packet.substring(p3 + 1) : packet.substring(p3 + 1, p4 - 1);

  dirStr.trim();
  metersStr.trim();
  totalStr.trim();
  runStr.trim();

  // Supporta tutti gli 8 codici manovra (0..7)
  if (dirStr.length() != 1 || dirStr.charAt(0) < '0' || dirStr.charAt(0) > '7') {
    return;
  }

  if (metersStr.length() == 0 || totalStr.length() == 0) return;

  int  dir    = dirStr.charAt(0) - '0';
  long meters = safeParseLong(metersStr);
  long total  = safeParseLong(totalStr);
  long run    = safeParseLong(runStr);

  // Aggiorna la distanza totale anche se viene avviata una nuova rotta diversa dalla precedente
  if (total > 0 && (!isTotalLocked || labs(total - lockedTotalMeters) > 50)) {
    lockedTotalMeters = total;
    isTotalLocked = true;
  }
  globalRunMeters = run;

  currentDir     = dir;
  currentMeters  = meters;
  lastPacketTime = millis();
  inNavMode      = true;
}

// =============================================================
// ELEMENTI GRAFICI HUD & PRIMITIVE TATTICHE
// =============================================================
void drawHudBrackets(int x, int y, int w, int h, int len) {
  u8g2.drawHLine(x, y, len);
  u8g2.drawVLine(x, y, len);
  u8g2.drawHLine(x + w - len, y, len);
  u8g2.drawVLine(x + w - 1, y, len);
  u8g2.drawHLine(x, y + h - 1, len);
  u8g2.drawVLine(x, y + h - len, len);
  u8g2.drawHLine(x + w - len, y + h - 1, len);
  u8g2.drawVLine(x + w - 1, y + h - len, len);
}

void formatCompactDist(long meters, char* buf, size_t bufSize) {
  if (meters >= 1000) {
    snprintf(buf, bufSize, "%ld.%ldk", meters / 1000, (meters % 1000) / 100);
  } else {
    snprintf(buf, bufSize, "%ldm", meters);
  }
}

void drawMiniNextIcon(int x, int y, int dir) {
  // Disegna mini-icona 7x7 per la prossima manovra nella top bar
  if (dir == 0 || dir == 5) { // DX / Tieni DX
    u8g2.drawHLine(x, y + 3, 5);
    u8g2.drawPixel(x + 3, y + 1);
    u8g2.drawPixel(x + 4, y + 2);
    u8g2.drawPixel(x + 4, y + 4);
    u8g2.drawPixel(x + 3, y + 5);
  } else if (dir == 1 || dir == 6) { // SX / Tieni SX
    u8g2.drawHLine(x + 2, y + 3, 5);
    u8g2.drawPixel(x + 3, y + 1);
    u8g2.drawPixel(x + 2, y + 2);
    u8g2.drawPixel(x + 2, y + 4);
    u8g2.drawPixel(x + 3, y + 5);
  } else if (dir == 7) { // Rotonda
    u8g2.drawCircle(x + 3, y + 3, 3);
  } else if (dir == 4) { // Arrivo
    u8g2.drawFrame(x + 1, y + 1, 5, 5);
    u8g2.drawPixel(x + 3, y + 3);
  } else { // Dritto / Default
    u8g2.drawVLine(x + 3, y + 1, 6);
    u8g2.drawPixel(x + 2, y + 2);
    u8g2.drawPixel(x + 4, y + 2);
  }
}

void showBootAnimation() {
  for (int step = 0; step <= 20; step++) {
    u8g2.clearBuffer();

    int pad = (20 - step) * 2;
    drawHudBrackets(pad, pad / 2, 128 - (pad * 2), 64 - pad, 8);

    if (step > 5) {
      u8g2.setFont(u8g2_font_helvB18_tr);
      int w = u8g2.getStrWidth("AiRide");
      u8g2.drawStr((128 - w) / 2, 32, "AiRide");
    }

    if (step > 10) {
      u8g2.setFont(u8g2_font_5x7_tr);
      const char* sub = "HUD OS v4.5 // XIAO-S3";
      int sw = u8g2.getStrWidth(sub);
      u8g2.drawStr((128 - sw) / 2, 44, sub);
    }

    int barW = (step * 88) / 20;
    u8g2.drawFrame(20, 50, 88, 6);
    if (barW > 4) {
      u8g2.drawBox(22, 52, barW - 4, 2);
    }

    u8g2.sendBuffer();
    delay(35);
  }
  delay(250);
}

// =============================================================
// DOCK SECONDARIO TATTICO (y = 42..63, 128x22 px)
// Mostrato INSIEME al normale navigatore (senza mai coprire freccia e metri)
// =============================================================
bool hasSecondaryOverlay() {
  return (sosState > 0) ||
         (callState >= 1 && callState <= 5) ||
         isVoiceListening ||
         (intercomSpeaker.length() > 0);
}

String getScrollingCaller(String rawName, unsigned int maxChars) {
  String clean = rawName.length() > 0 ? rawName : "Sconosciuto";
  if (clean.length() <= maxChars) return clean;
  unsigned int totalShift = clean.length() - maxChars + 1;
  unsigned int idx = (animTick / 6) % (totalShift + 4);
  if (idx >= totalShift) idx = 0;
  return clean.substring(idx, idx + maxChars);
}

void drawSecondaryHudDock() {
  // Pulisce l'area del dock secondario inferiore (y = 42..63)
  u8g2.setDrawColor(0);
  u8g2.drawBox(0, 42, 128, 22);
  u8g2.setDrawColor(1);

  if (sosState > 0) {
    // --- PRIORITÀ 1: AIRESCUE (COUNTDOWN / FALSO POSITIVO / SOS INVIATO) ---
    if (sosState == 1) {
      // Cornice lampeggiante sul dock inferiore
      if ((animTick / 3) % 2 == 0) {
        u8g2.drawFrame(0, 42, 128, 22);
      } else {
        drawHudBrackets(0, 42, 128, 22, 5);
      }

      // Badge invertito a sinistra con i secondi del countdown (es. "28s")
      u8g2.drawBox(2, 44, 32, 18);
      u8g2.setDrawColor(0);
      u8g2.setFont(u8g2_font_helvB10_tr);
      char secBuf[8];
      snprintf(secBuf, sizeof(secBuf), "%ds", sosCountdown);
      int sw = u8g2.getStrWidth(secBuf);
      u8g2.drawStr(2 + (32 - sw) / 2, 58, secBuf);
      u8g2.setDrawColor(1);

      // Testo falso positivo + barra di scaricamento a destra
      u8g2.setFont(u8g2_font_5x7_tr);
      u8g2.drawStr(37, 51, "SOS! DI': \"STO BENE\"");

      u8g2.drawFrame(37, 54, 87, 6);
      int clampedSec = (sosCountdown > 30) ? 30 : ((sosCountdown < 0) ? 0 : sosCountdown);
      int fillW = (clampedSec * 83) / 30;
      if (fillW > 0) {
        u8g2.drawBox(39, 56, fillW, 2);
      }

    } else if (sosState == 2) {
      // Falso positivo annullato dall'utente
      u8g2.drawFrame(0, 42, 128, 22);
      u8g2.drawBox(2, 44, 24, 18);
      u8g2.setDrawColor(0);
      u8g2.setFont(u8g2_font_helvB08_tr);
      u8g2.drawStr(6, 57, "OK");
      u8g2.setDrawColor(1);

      u8g2.setFont(u8g2_font_5x7_tr);
      u8g2.drawStr(30, 51, "ALLARME ANNULLATO");
      u8g2.drawStr(30, 61, "FALSO POSITIVO OK");

    } else {
      // SOS Inviato ai contatti
      if ((animTick / 3) % 2 == 0) {
        u8g2.drawFrame(0, 42, 128, 22);
      }
      u8g2.drawBox(2, 44, 28, 18);
      u8g2.setDrawColor(0);
      u8g2.setFont(u8g2_font_helvB08_tr);
      u8g2.drawStr(5, 57, "SOS");
      u8g2.setDrawColor(1);

      u8g2.setFont(u8g2_font_5x7_tr);
      u8g2.drawStr(34, 51, "EMERGENZA INVIATA!");
      u8g2.drawStr(34, 61, "GPS AI CONTATTI");
    }
    return;
  }

  if (callState >= 1 && callState <= 5) {
    // --- PRIORITÀ 2: CHIAMATA TELEFONICA (TUTTI I 5 SCENARI) ---
    if ((callState == 1 || callState == 5) && ((animTick / 4) % 2 == 0)) {
      u8g2.drawFrame(0, 42, 128, 22);
    } else {
      drawHudBrackets(0, 42, 128, 22, 5);
      u8g2.drawHLine(0, 42, 128);
    }

    int cx = 11;
    int cy = 53;

    if (callState == 1 || callState == 4) {
      // Icona onde radio compatta (In Arrivo / In Uscita)
      u8g2.drawDisc(cx, cy, 2);
      int r = 4 + ((animTick / 2) % 5);
      u8g2.drawCircle(cx, cy, r);
    } else if (callState == 2) {
      // Mini equalizzatore a 3 bande (In Chiamata)
      for (int i = 0; i < 3; i++) {
        int ph = (animTick + i * 3) % 6;
        int bh = 4 + ((ph < 3) ? (ph * 3) : ((6 - ph) * 3));
        u8g2.drawBox(4 + i * 5, cy - (bh / 2), 3, bh);
      }
    } else if (callState == 3) {
      // Icona X (Chiamata Terminata)
      u8g2.drawCircle(cx, cy, 6);
      u8g2.drawLine(cx - 3, cy - 3, cx + 3, cy + 3);
      u8g2.drawLine(cx + 3, cy - 3, cx - 3, cy + 3);
    } else if (callState == 5) {
      // Icona ! (Chiamata Persa)
      u8g2.drawFrame(cx - 5, cy - 6, 11, 13);
      u8g2.drawVLine(cx, cy - 4, 5);
      u8g2.drawPixel(cx, cy + 3);
    }

    u8g2.setFont(u8g2_font_5x7_tr);
    if (callState == 1) {
      String nameStr = getScrollingCaller(callerId, 12);
      char line1[28];
      snprintf(line1, sizeof(line1), "ARRIVO: %s", nameStr.c_str());
      u8g2.drawStr(22, 51, line1);
      u8g2.drawStr(22, 61, "DI': RISPONDI / RIFIUTA");

    } else if (callState == 2) {
      String nameStr = getScrollingCaller(callerId, 11);
      unsigned long elapsedSec = (millis() - callActiveStartMs) / 1000;
      char line1[28];
      snprintf(line1, sizeof(line1), "%s", nameStr.c_str());
      u8g2.drawStr(22, 51, line1);

      char timerBuf[10];
      snprintf(timerBuf, sizeof(timerBuf), "%02lu:%02lu", elapsedSec / 60, elapsedSec % 60);
      int tw = u8g2.getStrWidth(timerBuf);
      u8g2.drawStr(125 - tw, 51, timerBuf);

      u8g2.drawStr(22, 61, "ATTIVA | DI': CHIUDI");

    } else if (callState == 4) {
      String nameStr = getScrollingCaller(callerId, 12);
      char line1[28];
      snprintf(line1, sizeof(line1), "CHIAMO: %s", nameStr.c_str());
      u8g2.drawStr(22, 51, line1);
      u8g2.drawStr(22, 61, "USCITA | DI': CHIUDI");

    } else if (callState == 3) {
      String nameStr = getScrollingCaller(callerId, 16);
      u8g2.drawStr(22, 51, "CHIAMATA TERMINATA");
      u8g2.drawStr(22, 61, nameStr.c_str());

    } else if (callState == 5) {
      String nameStr = getScrollingCaller(callerId, 16);
      u8g2.drawStr(22, 51, "CHIAMATA PERSA");
      u8g2.drawStr(22, 61, nameStr.c_str());
    }
    return;
  }

  if (isVoiceListening) {
    // --- PRIORITÀ 3: ASSISTENTE VOCALE ("HEY CASCO") ---
    drawHudBrackets(0, 42, 128, 22, 5);
    u8g2.drawHLine(0, 42, 128);

    for (int i = 0; i < 4; i++) {
      int ph = (animTick + i * 2) % 8;
      int bh = 4 + ((ph < 4) ? (ph * 3) : ((8 - ph) * 3));
      u8g2.drawBox(5 + i * 5, 53 - (bh / 2), 3, bh);
    }

    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(28, 51, "ASSISTENTE VOCALE");
    u8g2.drawStr(28, 61, "TI ASCOLTO... PARLA");
    return;
  }

  if (intercomSpeaker.length() > 0) {
    // --- PRIORITÀ 4: INTERFONO COMPAGNI ---
    drawHudBrackets(0, 42, 128, 22, 5);
    u8g2.drawHLine(0, 42, 128);

    u8g2.drawDisc(11, 53, 2);
    u8g2.drawCircle(11, 53, 4 + ((animTick / 3) % 4));

    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(22, 51, "INTERFONO ATTIVO");
    String spk = getScrollingCaller(intercomSpeaker, 18);
    u8g2.drawStr(22, 61, spk.c_str());
  }
}

// =============================================================
// SCHERMATA STANDBY / IDLE ANIMATA
// =============================================================
void renderIdleScreen() {
  u8g2.clearBuffer();
  u8g2.setDrawColor(1);

  bool secondaryActive = hasSecondaryOverlay();

  drawHudBrackets(0, 0, 128, 64, 7);

  u8g2.setFont(u8g2_font_5x7_tr);
  if (deviceConnected) {
    u8g2.drawDisc(9, 6, 2);
    u8g2.drawCircle(9, 6, 4);
    u8g2.drawStr(17, 9, "BLE LINKED");
  } else {
    u8g2.drawDisc(9, 6, 1);
    int r = (animTick / 2) % 5;
    if (r > 1) u8g2.drawCircle(9, 6, r);
    u8g2.drawStr(17, 9, "BLE SCAN...");
  }
  u8g2.drawStr(103, 9, "v4.5");

  u8g2.drawHLine(6, 12, 46);
  u8g2.drawHLine(76, 12, 46);
  u8g2.drawPixel(64, 12);

  u8g2.setFont(u8g2_font_helvB18_tr);
  const char* title = "AiRide";
  int titleW = u8g2.getStrWidth(title);
  u8g2.drawStr((128 - titleW) / 2, secondaryActive ? 34 : 36, title);

  if (secondaryActive) {
    // Mostra il widget secondario compatto nel dock inferiore (y = 42..63)
    drawSecondaryHudDock();
  } else {
    int trackX = 24;
    int trackW = 80;
    u8g2.drawHLine(trackX, 42, trackW);
    int cycle = animTick % 40;
    int pos = (cycle < 20) ? cycle : (40 - cycle);
    int scannerX = trackX + (pos * (trackW - 18)) / 20;
    u8g2.drawBox(scannerX, 41, 18, 3);

    u8g2.drawHLine(6, 51, 116);
    u8g2.setFont(u8g2_font_5x7_tr);

    if (lockedTotalMeters > 0 || globalRunMeters > 0) {
      char totBuf[16], runBuf[16], lineBuf[36];
      formatCompactDist(lockedTotalMeters, totBuf, sizeof(totBuf));
      formatCompactDist(globalRunMeters, runBuf, sizeof(runBuf));
      snprintf(lineBuf, sizeof(lineBuf), "TOT:%s   RIM:%s", totBuf, runBuf);
      int lw = u8g2.getStrWidth(lineBuf);
      u8g2.drawStr((128 - lw) / 2, 60, lineBuf);
    } else {
      const char* msg = deviceConnected ? "READY - AWAITING ROUTE" : "WAITING FOR PHONE APP";
      int mw = u8g2.getStrWidth(msg);
      u8g2.drawStr((128 - mw) / 2, 60, msg);
    }
  }

  u8g2.sendBuffer();
}

// =============================================================
// DISEGNO FRECCE VETTORIALI TATTICHE (8 DIREZIONI ANIMATE)
// =============================================================
void drawTacticalArrow(int dir, bool isUrgent, int cy) {
  int cx = 23;

  if (isUrgent && ((animTick / 4) % 2 == 0)) {
    drawHudBrackets(2, 2, 42, (cy <= 21) ? 38 : 44, 6);
  }

  int shift = (animTick / 2) % 5;

  if (dir == 0) {        // 0: SVOLTA A DESTRA (→)
    int x = cx + shift - 2;
    u8g2.drawTriangle(x + 14, cy, x - 2, cy - 13, x - 2, cy + 13);
    u8g2.setDrawColor(0);
    u8g2.drawTriangle(x + 6, cy, x - 3, cy - 8, x - 3, cy + 8);
    u8g2.setDrawColor(1);
    u8g2.drawTriangle(x + 2, cy, x - 10, cy - 10, x - 10, cy + 10);
    u8g2.setDrawColor(0);
    u8g2.drawTriangle(x - 3, cy, x - 11, cy - 6, x - 11, cy + 6);
    u8g2.setDrawColor(1);

  } else if (dir == 1) { // 1: SVOLTA A SINISTRA (←)
    int x = cx - shift + 2;
    u8g2.drawTriangle(x - 14, cy, x + 2, cy - 13, x + 2, cy + 13);
    u8g2.setDrawColor(0);
    u8g2.drawTriangle(x - 6, cy, x + 3, cy - 8, x + 3, cy + 8);
    u8g2.setDrawColor(1);
    u8g2.drawTriangle(x - 2, cy, x + 10, cy - 10, x + 10, cy + 10);
    u8g2.setDrawColor(0);
    u8g2.drawTriangle(x + 3, cy, x + 11, cy - 6, x + 11, cy + 6);
    u8g2.setDrawColor(1);

  } else if (dir == 2) { // 2: PROSEGUI DRITTO (↑)
    int y = cy - shift + 2;
    u8g2.drawTriangle(cx, y - 14, cx - 14, y + 2, cx + 14, y + 2);
    u8g2.setDrawColor(0);
    u8g2.drawTriangle(cx, y - 6, cx - 9, y + 3, cx + 9, y + 3);
    u8g2.setDrawColor(1);
    u8g2.drawTriangle(cx, y - 1, cx - 11, y + 12, cx + 11, y + 12);
    u8g2.setDrawColor(0);
    u8g2.drawTriangle(cx, y + 5, cx - 7, y + 13, cx + 7, y + 13);
    u8g2.setDrawColor(1);

  } else if (dir == 3) { // 3: INVERSIONE A U (↶)
    u8g2.drawCircle(cx + 2, cy - 4, 9, U8G2_DRAW_UPPER_LEFT | U8G2_DRAW_UPPER_RIGHT);
    u8g2.drawCircle(cx + 2, cy - 4, 8, U8G2_DRAW_UPPER_LEFT | U8G2_DRAW_UPPER_RIGHT);
    u8g2.drawCircle(cx + 2, cy - 4, 7, U8G2_DRAW_UPPER_LEFT | U8G2_DRAW_UPPER_RIGHT);
    u8g2.drawBox(cx + 9, cy - 4, 3, 15);
    u8g2.drawBox(cx - 7, cy - 4, 3, 9 + (shift / 2));
    int tipY = cy + 11 + (shift / 2);
    u8g2.drawTriangle(cx - 6, tipY, cx - 13, tipY - 7, cx + 1, tipY - 7);

  } else if (dir == 5) { // 5: MANTIENI LA DESTRA / BIVIO DX (↗)
    int d = (shift / 2);
    u8g2.drawTriangle(cx + 12 + d, cy - 12 - d, cx - 2 + d, cy - 12 - d, cx + 12 + d, cy + 2 - d);
    for (int t = -2; t <= 2; t++) {
      u8g2.drawLine(cx - 11 + t, cy + 12, cx + 6 + t + d, cy - 4 - d);
    }

  } else if (dir == 6) { // 6: MANTIENI LA SINISTRA / BIVIO SX (↖)
    int d = (shift / 2);
    u8g2.drawTriangle(cx - 12 - d, cy - 12 - d, cx + 2 - d, cy - 12 - d, cx - 12 - d, cy + 2 - d);
    for (int t = -2; t <= 2; t++) {
      u8g2.drawLine(cx + 11 + t, cy + 12, cx - 6 + t - d, cy - 4 - d);
    }

  } else if (dir == 7) { // 7: ROTONDA / ROTATORIA (⟳)
    u8g2.drawCircle(cx, cy, 10);
    u8g2.drawCircle(cx, cy, 11);
    u8g2.drawBox(cx - 2, cy + 11, 5, 5);
    int ext = (shift / 2);
    u8g2.drawLine(cx + 8, cy - 8, cx + 13 + ext, cy - 13 - ext);
    u8g2.drawLine(cx + 9, cy - 7, cx + 14 + ext, cy - 12 - ext);
    u8g2.drawTriangle(
      cx + 14 + ext, cy - 14 - ext,
      cx + 7 + ext,  cy - 14 - ext,
      cx + 14 + ext, cy - 7 - ext
    );
    u8g2.drawDisc(cx, cy, 2);

  } else {               // 4: ARRIVO A DESTINAZIONE (Mirino Tattico Pulsante)
    u8g2.drawCircle(cx, cy, 13);
    int pulseR = 4 + ((animTick / 2) % 8);
    u8g2.drawCircle(cx, cy, pulseR);
    u8g2.drawDisc(cx, cy, 3);
    u8g2.drawHLine(cx - 16, cy, 4);
    u8g2.drawHLine(cx + 13, cy, 4);
    u8g2.drawVLine(cx, cy - 16, 4);
    u8g2.drawVLine(cx, cy + 13, 4);
  }
}

// =============================================================
// SCHERMATA DI NAVIGAZIONE ATTIVA (CON DOCK SECONDARIO INTEGRATO)
// =============================================================
void renderNavigationScreen(int dir, long meters) {
  u8g2.clearBuffer();
  u8g2.setDrawColor(1);

  bool secondaryActive = hasSecondaryOverlay();
  bool isUrgent = (meters > 0 && meters <= 50 && dir != 2);

  // 1. FRECCIA DI NAVIGAZIONE SEMPRE VISIBILE A SINISTRA
  drawTacticalArrow(dir, isUrgent, secondaryActive ? 21 : 25);

  if (secondaryActive) {
    u8g2.drawVLine(47, 2, 38);
  } else {
    u8g2.drawVLine(47, 2, 41);
    u8g2.drawLine(47, 43, 42, 48);
  }

  // 2. HEADER MANOVRA + ICONA PROSSIMA SVOLTA SEMPRE VISIBILI IN ALTO A DESTRA
  u8g2.setFont(u8g2_font_5x7_tr);
  const char* dirLabel = "ARRIVO";
  if      (dir == 0) dirLabel = "SVOLTA DX";
  else if (dir == 1) dirLabel = "SVOLTA SX";
  else if (dir == 2) dirLabel = "DRITTO";
  else if (dir == 3) dirLabel = "INVERSIONE";
  else if (dir == 5) dirLabel = "TIENI DX";
  else if (dir == 6) dirLabel = "TIENI SX";
  else if (dir == 7) dirLabel = "ROTONDA";

  u8g2.drawStr(52, 8, dirLabel);
  if (nextTurnDir >= 0 && nextTurnDir <= 7) {
    drawMiniNextIcon(110, 1, nextTurnDir);
  }

  if (deviceConnected) {
    u8g2.drawDisc(124, 4, 2);
  } else if ((animTick / 5) % 2 == 0) {
    u8g2.drawCircle(124, 4, 2);
  }

  // 3. DISTANZA ALLA SVOLTA SEMPRE VISIBILE AL CENTRO-DESTRA
  char numBuf[12];
  const char* unitStr = "m";

  if (meters >= 1000) {
    float km = meters / 1000.0f;
    snprintf(numBuf, sizeof(numBuf), "%.1f", km);
    unitStr = "km";
  } else {
    snprintf(numBuf, sizeof(numBuf), "%ld", meters);
    unitStr = "m";
  }

  u8g2.setFont(u8g2_font_helvB18_tr);
  int numW = u8g2.getStrWidth(numBuf);

  u8g2.setFont(u8g2_font_helvB08_tr);
  int unitW = u8g2.getStrWidth(unitStr);

  int totalTextW = numW + 3 + unitW;
  int startX = 51 + (76 - totalTextW) / 2;
  if (startX < 51) startX = 51;

  int distBaseY = secondaryActive ? 31 : 34;

  u8g2.setFont(u8g2_font_helvB18_tr);
  u8g2.drawStr(startX, distBaseY, numBuf);

  u8g2.setFont(u8g2_font_helvB08_tr);
  u8g2.drawStr(startX + numW + 3, distBaseY, unitStr);

  // Barra di avvicinamento alla svolta
  int barX = 53;
  int barY = secondaryActive ? 35 : 41;
  int barW = 72;
  int barH = secondaryActive ? 4 : 5;
  u8g2.drawFrame(barX, barY, barW, barH);

  if (meters <= 300) {
    long clamped = (meters < 0) ? 0 : meters;
    int fillW = (int)(((300 - clamped) * (barW - 4)) / 300);
    if (fillW > 0) {
      u8g2.drawBox(barX + 2, barY + 1, fillW, barH - 2);
    }
  } else {
    int pos = (animTick * 2) % (barW - 14);
    u8g2.drawBox(barX + 2 + pos, barY + 1, 10, barH - 2);
  }

  // 4. ZONA INFERIORE: DOCK SECONDARIO (CHIAMATE / AIRESCUE / VOCE) OPPURE TELEMETRIA
  if (secondaryActive) {
    drawSecondaryHudDock();
  } else {
    u8g2.drawHLine(0, 50, 128);

    char totStr[12], runStr[12];
    formatCompactDist(lockedTotalMeters, totStr, sizeof(totStr));
    formatCompactDist(globalRunMeters, runStr, sizeof(runStr));

    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(2, 59, "TOT:");
    u8g2.setFont(u8g2_font_helvB08_tr);
    u8g2.drawStr(24, 60, totStr);

    u8g2.drawVLine(64, 52, 8);

    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(69, 59, "RIM:");
    u8g2.setFont(u8g2_font_helvB08_tr);
    u8g2.drawStr(91, 60, runStr);

    if (lockedTotalMeters > 0) {
      long doneMeters = lockedTotalMeters - globalRunMeters;
      if (doneMeters < 0) doneMeters = 0;
      long prog = (doneMeters * 128L) / lockedTotalMeters;
      if (prog > 128) prog = 128;
      if (prog > 0) {
        u8g2.drawBox(0, 62, (int)prog, 2);
      }
    }
  }

  u8g2.sendBuffer();
}
