import express from "express";
import { v4 as uuidv4 } from "uuid";
import { 
  insertPlcData, 
  getLatestPlcData, 
  getLatestDataByType,
  getPlcDataByTimeRange,
  getMongoStatus
} from "../MongoHelper.js";
import { generateTextileId } from "../processUtils.js";

const router = express.Router();

/* -------- SAMPLE DATA GENERATORS -------- */

/**
 * Generate realistic telemetry data for testing
 */
function generateSampleTelemetry(processId = null, textileId = null) {
  return {
    type: "telemetry",
    timestamp: new Date(),
    processId: processId || uuidv4(),
    textileId: textileId || generateTextileId(),
    machineStatusCode: Math.floor(Math.random() * 3),
    machineStatus: ["IDLE", "RUNNING", "ERROR"][Math.floor(Math.random() * 3)],
    machineRunning: Math.floor(Math.random() * 2),
    totalProduction: Math.floor(Math.random() * 10000),
    fabricLength: Math.floor(Math.random() * 5000),
    alarmCode: Math.floor(Math.random() * 20),
    defectRegister: Math.floor(Math.random() * 10),
    processStart: Math.floor(Math.random() * 2)
  };
}

/**
 * Generate realistic defect data for testing
 */
function generateSampleDefect(processId = null, textileId = null) {
  return {
    type: "defect",
    timestamp: new Date(),
    processId: processId || uuidv4(),
    textileId: textileId || generateTextileId(),
    count: Math.floor(Math.random() * 5) + 1,
    lengthAtDetection: Math.floor(Math.random() * 3000),
    defectId: `DEFECT-${uuidv4().substring(0, 8)}`,
    confidence: Math.random().toFixed(2)
  };
}

/**
 * Generate realistic process summary data for testing
 */
function generateSampleProcessSummary(startTime = null) {
  const start = startTime || new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
  const end = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
  const duration = (end - start) / 60000;

  return {
    type: "process_summary",
    timestamp: new Date(),
    processId: uuidv4(),
    textileId: generateTextileId(),
    startTime: start,
    endTime: end,
    durationMinutes: parseFloat(duration.toFixed(2)),
    production: Math.floor(Math.random() * 5000),
    fabricProcessed: Math.floor(Math.random() * 3000)
  };
}

/* -------- TEST ENDPOINTS -------- */

/**
 * Insert a single telemetry record
 * GET /test-data/telemetry
 */
router.get("/telemetry", async (req, res) => {
  const data = generateSampleTelemetry();
  const success = await insertPlcData(data);

  if (success) {
    res.json({
      success: true,
      message: "✅ Telemetry data inserted",
      data
    });
  } else {
    res.status(500).json({
      success: false,
      message: "❌ Failed to insert telemetry",
      data
    });
  }
});

/**
 * Insert a single defect record
 * GET /test-data/defect
 */
router.get("/defect", async (req, res) => {
  const data = generateSampleDefect();
  const success = await insertPlcData(data);

  if (success) {
    res.json({
      success: true,
      message: "✅ Defect data inserted",
      data
    });
  } else {
    res.status(500).json({
      success: false,
      message: "❌ Failed to insert defect",
      data
    });
  }
});

/**
 * Insert a process summary record
 * GET /test-data/process-summary
 */
router.get("/process-summary", async (req, res) => {
  const data = generateSampleProcessSummary();
  const success = await insertPlcData(data);

  if (success) {
    res.json({
      success: true,
      message: "✅ Process summary inserted",
      data
    });
  } else {
    res.status(500).json({
      success: false,
      message: "❌ Failed to insert process summary",
      data
    });
  }
});

/**
 * Bulk insert multiple records of each type
 * GET /test-data/bulk?count=10
 */
