import express from "express";
import plcRoutes, { startPlcPolling } from "./Routes/PlcRoutes.js";
import { connectMongo } from "./MongoHelper.js";
import dotenv from "dotenv";
import cors from "cors";
const app = express();
const PORT = 3000;
dotenv.config()

app.use(cors());
// Store latest PLC data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Start Express server
app.use('/plc', plcRoutes);
// Connect to MongoDB first, then start server and polling
try {
  await connectMongo();
} catch (err) {
  console.warn("MongoDB not connected on startup:", err.message);
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  // Start PLC polling after server is listening
  startPlcPolling();
});
