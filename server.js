const express = require("express");
const mongoose = require("mongoose");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const cors = require("cors");
const { connectDB } = require("./db/connection");

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Connect to MongoDB
connectDB();

const sensorSchema = new mongoose.Schema({
  temperature: Number,
  humidity: Number,
  ldr: Number,
  timestamp: { type: Date, default: Date.now },
});
const SensorData = mongoose.model("SensorData", sensorSchema);

// Add these variables at the top level, after the model definition
let latestSensorData = null;
const SAVE_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds

// ✅ Setup Serial Communication with Arduino
const SERIAL_PORT = process.env.SERIAL_PORT || "COM3";
console.log("🔌 Attempting to connect to port:", SERIAL_PORT);

// Add a delay before opening the port
setTimeout(() => {
  const serialPort = new SerialPort({ path: SERIAL_PORT, baudRate: 9600 });

  // Add error handling for serial port
  serialPort.on("error", (err) => {
    console.error("🚨 Serial Port Error:", err.message);
    console.log("📝 Tips: ");
    console.log("1. Make sure Arduino is connected to", SERIAL_PORT);
    console.log("2. Close Arduino IDE or any other program using the port");
    console.log("3. Try running the application as administrator");
    console.log(
      "4. Check if",
      SERIAL_PORT,
      "is the correct port in Device Manager"
    );
  });

  const parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

  // Update parser.on to store latest reading without saving
  parser.on("data", async (data) => {
    try {
      console.log("📩 Received from Arduino:", data.trim());

      // Parse formatted string
      if (data.includes("Temperature:")) {
        const values = data.match(
          /Temperature: ([\d.]+) °C, Humidity: ([\d.]+) %, LDR Output: (\d+)/
        );
        if (values) {
          latestSensorData = {
            temperature: parseFloat(values[1]),
            humidity: parseFloat(values[2]),
            ldr: parseInt(values[3]),
          };
          console.log("📝 Latest reading stored:", latestSensorData);
        }
      }
    } catch (err) {
      console.error("❌ Error Parsing Data:", err.message);
    }
  });

  // Set up interval to save data every 10 minutes
  setInterval(async () => {
    if (latestSensorData) {
      try {
        const newEntry = new SensorData(latestSensorData);
        await newEntry.save();
        console.log("✅ Data saved to MongoDB:", latestSensorData);
        console.log("⏰ Next save in 10 minutes...");
      } catch (err) {
        console.error("❌ Error Saving to MongoDB:", err.message);
      }
    }
  }, SAVE_INTERVAL);
}, 2000);

// ✅ API to Fetch Latest Sensor Data
app.get("/api/sensors", async (req, res) => {
  try {
    const data = await SensorData.find().sort({ timestamp: -1 }).limit(10);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Add this new route to get all readings
app.get("/api/sensors/all", async (req, res) => {
  try {
    const data = await SensorData.find().sort({ timestamp: -1 });
    console.log(`📊 Found ${data.length} sensor readings in database`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Start Express Server
const SERVER_PORT = process.env.PORT || 5000;
app.listen(SERVER_PORT, () => {
  console.log(`🚀 Express server running on port ${SERVER_PORT}`);
});
