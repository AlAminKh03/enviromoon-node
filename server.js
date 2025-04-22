import { ReadlineParser } from "@serialport/parser-readline";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import { SerialPort } from "serialport";
import { connectDB } from "./db/connection.js";

dotenv.config();

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

// Add these variables at the top level
let latestSensorData = null;
let SAVE_INTERVAL = 10 * 60 * 1000; // Default 10 minutes in milliseconds
let serialPort = null;

// Function to send command to Arduino
const sendCommand = (command) => {
  if (serialPort && serialPort.isOpen) {
    serialPort.write(command + "\n");
  } else {
    console.error("❌ Serial port is not open");
  }
};

// ✅ Setup Serial Communication with Arduino
const SERIAL_PORT = process.env.SERIAL_PORT || "COM3";
console.log("🔌 Attempting to connect to port:", SERIAL_PORT);

// Add a delay before opening the port
setTimeout(() => {
  serialPort = new SerialPort({ path: SERIAL_PORT, baudRate: 9600 });

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

  serialPort.on("open", () => {
    console.log("✅ Serial port opened successfully");
    // Request initial status
    sendCommand("STATUS");
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

          // Save to MongoDB
          try {
            const newEntry = new SensorData(latestSensorData);
            await newEntry.save();
            console.log("✅ Data saved to MongoDB:", latestSensorData);
          } catch (err) {
            console.error("❌ Error Saving to MongoDB:", err.message);
          }
        }
      }
    } catch (err) {
      console.error("❌ Error Parsing Data:", err.message);
    }
  });

  // Set up interval to save data based on SAVE_INTERVAL
  setInterval(async () => {
    if (latestSensorData) {
      try {
        const newEntry = new SensorData(latestSensorData);
        await newEntry.save();
        console.log("✅ Data saved to MongoDB:", latestSensorData);
        console.log("⏰ Next save in", SAVE_INTERVAL / 1000, "seconds...");
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
    console.log(`📊 Found ${data.length} latest sensor readings`);
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching latest data:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add this new route to get all readings with time range
app.get("/api/sensors/range", async (req, res) => {
  try {
    const { start, end, limit } = req.query;
    const query = {};

    if (start && end) {
      query.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end),
      };
    }

    const data = await SensorData.find(query)
      .sort({ timestamp: -1 })
      .limit(limit ? parseInt(limit) : 1000);

    console.log(
      `📊 Found ${data.length} sensor readings in database for the specified range`
    );
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching data range:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add endpoint to update sampling interval
app.post("/api/settings/sampling-interval", async (req, res) => {
  try {
    const { interval } = req.body;
    if (!interval || interval < 1) {
      return res.status(400).json({ error: "Invalid interval" });
    }

    // Convert to milliseconds and send to Arduino
    const intervalMs = interval * 1000;
    sendCommand(`INTERVAL:${intervalMs}`);

    SAVE_INTERVAL = intervalMs;
    console.log(
      "✅ Sampling interval updated to:",
      SAVE_INTERVAL / 1000,
      "seconds"
    );
    res.json({ success: true, interval: SAVE_INTERVAL / 1000 });
  } catch (err) {
    console.error("❌ Error updating sampling interval:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add endpoint to force immediate reading
app.post("/api/sensors/read", async (req, res) => {
  try {
    sendCommand("READ");
    res.json({ success: true, message: "Reading command sent to Arduino" });
  } catch (err) {
    console.error("❌ Error sending read command:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Start Express Server
const SERVER_PORT = process.env.PORT || 5000;
app.listen(SERVER_PORT, () => {
  console.log(`🚀 Express server running on port ${SERVER_PORT}`);
});
