import ModbusRTU from "modbus-serial";
import dotenv from "dotenv";

dotenv.config();

const client = new ModbusRTU();

const PLC_IP = process.env.PLC_IP || "192.168.1.1";
const PLC_PORT = Number(process.env.PLC_PORT) || 502;

let isConnected = false;
client.setTimeout(2000);

// --------------------
// PLC Connection
// --------------------
export async function connectPLC() {
  try {
    if (!isConnected || !client.isOpen) {
      await client.connectTCP(PLC_IP, { port: PLC_PORT });
      isConnected = true;
      console.log(`✅ PLC Connected to ${PLC_IP}:${PLC_PORT}`);
    }
  } catch (err) {
    isConnected = false;
    console.error("❌ PLC Connection Error:", err.message);
    throw err;
  }
}

// Test connection status
export function getConnectionStatus() {
  return {
    isConnected,
    ip: PLC_IP,
    port: PLC_PORT
  };
}

// --------------------
// Machine Status Map
// --------------------
const STATUS_MAP = ["STOPPED", "RUNNING", "IDLE", "FAULT"];

// --------------------
// READ PLC DATA
// --------------------
export async function getPlcData() {
  try {
    await connectPLC();

    // Read D100 to D111
    const res = await client.readHoldingRegisters(100, 12);
    const d = res.data;

    return {
      machineStatusCode: d[0],        // D100
      machineStatus: STATUS_MAP[d[0]] || "UNKNOWN",

      totalProduction: d[1],          // D101
      alarmCode: d[2],                // D102
      fabricLength: d[3],             // D103

      processStart: d[6],             // D106 (Start Trigger)
      machineRunning: d[10],          // D110
      defectRegister: d[11],          // D111

      timestamp: new Date()
    };

  } catch (err) {
    console.error("❌ PLC Read Error:", err.message);
    return null;
  }
}

// --------------------
// WRITE DEFECT TRIGGER
// --------------------
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendDefectTrigger() {
  try {
    await connectPLC();

    await client.writeRegister(111, 1);
    console.log("🚨 D111 = 1");

    await delay(500);

    await client.writeRegister(111, 0);
    console.log("✅ D111 = 0");

    return true;

  } catch (err) {
    isConnected = false;
    console.error("❌ PLC Write Error:", err.message);
    return false;
  }
}

// --------------------
// GENERATE TEXTILE / PROCESS ID
// --------------------
export function generateTextileId() {
  const now = new Date();

  const date =
    now.getFullYear().toString().slice(2) +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");

  const time =
    now.getHours().toString().padStart(2, "0") +
    now.getMinutes().toString().padStart(2, "0") +
    now.getSeconds().toString().padStart(2, "0");

  return `TXT-${date}-${time}`;
}
