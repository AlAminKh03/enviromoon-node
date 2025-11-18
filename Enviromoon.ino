#include <DHT.h>
#include <DHT_U.h>

#define DHTPIN 2
#define DHTTYPE DHT22
#define LDR_PIN A0

DHT dht(DHTPIN, DHTTYPE);

// Variables for sensor readings
float temperature = 0;
float humidity = 0;
int ldrValue = 0;

// Variables for timing control
unsigned long lastReadingTime = 0;
unsigned long samplingInterval = 10000; // Default 10 seconds

// Separate "on/off" switches for each sensor
bool readTempHumidity = true;
bool readLight = true;

void setup() {
  Serial.begin(9600);
  dht.begin();
  
  // Initial reading
  readSensors();
  printReadings();
  
  Serial.println("Starting sensor readings...");
  Serial.println("Commands: TEMP:ON, TEMP:OFF, LIGHT:ON, LIGHT:OFF, READ, STATUS, INTERVAL:[ms]");
}

void loop() {
  // Check for commands from serial
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toUpperCase(); // Convert command to uppercase to make it case-insensitive
    
    // Handle commands
    if (command.startsWith("INTERVAL:")) {
      String intervalStr = command.substring(9);
      unsigned long newInterval = intervalStr.toInt();
      
      if (newInterval >= 1000) {
        samplingInterval = newInterval;
        Serial.print("Interval updated to: ");
        Serial.println(samplingInterval);
      }
    } else if (command == "READ") {
      readSensors();
      printReadings();
      
    } else if (command == "STATUS") {
      Serial.print("Current interval: ");
      Serial.println(samplingInterval);
      // Report status for each sensor
      Serial.print("Temp/Humidity Reading: ");
      Serial.println(readTempHumidity ? "ON" : "OFF");
      Serial.print("Light Reading: ");
      Serial.println(readLight ? "ON" : "OFF");
      
    // Command blocks for separate sensors
    } else if (command == "TEMP:ON") {
      readTempHumidity = true;
      Serial.println("Temperature/Humidity readings ENABLED.");
    } else if (command == "TEMP:OFF") {
      readTempHumidity = false;
      Serial.println("Temperature/Humidity readings DISABLED.");
    } else if (command == "LIGHT:ON") {
      readLight = true;
      Serial.println("LDR (Light) readings ENABLED.");
    } else if (command == "LIGHT:OFF") {
      readLight = false;
      Serial.println("LDR (Light) readings DISABLED.");
    }
  }
  
  // Check if it's time for a new reading
  unsigned long currentTime = millis();
  
  // Only run if EITHER sensor is on
  if ((readTempHumidity || readLight) && (currentTime - lastReadingTime >= samplingInterval)) {
    readSensors();
    printReadings();
    lastReadingTime = currentTime;
  }
}

void readSensors() {
  // Only read if the switch is ON
  if (readTempHumidity) {
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
    
    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("Failed to read from DHT sensor!");
    }
  }
  
  // Only read if the switch is ON
  if (readLight) {
    ldrValue = analogRead(LDR_PIN);
  }
}

void printReadings() {
  // Print a combined string, but only include
  // data from sensors that are turned ON.
  
  String output = ""; // Start with an empty string
  
  if (readTempHumidity) {
    output += "Temperature: ";
    output += temperature;
    output += " °C, Humidity: ";
    output += humidity;
    output += " %, ";
  }
  
  if (readLight) {
    output += "LDR Output: ";
    output += ldrValue;
  }
  
  // Only print if we actually added something to the string
  if (output.length() > 0) {
    Serial.println(output);
  }
}

