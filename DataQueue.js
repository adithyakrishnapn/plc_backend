/**
 * Non-blocking data queue system
 * 
 * Purpose: Decouple PLC polling from database writes
 * - PLC Reader: Fast polling (every 1-2 seconds), pushes to queue
 * - DB Writer: Slow operations (independent), consumes from queue
 * 
 * This ensures PLC connection never waits for DB operations
 */

let plcDataQueue = [];
let dbWriteQueue = [];

const MAX_QUEUE_SIZE = 100; // Prevent memory overflow

export class DataQueue {
  /**
   * Push telemetry data to PLC queue
   * Called from fast PLC polling loop
   * @param {Object} data - Telemetry data from PLC
   */
  static pushToPlcQueue(data) {
    if (plcDataQueue.length >= MAX_QUEUE_SIZE) {
      console.warn(`⚠️ PLC Queue full (${MAX_QUEUE_SIZE}), dropping oldest`);
      plcDataQueue.shift();
    }
    plcDataQueue.push({
      type: 'telemetry',
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Push defect data to DB write queue
   * Called from defect detection handler
   * @param {Object} defectData - Complete defect record
   */
  static pushToDbQueue(defectData) {
    if (dbWriteQueue.length >= MAX_QUEUE_SIZE) {
      console.warn(`⚠️ DB Queue full (${MAX_QUEUE_SIZE}), dropping oldest`);
      dbWriteQueue.shift();
    }
    dbWriteQueue.push({
      type: defectData.type || 'defect',
      data: defectData,
      timestamp: Date.now(),
      attempts: 0,
      lastError: null
    });
  }

  /**
   * Pop next telemetry record for processing
   * @returns {Object|null} Next telemetry record or null if empty
   */
  static popFromPlcQueue() {
    return plcDataQueue.shift() || null;
  }

  /**
   * Pop next DB write record for processing
   * @returns {Object|null} Next DB record or null if empty
   */
  static popFromDbQueue() {
    return dbWriteQueue.shift() || null;
  }

  /**
   * Get queue statistics
   * @returns {Object} Queue status
   */
  static getQueueStats() {
    return {
      plcQueueSize: plcDataQueue.length,
      dbQueueSize: dbWriteQueue.length,
      totalQueued: plcDataQueue.length + dbWriteQueue.length,
      maxQueueSize: MAX_QUEUE_SIZE
    };
  }

  /**
   * Clear all queues (emergency/testing)
   */
  static clear() {
    plcDataQueue = [];
    dbWriteQueue = [];
  }
}

export default DataQueue;
