import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { insertPlcData, TelemetryModel, DefectModel, ProcessSummaryModel } from './MongoHelper.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Generate random ID in format PREFIX-RANDOM-NUMBER
 */
const randomId = (prefix) => {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${rand}-${suffix}`;
};

/**
 * Generate realistic mock telemetry data matching PLC register values
 * Returns: { data: telemetry_array, processEndTimestamp: timestamp_when_processStart_becomes_0 }
 */
const generateRealisticTelemetry = (processId, textileId, count = 10, startTime = null, shouldComplete = true) => {
  const now = new Date();
  const data = [];
  let processEndTimestamp = null;
  
  // Use provided startTime or default to 2 hours ago
  const baseTime = startTime || new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const timeRange = now.getTime() - baseTime.getTime();
  const stepMs = timeRange / count;
  
  // Simulate continuous machine operation with realistic patterns
  let runningStreak = true; // Start running for completed processes
  let streakLength = 0;
  let totalRecords = 0;
  
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(baseTime.getTime() + stepMs * (i + 1));
    totalRecords++;
    
    // For completed processes: transition to stopped near the end
    // For running processes: keep running
    let statusCode;
    let processStart;
    
    if (shouldComplete) {
      // 70% through records, start transitioning to stopped
      if (i >= Math.floor(count * 0.7) && Math.random() > 0.6) {
        runningStreak = false;
      }
      
      if (runningStreak) {
        statusCode = Math.random() > 0.1 ? 1 : 2; // RUNNING or IDLE
        processStart = 1;
      } else {
        statusCode = 0; // STOPPED
        processStart = 0;
        
        // ✅ Capture the timestamp when processStart becomes 0 (process ends)
        if (processEndTimestamp === null) {
          processEndTimestamp = timestamp;
        }
      }
    } else {
      // Running process: keep it running
      statusCode = Math.random() > 0.15 ? 1 : 2;
      processStart = statusCode === 1 ? 1 : 0;
    }
    
    const STATUS_MAP = ["STOPPED", "RUNNING", "IDLE", "FAULT"];
    
    // Realistic production values (Modbus register D101) - cumulative increment
    const baseProduction = 1000 + i * 150;
    let production = baseProduction;
    if (statusCode === 1) {
      production += Math.floor(Math.random() * 200); // Running: add more
    }
    
    // Realistic fabric length values (Modbus register D103) - continuous increment
    const baseFabricLength = 200 + i * 80;
    let fabricLength = baseFabricLength;
    if (statusCode === 1) {
      fabricLength += Math.floor(Math.random() * 100); // Running: add more
    } else if (statusCode === 2) {
      fabricLength += Math.floor(Math.random() * 20); // Idle: small increment
    }
    
    // Alarm codes (D102) - mostly 0, occasionally real alarm codes
    let alarmCode = 0;
    if (Math.random() > 0.85) {
      const alarmTypes = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
      alarmCode = alarmTypes[Math.floor(Math.random() * alarmTypes.length)];
    }
    
    // Temperature/Humidity simulation
    const temperature = 18 + Math.random() * 15;
    const humidity = 40 + Math.random() * 50;
    
    data.push({
      type: 'telemetry',
      processId: String(processId),
      textileId: String(textileId),
      machineStatusCode: statusCode,
      machineStatus: STATUS_MAP[statusCode],
      machineRunning: statusCode === 1 ? 1 : 0,
      totalProduction: Math.floor(production),
      fabricLength: Math.floor(fabricLength),
      alarmCode: alarmCode,
      defectRegister: Math.random() > 0.85 ? 1 : 0,
      processStart: processStart,  // ✅ Core signal: 1=running, 0=stopped
      temperature: parseFloat(temperature.toFixed(1)),
      humidity: parseFloat(humidity.toFixed(1)),
      timestamp: timestamp
    });
  }
  
  // If completed process but no stop found, use last timestamp
  if (shouldComplete && processEndTimestamp === null) {
    processEndTimestamp = new Date(baseTime.getTime() + stepMs * count);
  }
  
  return {
    data,
    processEndTimestamp  // ✅ Return the timestamp when process actually ended
  };
};

/**
 * Generate realistic mock defects data
 */
const generateRealisticDefects = (processId, textileId, startTime, endTime, count = 3) => {
  const data = [];
  
  const defectTypes = ['Tear', 'Stain', 'Wrinkle', 'Color Variation', 'Foreign Material', 'Hole', 'Misalignment'];
  const severities = ['Low', 'Medium', 'High', 'Critical'];
  
  const timeRange = endTime ? (endTime.getTime() - startTime.getTime()) : (new Date().getTime() - startTime.getTime());
  
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(startTime.getTime() + Math.random() * timeRange);
    
    const severity = severities[Math.floor(Math.random() * severities.length)];
    const confidence = severity === 'Critical' ? 0.95 + Math.random() * 0.05 : 
                       severity === 'High' ? 0.85 + Math.random() * 0.14 :
                       severity === 'Medium' ? 0.75 + Math.random() * 0.24 : 0.65 + Math.random() * 0.34;
    
    data.push({
      type: 'defect',
      processId: String(processId),
      textileId: String(textileId),
      count: Math.floor(1 + Math.random() * 8),                         // 1-8 defect instances
      lengthAtDetection: Math.floor(50 + Math.random() * 1950),         // 50-2000 meters
      defectId: randomId('DEFECT'),
      defectType: defectTypes[Math.floor(Math.random() * defectTypes.length)],
      severity: severity,
      confidence: parseFloat(confidence.toFixed(3)),                    // 65-99.9% confidence
      repairNeeded: severity === 'High' || severity === 'Critical' ? 1 : 0,
      repairTime: severity === 'High' || severity === 'Critical' ? 5 + Math.floor(Math.random() * 45) : 0,
      timestamp
    });
  }
  
  return data;
};

/**
 * Generate realistic process summary data - NOW SYNCED with actual processStart transitions
 */
const generateProcessSummaryTemplate = (count = 3) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  
  const processes = [];
  
  // Generate completed processes that started TODAY
  for (let i = 0; i < count; i++) {
    const hoursIntoDay = (now.getTime() - startOfDay.getTime()) / (1000 * 60 * 60);
    const startOffset = (hoursIntoDay / (count + 1)) * (i + 1);
    const startTime = new Date(startOfDay.getTime() + startOffset * 60 * 60 * 1000);
    
    const fabricProcessed = 500 + Math.floor(Math.random() * 2000);
    const totalDefects = Math.floor(Math.random() * 10);
    const acceptanceRate = Math.max(85, 100 - (totalDefects * Math.random() * 2));
    
    processes.push({
      type: 'process_summary',
      processId: randomId('PROC'),
      textileId: randomId('TEX'),
      startTime,
      endTime: null,  // ✅ Will be set based on actual telemetry processStart transition
      durationMinutes: null,
      production: fabricProcessed,
      fabricProcessed: fabricProcessed,
      totalDefects: totalDefects,
      acceptanceRate: parseFloat(acceptanceRate.toFixed(2)),
      operatorId: `OP-${String(Math.floor(Math.random() * 50)).padStart(3, '0')}`,
      machineId: `M-${101 + Math.floor(Math.random() * 20)}`,
      timestamp: startTime,
      shouldComplete: true  // ✅ Mark as should complete
    });
  }
  
  // Add a currently running process
  const runningProcessStart = new Date(now.getTime() - (1 + Math.random() * 2) * 60 * 60 * 1000);
  if (runningProcessStart < startOfDay) {
    runningProcessStart.setTime(startOfDay.getTime() + 30 * 60 * 1000);
  }
  
  const runningFabricProcessed = 300 + Math.floor(Math.random() * 700);
  
  processes.push({
    type: 'process_summary',
    processId: randomId('PROC'),
    textileId: randomId('TEX'),
    startTime: runningProcessStart,
    endTime: null,  // Running - no end yet
    durationMinutes: null,
    production: runningFabricProcessed,
    fabricProcessed: runningFabricProcessed,
    totalDefects: Math.floor(Math.random() * 5),
    acceptanceRate: 90 + Math.random() * 10,
    operatorId: `OP-${String(Math.floor(Math.random() * 50)).padStart(3, '0')}`,
    machineId: `M-${101 + Math.floor(Math.random() * 20)}`,
    timestamp: runningProcessStart,
    shouldComplete: false  // ✅ Still running
  });
  
  return processes;
};

/**
 * Main seeding function - NOW SYNCED: endTime based on processStart=0 transition
 */
const seed = async () => {
  try {
    console.log('🌱 Starting PLC MongoDB seed process...');
    console.log(`📍 Connecting to: ${MONGODB_URI}`);
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    
    console.log('✅ Connected to MongoDB');
    
    // Clear existing data
    console.log('🧹 Clearing existing seed data...');
    await TelemetryModel.deleteMany({});
    await DefectModel.deleteMany({});
    await ProcessSummaryModel.deleteMany({});
    console.log('✅ Cleared existing data');
    
    // ✅ Generate process templates (not final yet)
    console.log('\n📝 Generating process templates for TODAY...');
    const processTemplates = generateProcessSummaryTemplate(4); // 4 completed + 1 running = 5 total
    const finalProcesses = [];
    
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    
    console.log('\n📡 Generating telemetry and syncing with processStart transitions...');
    let insertedTelemetry = 0;
    let insertedDefects = 0;
    
    // Process each template and generate telemetry
    for (const template of processTemplates) {
      // Generate telemetry for this process
      const telemetryCount = Math.max(8, Math.floor((now.getTime() - template.startTime.getTime()) / (1000 * 60 * 10)));
      const telemetryResult = generateRealisticTelemetry(
        template.processId,
        template.textileId,
        Math.min(telemetryCount, 20),
        template.startTime,
        template.shouldComplete
      );
      
      const telemetryData = telemetryResult.data;
      const processEndTimestamp = telemetryResult.processEndTimestamp;
      
      // ✅ Update process summary with actual processEnd timestamp
      if (template.shouldComplete && processEndTimestamp) {
        template.endTime = processEndTimestamp;
        template.durationMinutes = Math.floor((processEndTimestamp - template.startTime) / 60000);
        template.timestamp = processEndTimestamp;
      }
      
      finalProcesses.push(template);
      
      // Insert telemetry
      for (const data of telemetryData) {
        if (data.timestamp >= startOfDay && data.timestamp <= now) {
          const success = await insertPlcData(data);
          if (success) insertedTelemetry++;
        }
      }
      
      // Generate and insert defects
      const defectCount = template.shouldComplete ? 2 + Math.floor(Math.random() * 3) : 1;
      const defects = generateRealisticDefects(
        template.processId,
        template.textileId,
        template.startTime,
        template.endTime || now,
        defectCount
      );
      
      for (const data of defects) {
        if (data.timestamp >= startOfDay && data.timestamp <= now) {
          const success = await insertPlcData(data);
          if (success) insertedDefects++;
        }
      }
    }
    
    // ✅ Now insert process summaries with actual endTimes
    console.log('\n💾 Inserting synchronized process summaries...');
    let insertedProcesses = 0;
    
    for (const proc of finalProcesses) {
      const success = await insertPlcData(proc);
      if (success) insertedProcesses++;
    }
    console.log(`✅ Inserted ${insertedProcesses}/${finalProcesses.length} process summaries`);
    console.log(`   - Completed processes: ${finalProcesses.filter(p => p.endTime !== null).length}`);
    console.log(`   - Running processes: ${finalProcesses.filter(p => p.endTime === null).length}`);
    
    console.log(`✅ Inserted ${insertedTelemetry} telemetry records (all for TODAY)`);
    console.log(`✅ Inserted ${insertedDefects} defect records (all for TODAY)`);
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Process Summaries: ${insertedProcesses}`);
    console.log(`   - Completed today: ${finalProcesses.filter(p => p.endTime !== null).length}`);
    console.log(`   - Currently running: ${finalProcesses.filter(p => p.endTime === null).length}`);
    console.log(`✅ Telemetry Records: ${insertedTelemetry} (all for TODAY)`);
    console.log(`✅ Defect Records: ${insertedDefects} (all for TODAY)`);
    console.log(`📦 Total Documents: ${insertedProcesses + insertedTelemetry + insertedDefects}`);
    console.log('='.repeat(50));
    console.log('\n✨ Seed data inserted successfully!');
    console.log('✅ Process endTime is SYNCED with actual processStart=0 transition!\n');
    
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    console.error(err);
    process.exit(1);
  }
};

// Run the seed
seed();

