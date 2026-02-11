import mongoose from "mongoose";

const plcSchema = new mongoose.Schema({
  type: String,

  processId: String,
  textileId: String,

  machineStatusCode: Number,
  machineStatus: String,
  machineRunning: Number,

  totalProduction: Number,
  fabricLength: Number,
  alarmCode: Number,

  count: Number,
  lengthAtDetection: Number,

  startTime: Date,
  endTime: Date,
  durationMinutes: Number,
  production: Number,
  fabricProcessed: Number,

  timestamp: { type: Date, default: Date.now }
});

export const PlcModel = mongoose.model("PlcData", plcSchema);

export async function insertPlcData(data) {
  try {
    await PlcModel.create(data);
  } catch (err) {
    console.error("Mongo Insert Error:", err.message);
  }
}
