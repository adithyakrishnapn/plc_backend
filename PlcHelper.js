import ModbusRTU from "modbus-serial";

const client = new ModbusRTU();

const PLC_IP = "192.168.1.50";
const PLC_PORT = 502;

let isConnected = false;

client.setTimeout(2000);

async function connectPLC() {
  try {
    if (!isConnected || !client.isOpen) {
      await client.connectTCP(PLC_IP, { port: PLC_PORT });
      isConnected = true;
      console.log("✅ Connected to PLC");
    }
  } catch (err) {
    isConnected = false;
    console.error("❌ Connection Error:", err.message);
    throw err;
  }
}

const STATUS_MAP = ["STOPPED", "RUNNING", "IDLE", "FAULT"];

async function getPlcData() {
  try {
    await connectPLC();

    // Read D100 → D112 (13 registers)
    const res = await client.readHoldingRegisters(100, 13);
    const d = res.data;

    return {
      machineStatusCode: d[0],
      machineStatus: STATUS_MAP[d[0]] || "UNKNOWN",

      totalProduction: d[1],     // D101
      alarmCode: d[2],           // D102
      fabricLength: d[3],        // D103 (meters or mm based on PLC)

      machineRunning: d[10],     // D110 (0/1)
      defectTrigger: d[11],      // D111 (for monitoring)
      stampComplete: d[12],      // D112

      timestamp: new Date()
    };

  } catch (err) {
    isConnected = false;
    console.error("❌ PLC Read Error:", err.message);
    return null;
  }
}

/* ----------- WRITE: AI DEFECT → PLC ----------- */
export async function sendDefectTrigger() {
  try {
    await connectPLC();

    // Write 1 to D111
    await client.writeRegister(111, 1);

    console.log("🚨 Defect trigger sent (D111)");
    return true;
  } catch (err) {
    console.error("❌ PLC Write Error:", err.message);
    return false;
  }
}

/* Optional: reset trigger after PLC action */
export async function resetDefectTrigger() {
  try {
    await connectPLC();
    await client.writeRegister(111, 0);
    return true;
  } catch (err) {
    return false;
  }
}

export default getPlcData;
