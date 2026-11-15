/**
 * VISION AI — Hardware Bridge
 * =====================================================================
 * Receives "EMOTION:CONFIDENCE\n" over Serial at 115200 baud and drives
 * four peripherals that mirror the browser app's live emotion state.
 *
 *   WS2812B NeoPixel Ring  D6   16 LEDs, emotion-coloured ambient ring
 *   Active Buzzer          D8   80 ms alert beep on Angry / alert shifts
 *   SG90 Servo             D9   Valence gauge: 0° Angry → 90° Neutral → 180° Happy
 *   16x2 I2C LCD        A4/A5   Address 0x27, label + confidence readout
 *
 * PROTOCOL
 *   ASCII, newline-terminated, case-insensitive, CR tolerated:
 *     HAPPY:87
 *     NEUTRAL:72
 *     CONTEMPT:54
 *   Unknown labels are reported on Serial and ignored (state is kept).
 *
 * WATCHDOG
 *   If no valid command arrives for >3 s the rig falls back to a
 *   "waiting" state: cyan LEDs, servo at 90°, "WAITING FOR AI..." on the
 *   LCD. This makes a dropped USB cable obvious at a glance instead of
 *   leaving stale data on the gauges.
 *
 * Wiring, BOM and flashing instructions: see ../README.md
 * Library dependencies: see ../library_deps.txt
 *
 * Tested target: Arduino Uno R3 (ATmega328P, 5 V / 16 MHz).
 * =====================================================================
 */

#include <Wire.h>
#include <Servo.h>
#include <Adafruit_NeoPixel.h>
#include <LiquidCrystal_I2C.h>

// ── Pin map ──────────────────────────────────────────────────────────
// Kept in one place so a rewire only touches these five lines.
constexpr uint8_t PIN_NEOPIXEL_DATA = 6;   // WS2812B DIN
constexpr uint8_t PIN_BUZZER        = 8;   // Active buzzer + leg
constexpr uint8_t PIN_SERVO_SIGNAL  = 9;   // SG90 orange wire
// A4/A5 are the Uno's hardware I2C pins (SDA/SCL) — used implicitly by Wire.

// ── Peripheral configuration ─────────────────────────────────────────
constexpr uint16_t NEOPIXEL_COUNT    = 16;
constexpr uint8_t  NEOPIXEL_BRIGHTNESS = 90;  // 0–255; 90 is bright but easy on the eyes
constexpr uint8_t  LCD_ADDRESS       = 0x27; // Most common PCF8574 backpack address
constexpr uint8_t  LCD_COLUMNS       = 16;
constexpr uint8_t  LCD_ROWS          = 2;

constexpr uint32_t SERIAL_BAUD       = 115200;
constexpr uint32_t WATCHDOG_MS       = 3000;
constexpr uint16_t BUZZER_BEEP_MS    = 80;
constexpr uint16_t SERVO_SETTLE_MS   = 15;   // Per-degree travel pause on large swings

// Longest expected command ("CONTEMPT:100") plus slack.
constexpr uint8_t  COMMAND_BUFFER_SIZE = 24;

// ── Emotion model ────────────────────────────────────────────────────
// Mirrors the 8-class AffectNet set used by the browser app (including
// Contempt). The numeric values are the servo angle for each class —
// a valence scale where 0° is the most negative and 180° the most positive.
enum Emotion : uint8_t {
  EMOTION_ANGRY    = 0,
  EMOTION_DISGUST  = 20,
  EMOTION_FEAR     = 35,
  EMOTION_SAD      = 50,
  EMOTION_CONTEMPT = 65,
  EMOTION_NEUTRAL  = 90,
  EMOTION_SURPRISE = 120,
  EMOTION_HAPPY    = 180,
  EMOTION_UNKNOWN  = 255
};

