const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// استخدام مسار /tmp لأنه المسار الوحيد المسموح بالكتابة عليه في Railway
const DB_PATH = '/tmp/rabaa.db';
let db;

async function getDB() {
  if (db) return db;

  const SQL = await initSqlJs();

  // إذا كان الملف موجوداً في /tmp نقرأه، وإلا نبدأ قاعدة جديدة
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    // إنشاء الجداول الأساسية
    db.run(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        qr_image TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        plan TEXT NOT NULL,
        price INTEGER NOT NULL,
        paid INTEGER NOT NULL DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // إدخال الإعدادات الافتراضية
    const defaults = [
      ['price_monthly', '25000'],
      ['price_3months', '60000'],
      ['price_6months', '110000'],
      ['price_yearly', '200000'],
      ['plan_monthly_active', '1'],
      ['plan_3months_active', '1'],
      ['plan_6months_active', '1'],
      ['plan_yearly_active', '1'],
      ['telegram_token', '8927070181:AAHjCAYafUL4AGWB3-y2LQwRSk8ijEYNkVk'],
      ['telegram_chat_id', '5303752795'],
    ];

    for (const [key, value] of defaults) {
      db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
    }
    
    saveDB();
  }
  return db;
}

function saveDB() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error("خطأ في حفظ قاعدة البيانات:", err);
  }
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

module.exports = { getDB, saveDB, query, run };
