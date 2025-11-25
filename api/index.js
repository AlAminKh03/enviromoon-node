import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import { connectDB } from "../db/connection.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Initialize MongoDB connection (will be reused across invocations)
let dbConnected = false;

const ensureDBConnection = async () => {
  if (!dbConnected) {
    try {
      await connectDB();
      dbConnected = true;
    } catch (err) {
      console.error("❌ Failed to connect to MongoDB:", err);
      dbConnected = false;
    }
  }
};

// Middleware to ensure DB connection before handling requests
app.use(async (req, res, next) => {
  await ensureDBConnection();
  next();
});

const sensorSchema = new mongoose.Schema({
  temperature: Number,
  humidity: Number,
  ldr: Number,
  timestamp: { type: Date, default: Date.now },
});

const alertSchema = new mongoose.Schema({
  message: String,
  timestamp: { type: Date, default: Date.now },
});

const deviceStatusSchema = new mongoose.Schema({
  uptime: Number,
  totalReadings: Number,
  samplingInterval: Number,
  ledState: Boolean,
  temperatureOffset: Number,
  humidityOffset: Number,
  lightThreshold: Number,
  ipAddress: String,
  rssi: Number,
  timestamp: { type: Date, default: Date.now },
});

const SensorData = mongoose.model("SensorData", sensorSchema);
const Alert = mongoose.model("Alert", alertSchema);
const DeviceStatus = mongoose.model("DeviceStatus", deviceStatusSchema);

// ⚠️ NOTE: In-memory state won't persist across serverless invocations
// For production, consider using a database or external storage (Redis, etc.)
// Command queue for ESP32 to poll
let commandQueue = null;

// Latest sensor data
let latestSensorData = null;

// Device status
let latestDeviceStatus = null;

// Connection tracking
let connectionStatus = {
  lastDataReceived: null,
  lastStatusUpdate: null,
  lastCommandPoll: null,
  totalDataReceived: 0,
  totalCommandsSent: 0,
  isConnected: false,
};

// ========== ESP32 HTTP ENDPOINTS ==========

