import ModbusRTU from "modbus-serial";
import dotenv from "dotenv";

dotenv.config();

const client = new ModbusRTU();
const PLC_IP = process.env.PLC_IP || "192.168.1.1";
const PLC_PORT = Number(process.env.PLC_PORT) || 502;
const PLC_UNIT_ID = Number(process.env.PLC_UNIT_ID) || 1;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testRegister(registerAddress) {
  try {
    console.log(`   Testing D${registerAddress}...`, );
    const startTime = Date.now();
    
    const res = await client.readHoldingRegisters(registerAddress, 1);
    const readTime = Date.now() - startTime;
    
    const value = res.data[0];
    const status = value === 0 ? "⚠️ (contains 0)" : "✅";
    
    console.log(`   ✅ D${registerAddress}: ${value} ${status} [${readTime}ms]`);
    return { address: registerAddress, value, success: true, time: readTime };
    
  } catch (err) {
    console.log(`   ❌ D${registerAddress}: TIMEOUT/ERROR - ${err.message}`);
    return { address: registerAddress, value: null, success: false, error: err.message };
  }
}

async function diagnoseRegisters() {
  console.log("\n" + "=".repeat(70));
  console.log("🔧 PLC REGISTER DIAGNOSTIC");
  console.log("=".repeat(70));
  console.log(`Target: ${PLC_IP}:${PLC_PORT} (Unit ID: ${PLC_UNIT_ID})\n`);

  try {
    console.log("🔌 Connecting to PLC...");
    await client.connectTCP(PLC_IP, { port: PLC_PORT, timeout: 5000 });
    client.setID(PLC_UNIT_ID);
    console.log("✅ Connected\n");

  } catch (err) {
    console.error("❌ Cannot connect to PLC:", err.message);
    return;
  }

  // Test each register individually
  const registersToTest = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
  
  console.log("📋 Testing Individual Registers:\n");
  const results = [];
  
  for (const reg of registersToTest) {
    const result = await testRegister(reg);
    results.push(result);
    await delay(200); // 200ms between reads to avoid overload
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("📊 SUMMARY:\n");
  
  const working = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const zeros = results.filter(r => r.success && r.value === 0);
  
  console.log(`✅ Working Registers: ${working.length}/${registersToTest.length}`);
  if (working.length > 0) {
    working.forEach(r => console.log(`   D${r.address}: ${r.value}`));
  }
  
  if (zeros.length > 0) {
    console.log(`\n⚠️ Registers with Value 0 (not configured?): ${zeros.length}`);
    zeros.forEach(r => console.log(`   D${r.address}: 0`));
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed/Timeout Registers: ${failed.length}`);
    failed.forEach(r => console.log(`   D${r.address}: ${r.error}`));
  }

  // Recommendations
  console.log("\n" + "=".repeat(70));
  console.log("💡 RECOMMENDATIONS:\n");
  
  if (failed.length > 0) {
    console.log("1. ❌ These registers don't exist or PLC won't respond to them:");
    failed.forEach(r => console.log(`   - D${r.address}`));
    console.log("\n   ACTION: Update PlcHelper.js to NOT read these registers");
  }
  
  if (zeros.length > 0) {
    console.log(`2. ⚠️ These registers exist but are NOT CONFIGURED in PLC (value = 0):`);
    zeros.forEach(r => console.log(`   - D${r.address}`));
    console.log("\n   ACTION: Either configure them in PLC or handle 0 values in code");
  }
  
  console.log("\n3. ✅ Use only the working registers in PlcHelper.js:");
  const workingAddresses = working.map(r => r.address).join(", ");
  console.log(`   Registers to use: D${workingAddresses}`);

  console.log("\n" + "=".repeat(70) + "\n");

  // Close connection
  try {
    await client.close();
  } catch (err) {
    console.error("Error closing connection:", err.message);
  }
}

diagnoseRegisters().catch(err => console.error("Fatal Error:", err));
