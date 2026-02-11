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

/* ---------------- AI LOGIC ---------------- */

async function handleAI(data) {

  if (!currentProcess) return;
  if (data.machineRunning !== 1) return;
  if (data.fabricLength <= lastLengthForAI) return;

  lastLengthForAI = data.fabricLength;

  try {
    const res = await axios.get("http://localhost:5000/detect");
    const { defect, count } = res.data;

    if (defect) {
      console.log("❗ Defect:", count);

      await sendDefectTrigger();

      await insertPlcData({
        type: "defect",
        processId: currentProcess.processId,
        textileId: currentProcess.textileId,
        count,
        lengthAtDetection: data.fabricLength,
        timestamp: new Date()
      });
    }

  } catch (err) {
    console.error("AI Error:", err.message);
  }
}

/* ---------------- POLLING LOOP ---------------- */

async function readLoop() {
  try {
    const data = await getPlcData();
    if (!data) return setTimeout(readLoop, 2000);

    latestPlcData = data;

    await handleProcessLogic(data);
    await handleAI(data);

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

/* ---------------- API ---------------- */

router.get("/latest", (req, res) => {
  if (!latestPlcData) {
    return res.status(503).json({ message: "No data yet" });
  }
  res.json(latestPlcData);
});

export default router;
