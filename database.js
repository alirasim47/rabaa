const { Client } = require('pg');

// الرابط النصي الرسمي الآمن مع إجبار تخطي جدار حماية الشهادات لـ Railway
const client = new Client({
  connectionString: "postgresql://postgres.ozwt9luQahLN1zzX:ozwt9luQahLN1zzX@db.aotsntxicbqmvsbusgaz.supabase.co:5432/postgres",
  ssl: {
    rejectUnauthorized: false
  }
});

async function getDB() {
  if (!client._connected) {
    try {
      await client.connect();
      client._connected = true;
      console.log("✅ تم الاتصال بقاعدة بيانات Supabase بنجاح!");
      await initTables(); 
    } catch (err) {
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
