import express from "express";
import {
  getPlcData,
  sendDefectTrigger,
  resetDefectTrigger
} from "../PlcHelper.js";

const router = express.Router();

/* ---- Test Connection + Read ---- */
router.get("/read", async (req, res) => {
  const data = await getPlcData();

  if (!data) {
    return res.status(500).json({
      success: false,
      message: "Failed to read PLC"
    });
  }

  res.json({
    success: true,
    data
  });
});

/* ---- Send Defect (D111 = 1) ---- */
router.post("/defect", async (req, res) => {
  const success = await sendDefectTrigger();

  res.json({
    success,
    message: success
      ? "Defect trigger sent (D1111=1)"
      : "Failed to write PLC"
  });
});

/* ---- Reset Defect (D111 = 0) ---- */
router.post("/reset", async (req, res) => {
  const success = await resetDefectTrigger();

  res.json({
    success,
    message: success
      ? "Defect reset (D111=0)"
      : "Failed to reset PLC"
  });
});

export default router;
