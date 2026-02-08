import express from "express";
import plcRoutes from "./Routes/PlcRoutes.js";
import { testPlcConnection } from "./PlcHelper.js";

const app = express();
const PORT = 3000;

app.use(express.json());
app.use("/plc", plcRoutes);

app.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);

  // Test PLC connection on startup
  const plcOk = await testPlcConnection();

  if (!plcOk) {
    console.log("⚠️ PLC connection failed. Check IP / Network.");
  }
});