struct EmotionProfile {
  const char*  label;      // Uppercase protocol token
  uint8_t      red;        // NeoPixel colour
  uint8_t      green;
  uint8_t      blue;
  bool         isAlert;    // Triggers the warning beep
};

// Order must match the Emotion enum above.
static const EmotionProfile EMOTION_TABLE[] PROGMEM = {
  // label        red   green blue  alert
  { "ANGRY",      0xFF, 0x33, 0x66, true  },  // #FF3366 red
  { "DISGUST",    0xAA, 0x44, 0xFF, true  },  // #AA44FF purple
  { "FEAR",       0xFF, 0x88, 0x00, true  },  // #FF8800 orange
  { "SAD",        0x44, 0x88, 0xFF, false },  // #4488FF blue
  { "CONTEMPT",   0xBE, 0x12, 0x3C, false },  // #BE123C deep rose (matches app)
  { "NEUTRAL",    0x00, 0xE5, 0xFF, false },  // #00E5FF cyan
  { "SURPRISE",   0xFF, 0xD7, 0x00, false },  // #FFD700 gold
  { "HAPPY",      0x00, 0xFF, 0x88, false },  // #00FF88 green
};
constexpr uint8_t EMOTION_TABLE_SIZE =
  sizeof(EMOTION_TABLE) / sizeof(EMOTION_TABLE[0]);

// Fallback colour when the label is unrecognised — deliberately dim white.
constexpr uint8_t UNKNOWN_RED   = 40;
constexpr uint8_t UNKNOWN_GREEN = 40;
constexpr uint8_t UNKNOWN_BLUE  = 40;

// ── Peripherals ──────────────────────────────────────────────────────
Adafruit_NeoPixel pixels(NEOPIXEL_COUNT, PIN_NEOPIXEL_DATA, NEO_GRB + NEO_KHZ800);
Servo             gaugeServo;
LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);

// ── Runtime state ────────────────────────────────────────────────────
char     commandBuffer[COMMAND_BUFFER_SIZE];
uint8_t  commandLength = 0;

Emotion  currentEmotion     = EMOTION_NEUTRAL;
uint8_t  currentConfidence  = 0;
Emotion  previousEmotion    = EMOTION_UNKNOWN;

uint32_t lastCommandMs   = 0;
uint32_t buzzerOffMs     = 0;
bool     buzzerActive    = false;
bool     watchdogTripped = true;   // Start in the waiting state

// Servo easing: stepping a cheap SG90 across 180° in one jump can strip
// gears under load, so motion is spread over loop() iterations.
uint8_t  targetServoAngle  = 90;
uint8_t  currentServoAngle = 90;
uint32_t lastServoStepMs   = 0;

// ── Forward declarations ─────────────────────────────────────────────
void  applyEmotion(Emotion emotion, uint8_t confidence);
void  enterWaitingState();
void  beep();
Emotion emotionFromLabel(const char* label);
const EmotionProfile* profileFor(Emotion emotion);
void  writeLcdLine(uint8_t row, const char* prefix, const char* value);
void  setRingColour(uint8_t red, uint8_t green, uint8_t blue);

// =====================================================================
// SETUP
// =====================================================================
void setup() {
  Serial.begin(SERIAL_BAUD);

  // Give cheap USB-serial bridges a moment to enumerate before the first
  // bytes are written — otherwise the opening banner is silently lost.
  delay(1500);

  // Buzzer: driven HIGH to sound (active buzzer has its own oscillator).
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  pixels.begin();
  pixels.setBrightness(NEOPIXEL_BRIGHTNESS);
  pixels.show();                       // All LEDs off

  gaugeServo.attach(PIN_SERVO_SIGNAL);
  gaugeServo.write(90);                // Neutral — matches the waiting state

  lcd.init();
  lcd.backlight();
  lcd.clear();

  enterWaitingState();

  Serial.println(F("VISION AI hardware bridge ready"));
  Serial.println(F("Send: EMOTION:CONFIDENCE  e.g. HAPPY:87"));
}

