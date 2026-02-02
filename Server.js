// index.js
import express from "express";
import plcRoutes from "./Routes/PlcRoutes.js";
import cors from "cors";
const app = express();
const PORT = 3000;

app.use(cors());
// Store latest PLC data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Start Express server
app.use('/plc', plcRoutes);
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
