import { MongoClient } from "mongodb";

let _client = null;
let _connected = false;


export async function connectMongo() {
  const envUri = process.env.MONGODB_URI;
  if (!envUri) {
    console.warn("No MongoDB URI could be constructed from environment variables.");
    throw new Error("MONGODB connection info missing");
  }

  if (!_client) {
    _client = new MongoClient(envUri, { maxPoolSize: 10 });
  }

  if (!_connected) {
    await _client.connect();
    _connected = true;
    console.log("Connected to MongoDB");
  }

  return _client;
}

async function ensureConnected() {
  if (!_connected) {
    await connectMongo();
  }
  return _client;
}

export async function insertPlcData(doc) {
  const c = await ensureConnected();
  const dbName = process.env.MONGODB_DB || "plcdb";
  const coll = process.env.MONGODB_COLLECTION || "plcdata";
  const db = c.db(dbName);
  const res = await db.collection(coll).insertOne(doc);
  return res;
}

export async function closeMongo() {
  if (_connected && _client) {
    await _client.close();
    _connected = false;
    _client = null;
  }
}

export function isMongoConnected() {
  return _connected;
}

export default { connectMongo, insertPlcData, closeMongo, isMongoConnected };