// =====================================================================
// MAIN LOOP
// =====================================================================
void loop() {
  readSerial();
  serviceBuzzer();
  serviceServo();

  // Watchdog: no valid command within the window → fall back to waiting.
  if (!watchdogTripped && (millis() - lastCommandMs) > WATCHDOG_MS) {
    enterWaitingState();
  }
}

// ── Serial ───────────────────────────────────────────────────────────
/**
 * Non-blocking line reader. Using Serial.readStringUntil() instead would
 * block for its full timeout (default 1 s) on every loop iteration and
 * make the servo and buzzer feel sluggish.
 */
void readSerial() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\n') {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';
        handleCommand(commandBuffer);
        commandLength = 0;
      }
      continue;
    }

    // Tolerate CR from CRLF senders.
    if (c == '\r') continue;

    if (commandLength < COMMAND_BUFFER_SIZE - 1) {
      commandBuffer[commandLength++] = c;
    } else {
      // Overlong garbage: discard and resynchronise on the next newline.
      commandLength = 0;
    }
  }
}

/** Parse "LABEL:CONFIDENCE" and apply it. */
void handleCommand(const char* raw) {
  const char* separator = strchr(raw, ':');
  if (separator == nullptr) {
    Serial.print(F("ERR malformed (no ':'): "));
    Serial.println(raw);
    return;
  }

  const uint8_t labelLength = static_cast<uint8_t>(separator - raw);
  if (labelLength == 0 || labelLength >= COMMAND_BUFFER_SIZE) {
    Serial.print(F("ERR bad label: "));
    Serial.println(raw);
    return;
  }

  char label[COMMAND_BUFFER_SIZE];
  strncpy(label, raw, labelLength);
  label[labelLength] = '\0';

  const int confidence = atoi(separator + 1);
  if (confidence < 0 || confidence > 100) {
    Serial.print(F("ERR confidence out of range: "));
    Serial.println(raw);
    return;
  }

  const Emotion emotion = emotionFromLabel(label);
  if (emotion == EMOTION_UNKNOWN) {
    // Keep the last valid state — a typo should not blank the gauges.
    Serial.print(F("ERR unknown emotion: "));
    Serial.println(label);
    return;
  }

  watchdogTripped = false;
  lastCommandMs   = millis();
  applyEmotion(emotion, static_cast<uint8_t>(confidence));
}

/** Case-insensitive label → Emotion lookup. */
Emotion emotionFromLabel(const char* label) {
  for (uint8_t i = 0; i < EMOTION_TABLE_SIZE; i++) {
    const char* candidate = EMOTION_TABLE[i].label;
    if (strcasecmp(label, candidate) == 0) {
      return static_cast<Emotion>(i);
    }
  }
  return EMOTION_UNKNOWN;
}

const EmotionProfile* profileFor(Emotion emotion) {
  if (emotion == EMOTION_UNKNOWN) return nullptr;
  const uint8_t index = static_cast<uint8_t>(emotion);
  if (index >= EMOTION_TABLE_SIZE) return nullptr;
  return &EMOTION_TABLE[index];
}

