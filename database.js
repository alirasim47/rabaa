const { Client } = require('pg');

// قراءة الرابط ديناميكياً من الـ Variables
const connectionString = process.env.DATABASE_URL || "postgresql://postgres.ozwt9luQahLN1zzX:ozwt9luQahLN1zzX@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require";

const client = new Client({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// متغير داخلي صارم لمنع تكرار الاتصال نهائياً
let isConnectingOrConnected = false;

async function getDB() {
  if (!isConnectingOrConnected) {
    try {
      isConnectingOrConnected = true;
      await client.connect();
      console.log("✅ تم الاتصال بقاعدة بيانات Supabase بنجاح!");
      await initTables(); 
    } catch (err) {
      isConnectingOrConnected = false;
      console.error("❌ فشل الاتصال بـ Supabase:", err.message);
      throw err;
    }
  }
  return client;
}

async function query(sql, params = []) {
  const db = await getDB();
  const res = await db.query(sql, params);
  return res.rows;
}

async function run(sql, params = []) {
  const db = await getDB();
  return await db.query(sql, params);
}

async function initTables() {
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        qr_image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        plan TEXT NOT NULL,
        price INTEGER NOT NULL,
        paid INTEGER DEFAULT 0,
        cost INTEGER DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS recharges (
        id SERIAL PRIMARY KEY,
        amount INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    console.log("🏗️ تم فحص وتجهيز جداول الرابعة في السحابة.");
  } catch (err) {
    console.error("❌ خطأ إنشاء جداول السحابة:", err.message);
  }
}

module.exports = { getDB, query, run };
