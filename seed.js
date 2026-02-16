import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { insertPlcData, TelemetryModel, DefectModel, ProcessSummaryModel } from './MongoHelper.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/plc_integration';

/**
 * Generate random ID in format PREFIX-RANDOM-NUMBER
 */
const randomId = (prefix) => {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${rand}-${suffix}`;
};

/**
 * Generate sample telemetry data
 */
const generateTelemetry = (processId, textileId, count = 10) => {
  const now = new Date();
  const data = [];
  
  // Generate telemetry points over last 2 hours
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now.getTime() - (count - i) * (120 / count) * 60 * 1000);
    const production = 800 + Math.floor(Math.random() * 500);
    const fabricLength = 400 + Math.floor(Math.random() * 300);
    const isRunning = Math.random() > 0.2; // 80% running, 20% stopped
    
    // ✅ FIXED: Ensure all fields are proper datatypes (Numbers, not Booleans)
    data.push({
      type: 'telemetry',
      processId: String(processId),
      textileId: String(textileId),
      machineStatusCode: isRunning ? 1 : 0,           // ✅ Number (1=RUNNING, 0=STOPPED)
      machineStatus: isRunning ? 'RUNNING' : 'STOPPED', // ✅ String
      machineRunning: isRunning ? 1 : 0,             // ✅ Number (not boolean)
      totalProduction: Number(production),
      fabricLength: Number(fabricLength),
      alarmCode: Math.random() > 0.95 ? 101 : 0,     // ✅ Number
      defectRegister: Math.random() > 0.9 ? 1 : 0,   // ✅ Number (not boolean)
      processStart: Number(isRunning ? 1 : 0),       // ✅ Number (not boolean)
      timestamp: timestamp
    });
  }
  
  return data;
};

/**
 * Generate sample defects data
 */
const generateDefects = (processId, textileId, count = 3) => {
  const now = new Date();
  const data = [];
  
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now.getTime() - Math.random() * 120 * 60 * 1000);
    
    // ✅ FIXED: Ensure all fields are proper datatypes
    data.push({
      type: 'defect',
      processId: String(processId),
      textileId: String(textileId),
      count: Number(Math.floor(1 + Math.random() * 3)),
      lengthAtDetection: Number(50 + Math.random() * 400),
      defectId: randomId('DEFECT'),
      confidence: Number((0.75 + Math.random() * 0.25).toFixed(2)), // 75-100% confidence
      timestamp
    });
  }
  
  return data;
};

/**
 * Generate sample process summary data
 */
const generateProcessSummaries = (count = 5) => {
  const now = new Date();
  const data = [];
  
  for (let i = 0; i < count; i++) {
    const startTime = new Date(now.getTime() - (count - i + 2) * 2 * 60 * 60 * 1000);
    const endTime = new Date(startTime.getTime() + (1.5 + Math.random()) * 60 * 60 * 1000);
    const fabricProcessed = 800 + Math.floor(Math.random() * 600);
    
    data.push({
      type: 'process_summary',
      processId: randomId('PROC'),
      textileId: randomId('TEX'),
      startTime,
      endTime,
      durationMinutes: (endTime - startTime) / 60000,
      production: fabricProcessed, // Direct field
      fabricProcessed: fabricProcessed, // Direct field
      timestamp: endTime
    });
  }
  
  return data;
};

/**
 * Main seeding function
 */
const seed = async () => {
  try {
    console.log('🌱 Starting PLC MongoDB seed process...');
    console.log(`📍 Connecting to: ${MONGODB_URI}`);
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    
    console.log('✅ Connected to MongoDB');
    
    // Clear existing data (optional - comment out to preserve data)
    console.log('🧹 Clearing existing seed data...');
    await TelemetryModel.deleteMany({});
    await DefectModel.deleteMany({});
    await ProcessSummaryModel.deleteMany({});
    console.log('✅ Cleared existing data');
    
    // Generate process summaries
    console.log('\n📝 Generating process summaries...');
    const processes = generateProcessSummaries(5);
    let insertedProcesses = 0;
    
    for (const proc of processes) {
      const success = await insertPlcData(proc);
      if (success) insertedProcesses++;
    }
    console.log(`✅ Inserted ${insertedProcesses}/${processes.length} process summaries`);
    
    // Generate telemetry and defects for each process
    console.log('\n📡 Generating telemetry and defect data...');
    let insertedTelemetry = 0;
    let insertedDefects = 0;
    
    for (const proc of processes) {
      // Generate telemetry for each process
      const telemetry = generateTelemetry(proc.processId, proc.textileId, 12);
      for (const data of telemetry) {
        const success = await insertPlcData(data);
        if (success) insertedTelemetry++;
      }
      
      // Generate defects for each process
      const defects = generateDefects(proc.processId, proc.textileId, 2);
      for (const data of defects) {
        const success = await insertPlcData(data);
        if (success) insertedDefects++;
      }
    }
    
    console.log(`✅ Inserted ${insertedTelemetry}/${processes.length * 12} telemetry records`);
    console.log(`✅ Inserted ${insertedDefects}/${processes.length * 2} defect records`);
    
    // Generate additional telemetry for current running process
    console.log('\n⚙️  Adding current running process data...');
    const currentProcessId = randomId('PROC');
    const currentTextileId = randomId('TEX');
    const currentTelemetry = generateTelemetry(currentProcessId, currentTextileId, 10);
    
    let insertedCurrentTelemetry = 0;
    for (const data of currentTelemetry) {
      const success = await insertPlcData(data);
      if (success) insertedCurrentTelemetry++;
    }
    console.log(`✅ Inserted ${insertedCurrentTelemetry} current process telemetry records`);
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Process Summaries: ${insertedProcesses}`);
    console.log(`✅ Telemetry Records: ${insertedTelemetry + insertedCurrentTelemetry}`);
    console.log(`✅ Defect Records: ${insertedDefects}`);
    console.log(`📦 Total Documents: ${insertedProcesses + insertedTelemetry + insertedCurrentTelemetry + insertedDefects}`);
    console.log('='.repeat(50));
    console.log('\n✨ Seed data inserted successfully!\n');
    
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
