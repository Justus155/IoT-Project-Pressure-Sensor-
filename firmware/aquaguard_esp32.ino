// ============================================================
// AquaGuard — ESP32 Firmware
// Water Leakage & Overflow Prevention System
//
// Hardware: ESP32 + 2 pressure sensors + 5 LEDs + red LED + buzzer
// Comms:    WiFi → Supabase RPCs (sql/device_api.sql)
//
// Libraries: WiFiManager (tzapu), ArduinoJson v7
// ============================================================

#include <WiFi.h>
#include <WiFiManager.h>      // Captive portal
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ---------- Pin Definitions ----------
// Both sensors output up to 4.5–4.7 V; the ESP32 ADC tolerates 3.3 V max,
// so each signal MUST go through a voltage divider (see DIVIDER_RATIO).
#define SENSOR_UPSTREAM    34    // PETYS42 → ADC1_CH6
#define SENSOR_DOWNSTREAM  35    // MPX5700 → ADC1_CH7

#define LED_1   25
#define LED_2   26
#define LED_3   27
#define LED_4   14
#define LED_5   12               // Strapping pin: keep LOW at boot (LED to GND is fine)
#define LED_RED 13
#define BUZZER  15

// ---------- Configuration ----------
const char* SUPABASE_URL = "https://vtsqsqpkatarmfsntjoi.supabase.co";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0c3FzcXBrYXRhcm1mc250am9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MjEzMzYsImV4cCI6MjEwNTI5NzMzNn0.cQrDvMbfcA7_OPScc13LAt1OwKEEkSNubLl8_nbDNVQ";

// Must match a row in public.devices (sensor_id + pairing_code).
const char* DEVICE_SENSOR_ID = "S-01";
const char* DEVICE_CODE      = "482913";

// Optional: paste Supabase's root CA (PEM) here to verify the server.
// Left empty, TLS still encrypts but does not authenticate the server.
const char* ROOT_CA = "";

// ---------- Analog front-end ----------
// Divider ratio = (R1 + R2) / R2. 10k over 20k → 1.5 (4.5 V → 3.0 V).
const float DIVIDER_RATIO = 1.5;

// ---------- Thresholds (overwritten from Supabase on boot) ----------
float RANGE_MIN_PSI          = 0.0;    // LEAK_THRESHOLD.min_value
float RANGE_MAX_PSI          = 100.0;  // OVERFLOW_THRESHOLD.max_value
float OVERFLOW_THRESHOLD_PSI = 85.0;   // 85 % of range = website "Critical" zone
float LEAK_THRESHOLD_PSI     = 5.0;    // ΔP between sensors (local only)
float BASELINE_PSI           = 45.0;

// ---------- Timing ----------
const unsigned long SAMPLE_INTERVAL_MS  = 500;
const unsigned long UPLOAD_INTERVAL_MS  = 10000;   // 10 s
const unsigned long LEAK_CONFIRM_MS     = 3000;
const uint16_t      HTTP_TIMEOUT_MS     = 5000;
unsigned long lastSampleTime = 0;
unsigned long lastUploadTime = 0;

// ---------- State ----------
float currentPressureUpstream   = 0.0;
float currentPressureDownstream = 0.0;
float currentDeltaP             = 0.0;
bool  leakAlarm      = false;
bool  overflowAlarm  = false;

// ---------- Prototypes ----------
void setupPins();
void connectWiFi();
float readUpstreamPsi();
float readDownstreamPsi();
void readSensors();
void calibrateBaseline();
void updateLEDs();
void checkAlarms();
void updateAlarmOutputs();
void triggerAlert(const char* type, float value);
void clearAlert(const char* type);
bool callRpc(const char* fn, const String& body, String* response = nullptr);
void uploadReading(float psi);
void fetchThresholdsFromSupabase();

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n\n=== AquaGuard ESP32 Booting ===");

  setupPins();
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);   // ~0–3.1 V usable input range

  connectWiFi();
  fetchThresholdsFromSupabase();
  calibrateBaseline();

  Serial.println("=== Ready ===");
}

