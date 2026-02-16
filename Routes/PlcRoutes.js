import express from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

import { getPlcData, sendDefectTrigger, sendDefectTriggerSetOne, sendDefectTriggerSetZero, connectPLC, getConnectionStatus } from "../PlcHelper.js";
import { insertPlcData, getMongoStatus, getLatestPlcData, getLatestDataByType, getPlcDataByTimeRange } from "../MongoHelper.js";
import { generateTextileId } from "../processUtils.js";
import { DataQueue } from "../DataQueue.js";

const router = express.Router();

let latestPlcData = null;
let _pollingStarted = false;

let lastSavedData = null;
let lastProcessStart = 0;
let currentProcess = null;
let lastLengthForAI = 0;

/* -------- DEFECT QUEUE (Process defects via independent loop) -------- */
let defectQueue = [];
let isProcessingDefect = false;

// Note: Defect processing is now handled in startPlcPolling() as an independent interval
// This keeps it from blocking PLC polling




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

    // Queue process summary instead of direct insert
    DataQueue.pushToDbQueue(summary);

    currentProcess = null;
  }

  lastProcessStart = data.processStart;
}

/* -------- AI LOGIC (Receives POST from Python) ---------- */

async function handleDetectResult(defectData) {
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
}


/* ---------------- POLLING LOOP ---------------- */

async function readLoop() {
  try {
    // FAST: Read PLC data only (~20-50ms)
    const data = await getPlcData();
    
    if (!data) {
      return;
    }

    // Update in-memory latest data (quick)
    latestPlcData = data;

    // Process logic SYNCHRONOUSLY (no await/blocking)
    handleProcessLogic(data);

    // Check if telemetry should be saved - if yes, QUEUE it
    if (hasImportantChange(data)) {
      // Push to queue instead of waiting for DB insert
      DataQueue.pushToPlcQueue({
        type: "telemetry",
        processId: currentProcess?.processId || null,
        textileId: currentProcess?.textileId || null,
        ...data
      });

      // Mark as saved locally
      lastSavedData = { ...data };
      console.log("📤 Telemetry queued for DB (PLC queue: " + DataQueue.getQueueStats().plcQueueSize + ")");
    }

  } catch (err) {
    console.error("❌ PLC Polling Error:", err.message);
  }
}

/**
 * Database writer: processes telemetry queue independently
 */
async function dbWriterTelemetryLoop() {
  try {
    // No queue item processing - that will be done in main scheduler
  } catch (err) {
    console.error("❌ DB Writer Error:", err.message);
  }
}

export function startPlcPolling() {
  if (_pollingStarted) return;
  _pollingStarted = true;
  
  console.log("🔄 Starting NON-BLOCKING architecture:");
  console.log("   ✓ PLC polls every 1-2 seconds (FAST, never blocked by DB)");
  console.log("   ✓ Data queued for async DB writes");
  console.log("   ✓ Socket stays responsive & active");
  
  // Fast PLC polling loop (1-2 second interval)
  setInterval(async () => {
    await readLoop();
  }, 1500);

  // Database writer loop (continual, processes queue)
  setInterval(async () => {
    const record = DataQueue.popFromPlcQueue();
    if (record) {
      try {
        const success = await insertPlcData(record.data);
        if (success) {
          console.log("✅ Telemetry DB write complete");
        }
      } catch (err) {
        console.error("❌ Telemetry DB write failed:", err.message);
      }
    }
  }, 100); // Check queue every 100ms

  // Defect processor (independent)
  setInterval(async () => {
    if (isProcessingDefect || defectQueue.length === 0) return;

    isProcessingDefect = true;
    const defectData = defectQueue.shift();

    try {
      if (!currentProcess || (latestPlcData && latestPlcData.machineRunning !== 1)) {
        isProcessingDefect = false;
        return;
      }

      console.log(`❗ Processing Defect [${defectData.defectId}]: ${defectData.count} holes`);
      await sendDefectTrigger();

      const success = await insertPlcData({
        type: "defect",
        processId: currentProcess.processId,
        textileId: currentProcess.textileId,
        count: defectData.count,
        defectId: defectData.defectId,
        confidence: defectData.confidence,
        lengthAtDetection: latestPlcData?.fabricLength || null,
        timestamp: new Date()
      });

      if (success) {
        console.log(`✅ Defect #${defectData.defectId} complete (${defectQueue.length} queued)`);
      }
    } catch (err) {
      console.error("❌ Defect processing error:", err.message);
    } finally {
      isProcessingDefect = false;
    }
  }, 50); // Check defect queue every 50ms
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

/* -------- DEFECT REGISTER TEST ENDPOINTS -------- */

// Test the defect register (1 -> 0 with 2 second delay)
router.post("/test/trigger-defect-register", async (req, res) => {
  try {
    const startTime = Date.now();
    console.log("🧪 TEST: Triggering defect register...");
    
    // Trigger the defect register
    await sendDefectTrigger();
    
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      message: "Defect register triggered successfully",
      timestamp: new Date(),
      details: {
        register: "D111",
        sequence: "1 -> (wait 2 seconds) -> 0",
        duration_ms: duration,
        expected_duration_ms: 2000,
        status: "Complete"
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to trigger defect register",
      error: err.message
    });
  }
});

// Manually set defect register to 1
router.post("/test/defect-register/set-1", async (req, res) => {
  try {
    console.log("🧪 TEST: Setting D111 = 1");
    await sendDefectTriggerSetOne();
    
    res.json({
      success: true,
      message: "Defect register set to 1",
      register: "D111",
      value: 1,
      status: "Register ON ⚠️",
      nextAction: "Use POST /plc/test/defect-register/reset-0 to reset"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to set register",
      error: err.message
    });
  }
});

// Manually set defect register to 0
router.post("/test/defect-register/reset-0", async (req, res) => {
  try {
    console.log("🧪 TEST: Resetting D111 = 0");
    await sendDefectTriggerSetZero();
    
    res.json({
      success: true,
      message: "Defect register reset to 0",
      register: "D111",
      value: 0,
      status: "Register OFF ✅"
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to reset register",
      error: err.message
    });
  }
});

// Get current defect register status
router.get("/test/defect-register/status", (req, res) => {
  const registerValue = latestPlcData?.defectRegister || 0;
  
  res.json({
    register: "D111",
    currentValue: registerValue,
    status: registerValue === 1 ? "DEFECT DETECTED ⚠️" : "NORMAL ✅",
    timestamp: latestPlcData?.timestamp || new Date()
  });
});

// Production endpoint: Get current defect register status (for AI sync)
router.get("/defect-register/status", (req, res) => {
  const registerValue = latestPlcData?.defectRegister || 0;
  
  res.json({
    register: "D111",
    value: registerValue,
    isActive: registerValue === 1,
    timestamp: latestPlcData?.timestamp || new Date()
  });
});

export default router;
