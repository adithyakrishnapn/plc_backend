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

/* -------- READ (Manual Test) -------- */
export async function getPlcData() {
  try {
    await connectPLC();

    // Read D100 → D112
    const res = await client.readHoldingRegisters(1000, 13);
    const d = res.data;

    return {
      machineStatusCode: d[0],
      machineStatus: STATUS_MAP[d[0]] || "UNKNOWN",
      totalProduction: d[1],
      alarmCode: d[2],
      fabricLength: d[3],
      machineRunning: d[10],
      defectTrigger: d[11],
      stampComplete: d[12],
      timestamp: new Date()
    };

  } catch (err) {
    console.error("❌ PLC Read Error:", err.message);
    return null;
  }
}

/* -------- WRITE: DEFECT -------- */
export async function sendDefectTrigger() {
  try {
    await connectPLC();

    // Write 1 to D1111
    await client.writeRegister(1111, 1);

    console.log("🚨 D111 = 1 sent");
    return true;
  } catch (err) {
    console.error("❌ Write Error:", err.message);
    return false;
  }
}

/* -------- RESET -------- */
export async function resetDefectTrigger() {
  try {
    await connectPLC();

    await client.writeRegister(111, 0);
    console.log("🔄 D111 reset to 0");
    return true;
  } catch (err) {
    return false;
  }
}


/* -------- CONNECT ON START -------- */
export async function testPlcConnection() {
  try {
    await connectPLC();
    console.log(`🔌 PLC Connected at ${PLC_IP}:${PLC_PORT}`);
    return true;
  } catch (err) {
    console.error("❌ PLC not reachable");
    return false;
  }
}
