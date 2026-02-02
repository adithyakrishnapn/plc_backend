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

async function getPlcData() {
  try {
    await connectPLC();

    const res = await client.readHoldingRegisters(0, 2);

    return {
      temperature: res.data[0],
      pressure: res.data[1],
      timestamp: new Date()
    };
  } catch (err) {
    isConnected = false;
    console.error("PLC Error:", err.message);
    return null;
  }
}

export default getPlcData;
