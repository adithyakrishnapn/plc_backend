import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { BaseModel } from './MongoHelper.js';

dotenv.config();

/**
 * Datatype Validation Utility
 * Checks if database records have correct datatypes matching schema
 */

const EXPECTED_TYPES = {
  telemetry: {
    processId: 'string',
    textileId: 'string',
    machineStatusCode: 'number',      // ✅ Must be Number
    machineStatus: 'string',          // ✅ Must be String: 'RUNNING' or 'STOPPED'
    machineRunning: 'number',         // ✅ Must be Number (0 or 1)
    totalProduction: 'number',
    fabricLength: 'number',
    alarmCode: 'number',
    defectRegister: 'number',         // ✅ Must be Number (not boolean)
    processStart: 'number',           // ✅ Must be Number (not boolean)
    timestamp: 'date'
  },
  defect: {
    processId: 'string',
    textileId: 'string',
    count: 'number',
    lengthAtDetection: 'number',
    defectId: 'string',
    confidence: 'number',
    timestamp: 'date'
  },
  process_summary: {
    processId: 'string',
    textileId: 'string',
    startTime: 'date',
    endTime: 'date',
    durationMinutes: 'number',
    production: 'number',
    fabricProcessed: 'number',
    timestamp: 'date'
  }
};

function getType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Date) return 'date';
  return typeof value;
}

function validateRecord(record, expectedSchema) {
  const issues = [];
  
  for (const [field, expectedType] of Object.entries(expectedSchema)) {
    if (!(field in record)) {
      issues.push(`❌ Missing field: ${field}`);
      continue;
    }

    const actualType = getType(record[field]);
    
    if (actualType !== expectedType) {
      issues.push(
        `❌ ${field}: Expected ${expectedType}, got ${actualType} (value: ${JSON.stringify(record[field])})`
      );
    }
  }
  
  return issues;
}

async function validateDatabase() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI not found in .env');
    }

    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('✅ Connected\n');

    // Check each type
    for (const [type, schema] of Object.entries(EXPECTED_TYPES)) {
      console.log(`\n📋 Validating "${type}" records...`);
      console.log('='.repeat(60));
      
      const records = await BaseModel.find({ type }).limit(5).lean();
      
      if (records.length === 0) {
        console.log(`⚠️  No ${type} records found in database`);
        continue;
      }

      console.log(`Found ${records.length} records to validate\n`);
      
      let validCount = 0;
      let invalidCount = 0;

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const issues = validateRecord(record, schema);
        
        if (issues.length === 0) {
          console.log(`✅ Record ${i + 1}: Valid`);
          validCount++;
        } else {
          console.log(`❌ Record ${i + 1}: Invalid`);
          issues.forEach(issue => console.log(`   ${issue}`));
          invalidCount++;
        }
      }

      console.log(`\n📊 ${type} Summary: ${validCount} valid, ${invalidCount} invalid`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✨ Validation complete!\n');

    await mongoose.disconnect();
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Validation failed:', err.message);
    process.exit(1);
  }
}

// Run validation
validateDatabase();
