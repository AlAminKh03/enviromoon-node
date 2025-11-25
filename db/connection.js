import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

// Cache the connection to reuse in serverless environments
let cachedConnection = null;

export const connectDB = async () => {
  try {
    // If connection already exists and is ready, reuse it
    if (cachedConnection && mongoose.connection.readyState === 1) {
      console.log("✅ MongoDB Connection Reused");
      return cachedConnection;
    }

    const MONGO_URI = process.env.MONGO_URI;

    if (!MONGO_URI) {
      throw new Error("MONGO_URI environment variable is not set");
    }

    // Connect to MongoDB
    const connection = await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    });

    cachedConnection = connection;
    console.log("✅ MongoDB Connected");
    return connection;
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    // Don't exit process in serverless - just throw error
    throw err;
  }
};
