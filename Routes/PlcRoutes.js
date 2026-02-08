import express from "express";
import getPlcData, { sendDefectTrigger } from "../PlcHelper.js";
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

    // Insert only if something important changed
    const hasChanged =
      !lastInsertedData ||
      data.machineStatusCode !== lastInsertedData.machineStatusCode ||
      data.totalProduction !== lastInsertedData.totalProduction ||
      data.fabricLength !== lastInsertedData.fabricLength ||
      data.alarmCode !== lastInsertedData.alarmCode ||
      data.stampComplete !== lastInsertedData.stampComplete;

    if (hasChanged) {
      console.log("📈 PLC Update:", data);
      await insertPlcData(data);
      lastInsertedData = { ...data };
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

/* -------- API -------- */

router.get("/latest", (req, res) => {
  if (!latestPlcData) {
    return res.status(503).json({ message: "PLC data not available yet" });
  }
  res.json(latestPlcData);
});

router.post("/defect", async (req, res) => {
  const success = await sendDefectTrigger();

  if (!success) {
    return res.status(500).json({
      success: false,
      message: "Failed to send defect trigger",
    });
  }

  res.json({
    success: true,
    message: "Defect trigger sent to PLC",
  });
});

export default router;
