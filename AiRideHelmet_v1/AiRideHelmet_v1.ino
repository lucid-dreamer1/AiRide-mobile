/*
 * =============================================================
 *  AiRide Helmet Firmware - v1.0
 *  Arduino Nano ESP32 + SSD1306 OLED (SPI)
 * 
 *  Due servizi BLE coesistenti:
 *   1) Nordic UART Service  -> ricezione istruzioni di navigazione
 *   2) OTA Service          -> aggiornamento firmware via BLE
 * 
 *  --- PARTITION TABLE RICHIESTA ---
 *  Crea il file "partitions.csv" nella root del progetto:
 * 
 *    # Name,   Type, SubType, Offset,  Size
 *    nvs,      data, nvs,     0x9000,  0x5000
 *    otadata,  data, ota,     0xe000,  0x2000
 *    app0,     app,  ota_0,   0x10000, 0x180000
 *    app1,     app,  ota_1,   0x190000,0x180000
 *    spiffs,   data, spiffs,  0x310000,0xF0000
 * 
 *  In platformio.ini aggiungi:
 *    board_build.partitions = partitions.csv
 *    board_build.flash_size = 8MB
 * 
 *  Per abilitare il rollback automatico in sdkconfig / menuconfig:
 *    CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y
 * =============================================================
 */

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Fonts/FreeSansBold12pt7b.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <Update.h>
#include <esp_ota_ops.h>

// =============================================================
// CONFIGURAZIONE PIN OLED (Arduino Nano ESP32 - SPI)
// Collegamenti come da schema originale:
//   DIN  -> D11 (MOSI / GPIO 11)
//   CLK  -> D13 (SCK  / GPIO 13)
//   CS   -> D10 (SS   / GPIO 10)
//   DC   -> D9  (GPIO 9)
//   RST  -> D8  (GPIO 8)
// =============================================================
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_MOSI     11  // DIN  (D11 / MOSI)
#define OLED_CLK      13  // CLK  (D13 / SCK)
#define OLED_DC       9   // DC   (D9)
#define OLED_CS       10  // CS   (D10 / SS)
#define OLED_RESET    8   // RST  (D8)

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT,
                          OLED_MOSI, OLED_CLK, OLED_DC,
                          OLED_RESET, OLED_CS);

// =============================================================
// UUID SERVIZIO 1 - Nordic UART Service (navigazione)
// =============================================================
#define NAV_SERVICE_UUID    "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NAV_CHAR_RX_UUID    "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"

// =============================================================
// UUID SERVIZIO 2 - OTA Service
// DEVONO combaciare con BleOtaService.ts dell'app mobile
// =============================================================
#define OTA_SERVICE_UUID    "e2697de0-5fae-4a6e-9b3d-21c7f3e4a8b2"
#define OTA_CONTROL_UUID    "e2697de1-5fae-4a6e-9b3d-21c7f3e4a8b2"  // Write + Notify
#define OTA_DATA_UUID       "e2697de2-5fae-4a6e-9b3d-21c7f3e4a8b2"  // Write Without Response

// =============================================================
// OPCODE PROTOCOLLO OTA (concordato con app mobile)
// =============================================================
// App -> ESP32 (via Control Write):
#define CMD_START   0x01  // + 4 byte uint32 LE = firmware size
#define CMD_END     0x02  // verifica e riavvia
#define CMD_ABORT   0x03  // annulla

// ESP32 -> App (via Control Notify):
#define RESP_READY    0x10  // pronto, in attesa di CMD_START
#define RESP_OK_START 0x11  // Update.begin OK, inizia streaming
#define RESP_PROGRESS 0x12  // + 4 byte uint32 LE = bytes ricevuti
#define RESP_SUCCESS  0x13  // Update.end OK, riavvio in corso
#define RESP_ERROR    0x14  // + 1 byte error code

// Codici errore OTA
#define ERR_BEGIN_FAILED    0x01
#define ERR_WRITE_FAILED    0x02
#define ERR_END_FAILED      0x03
#define ERR_SIZE_MISMATCH   0x04
#define ERR_NOT_STARTED     0x05

// =============================================================
// VARIABILI GLOBALI
// =============================================================
BLEServer*          pServer         = NULL;
BLECharacteristic*  pOtaControl     = NULL;
bool                deviceConnected = false;

// - Navigazione -
String        navBuffer    = "";
unsigned long lastCharTime = 0;
const unsigned long PACKET_TIMEOUT = 100;
unsigned long lastDisplayUpdate    = 0;
const unsigned long IDLE_TIMEOUT   = 20000;
long  lockedTotalMeters = 0;
bool  isTotalLocked     = false;
long  globalRunMeters   = 0;

// - OTA -
volatile bool   otaInProgress   = false;
volatile size_t otaExpectedSize = 0;
volatile size_t otaBytesWritten = 0;

