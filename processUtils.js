import { v4 as uuidv4 } from "uuid";

/* ---------------- PROCESS ID ---------------- */

export function generateProcessId() {
  return uuidv4();
}

/* ---------------- TEXTILE ID ---------------- */
/*
Format:
ROLL-YYYYMMDD-HHMMSS
Example:
ROLL-20260211-154530
*/

export function generateTextileId() {
  const now = new Date();

  const date =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const time =
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");

  return `ROLL-${date}-${time}`;
}

/* ---------------- PROCESS START OBJECT ---------------- */

export function createNewProcess(data) {
  return {
    processId: generateProcessId(),
    textileId: generateTextileId(),
    startTime: new Date(),
    startProduction: data.totalProduction,
    startLength: data.fabricLength
  };
}

/* ---------------- PROCESS SUMMARY ---------------- */

export function createProcessSummary(process, data) {
  const endTime = new Date();

  return {
    type: "process_summary",
    processId: process.processId,
    textileId: process.textileId,

    startTime: process.startTime,
    endTime,

    durationMinutes:
      (endTime - process.startTime) / 60000,

    production:
      data.totalProduction - process.startProduction,

    fabricProcessed:
      data.fabricLength - process.startLength
  };
}