void loop() {
  unsigned long now = millis();

  // 1. Sample sensors every 500 ms
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    readSensors();
    updateLEDs();
    checkAlarms();
  }

  // 2. Upload to Supabase every 10 s
  if (now - lastUploadTime >= UPLOAD_INTERVAL_MS) {
    lastUploadTime = now;
    uploadReading(currentPressureUpstream);
  }

  delay(10);
}

// ============================================================
// SETUP HELPERS
// ============================================================
void setupPins() {
  pinMode(LED_1, OUTPUT);
  pinMode(LED_2, OUTPUT);
  pinMode(LED_3, OUTPUT);
  pinMode(LED_4, OUTPUT);
  pinMode(LED_5, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(LED_RED, LOW);
  digitalWrite(BUZZER, LOW);
}

void connectWiFi() {
  WiFiManager wifiManager;
  wifiManager.setConfigPortalTimeout(180); // 3-min timeout

  Serial.println("Starting WiFiManager…");
  if (!wifiManager.autoConnect("AquaGuard-Setup")) {
    Serial.println("WiFi failed — restarting");
    ESP.restart();
  }
  WiFi.setAutoReconnect(true);
  Serial.print("WiFi connected: ");
  Serial.println(WiFi.localIP());
}

// ============================================================
// SENSOR READING
// ============================================================
// Pin voltage (after divider) → sensor output voltage.
float sensorVolts(int pin) {
  return (analogReadMilliVolts(pin) / 1000.0) * DIVIDER_RATIO;
}

// PETYS42: assumed 0.5–4.5 V → 0–150 PSI. Check your datasheet.
float readUpstreamPsi() {
  float psi = (sensorVolts(SENSOR_UPSTREAM) - 0.5) * (150.0 / 4.0);
  return psi < 0 ? 0 : psi;
}

// MPX5700DP @ 5 V supply: Vout = 5 × (0.0012858 × kPa + 0.04) → 0.2–4.7 V for 0–700 kPa.
float readDownstreamPsi() {
  float kPa = (sensorVolts(SENSOR_DOWNSTREAM) / 5.0 - 0.04) / 0.0012858;
  float psi = kPa * 0.145038;
  return psi < 0 ? 0 : psi;
}

void readSensors() {
  currentPressureUpstream   = readUpstreamPsi();
  currentPressureDownstream = readDownstreamPsi();
  currentDeltaP = currentPressureUpstream - currentPressureDownstream;

  Serial.printf("P1=%.1f  P2=%.1f  dP=%.1f  PSI\n",
                currentPressureUpstream, currentPressureDownstream, currentDeltaP);
}

void calibrateBaseline() {
  Serial.println("Calibrating baseline (2 s)…");
  float sum = 0;
  int samples = 0;
  unsigned long start = millis();
  while (millis() - start < 2000) {
    sum += readUpstreamPsi();
    samples++;
    delay(50);
  }
  BASELINE_PSI = samples ? sum / samples : 0;
  Serial.printf("Baseline = %.1f PSI\n", BASELINE_PSI);
}

// ============================================================
// LED & ALARM LOGIC
// ============================================================
// Same pct-of-range mapping as updateLEDs() in javascript/dashboard.js.
void updateLEDs() {
  float span = RANGE_MAX_PSI - RANGE_MIN_PSI;
  if (span <= 0) span = 1;
  float pct = constrain((currentPressureUpstream - RANGE_MIN_PSI) / span, 0.0f, 1.0f);
  int litCount = constrain((int)round(pct * 5.0), 0, 5);

  digitalWrite(LED_1, litCount >= 1);
  digitalWrite(LED_2, litCount >= 2);
  digitalWrite(LED_3, litCount >= 3);
  digitalWrite(LED_4, litCount >= 4);
  digitalWrite(LED_5, litCount >= 5);
}

void checkAlarms() {
  // Leak: ΔP exceeds threshold continuously for LEAK_CONFIRM_MS
  static unsigned long leakStart = 0;
  if (currentDeltaP > LEAK_THRESHOLD_PSI) {
    if (leakStart == 0) leakStart = millis();
    if ((millis() - leakStart) > LEAK_CONFIRM_MS && !leakAlarm) {
      leakAlarm = true;
      triggerAlert("LEAK", currentDeltaP);
    }
  } else {
    leakStart = 0;
  }

  // Overflow: absolute pressure exceeds threshold
  if (currentPressureUpstream > OVERFLOW_THRESHOLD_PSI && !overflowAlarm) {
    overflowAlarm = true;
    triggerAlert("OVERFLOW", currentPressureUpstream);
  }

  // Hysteresis so alarms don't flap around the threshold
  if (leakAlarm && currentDeltaP < LEAK_THRESHOLD_PSI * 0.7) {
    leakAlarm = false;
    clearAlert("LEAK");
  }
  if (overflowAlarm && currentPressureUpstream < OVERFLOW_THRESHOLD_PSI * 0.9) {
    overflowAlarm = false;
    clearAlert("OVERFLOW");
  }
}

// Red LED + buzzer stay on while ANY alarm is active.
void updateAlarmOutputs() {
  bool on = leakAlarm || overflowAlarm;
  digitalWrite(LED_RED, on);
  digitalWrite(BUZZER, on);
}

void triggerAlert(const char* type, float value) {
  updateAlarmOutputs();
  Serial.printf("ALERT: %s (%.1f)\n", type, value);

  JsonDocument doc;
  doc["p_sensor_id"] = DEVICE_SENSOR_ID;
  doc["p_device_code"] = DEVICE_CODE;
  doc["p_type"] = type;
  String body;
  serializeJson(doc, body);
  callRpc("device_raise_alert", body);
}

void clearAlert(const char* type) {
  updateAlarmOutputs();
  Serial.printf("CLEARED: %s\n", type);

  JsonDocument doc;
  doc["p_sensor_id"] = DEVICE_SENSOR_ID;
  doc["p_device_code"] = DEVICE_CODE;
  doc["p_type"] = type;
  String body;
  serializeJson(doc, body);
  callRpc("device_clear_alert", body);
}

// ============================================================
// SUPABASE COMMUNICATION
// ============================================================
bool callRpc(const char* fn, const String& body, String* response) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("RPC %s skipped — WiFi down\n", fn);
    return false;
  }

  WiFiClientSecure tls;
  if (ROOT_CA[0] != '\0') tls.setCACert(ROOT_CA);
  else tls.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + fn;
  if (!http.begin(tls, url)) {
    Serial.printf("RPC %s: could not open connection\n", fn);
    return false;
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int code = http.POST(body);
  bool ok = code >= 200 && code < 300;
  if (response && ok) *response = http.getString();
  if (!ok) Serial.printf("RPC %s → %d %s\n", fn, code, http.getString().c_str());
  else Serial.printf("RPC %s → %d\n", fn, code);
  http.end();
  return ok;
}

