import ModbusRTU from "modbus-serial";

const client = new ModbusRTU();
let isConnected = false;

async function connectPLC() {
  if (!isConnected) {
    await client.connectTCP("192.168.1.50", { port: 502 });
    client.setID(1);
    isConnected = true;
    console.log("Connected to PLC");
  }
}

const STATUS_MAP = ["STOPPED", "RUNNING", "IDLE", "FAULT"];

async function getPlcData() {
  try {
    await connectPLC();

    // Read D100 → D109
    const res = await client.readHoldingRegisters(100, 10);
    const d = res.data;

    return {
      machineStatus: STATUS_MAP[d[0]],
      shiftWorkingHours: (d[1] / 3600).toFixed(1),
      totalUptimeHours: (d[2] / 3600).toFixed(1),

      todayProduction: d[3],
      totalProduction: d[4],

      fabricLengthMeters: (d[5] / 100).toFixed(2),
      machineSpeed: d[6] / 10,

      utilizationPercent: d[7],
      downtimeMinutes: (d[8] / 60).toFixed(1),

      alarmCode: d[9],
      timestamp: new Date()
    };

  } catch (err) {
    isConnected = false;
    console.error("PLC Error:", err.message);
    return null;
  }
}

export default getPlcData;