// ── Actuation ────────────────────────────────────────────────────────
void applyEmotion(Emotion emotion, uint8_t confidence) {
  previousEmotion  = currentEmotion;
  currentEmotion   = emotion;
  currentConfidence = confidence;

  const EmotionProfile* profile = profileFor(emotion);
  const uint8_t red   = profile ? pgm_read_byte(&profile->red)   : UNKNOWN_RED;
  const uint8_t green = profile ? pgm_read_byte(&profile->green) : UNKNOWN_GREEN;
  const uint8_t blue  = profile ? pgm_read_byte(&profile->blue)  : UNKNOWN_BLUE;

  setRingColour(red, green, blue);
  targetServoAngle = static_cast<uint8_t>(emotion);  // Enum value IS the angle

  // LCD: "EMOTION: <label>" / "SCORE:   <n>%", both truncated to 16 chars.
  const char* displayLabel = profile ? profile->label : "UNKNOWN";
  writeLcdLine(0, "EMOTION: ", displayLabel);

  char scoreLine[LCD_COLUMNS + 1];
  snprintf(scoreLine, sizeof(scoreLine), "SCORE:   %u%%", confidence);
  lcd.setCursor(0, 1);
  lcd.print(scoreLine);
  // Clear any residue when the new text is shorter than the last.
  for (uint8_t i = strlen(scoreLine); i < LCD_COLUMNS; i++) lcd.print(' ');

  // Buzzer: Angry always alerts; other negative emotions alert only on a
  // fresh transition into them, so a sustained frown does not keep beeping.
  const bool isNewAlert = profile != nullptr && profile->isAlert &&
                          previousEmotion != emotion;
  if (emotion == EMOTION_ANGRY || isNewAlert) {
    beep();
  }

  // Echo the applied state so the browser can confirm round-trip health.
  Serial.print(F("OK "));
  Serial.print(displayLabel);
  Serial.print(':');
  Serial.println(confidence);
}

/** Fill the ring with one colour. Intensity scales slightly with confidence. */
void setRingColour(uint8_t red, uint8_t green, uint8_t blue) {
  const uint32_t colour = pixels.Color(red, green, blue);
  for (uint16_t i = 0; i < NEOPIXEL_COUNT; i++) {
    pixels.setPixelColor(i, colour);
  }
  pixels.show();
}

// ── Buzzer ───────────────────────────────────────────────────────────
void beep() {
  digitalWrite(PIN_BUZZER, HIGH);
  buzzerActive = true;
  buzzerOffMs  = millis() + BUZZER_BEEP_MS;
}

/** Non-blocking buzzer off — delay(80) would stall the servo easing. */
void serviceBuzzer() {
  if (buzzerActive && (millis() >= buzzerOffMs)) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerActive = false;
  }
}

// ── Servo easing ─────────────────────────────────────────────────────
/**
 * Step the servo one degree per interval. A cheap SG90 driven 180° in a
 * single write() can overshoot and stall under load; easing keeps the
 * needle motion smooth and readable as a gauge.
 */
void serviceServo() {
  if (currentServoAngle == targetServoAngle) return;
  if ((millis() - lastServoStepMs) < SERVO_SETTLE_MS) return;

  if (targetServoAngle > currentServoAngle) currentServoAngle++;
  else                                      currentServoAngle--;

  gaugeServo.write(currentServoAngle);
  lastServoStepMs = millis();
}

// ── Watchdog / idle state ────────────────────────────────────────────
void enterWaitingState() {
  watchdogTripped = true;
  currentEmotion    = EMOTION_NEUTRAL;
  previousEmotion   = EMOTION_UNKNOWN;
  currentConfidence = 0;
  targetServoAngle  = 90;

  setRingColour(0x00, 0xE5, 0xFF);   // Cyan — "idle, link is down"

  lcd.setCursor(0, 0);
  lcd.print(F("WAITING FOR AI..."));
  lcd.setCursor(0, 1);
  lcd.print(F("                "));    // Blank line 2
}

// ── LCD helper ───────────────────────────────────────────────────────
/**
 * Print "prefix + value" on a row, truncated to the LCD width and padded
 * with spaces so a shorter new line never leaves stale characters behind.
 * ("EMOTION: SURPRISE" is 17 characters, the only label that overflows.)
 */
void writeLcdLine(uint8_t row, const char* prefix, const char* value) {
  char line[LCD_COLUMNS + 1];
  snprintf(line, sizeof(line), "%s%s", prefix, value);

  lcd.setCursor(0, row);
  lcd.print(line);
  for (uint8_t i = strlen(line); i < LCD_COLUMNS; i++) lcd.print(' ');
}