void uploadReading(float psi) {
  JsonDocument doc;
  doc["p_sensor_id"] = DEVICE_SENSOR_ID;
  doc["p_device_code"] = DEVICE_CODE;
  doc["p_value"] = psi;
  String body;
  serializeJson(doc, body);
  callRpc("device_insert_reading", body);
}

void fetchThresholdsFromSupabase() {
  JsonDocument req;
  req["p_sensor_id"] = DEVICE_SENSOR_ID;
  req["p_device_code"] = DEVICE_CODE;
  String body;
  serializeJson(req, body);

  String response;
  if (!callRpc("device_get_thresholds", body, &response)) {
    Serial.println("Thresholds: using defaults");
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, response)) {
    Serial.println("Thresholds: bad JSON, using defaults");
    return;
  }

  for (JsonObject row : doc.as<JsonArray>()) {
    const char* param = row["parameter"] | "";
    if (strcmp(param, "LEAK_THRESHOLD") == 0) {
      RANGE_MIN_PSI = row["min_value"] | RANGE_MIN_PSI;
    } else if (strcmp(param, "OVERFLOW_THRESHOLD") == 0) {
      RANGE_MAX_PSI = row["max_value"] | RANGE_MAX_PSI;
    }
  }
  OVERFLOW_THRESHOLD_PSI = RANGE_MIN_PSI + (RANGE_MAX_PSI - RANGE_MIN_PSI) * 0.85;

  Serial.printf("Thresholds: range %.1f–%.1f PSI, overflow > %.1f PSI\n",
                RANGE_MIN_PSI, RANGE_MAX_PSI, OVERFLOW_THRESHOLD_PSI);
}