const size_t PROGRESS_NOTIFY_INTERVAL = 4096;
size_t       lastProgressNotify       = 0;

// =============================================================
// HELPER: invia notify sulla Control characteristic OTA
// =============================================================
void otaNotify(uint8_t* data, size_t len) {
  if (!deviceConnected || !pOtaControl) return;
  pOtaControl->setValue(data, len);
  pOtaControl->notify();
}

void otaNotifyByte(uint8_t opcode) {
  otaNotify(&opcode, 1);
}

void otaNotifyError(uint8_t errorCode) {
  uint8_t buf[2] = { RESP_ERROR, errorCode };
  otaNotify(buf, 2);
}

void otaNotifyProgress(size_t bytesReceived) {
  uint8_t buf[5];
  buf[0] = RESP_PROGRESS;
  buf[1] = (bytesReceived >>  0) & 0xFF;
  buf[2] = (bytesReceived >>  8) & 0xFF;
  buf[3] = (bytesReceived >> 16) & 0xFF;
  buf[4] = (bytesReceived >> 24) & 0xFF;
  otaNotify(buf, 5);
}

// =============================================================
// CALLBACK - Connessione/Disconnessione BLE
// =============================================================
class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    Serial.println("[BLE] App connessa!");
    delay(300);
    otaNotifyByte(RESP_READY);
  }

  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    Serial.println("[BLE] App disconnessa. Riavvio advertising...");

    if (otaInProgress) {
      Serial.println("[OTA] Connessione persa durante OTA. Abort.");
      Update.abort();
      otaInProgress   = false;
      otaExpectedSize = 0;
      otaBytesWritten = 0;
      showIdleScreen();
    }

    BLEDevice::startAdvertising();
  }
};

// =============================================================
// CALLBACK - RX Navigazione (Nordic UART)
// =============================================================
class NavRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    if (otaInProgress) return;

    std::string rxValue = pCharacteristic->getValue();
    if (rxValue.length() == 0) return;

    for (size_t i = 0; i < rxValue.length(); i++) {
      char c = rxValue[i];
      if (c == '\n' || c == '\r') continue;
      navBuffer += c;
      lastCharTime = millis();
    }
  }
};

// =============================================================
// CALLBACK - Control OTA (Write + Notify)
// =============================================================
class OtaControlCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    std::string raw = pCharacteristic->getValue();
    if (raw.length() == 0) return;

    uint8_t opcode = (uint8_t)raw[0];

    switch (opcode) {

      case CMD_START: {
        if (raw.length() < 5) {
          Serial.println("[OTA] CMD_START malformato (attesi 5 byte)");
          otaNotifyError(ERR_BEGIN_FAILED);
          return;
        }

        size_t fwSize =  ((uint8_t)raw[1])
                      | (((uint8_t)raw[2]) << 8)
                      | (((uint8_t)raw[3]) << 16)
                      | (((uint8_t)raw[4]) << 24);

        Serial.printf("[OTA] CMD_START - size attesa: %u bytes\n", fwSize);

        if (Update.isRunning()) Update.abort();

        if (!Update.begin(fwSize)) {
          Serial.printf("[OTA] Update.begin fallito: %s\n", Update.errorString());
          otaNotifyError(ERR_BEGIN_FAILED);
          return;
        }

        otaInProgress      = true;
        otaExpectedSize    = fwSize;
        otaBytesWritten    = 0;
        lastProgressNotify = 0;

        Serial.println("[OTA] Update.begin OK - in attesa dello streaming...");
        showOtaScreen(0);
        otaNotifyByte(RESP_OK_START);
        break;
      }

      case CMD_END: {
        if (!otaInProgress) {
          Serial.println("[OTA] CMD_END ricevuto ma OTA non attivo");
          otaNotifyError(ERR_NOT_STARTED);
          return;
        }

        Serial.printf("[OTA] CMD_END - scritti %u / %u byte\n",
                      otaBytesWritten, otaExpectedSize);

        if (!Update.end(true)) {
          Serial.printf("[OTA] Update.end fallito: %s\n", Update.errorString());
          otaNotifyError(ERR_END_FAILED);
          otaInProgress = false;
          return;
        }

        Serial.println("[OTA] Firmware aggiornato! Invio SUCCESS e riavvio...");
        showOtaSuccessScreen();
        otaNotifyByte(RESP_SUCCESS);

        delay(800);
        ESP.restart();
        break;
      }

      case CMD_ABORT: {
        Serial.println("[OTA] CMD_ABORT ricevuto.");
        if (Update.isRunning()) Update.abort();
        otaInProgress   = false;
        otaExpectedSize = 0;
        otaBytesWritten = 0;
        showIdleScreen();
        break;
      }

      default:
        Serial.printf("[OTA] Opcode sconosciuto: 0x%02X\n", opcode);
        break;
    }
  }
};

