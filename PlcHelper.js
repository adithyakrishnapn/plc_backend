import ModbusRTU from "modbus-serial";
import dotenv from "dotenv";

dotenv.config();

const client = new ModbusRTU();

const PLC_IP = process.env.PLC_IP || "192.168.1.1";
const PLC_PORT = Number(process.env.PLC_PORT) || 502;
const PLC_UNIT_ID = Number(process.env.PLC_UNIT_ID) || 1;  // Default Unit ID = 1

let isConnected = false;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second between retries

// Simple mutex to ensure ALL Modbus operations are serialized over a single TCP connection.
// This prevents overlapping read/write requests which many PLCs and the modbus-serial client
// do not handle well.
let plcLock = Promise.resolve();

function withPlcLock(fn) {
  const run = plcLock.then(() => fn());

  // Ensure the chain continues even if an operation fails
  plcLock = run.catch(() => {});

  return run;
}

// Increase timeout to 5 seconds for better reliability
client.setTimeout(5000);
client.setMaxListeners(20);

// --------------------
// PLC Connection with Persistent Connection (No Reconnect)
// --------------------
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function connectPLC() {
  try {
    // ✅ Keep connection open - don't reconnect if already connected
    if (isConnected && client.isOpen) {
      return;  // Reuse existing persistent connection
    }

    // Try to connect with retry logic (only on first attempt)
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        console.log(`🔌 PLC Connection Attempt ${attempt}/${MAX_RETRY_ATTEMPTS}...`);
        
        await client.connectTCP(PLC_IP, { 
          port: PLC_PORT,
          timeout: 5000  // Timeout for this initial connection only
        });
        
        // ✅ Set Unit ID after TCP connection
        client.setID(PLC_UNIT_ID);
        console.log(`   Unit ID set to: ${PLC_UNIT_ID}`);
        
        isConnected = true;
        connectionAttempts = 0;
        console.log(`✅ PLC Connected PERSISTENTLY to ${PLC_IP}:${PLC_PORT} (Unit ID: ${PLC_UNIT_ID})`);
        console.log(`   ⚡ Connection will stay open for operations (no reconnect)`);
        return;
        
      } catch (err) {
        console.warn(`⚠️ Connection attempt ${attempt} failed: ${err.message}`);
        
        if (attempt < MAX_RETRY_ATTEMPTS) {
          console.log(`⏳ Retrying in ${RETRY_DELAY}ms...`);
          await delay(RETRY_DELAY);
        } else {
          isConnected = false;
          throw new Error(`Failed to connect after ${MAX_RETRY_ATTEMPTS} attempts: ${err.message}`);
        }
      }
    }

  } catch (err) {
    isConnected = false;
    connectionAttempts++;
    console.error(`❌ PLC Connection Error: ${err.message}`);
    throw err;
  }
}

// Gracefully close connection
export async function disconnectPLC() {
  try {
    if (client.isOpen) {
      await client.close();
      isConnected = false;
      console.log("✅ PLC Connection Closed");
    }
  } catch (err) {
    console.error("⚠️ Error closing PLC connection:", err.message);
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
// READ PLC DATA with Retry Logic
// --------------------
export async function getPlcData() {
  return withPlcLock(async () => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      await connectPLC();

      // ✅ EFFICIENT: Read all 12 registers in one Modbus command (D100-D111)
      // Non-blocking architecture handles any register delays gracefully
      const res = await client.readHoldingRegisters(100, 12);
      const data = res.data;

      return {
        machineStatusCode: data[0],    // D100
        machineStatus: STATUS_MAP[data[0]] || "UNKNOWN",
        totalProduction: data[1],      // D101
        alarmCode: data[2],            // D102
        fabricLength: data[3],         // D103
        processStart: data[6],         // D106
        machineRunning: data[10],      // D110
        defectRegister: data[11],      // D111
        timestamp: new Date()
      };

    } catch (err) {
      lastError = err;
      console.error(`⚠️ PLC Read attempt ${attempt} failed: ${err.message}`);

      // Only mark as disconnected if the underlying TCP socket is actually closed.
      if (!client.isOpen) {
        isConnected = false;
      }

      if (attempt < MAX_RETRY_ATTEMPTS) {
        console.log(`⏳ Retrying read in ${RETRY_DELAY}ms...`);
        await delay(RETRY_DELAY);
      }
    }
  }
  
  console.error(`❌ PLC Read Error after ${MAX_RETRY_ATTEMPTS} attempts:`, lastError.message);
  return null;
  });
}

// --------------------
// WRITE DEFECT TRIGGER with Retry Logic
// --------------------

export async function sendDefectTrigger() {
  return withPlcLock(async () => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      await connectPLC();

      await client.writeRegister(111, 1);
      console.log("🚨 DEFECT DETECTED: D111 = 1");

      // Wait 2 seconds before resetting
      await delay(2000);

      await client.writeRegister(111, 0);
      console.log("✅ DEFECT CLEARED: D111 = 0");

      return true;

    } catch (err) {
      lastError = err;
      console.error(`⚠️ PLC Write attempt ${attempt} failed: ${err.message}`);

      // Only mark as disconnected if the underlying TCP socket is actually closed.
      if (!client.isOpen) {
        isConnected = false;
      }

      if (attempt < MAX_RETRY_ATTEMPTS) {
        console.log(`⏳ Retrying write in ${RETRY_DELAY}ms...`);
        await delay(RETRY_DELAY);
      }
    }
  }
  
  console.error(`❌ PLC Write Error after ${MAX_RETRY_ATTEMPTS} attempts:`, lastError.message);
  return false;
  });
}

// Set defect register to 1 only (for testing)
export async function sendDefectTriggerSetOne() {
  return withPlcLock(async () => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      await connectPLC();
      await client.writeRegister(111, 1);
      console.log("🚨 TEST: D111 = 1");
      return true;
    } catch (err) {
      lastError = err;
      console.error(`⚠️ Write attempt ${attempt} failed: ${err.message}`);

      if (!client.isOpen) {
        isConnected = false;
      }
      
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await delay(RETRY_DELAY);
      }
    }
  }
  
  console.error("❌ Failed to set D111 = 1 after retries");
  return false;
  });
}

// Set defect register to 0 only (for testing)
export async function sendDefectTriggerSetZero() {
  return withPlcLock(async () => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      await connectPLC();
      await client.writeRegister(111, 0);
      console.log("✅ TEST: D111 = 0");
      return true;
    } catch (err) {
      lastError = err;
      console.error(`⚠️ Write attempt ${attempt} failed: ${err.message}`);

      if (!client.isOpen) {
        isConnected = false;
      }
      
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await delay(RETRY_DELAY);
      }
    }
  }
  
  console.error("❌ Failed to set D111 = 0 after retries");
  return false;
  });
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
