/*
 * Sensor de nivel de canal — ESP32 + JSN-SR04T (ultrasónico impermeable)
 * ---------------------------------------------------------------
 * Mide la altura del agua, la publica en ntfy y avisa cuando el canal sube.
 * No guarda credenciales en el repositorio: completá las constantes al flashear.
 *
 * Librerías: solo las del core ESP32 (WiFi, HTTPClient, WiFiClientSecure).
 * Placa: "ESP32 Dev Module". Sensor: TRIG=5, ECHO=18, alimentado a 5 V.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <algorithm>

const char* SSID     = "TU_WIFI";
const char* PASS     = "TU_CLAVE";
const char* CANAL    = "mismo-canal-que-en-la-app";     // topic de datos
const char* ALERTA   = "mismo-NTFY_TOPIC-que-en-GitHub"; // topic de avisos

const int   TRIG = 5, ECHO = 18;
const float ALTURA_SENSOR_CM = 300;   // distancia sensor -> fondo del canal
const float UMBRAL_CM        = 120;   // nivel considerado peligroso
const float SUBA_CM          = 10;    // suba entre lecturas que dispara aviso

float medir() {
  float v[7]; int k = 0;
  for (int i = 0; i < 7; i++) {
    digitalWrite(TRIG, LOW);  delayMicroseconds(3);
    digitalWrite(TRIG, HIGH); delayMicroseconds(12);
    digitalWrite(TRIG, LOW);
    long d = pulseIn(ECHO, HIGH, 30000);
    if (d > 0) { float c = d * 0.0343f / 2; if (c > 25 && c < 450) v[k++] = c; }
    delay(70);
  }
  if (k < 4) return -1;
  std::sort(v, v + k);
  return ALTURA_SENSOR_CM - v[k / 2];   // mediana de 7 lecturas
}

void post(const char* topic, const String& body, int prio, const char* title) {
  WiFiClientSecure c; c.setInsecure();
  HTTPClient h;
  h.begin(c, String("https://ntfy.sh/") + topic);
  h.addHeader("Priority", String(prio));
  h.addHeader("Title", title);
  h.POST(body);
  h.end();
}

float prev = -1;
unsigned long lastAl = 0;
bool alerto = false;

void setup() {
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  WiFi.begin(SSID, PASS);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); delay(8000); return; }

  float n = medir();
  if (n < 0) { delay(60000); return; }

  post(CANAL, String(n, 0), 2, "Canal");

  bool alto = n >= UMBRAL_CM;
  bool sube = prev >= 0 && (n - prev) >= SUBA_CM;

  if ((alto || sube) && (!alerto || millis() - lastAl > 1800000UL)) {
    String m = (alto ? "Nivel " : "Sube rápido: ") + String(n, 0) + " cm";
    post(ALERTA, m, 5, "Canal — alerta");
    lastAl = millis();
    alerto = true;
  }
  if (!alto && !sube && n < UMBRAL_CM * 0.9) alerto = false;

  prev = n;
  delay((alto || sube || n >= UMBRAL_CM * 0.7) ? 180000 : 900000);
}
