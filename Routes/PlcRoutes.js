import express from "express";
import getPlcData from "../PlcHelper.js";

const router = express.Router();
let latestPlcData = null;

// Function to continuously read PLC
async function readLoop() {
  const data = await getPlcData();
  if (data) {
    latestPlcData = data; // store latest data
    console.log("PLC Data:", data);
  }
  setTimeout(readLoop, 2000); // repeat every 2 seconds
}

// Start reading loop
readLoop();

// Simple API to get the latest PLC data
router.get("/latest", (req, res) => {
  if (!latestPlcData) {
    return res.status(503).json({ message: "PLC data not available yet" });
  }
  res.json(latestPlcData);
});
// Simple route to check API status
router.get("/status", (req, res) => {
  res.json({ status: "PLC API is running" });
});

export default router;