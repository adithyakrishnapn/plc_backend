import mongoose from "mongoose";

// Base schema (matches server/models/Base.js)
const options = { 
  discriminatorKey: 'type', 
  collection: 'plc_data',  // ✅ FIXED: Use correct collection name
  timestamps: false // Use explicit timestamp fields
};

const baseSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now }
}, options);

const BaseModel = mongoose.model('PLCData', baseSchema);

// ============ TELEMETRY SCHEMA ============
const telemetrySchema = new mongoose.Schema({
  processId: String,
  textileId: String,
  machineStatusCode: Number,
  machineStatus: String,
  machineRunning: Number,
  totalProduction: Number,
  fabricLength: Number,
  alarmCode: Number,
  // Additional telemetry fields for consistency
  defectRegister: Number,
  processStart: Number
}, { discriminatorKey: 'type' });

export const TelemetryModel = BaseModel.discriminator('telemetry', telemetrySchema);

// ============ DEFECT SCHEMA ============
const defectSchema = new mongoose.Schema({
  processId: String,
  textileId: String,
  count: Number,
  lengthAtDetection: Number,
  defectId: String,
  confidence: Number
}, { discriminatorKey: 'type' });

export const DefectModel = BaseModel.discriminator('defect', defectSchema);

// ============ PROCESS SUMMARY SCHEMA ============
const processSummarySchema = new mongoose.Schema({
  processId: String,
  textileId: String,
  startTime: Date,
  endTime: Date,
  durationMinutes: Number,
  production: Number,              // ✅ FIXED: Direct field, not nested
  fabricProcessed: Number          // ✅ FIXED: Direct field
}, { discriminatorKey: 'type' });

export const ProcessSummaryModel = BaseModel.discriminator('process_summary', processSummarySchema);

// ============ LEGACY SUPPORT ============
// For backward compatibility
export const PlcModel = BaseModel;
export { BaseModel };


export async function insertPlcData(data) {
  try {
    if (!mongoose.connection.readyState) {
      console.error("❌ MongoDB not connected (readyState:", mongoose.connection.readyState, ")");
      return false;
    }

    // Route data to correct model based on type
    let Model;
    switch (data.type) {
      case 'telemetry':
        Model = TelemetryModel;
        break;
      case 'defect':
        Model = DefectModel;
        break;
      case 'process_summary':
        Model = ProcessSummaryModel;
        break;
      default:
        Model = BaseModel;
    }

    const result = await Model.create(data);
    console.log(`✅ Data inserted - Type: ${data.type}, ID: ${result._id}`);
    return true;
  } catch (err) {
    console.error("❌ Mongo Insert Error:", err.message);
    console.error("   Data that failed:", JSON.stringify(data, null, 2));
    return false;
  }
}

// Check MongoDB connection status
export function getMongoStatus() {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting"
  };
  return {
    connected: mongoose.connection.readyState === 1,
    state: states[mongoose.connection.readyState] || "unknown",
    database: mongoose.connection.name || "none"
  };
}


// Fetch latest data from database
export async function getLatestPlcData() {
  try {
    const latestData = await BaseModel.findOne().sort({ timestamp: -1 }).exec();
    return latestData;
  } catch (err) {
    console.error("❌ Error fetching latest data:", err.message);
    return null;
  }
}

// Fetch latest data by type
export async function getLatestDataByType(type) {
  try {
    const latestData = await BaseModel.findOne({ type }).sort({ timestamp: -1 }).exec();
    return latestData;
  } catch (err) {
    console.error("❌ Error fetching latest data by type:", err.message);
    return null;
  }
}

// Fetch all data from last N minutes
export async function getPlcDataByTimeRange(minutes) {
  try {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const data = await BaseModel.find({ timestamp: { $gte: since } })
      .sort({ timestamp: -1 })
      .exec();
    return data;
  } catch (err) {
    console.error("❌ Error fetching data by time range:", err.message);
    return [];
  }
}