// =============================================================
// CALLBACK - Data OTA (Write Without Response)
// =============================================================
class OtaDataCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    if (!otaInProgress) return;

    std::string chunk = pCharacteristic->getValue();
    if (chunk.length() == 0) return;

    size_t written = Update.write(
      (uint8_t*)chunk.c_str(),
      chunk.length()
    );

    if (written != chunk.length()) {
      Serial.printf("[OTA] Errore write: %u su %u byte. %s\n",
                    written, chunk.length(), Update.errorString());
      Update.abort();
      otaNotifyError(ERR_WRITE_FAILED);
      otaInProgress = false;
      showIdleScreen();
      return;
    }

    otaBytesWritten += written;

    if (otaBytesWritten - lastProgressNotify >= PROGRESS_NOTIFY_INTERVAL) {
      lastProgressNotify = otaBytesWritten;
      otaNotifyProgress(otaBytesWritten);

      if (otaExpectedSize > 0) {
        int pct = (int)((otaBytesWritten * 100UL) / otaExpectedSize);
        showOtaScreen(pct);
      }
    }

    vTaskDelay(1);
  }
};

// =============================================================
// SETUP
// =============================================================
void setup() {
  Serial.begin(115200);
  navBuffer.reserve(64);

  // --- Display SPI ---
  SPI.begin();

  if (!display.begin(SSD1306_SWITCHCAPVCC)) {
    Serial.println(F("[OLED] Errore inizializzazione SPI"));
    while (1);
  }
  display.clearDisplay();
  showIdleScreen();

  // --- Rollback ---
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t   ota_state;
  if (esp_ota_get_state_partition(running, &ota_state) == ESP_OK) {
    if (ota_state == ESP_OTA_IMG_PENDING_VERIFY) {
      Serial.println("[OTA] Nuovo firmware in verifica - marcato come valido.");
      esp_ota_mark_app_valid_cancel_rollback();
    }
  }

  // --- BLE ---
  BLEDevice::init("AiRide Helmet");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // - Servizio 1: Nordic UART (navigazione) -
  BLEService* pNavService = pServer->createService(NAV_SERVICE_UUID);
  BLECharacteristic* pNavRx = pNavService->createCharacteristic(
    NAV_CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  pNavRx->setCallbacks(new NavRxCallbacks());
  pNavService->start();

  // - Servizio 2: OTA -
  BLEService* pOtaService = pServer->createService(OTA_SERVICE_UUID);

  pOtaControl = pOtaService->createCharacteristic(
    OTA_CONTROL_UUID,
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pOtaControl->addDescriptor(new BLE2902());
  pOtaControl->setCallbacks(new OtaControlCallbacks());

  BLECharacteristic* pOtaData = pOtaService->createCharacteristic(
    OTA_DATA_UUID,
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  pOtaData->setCallbacks(new OtaDataCallbacks());

  pOtaService->start();

  // - Advertising -
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
// LOOP
// =============================================================
void loop() {
  if (otaInProgress) {
    delay(10);
    return;
  }

  if (navBuffer.length() > 0 && millis() - lastCharTime > PACKET_TIMEOUT) {
    handleNavPacket(navBuffer);
    navBuffer = "";
  }

  if (millis() - lastDisplayUpdate > IDLE_TIMEOUT) {
    showIdleScreen();
  }
}

// =============================================================
// LOGICA NAVIGAZIONE
// =============================================================
long safeParseLong(String s) {
  String clean = "";
  clean.reserve(10);
  for (unsigned int i = 0; i < s.length(); ++i) {
    char ch = s.charAt(i);
    if (isDigit(ch)) clean += ch;
  }
  if (clean.length() == 0) return 0;
  return clean.toInt();
}

void handleNavPacket(String packet) {
  packet.trim();
  int p1 = packet.indexOf('|');
  if (p1 == -1) return;

  String dirStr = packet.substring(0, p1);
  int    p2     = packet.indexOf('|', p1 + 1);
  String metersStr, totalStr = "", runStr = "";

  if (p2 == -1) {
    metersStr = packet.substring(p1 + 1);
  } else {
    metersStr = packet.substring(p1 + 1, p2);
    int p3 = packet.indexOf('|', p2 + 1);
    if (p3 == -1) {
      totalStr = packet.substring(p2 + 1);
    } else {
      totalStr = packet.substring(p2 + 1, p3);
      runStr   = packet.substring(p3 + 1);
    }
  }

  int  dir    = dirStr.toInt();
  long meters = safeParseLong(metersStr);
  long total  = safeParseLong(totalStr);
  long run    = safeParseLong(runStr);

  if (!isTotalLocked && total > 0) {
    lockedTotalMeters = total;
    isTotalLocked = true;
  }
  if (run > 0) globalRunMeters = run;

  drawNavigation(dir, meters);
}

// =============================================================
// SCHERMATE DISPLAY
// =============================================================
void showIdleScreen() {
  display.clearDisplay();
  display.setFont(NULL);
  display.setTextSize(2);
  display.setTextColor(WHITE);
  display.setCursor(18, 24);
  display.print(F("AiRide v1.0"));
  display.display();
  lastDisplayUpdate = millis();
}

void showOtaScreen(int percent) {
  display.clearDisplay();
  display.setFont(NULL);
  display.setTextColor(WHITE);

  display.setTextSize(1);
  display.setCursor(14, 4);
  display.print(F("Aggiornamento OTA"));

  display.setTextSize(2);
  char pctBuf[5];
  snprintf(pctBuf, sizeof(pctBuf), "%d%%", percent);
  int pctX = 64 - (strlen(pctBuf) * 12) / 2;
  display.setCursor(pctX, 22);
  display.print(pctBuf);

  display.drawRect(4, 46, 120, 10, WHITE);
  int fillW = (int)(120 * percent / 100);
  if (fillW > 0) display.fillRect(4, 46, fillW, 10, WHITE);

  display.setTextSize(1);
  display.setCursor(12, 58);
  display.print(F("Non spegnere!"));

  display.display();
}

void showOtaSuccessScreen() {
  display.clearDisplay();
  display.setFont(NULL);
  display.setTextColor(WHITE);
  display.setTextSize(1);
  display.setCursor(25, 14);
  display.print(F("Aggiornato!"));
  display.setTextSize(2);
  display.setCursor(48, 28);
  display.print(F(":)"));
  display.setTextSize(1);
  display.setCursor(16, 52);
  display.print(F("Riavvio in corso..."));
  display.display();
}

// =============================================================
// GRAFICA NAVIGAZIONE
// =============================================================
void printCompactDistance(long meters) {
  if (meters >= 1000) {
    display.print(meters / 1000);
    display.print(F("."));
    display.print((meters % 1000) / 100);
    display.print(F("k"));
  } else {
    display.print(meters);
  }
}

void drawArrowModern(int dir) {
  int cx = 25;
  int cy = SCREEN_HEIGHT / 2 - 4;

  if (dir == 0) {        // DESTRA
    display.fillTriangle(cx+15, cy, cx, cy-15, cx, cy+15, WHITE);
    display.fillRect(cx-15, cy-6, 15, 12, WHITE);
  } else if (dir == 1) { // SINISTRA
    display.fillTriangle(cx-15, cy, cx, cy-15, cx, cy+15, WHITE);
    display.fillRect(cx, cy-6, 15, 12, WHITE);
  } else if (dir == 2) { // SU (dritto)
    display.fillTriangle(cx, cy-15, cx-15, cy, cx+15, cy, WHITE);
    display.fillRect(cx-6, cy, 12, 15, WHITE);
  } else if (dir == 3) { // GIU (dietrofront)
    display.fillTriangle(cx, cy+15, cx-15, cy, cx+15, cy, WHITE);
    display.fillRect(cx-6, cy-15, 12, 15, WHITE);
  } else {               // Arrivo / cerchio
    display.fillCircle(cx, cy, 10, WHITE);
  }
}

void drawNavigation(int dir, long meters) {
  display.clearDisplay();
  drawArrowModern(dir);

  display.setTextColor(WHITE);
  display.setFont(&FreeSansBold12pt7b);

  int cursorX = 55;
  int cursorY = 40;

  if (meters >= 1000) {
    float km = meters / 1000.0;
    if (km >= 10.0) cursorX -= 5;
    display.setCursor(cursorX, cursorY);
    display.print(km, 1);
    display.setFont(NULL);
    display.setTextSize(1);
    display.setCursor(cursorX + (km >= 10.0 ? 55 : 45), 32);
    display.print(F("km"));
  } else {
    if (meters < 10)       cursorX += 20;
    else if (meters < 100) cursorX += 10;
    display.setCursor(cursorX, cursorY);
    display.print(meters);
    display.setFont(NULL);
    display.setTextSize(1);
    int unitX = 110;
    if (meters < 10)       unitX = 90;
    else if (meters < 100) unitX = 100;
    display.setCursor(unitX, 32);
    display.print(F("m"));
  }

  display.setFont(NULL);
  display.setTextSize(1);
  display.setCursor(32, 56);
  display.print(F("T:"));
  printCompactDistance(lockedTotalMeters);
  display.setCursor(90, 56);
  display.print(F("R:"));
  printCompactDistance(globalRunMeters);

  display.display();
  lastDisplayUpdate = millis();
}