// ✅ POST /api/sensors/data - Receive sensor data from ESP32
app.post("/api/sensors/data", async (req, res) => {
  try {
    const { temperature, humidity, ldr } = req.body;

    if (
      temperature === undefined ||
      humidity === undefined ||
      ldr === undefined
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    latestSensorData = {
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity),
      ldr: parseInt(ldr),
    };

    // Update connection tracking
    connectionStatus.lastDataReceived = new Date();
    connectionStatus.totalDataReceived++;
    connectionStatus.isConnected = true;

    // Save to MongoDB
    const newEntry = new SensorData(latestSensorData);
    await newEntry.save();

    // Display formatted reading
    console.log("\n" + "=".repeat(60));
    console.log("📡 NEW SENSOR READING RECEIVED:");
    console.log(`   🌡️  Temperature: ${latestSensorData.temperature}°C`);
    console.log(`   💧 Humidity: ${latestSensorData.humidity}%`);
    console.log(`   💡 Light (LDR): ${latestSensorData.ldr}`);
    console.log(`   📊 Total readings: ${connectionStatus.totalDataReceived}`);
    console.log("=".repeat(60) + "\n");
    res.json({ success: true, message: "Data saved successfully" });
  } catch (err) {
    console.error("❌ Error saving sensor data:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/device/commands - ESP32 polls for commands
app.get("/api/device/commands", (req, res) => {
  try {
    // Update connection tracking
    connectionStatus.lastCommandPoll = new Date();
    connectionStatus.isConnected = true;

    if (commandQueue) {
      const command = commandQueue;
      commandQueue = null; // Clear command after sending
      connectionStatus.totalCommandsSent++;
      console.log("📤 Sending command to ESP32:", command);
      console.log(
        `📊 Total commands sent: ${connectionStatus.totalCommandsSent}`
      );
      res.json({ command });
    } else {
      res.json({ command: null });
    }
  } catch (err) {
    console.error("❌ Error getting command:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/device/status-update - Receive device status from ESP32
app.post("/api/device/status-update", async (req, res) => {
  try {
    const statusData = req.body;
    latestDeviceStatus = statusData;

    // Update connection tracking
    connectionStatus.lastStatusUpdate = new Date();
    connectionStatus.isConnected = true;

    // Save to MongoDB
    const newStatus = new DeviceStatus(statusData);
    await newStatus.save();

    console.log("✅ Device status updated:", statusData);
    res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    console.error("❌ Error saving device status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/device/alerts - Receive alerts from ESP32
app.post("/api/device/alerts", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing alert message" });
    }

    // Save to MongoDB
    const newAlert = new Alert({ message });
    await newAlert.save();

    console.log("🚨 Alert received:", message);
    res.json({ success: true, message: "Alert saved successfully" });
  } catch (err) {
    console.error("❌ Error saving alert:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========== CLIENT API ENDPOINTS ==========

// ✅ GET /api/sensors - Fetch latest sensor data
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

// ✅ GET /api/sensors/latest - Get the most recent sensor reading
app.get("/api/sensors/latest", async (req, res) => {
  try {
    if (latestSensorData) {
      // Get the most recent from database to include timestamp
      const latest = await SensorData.findOne()
        .sort({ timestamp: -1 })
        .limit(1);

      if (latest) {
        res.json({
          temperature: latest.temperature,
          humidity: latest.humidity,
          ldr: latest.ldr,
          timestamp: latest.timestamp,
          formatted: `🌡️ Temperature: ${latest.temperature}°C | 💧 Humidity: ${latest.humidity}% | 💡 Light: ${latest.ldr}`,
        });
      } else {
        res.json(latestSensorData);
      }
    } else {
      // Try to get from database
      const latest = await SensorData.findOne()
        .sort({ timestamp: -1 })
        .limit(1);

      if (latest) {
        res.json({
          temperature: latest.temperature,
          humidity: latest.humidity,
          ldr: latest.ldr,
          timestamp: latest.timestamp,
          formatted: `🌡️ Temperature: ${latest.temperature}°C | 💧 Humidity: ${latest.humidity}% | 💡 Light: ${latest.ldr}`,
        });
      } else {
        res.json({ message: "No sensor data available yet" });
      }
    }
  } catch (err) {
    console.error("❌ Error fetching latest reading:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/sensors/range - Get readings with time range
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

// ✅ GET /api/sensors/history - Get readings for a specific time period
// Query params: period (1m, 5m, 15m, 30m, 1h, 6h, 1d, 1w) or custom minutes/hours/days
app.get("/api/sensors/history", async (req, res) => {
  try {
    const { period, limit } = req.query;
    const now = new Date();
    let startTime;

    // Calculate start time based on period
    if (period === "1m" || period === "1minute") {
      startTime = new Date(now.getTime() - 60 * 1000); // 1 minute ago
    } else if (period === "5m" || period === "5minutes") {
      startTime = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago
    } else if (period === "15m" || period === "15minutes") {
      startTime = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago
    } else if (period === "30m" || period === "30minutes") {
      startTime = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago
    } else if (period === "1h" || period === "1hour") {
      startTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    } else if (period === "6h" || period === "6hours") {
      startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago
    } else if (period === "1d" || period === "1day") {
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
    } else if (period === "1w" || period === "1week") {
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 1 week ago
    } else if (period) {
      // Support custom minutes/hours/days format like "10m", "12h" or "3d"
      const match = period.match(/^(\d+)([mhd])$/);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2];
        if (unit === "m") {
          startTime = new Date(now.getTime() - value * 60 * 1000);
        } else if (unit === "h") {
          startTime = new Date(now.getTime() - value * 60 * 60 * 1000);
        } else if (unit === "d") {
          startTime = new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
        } else {
          return res.status(400).json({
            error:
              "Invalid period format. Use: 1m, 5m, 15m, 30m, 1h, 6h, 1d, 1w, or custom like 10m, 12h, 3d",
          });
        }
      } else {
        return res.status(400).json({
          error:
            "Invalid period. Use: 1m, 5m, 15m, 30m, 1h, 6h, 1d, 1w, or custom like 10m, 12h, 3d",
        });
      }
    } else {
      return res.status(400).json({
        error:
          "Period parameter is required. Use: 1m, 5m, 15m, 30m, 1h, 6h, 1d, 1w",
      });
    }

    const query = {
      timestamp: {
        $gte: startTime,
        $lte: now,
      },
    };

    const data = await SensorData.find(query)
      .sort({ timestamp: -1 })
      .limit(limit ? parseInt(limit) : 10000);

    console.log(
      `📊 Found ${data.length} sensor readings for the last ${period}`
    );
    res.json({
      period,
      startTime,
      endTime: now,
      count: data.length,
      data: data,
    });
  } catch (err) {
    console.error("❌ Error fetching history data:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/device/status - Get latest device status
app.get("/api/device/status", async (req, res) => {
  try {
    if (latestDeviceStatus) {
      res.json(latestDeviceStatus);
    } else {
      // Try to get from database
      const status = await DeviceStatus.findOne()
        .sort({ timestamp: -1 })
        .limit(1);
      res.json(status || { message: "No status available" });
    }
  } catch (err) {
    console.error("❌ Error fetching device status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/device/connection - Check device connection status
app.get("/api/device/connection", (req, res) => {
  try {
    const now = new Date();
    const CONNECTION_TIMEOUT = 60000; // 60 seconds - device considered offline if no communication

    // Check if device is still connected (has communicated recently)
    let isCurrentlyConnected = false;
    if (connectionStatus.lastDataReceived || connectionStatus.lastCommandPoll) {
      const lastComm =
        connectionStatus.lastDataReceived || connectionStatus.lastCommandPoll;
      const timeSinceLastComm = now - lastComm;
      isCurrentlyConnected = timeSinceLastComm < CONNECTION_TIMEOUT;
    }

    // Calculate time since last communication
    const getTimeAgo = (date) => {
      if (!date) return "Never";
      const seconds = Math.floor((now - date) / 1000);
      if (seconds < 60) return `${seconds} seconds ago`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes} minutes ago`;
      const hours = Math.floor(minutes / 60);
      return `${hours} hours ago`;
    };

    const status = {
      isConnected: isCurrentlyConnected,
      lastDataReceived: connectionStatus.lastDataReceived
        ? {
            timestamp: connectionStatus.lastDataReceived,
            timeAgo: getTimeAgo(connectionStatus.lastDataReceived),
          }
        : null,
      lastStatusUpdate: connectionStatus.lastStatusUpdate
        ? {
            timestamp: connectionStatus.lastStatusUpdate,
            timeAgo: getTimeAgo(connectionStatus.lastStatusUpdate),
          }
        : null,
      lastCommandPoll: connectionStatus.lastCommandPoll
        ? {
            timestamp: connectionStatus.lastCommandPoll,
            timeAgo: getTimeAgo(connectionStatus.lastCommandPoll),
          }
        : null,
      statistics: {
        totalDataReceived: connectionStatus.totalDataReceived,
        totalCommandsSent: connectionStatus.totalCommandsSent,
      },
      latestSensorData: latestSensorData,
    };

    res.json(status);
  } catch (err) {
    console.error("❌ Error fetching connection status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ GET /api/alerts - Get recent alerts
app.get("/api/alerts", async (req, res) => {
  try {
    const { limit } = req.query;
    const alerts = await Alert.find()
      .sort({ timestamp: -1 })
      .limit(limit ? parseInt(limit) : 50);
    res.json(alerts);
  } catch (err) {
    console.error("❌ Error fetching alerts:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========== COMMAND ENDPOINTS ==========

// ✅ POST /api/device/command - Queue a command for ESP32
app.post("/api/device/command", (req, res) => {
  try {
    const { command } = req.body;

    if (!command) {
      return res.status(400).json({ error: "Command is required" });
    }

    commandQueue = command;
    console.log("📥 Command queued for ESP32:", command);
    res.json({ success: true, message: "Command queued successfully" });
  } catch (err) {
    console.error("❌ Error queueing command:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/sensors/read - Force immediate reading
app.post("/api/sensors/read", (req, res) => {
  try {
    commandQueue = "READ";
    console.log("📥 READ command queued for ESP32");
    res.json({ success: true, message: "Reading command queued" });
  } catch (err) {
    console.error("❌ Error sending read command:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/settings/sampling-interval - Update sampling interval
app.post("/api/settings/sampling-interval", (req, res) => {
  try {
    const { interval } = req.body;
    if (!interval || interval < 1) {
      return res.status(400).json({ error: "Invalid interval" });
    }

    // Convert to milliseconds and queue command
    const intervalMs = interval * 1000;
    commandQueue = `INTERVAL:${intervalMs}`;

    console.log("✅ Sampling interval command queued:", interval, "seconds");
    res.json({ success: true, interval });
  } catch (err) {
    console.error("❌ Error updating sampling interval:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/sensors/temp/enable - Enable temperature/humidity readings
app.post("/api/sensors/temp/enable", (req, res) => {
  try {
    commandQueue = "TEMP:ON";
    console.log("📥 TEMP:ON command queued");
    res.json({
      success: true,
      message: "Temperature/Humidity readings enabled",
    });
  } catch (err) {
    console.error("❌ Error enabling temp sensor:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/sensors/temp/disable - Disable temperature/humidity readings
app.post("/api/sensors/temp/disable", (req, res) => {
  try {
    commandQueue = "TEMP:OFF";
    console.log("📥 TEMP:OFF command queued");
    res.json({
      success: true,
      message: "Temperature/Humidity readings disabled",
    });
  } catch (err) {
    console.error("❌ Error disabling temp sensor:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/sensors/light/enable - Enable light (LDR) readings
app.post("/api/sensors/light/enable", (req, res) => {
  try {
    commandQueue = "LIGHT:ON";
    console.log("📥 LIGHT:ON command queued");
    res.json({ success: true, message: "Light (LDR) readings enabled" });
  } catch (err) {
    console.error("❌ Error enabling light sensor:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/sensors/light/disable - Disable light (LDR) readings
app.post("/api/sensors/light/disable", (req, res) => {
  try {
    commandQueue = "LIGHT:OFF";
    console.log("📥 LIGHT:OFF command queued");
    res.json({ success: true, message: "Light (LDR) readings disabled" });
  } catch (err) {
    console.error("❌ Error disabling light sensor:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST /api/device/status-request - Request device status
app.post("/api/device/status-request", (req, res) => {
  try {
    commandQueue = "STATUS";
    console.log("📥 STATUS command queued");
    res.json({ success: true, message: "Status request queued" });
  } catch (err) {
    console.error("❌ Error requesting status:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Export the Express app as a serverless function
export default app;
