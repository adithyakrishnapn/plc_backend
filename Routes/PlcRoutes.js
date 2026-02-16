import express from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

import { getPlcData, sendDefectTrigger, connectPLC, getConnectionStatus } from "../PlcHelper.js";
import { insertPlcData, getMongoStatus, getLatestPlcData, getLatestDataByType, getPlcDataByTimeRange } from "../MongoHelper.js";
import { generateTextileId } from "../processUtils.js";

const router = express.Router();

let latestPlcData = null;
let _pollingStarted = false;

let lastSavedData = null;
let lastProcessStart = 0;
let currentProcess = null;
let lastLengthForAI = 0;

/* -------- DEFECT QUEUE (Process defects ONE at a time) -------- */
let defectQueue = [];
let isProcessingDefect = false;

async function processDefectQueue() {
  // If already processing, wait
  if (isProcessingDefect || defectQueue.length === 0) {
    return;
  }

  isProcessingDefect = true;
  const defectData = defectQueue.shift();
  const defectCount = defectQueue.length;

  try {
    if (!currentProcess) {
      console.log("⚠️ Defect received but no active process");
      return;
    }

    if (latestPlcData && latestPlcData.machineRunning !== 1) {
      console.log("⚠️ Defect received but machine not running");
      return;
    }

    const { count } = defectData;

    console.log(`❗ Processing Defect [${defectData.defectId}]: ${count} holes`);

    // TRIGGER PLC (only one signal at a time)
    await sendDefectTrigger();

    // SAVE TO DATABASE
    await insertPlcData({
      type: "defect",
      processId: currentProcess.processId,
      textileId: currentProcess.textileId,
      count,
      defectId: defectData.defectId,
      confidence: defectData.confidence,
      lengthAtDetection: latestPlcData?.fabricLength || null,
      timestamp: new Date()
    });

    console.log(`✅ Defect #${defectData.defectId} COMPLETE (${defectCount} in queue)`);

  } catch (err) {
    console.error("❌ Defect Processing Error:", err.message);
  } finally {
    isProcessingDefect = false;

    // Process next defect if queue has more
    if (defectQueue.length > 0) {
      setTimeout(processDefectQueue, 100); // Small delay before next
    }
  }
}

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
  // defectData = { defect: true, count: N, defectId: X, confidence: Y, timestamp: T }
  
  if (!currentProcess) {
    console.log("⚠️ Defect received but no active process");
    return;
  }

  if (latestPlcData && latestPlcData.machineRunning !== 1) {
    console.log("⚠️ Defect received but machine not running");
    return;
  }

  // ADD TO QUEUE instead of processing immediately
  defectQueue.push(defectData);
  console.log(`📥 Defect #${defectData.defectId} queued (Queue size: ${defectQueue.length})`);

  // Start processing if not already
  if (!isProcessingDefect) {
    processDefectQueue();
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
      console.log("📝 Saving telemetry...");
      const success = await insertPlcData({
        type: "telemetry",
        processId: currentProcess?.processId || null,
        textileId: currentProcess?.textileId || null,
        ...data
      });

      if (success) {
        lastSavedData = { ...data };
        console.log("📈 Telemetry Saved to Database");
      } else {
        console.log("⚠️ Telemetry NOT saved - check MongoDB connection");
      }
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

// Get process status (for Python AI to know if it should count defects)
router.get("/process-status", (req, res) => {
  const processActive = currentProcess !== null;
  
  res.json({
    processActive,
    processId: currentProcess?.processId || null,
    textileId: currentProcess?.textileId || null,
    machineRunning: latestPlcData?.machineRunning || 0
  });
});

// Get latest data from database
router.get("/db/latest", async (req, res) => {
  const data = await getLatestPlcData();
  
  if (!data) {
    return res.status(404).json({
      message: "No data in database yet",
      data: null
    });
  }

  res.json({
    message: "Latest data from database",
    data,
    timestamp: data.timestamp
  });
});

// Get latest telemetry data from database
router.get("/db/latest/telemetry", async (req, res) => {
  const data = await getLatestDataByType("telemetry");
  
  if (!data) {
    return res.status(404).json({
      message: "No telemetry data in database yet",
      data: null
    });
  }

  res.json({
    message: "Latest telemetry from database",
    data,
    timestamp: data.timestamp
  });
});

// Get latest defect data from database
router.get("/db/latest/defect", async (req, res) => {
  const data = await getLatestDataByType("defect");
  
  if (!data) {
    return res.status(404).json({
      message: "No defect data in database yet",
      data: null
    });
  }

  res.json({
    message: "Latest defect from database",
    data,
    timestamp: data.timestamp
  });
});

// Get data from last N minutes (default 10 minutes)
router.get("/db/history", async (req, res) => {
  const minutes = parseInt(req.query.minutes) || 10;
  const data = await getPlcDataByTimeRange(minutes);
  
  res.json({
    message: `Data from last ${minutes} minutes`,
    count: data.length,
    minutes,
    data
  });
});

// Receive defect detection result from Python AI server
router.post("/detect-result", async (req, res) => {
  const { defect, count, defectId, confidence, timestamp } = req.body;

  if (!defect) {
    return res.status(400).json({ message: "No defect in request" });
  }

  // Handle the defect result (add to queue)
  await handleDetectResult({
    defect,
    count,
    defectId,
    confidence,
    timestamp
  });

  res.json({
    success: true,
    message: "Defect queued for processing",
    processId: currentProcess?.processId || null,
    queueSize: defectQueue.length,
    isProcessing: isProcessingDefect
  });
});

// Get defect queue status
router.get("/defect-queue", (req, res) => {
  res.json({
    queueSize: defectQueue.length,
    isProcessing: isProcessingDefect,
    status: isProcessingDefect ? "Processing defect..." : (defectQueue.length > 0 ? `${defectQueue.length} waiting` : "Idle"),
    details: {
      total_queued: defectQueue.length,
      currently_processing: isProcessingDefect,
      estimated_time_remaining: isProcessingDefect ? "~500-600ms" : "0ms"
    }
  });
});

/* -------- TEST ENDPOINTS (FOR TESTING ONLY) -------- */

// Health check - PLC + Database
router.get("/test/health", (req, res) => {
  const mongoStatus = getMongoStatus();
  const plcStatus = getConnectionStatus();

  const allHealthy = mongoStatus.connected && plcStatus.isConnected;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "unhealthy",
    timestamp: new Date(),
    services: {
      mongodb: mongoStatus,
      plc: plcStatus
    },
    polling: {
      started: _pollingStarted,
      latestData: latestPlcData ? "Available" : "No data yet"
    }
  });
});

