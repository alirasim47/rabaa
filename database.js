const { Pool } = require('pg');

// قراءة الرابط ديناميكياً من الـ Variables مع البورت السحابي المستقر
const connectionString = process.env.DATABASE_URL || "postgresql://postgres.ozwt9luQahLN1zzX:ozwt9luQahLN1zzX@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require";

// استخدام خزان الاتصالات Pool لإدارة مئات الطلبات المتزامنة والـ Cron بدون تعارض
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10, // حد أقصى 10 اتصالات متزامنة لتوفير رصيد Supabase
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function getDB() {
  // الـ Pool يفتح ويتصل تلقائياً عند أول استعلام ولا يحتاج لدالة connect يديرها المطور
  return pool;
}

async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}

async function run(sql, params = []) {
  return await pool.query(sql, params);
}

// دالة فحص وتجهيز الهياكل عند إقلاع السيرفر لأول مرة
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

// تشغيل الفحص الأولي للهياكل فور استدعاء الملف
initTables();

module.exports = { getDB, query, run };
