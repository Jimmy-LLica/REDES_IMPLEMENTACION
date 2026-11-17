#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <DHTesp.h>
#include <cstdio>
#include <cmath>
#include <esp_system.h>

// Usa el mismo puerto que muestra Iniciar-Node-RED.cmd.
constexpr char endpoint[] = "http://host.wokwi.internal:1880/riegoguard/esp32";
constexpr char farm[] = "tacna-centro";
constexpr uint8_t valves[] = {16, 17, 18, 19};
constexpr uint8_t soilPins[] = {32, 33, 36, 39};
constexpr uint8_t flowPin = 34;
constexpr uint8_t pressurePin = 35;
constexpr uint8_t airPin = 21;
constexpr uint8_t layoutPin = 22;
constexpr uint8_t linkPin = 23;
constexpr uint32_t sampleIntervalMs = 700;
constexpr uint32_t commandTimeoutMs = 3200;

uint32_t lastSample = 0;
uint32_t lastCommand = 0;
uint32_t sequence = 0;
uint32_t sessionId = 0;
uint32_t clockBase = 0;
unsigned long long epochBase = 0;
unsigned long long bootEpoch = 0;
uint32_t lastAir = 0;
float temperature = NAN;
float humidity = NAN;
DHTesp dht;
bool linked = false;

void setValve(int valve) {
  for (uint8_t i = 0; i < 4; i++) digitalWrite(valves[i], LOW);
  if (valve >= 1 && valve <= 4) digitalWrite(valves[valve - 1], HIGH);
}

int confirmedValve() {
  for (uint8_t i = 0; i < 4; i++) {
    if (digitalRead(valves[i]) == HIGH) return i + 1;
  }
  return 0;
}

void disconnectOutputs() {
  setValve(0);
  digitalWrite(linkPin, LOW);
  if (linked) Serial.println("Sin consigna reciente: válvulas cerradas");
  linked = false;
}

void exchange() {
  const float flow = analogRead(flowPin) * (12.0f / 4095.0f);
  const float pressure = analogRead(pressurePin) * (1.8f / 4095.0f);
  const bool layoutPresent = digitalRead(layoutPin) == LOW;
  char soil[4][16] = {"null", "null", "null", "null"};
  if (layoutPresent) {
    for (uint8_t i = 0; i < 4; i++) {
      snprintf(soil[i], sizeof(soil[i]), "%.1f", analogRead(soilPins[i]) * (100.0f / 4095.0f));
    }
  } else if (sequence % 10 == 0) {
    Serial.println("Circuito de suelo ausente. Reinicia Wokwi con el diagram.json actualizado.");
  }
  const uint32_t now = millis();
  const unsigned long long sampled = epochBase ? epochBase + uint32_t(now - clockBase) : 0;
  char temp[16] = "null";
  char rh[16] = "null";
  if (layoutPresent && std::isfinite(temperature)) snprintf(temp, sizeof(temp), "%.1f", temperature);
  if (layoutPresent && std::isfinite(humidity)) snprintf(rh, sizeof(rh), "%.1f", humidity);
  char payload[400];
  snprintf(payload, sizeof(payload),
           "{\"v\":2,\"farm\":\"%s\",\"boot\":\"esp-%08lx-%llu\",\"seq\":%lu,\"sampledAt\":%llu,\"valve\":%d,"
           "\"flow\":%.2f,\"pressure\":%.2f,\"soil\":[%s,%s,%s,%s],\"air\":{\"temperature\":%s,\"humidity\":%s}}",
           farm, static_cast<unsigned long>(sessionId), bootEpoch, static_cast<unsigned long>(++sequence), sampled,
           confirmedValve(), flow, pressure, soil[0], soil[1], soil[2], soil[3], temp, rh);

  WiFiClient client;
  HTTPClient request;
  if (!request.begin(client, endpoint)) return;
  request.setConnectTimeout(600);
  request.setTimeout(650);
  request.addHeader("Content-Type", "application/json");
  const int code = request.POST(String(payload));
  int valve = 0;
  unsigned long frame = 0;
  unsigned long long epoch = 0;
  char extra = 0;
  if (code == HTTP_CODE_OK) {
    const String response = request.getString();
    if (sscanf(response.c_str(), "RG2 %d %lu %llu %c", &valve, &frame, &epoch, &extra) == 3 && valve >= 0 && valve <= 4) {
      setValve(valve);
      digitalWrite(linkPin, HIGH);
      lastCommand = millis();
      if (!bootEpoch) bootEpoch = epoch;
      epochBase = epoch;
      clockBase = lastCommand;
      linked = true;
      Serial.printf("Trama %lu | válvula %d | caudal %.2f L/min | presión %.2f bar | suelo %s / %s / %s / %s %% | aire %s C, %s %%\n",
                    frame, confirmedValve(), flow, pressure, soil[0], soil[1], soil[2], soil[3], temp, rh);
    }
  } else {
    Serial.printf("Sin respuesta de Node-RED (HTTP %d)\n", code);
    if (code == HTTP_CODE_CONFLICT) {
      epochBase = 0;
      disconnectOutputs();
    }
  }
  request.end();
}

void setup() {
  Serial.begin(115200);
  for (const auto pin : valves) pinMode(pin, OUTPUT);
  pinMode(layoutPin, INPUT_PULLUP);
  pinMode(linkPin, OUTPUT);
  disconnectOutputs();
  analogReadResolution(12);
  sessionId = esp_random();
  dht.setup(airPin, DHTesp::DHT22);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin("Wokwi-GUEST", "", 6);
  Serial.println("RiegoGuard ESP32 · Conectando a Wokwi-GUEST");
}

void loop() {
  const uint32_t now = millis();
  if (digitalRead(layoutPin) == LOW && now - lastAir >= 2500) {
    lastAir = now;
    const auto air = dht.getTempAndHumidity();
    temperature = air.temperature;
    humidity = air.humidity;
  }
  if (WiFi.status() != WL_CONNECTED) {
    if (linked) disconnectOutputs();
    delay(25);
    return;
  }
  if (linked && now - lastCommand >= commandTimeoutMs) disconnectOutputs();
  if (now - lastSample >= sampleIntervalMs) {
    lastSample = now;
    exchange();
  }
  delay(10);
}