// Test PLC connection
router.get("/test/connection", async (req, res) => {
  try {
    await connectPLC();
    const status = getConnectionStatus();

    res.json({
      success: true,
      message: "PLC connection successful",
      status: {
        connected: status.isConnected,
        ip: status.ip,
        port: status.port
      }
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: "PLC connection failed",
      error: err.message,
      status: {
        connected: false,
        ip: getConnectionStatus().ip,
        port: getConnectionStatus().port
      }
    });
  }
});

// Test MongoDB connection and write
router.post("/test/database", async (req, res) => {
  const mongoStatus = getMongoStatus();

  if (!mongoStatus.connected) {
    return res.status(503).json({
      success: false,
      message: "MongoDB not connected",
      status: mongoStatus
    });
  }

  try {
    const testData = {
      type: "test",
      processId: uuidv4(),
      textileId: `TEST-${Date.now()}`,
      machineStatusCode: 1,
      machineStatus: "RUNNING",
      totalProduction: Math.floor(Math.random() * 2000),
      fabricLength: Math.floor(Math.random() * 1000),
      alarmCode: 0,
      timestamp: new Date()
    };

    const success = await insertPlcData(testData);

    if (success) {
      res.json({
        success: true,
        message: "Test data inserted successfully",
        status: mongoStatus,
        testData
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to insert test data",
        status: mongoStatus
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Database test error",
      error: err.message,
      status: mongoStatus
    });
  }
});

// Simulate process start (for testing without PLC)
router.post("/test/process-start", (req, res) => {
  if (currentProcess) {
    return res.status(400).json({ message: "Process already running" });
  }

  currentProcess = {
    processId: uuidv4(),
    textileId: generateTextileId(),
    startTime: new Date(),
    startProduction: latestPlcData?.totalProduction || 0,
    startLength: latestPlcData?.fabricLength || 0
  };

  console.log("🟢 TEST: Process Started:", currentProcess);

  res.json({
    success: true,
    message: "Process started (TEST MODE)",
    processId: currentProcess.processId,
    textileId: currentProcess.textileId
  });
});

// Simulate process end (for testing without PLC)
router.post("/test/process-end", async (req, res) => {
  if (!currentProcess) {
    return res.status(400).json({ message: "No process running" });
  }

  const endTime = new Date();

  const summary = {
    type: "process_summary",
    processId: currentProcess.processId,
    textileId: currentProcess.textileId,
    startTime: currentProcess.startTime,
    endTime,
    durationMinutes: (endTime - currentProcess.startTime) / 60000,
    production: (latestPlcData?.totalProduction || 0) - currentProcess.startProduction,
    fabricProcessed: (latestPlcData?.fabricLength || 0) - currentProcess.startLength
  };

  console.log("🔴 TEST: Process Ended:", summary);

  await insertPlcData(summary);

  const processId = currentProcess.processId;
  currentProcess = null;

  res.json({
    success: true,
    message: "Process ended (TEST MODE)",
    summary
  });
});

export default router;
