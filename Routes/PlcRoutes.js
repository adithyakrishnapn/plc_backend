import express from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

import { getPlcData, sendDefectTrigger } from "../PlcHelper.js";
import { insertPlcData } from "../MongoHelper.js";
import { generateTextileId } from "../processUtils.js";

const router = express.Router();

let latestPlcData = null;
let _pollingStarted = false;

let lastSavedData = null;
let lastProcessStart = 0;
let currentProcess = null;
let lastLengthForAI = 0;

/* ---------------- CHANGE CHECK ---------------- */

function hasImportantChange(data) {
  if (!lastSavedData) return true;

  return (
    data.machineStatusCode !== lastSavedData.machineStatusCode ||
    data.totalProduction !== lastSavedData.totalProduction ||
    data.fabricLength !== lastSavedData.fabricLength ||
    data.alarmCode !== lastSavedData.alarmCode ||
    data.processStart !== lastSavedData.processStart ||
    data.machineRunning !== lastSavedData.machineRunning ||
    data.defectRegister !== lastSavedData.defectRegister
  );
}

/* ---------------- PROCESS LOGIC ---------------- */

async function handleProcessLogic(data) {

  // START 0 → 1
  if (data.processStart === 1 && lastProcessStart === 0) {

    currentProcess = {
      processId: uuidv4(),
      textileId: generateTextileId(),
      startTime: new Date(),
      startProduction: data.totalProduction,
      startLength: data.fabricLength
    };

    console.log("🟢 Process Started:", currentProcess);
  }

  // END 1 → 0
  if (data.processStart === 0 && lastProcessStart === 1 && currentProcess) {

    const endTime = new Date();

    const summary = {
      type: "process_summary",
      processId: currentProcess.processId,
      textileId: currentProcess.textileId,
      startTime: currentProcess.startTime,
      endTime,
      durationMinutes: (endTime - currentProcess.startTime) / 60000,
      production: data.totalProduction - currentProcess.startProduction,
      fabricProcessed: data.fabricLength - currentProcess.startLength
    };

    console.log("🔴 Process Ended:", summary);

    await insertPlcData(summary);

    currentProcess = null;
  }

  lastProcessStart = data.processStart;
}

/* ---------------- AI LOGIC (Receives POST from Python) ---------- */

async function handleDetectResult(defectData) {
  // defectData = { defect: true, count: N, timestamp: T }
  
  if (!currentProcess) {
    console.log("⚠️ Defect received but no active process");
    return;
  }
  
  if (latestPlcData && latestPlcData.machineRunning !== 1) {
    console.log("⚠️ Defect received but machine not running");
    return;
  }

  const { count } = defectData;
  
  console.log("❗ Defect Detected:", count);

  try {
    await sendDefectTrigger();

    await insertPlcData({
      type: "defect",
      processId: currentProcess.processId,
      textileId: currentProcess.textileId,
      count,
      lengthAtDetection: latestPlcData?.fabricLength || null,
      timestamp: new Date()
    });
  } catch (err) {
    console.error("Defect Handler Error:", err.message);
  }
}

/* ---------------- POLLING LOOP ---------------- */

async function readLoop() {
  try {
    const data = await getPlcData();
    if (!data) return setTimeout(readLoop, 2000);

    latestPlcData = data;

    // Handle process start/end logic
    await handleProcessLogic(data);

    // Save telemetry on important changes
    if (hasImportantChange(data)) {
      await insertPlcData({
        type: "telemetry",
        processId: currentProcess?.processId || null,
        textileId: currentProcess?.textileId || null,
        ...data
      });

      lastSavedData = { ...data };
      console.log("📈 Telemetry Saved");
    }

  } catch (err) {
    console.error("Loop Error:", err.message);
  }

  setTimeout(readLoop, 2000);
}

export function startPlcPolling() {
  if (_pollingStarted) return;
  _pollingStarted = true;
  readLoop();
}

/* ---------------- API ENDPOINTS ---------------- */

// Get latest PLC data
router.get("/latest", (req, res) => {
  if (!latestPlcData) {
    return res.status(503).json({ message: "No data yet" });
  }
  res.json(latestPlcData);
});

// Receive defect detection result from Python AI server
router.post("/detect-result", async (req, res) => {
  const { defect, count, timestamp } = req.body;

  if (!defect) {
    return res.status(400).json({ message: "No defect in request" });
  }

  // Handle the defect result
  await handleDetectResult({
    defect,
    count,
    timestamp
  });

  res.json({
    success: true,
    message: "Defect processed",
    processId: currentProcess?.processId || null
  });
});

export default router;
