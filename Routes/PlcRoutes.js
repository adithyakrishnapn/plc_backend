import express from "express";
import getPlcData from "../PlcHelper.js";
import { insertPlcData } from "../MongoHelper.js";

const router = express.Router();

let latestPlcData = null;
let lastInsertedData = null;
let _pollingStarted = false;

async function readLoop() {
  try {
    const data = await getPlcData();

    if (!data) {
      return setTimeout(readLoop, 2000);
    }

    latestPlcData = data;

    // Compare simple fields; adjust keys as needed for your PLC payload
    const hasChanged =
      !lastInsertedData ||
      Object.keys(data).some((k) => {
        if (k === "timestamp") return false;
        return data[k] !== lastInsertedData[k];
      });

    if (hasChanged) {
      console.log("📈 PLC Data Changed:", data);
      try {
        await insertPlcData({ ...data, timestamp: new Date() });
        lastInsertedData = { ...data };
      } catch (err) {
        console.error("MongoDB insert failed:", err.message);
      }
    }

  } catch (err) {
    console.error("Read loop error:", err.message);
  }

  setTimeout(readLoop, 2000);
}

export function startPlcPolling() {
  if (_pollingStarted) return;
  _pollingStarted = true;
  readLoop();
}

/* ------------------ API ENDPOINTS ------------------ */

router.get("/latest", (req, res) => {
  if (!latestPlcData) {
    return res.status(503).json({ message: "PLC data not available yet" });
  }
  res.json(latestPlcData);
});

router.get("/status", (req, res) => {
  res.json({ status: "PLC API running" });
});

export default router;
