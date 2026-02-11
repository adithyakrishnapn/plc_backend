import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

import plcRoutes, { startPlcPolling } from "./Routes/PlcRoutes.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/plc", plcRoutes);

// --------------------
// MongoDB Connection (Mongoose)
// --------------------
export async function connectMongo() {
  try {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error("MONGODB_URI not found in .env");
    }

    await mongoose.connect(uri);

    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
}

// --------------------
// Start Server + PLC
// --------------------
async function startServer() {
  await connectMongo();

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);

    // Start PLC polling after server starts
    startPlcPolling();
    console.log("🔄 PLC Polling Started");
  });
}

startServer();
