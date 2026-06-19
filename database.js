const { Pool } = require('pg');

// قراءة الرابط من Railway Variables
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ خطأ: DATABASE_URL غير موجود في المتغيرات!');
  process.exit(1);
}

// إنشاء Pool اتصال مستقر
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false  // تخطي فحص الشهادات الصارم
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// دالة الحصول على الاتصال
async function getDB() {
  return pool;
}

// دالة الاستعلام (SELECT)
async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

// دالة التنفيذ (INSERT, UPDATE, DELETE, CREATE)
async function run(sql, params = []) {
  return await pool.query(sql, params);
}

// إنشاء الجداول تلقائياً عند التشغيل
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
    console.log("🏗️ تم فحص وتجهيز جداول الرابعة في السحابة بنجاح.");
  } catch (err) {
    console.error("❌ خطأ إنشاء جداول السحابة:", err.message);
  }
}

// تشغيل إنشاء الجداول
initTables();

// تصدير الدوال
module.exports = { getDB, query, run };