router.get("/bulk", async (req, res) => {
  const count = parseInt(req.query.count) || 5;
  const results = {
    telemetry: { success: 0, failed: 0 },
    defect: { success: 0, failed: 0 },
    process: { success: 0, failed: 0 }
  };

  try {
    // Insert telemetry records
    for (let i = 0; i < count; i++) {
      const success = await insertPlcData(generateSampleTelemetry());
      if (success) results.telemetry.success++;
      else results.telemetry.failed++;
    }

    // Insert defect records
    for (let i = 0; i < count; i++) {
      const success = await insertPlcData(generateSampleDefect());
      if (success) results.defect.success++;
      else results.defect.failed++;
    }

    // Insert process summaries
    for (let i = 0; i < count; i++) {
      const success = await insertPlcData(generateSampleProcessSummary());
      if (success) results.process.success++;
      else results.process.failed++;
    }

    res.json({
      success: true,
      message: `✅ Bulk insert completed (${count} of each type)`,
      results,
      total: {
        inserted: results.telemetry.success + results.defect.success + results.process.success,
        failed: results.telemetry.failed + results.defect.failed + results.process.failed
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "❌ Bulk insert error",
      error: err.message,
      results
    });
  }
});

/**
 * Insert a complete process scenario (start → telemetry → defects → end)
 * GET /test-data/scenario
 */
router.get("/scenario", async (req, res) => {
  const processId = uuidv4();
  const textileId = generateTextileId();
  const startTime = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago

  const results = {
    process_start: null,
    telemetry_records: [],
    defects: [],
    process_end: null
  };

  try {
    // 1. Insert initial telemetry with processStart = 1
    const startTelemetry = {
      ...generateSampleTelemetry(processId, textileId),
      processStart: 1,
      machineRunning: 1
    };
    let success = await insertPlcData(startTelemetry);
    results.process_start = success ? { ...startTelemetry, _id: "inserted" } : null;

    // 2. Insert 3 telemetry records during process
    for (let i = 0; i < 3; i++) {
      const telemetry = {
        ...generateSampleTelemetry(processId, textileId),
        processStart: 1,
        machineRunning: 1,
        timestamp: new Date(startTime.getTime() + i * 5 * 60 * 1000)
      };
      success = await insertPlcData(telemetry);
      if (success) results.telemetry_records.push(telemetry);
    }

    // 3. Insert 2 defects during process
    for (let i = 0; i < 2; i++) {
      const defect = {
        ...generateSampleDefect(processId, textileId),
        timestamp: new Date(startTime.getTime() + i * 7 * 60 * 1000)
      };
      success = await insertPlcData(defect);
      if (success) results.defects.push(defect);
    }

    // 4. Insert process summary (end)
    const processSummary = {
      type: "process_summary",
      timestamp: new Date(),
      processId,
      textileId,
      startTime,
      endTime: new Date(Date.now() - 2 * 60 * 1000),
      durationMinutes: 13,
      production: 4500,
      fabricProcessed: 2800
    };
    success = await insertPlcData(processSummary);
    results.process_end = success ? processSummary : null;

    res.json({
      success: true,
      message: "✅ Complete process scenario inserted",
      processId,
      textileId,
      results
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "❌ Scenario insert error",
      error: err.message,
      results
    });
  }
});

/**
 * Get latest records of each type
 * GET /test-data/latest
 */
router.get("/latest", async (req, res) => {
  try {
    const latest = await getLatestPlcData();
    const latestTelemetry = await getLatestDataByType("telemetry");
    const latestDefect = await getLatestDataByType("defect");
    const latestProcess = await getLatestDataByType("process_summary");

    res.json({
      message: "Latest records from database",
      latest: {
        any: latest,
        telemetry: latestTelemetry,
        defect: latestDefect,
        process_summary: latestProcess
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "❌ Error fetching latest",
      error: err.message
    });
  }
});

/**
 * Get records from last N minutes
 * GET /test-data/history?minutes=30
 */
router.get("/history", async (req, res) => {
  const minutes = parseInt(req.query.minutes) || 30;

  try {
    const data = await getPlcDataByTimeRange(minutes);

    // Categorize by type
    const stats = {
      total: data.length,
      telemetry: 0,
      defect: 0,
      process_summary: 0
    };

    for (const doc of data) {
      if (doc.type) {
        stats[doc.type] = (stats[doc.type] || 0) + 1;
      }
    }

    res.json({
      message: `Data from last ${minutes} minutes`,
      minutes,
      stats,
      data: data.slice(0, 20) // Return first 20 for brevity
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "❌ Error fetching history",
      error: err.message
    });
  }
});

/**
 * Database status and counts
 * GET /test-data/status
 */
router.get("/status", async (req, res) => {
  try {
    const mongoStatus = getMongoStatus();
    const latest = await getLatestPlcData();
    const last30Min = await getPlcDataByTimeRange(30);

    // Count by type
    const typeCounts = {};
    for (const doc of last30Min) {
      if (doc.type) {
        typeCounts[doc.type] = (typeCounts[doc.type] || 0) + 1;
      }
    }

    res.json({
      status: mongoStatus.connected ? "✅ Connected" : "❌ Disconnected",
      mongodb: mongoStatus,
      latest_record: latest ? {
        type: latest.type,
        timestamp: latest.timestamp,
        id: latest._id
      } : null,
      last_30_minutes: {
        total: last30Min.length,
        by_type: typeCounts
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "❌ Status check error",
      error: err.message
    });
  }
});

export default router;
