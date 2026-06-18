const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query, run } = require('../db/database');
const { sendExpiryNotification } = require('./telegram');

// ==========================================
// تحديث قاعدة البيانات (ينفذ بأمان بعد تشغيل السيرفر)
// ==========================================
let isDbMigrated = false;
router.use((req, res, next) => {
  if (!isDbMigrated) {
    try {
      run(`CREATE TABLE IF NOT EXISTS recharges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      
      const pragma = query(`PRAGMA table_info(subscriptions)`);
      if (!pragma.some(col => col.name === 'cost')) {
        run(`ALTER TABLE subscriptions ADD COLUMN cost INTEGER DEFAULT 0`);
        console.log('✅ تم تحديث قاعدة البيانات وإضافة عمود الكلفة.');
      }
      isDbMigrated = true;
    } catch (e) {
      console.error('Migration error:', e.message);
    }
  }
  next();
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `qr_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const PLAN_DAYS = { monthly: 30, '3months': 90, '6months': 180, yearly: 365 };

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function diffDaysHours(endDate) {
  const now = new Date();
  const end = new Date(endDate + 'T23:59:59');
  const diffMs = end - now;
  if (diffMs <= 0) return { days: 0, hours: 0, expired: true, expiredDays: Math.abs(Math.floor(diffMs / 86400000)) };
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return { days, hours, expired: false };
}

// ----------------------------------------------------
// 1. قسم الزبائن
// ----------------------------------------------------
router.get('/customers', (req, res) => {
  const customers = query(`
    SELECT c.*, 
      s.plan, s.price, s.paid, s.start_date, s.end_date, s.is_active, s.id as sub_id,
      (SELECT COUNT(*) FROM subscriptions WHERE customer_id = c.id) as total_subs
    FROM customers c
    LEFT JOIN subscriptions s ON s.id = (
      SELECT id FROM subscriptions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
    )
    ORDER BY c.created_at DESC
  `);
  res.json(customers.map(c => ({ ...c, timeInfo: c.end_date ? diffDaysHours(c.end_date) : null })));
});

router.get('/customers/:id', (req, res) => {
  const { id } = req.params;
  const [customer] = query('SELECT * FROM customers WHERE id = ?', [id]);
  if (!customer) return res.status(404).json({ error: 'not found' });
  const subs = query('SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY created_at DESC', [id]);
  const latestSub = subs[0];
  res.json({ ...customer, subscriptions: subs, latestSub, timeInfo: latestSub?.end_date ? diffDaysHours(latestSub.end_date) : null });
});

router.post('/customers', upload.single('qr_image'), async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    const qrImage = req.file ? `/uploads/${req.file.filename}` : null;
    run('INSERT INTO customers (name, phone, qr_image) VALUES (?, ?, ?)', [name, phone || '', qrImage]);
    const [customer] = query('SELECT * FROM customers ORDER BY id DESC LIMIT 1');
    res.json(customer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/customers/:id', (req, res) => {
  const { id } = req.params; const { name, phone } = req.body;
  run('UPDATE customers SET name = ?, phone = ? WHERE id = ?', [name, phone || '', id]);
  res.json({ ok: true });
});

router.put('/customers/:id/qr', upload.single('qr_image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const qrImage = `/uploads/${req.file.filename}`;
  run('UPDATE customers SET qr_image = ? WHERE id = ?', [qrImage, req.params.id]);
  res.json({ qr_image: qrImage });
});

router.delete('/customers/:id', (req, res) => {
  run('DELETE FROM subscriptions WHERE customer_id = ?', [req.params.id]);
  run('DELETE FROM customers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ----------------------------------------------------
// 2. قسم الاشتراكات (مع حساب الكلفة وخصم الرصيد)
// ----------------------------------------------------
router.post('/subscriptions', (req, res) => {
  try {
    const { customer_id, plan, paid, start_date } = req.body;
    if (!customer_id || !plan) return res.status(400).json({ error: 'بيانات ناقصة' });

    const prices = {
      monthly: parseInt(query("SELECT value FROM settings WHERE key='price_monthly'")[0]?.value || 25000),
      '3months': parseInt(query("SELECT value FROM settings WHERE key='price_3months'")[0]?.value || 60000),
      '6months': parseInt(query("SELECT value FROM settings WHERE key='price_6months'")[0]?.value || 110000),
      yearly: parseInt(query("SELECT value FROM settings WHERE key='price_yearly'")[0]?.value || 200000),
    };
    
    const costs = {
      monthly: parseInt(query("SELECT value FROM settings WHERE key='cost_monthly'")[0]?.value || 20000),
      '3months': parseInt(query("SELECT value FROM settings WHERE key='cost_3months'")[0]?.value || 50000),
      '6months': parseInt(query("SELECT value FROM settings WHERE key='cost_6months'")[0]?.value || 90000),
      yearly: parseInt(query("SELECT value FROM settings WHERE key='cost_yearly'")[0]?.value || 160000),
    };

    const price = prices[plan];
    const cost = costs[plan]; 
    const days = PLAN_DAYS[plan];
    const startD = start_date || new Date().toISOString().split('T')[0];
    const endD = addDays(startD, days);
    const paidAmount = parseInt(paid) || 0;

    run('UPDATE subscriptions SET is_active = 0 WHERE customer_id = ?', [customer_id]);
    run(
      'INSERT INTO subscriptions (customer_id, plan, price, cost, paid, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,1)',
      [customer_id, plan, price, cost, paidAmount, startD, endD]
    );

    const [sub] = query('SELECT * FROM subscriptions ORDER BY id DESC LIMIT 1');
    res.json(sub);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/subscriptions/:id', (req, res) => {
  try {
    const { id } = req.params; const { plan, paid, start_date } = req.body;
    const prices = {
      monthly: parseInt(query("SELECT value FROM settings WHERE key='price_monthly'")[0]?.value || 25000),
      '3months': parseInt(query("SELECT value FROM settings WHERE key='price_3months'")[0]?.value || 60000),
      '6months': parseInt(query("SELECT value FROM settings WHERE key='price_6months'")[0]?.value || 110000),
      yearly: parseInt(query("SELECT value FROM settings WHERE key='price_yearly'")[0]?.value || 200000),
    };
    const costs = {
      monthly: parseInt(query("SELECT value FROM settings WHERE key='cost_monthly'")[0]?.value || 20000),
      '3months': parseInt(query("SELECT value FROM settings WHERE key='cost_3months'")[0]?.value || 50000),
      '6months': parseInt(query("SELECT value FROM settings WHERE key='cost_6months'")[0]?.value || 90000),
      yearly: parseInt(query("SELECT value FROM settings WHERE key='cost_yearly'")[0]?.value || 160000),
    };
    
    const price = prices[plan]; const cost = costs[plan];
    const endD = addDays(start_date, PLAN_DAYS[plan]);
    run('UPDATE subscriptions SET plan = ?, price = ?, cost = ?, paid = ?, start_date = ?, end_date = ? WHERE id = ?',
      [plan, price, cost, parseInt(paid)||0, start_date, endD, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/subscriptions/:id', (req, res) => {
  run('DELETE FROM subscriptions WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ----------------------------------------------------
// 3. قسم الرصيد (Recharges) والوكالة
// ----------------------------------------------------
router.get('/recharges', (req, res) => {
  const rows = query(`SELECT * FROM recharges ORDER BY created_at DESC`);
  res.json(rows);
});

router.post('/recharges', (req, res) => {
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'المبلغ مطلوب' });
  run(`INSERT INTO recharges (amount) VALUES (?)`, [amount]);
  res.json({ ok: true });
});

// ----------------------------------------------------
// 4. قسم الإعدادات والإحصائيات
// ----------------------------------------------------
router.get('/settings', (req, res) => {
  const rows = query('SELECT * FROM settings');
  const obj = {}; rows.forEach(r => (obj[r.key] = r.value));
  res.json(obj);
});

router.put('/settings', (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }
  res.json({ ok: true });
});

router.get('/stats', (req, res) => {
  try {
    const [{ total }] = query('SELECT COUNT(*) as total FROM customers');
    
    const [{ totalRecharge }] = query(`SELECT COALESCE(SUM(amount),0) as totalRecharge FROM recharges`);
    const [{ totalCost }] = query(`SELECT COALESCE(SUM(cost),0) as totalCost FROM subscriptions`);
    const balance = totalRecharge - totalCost;

    const [{ monthRevenue }] = query(`SELECT COALESCE(SUM(paid),0) as monthRevenue FROM subscriptions WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime')`);
    const [{ monthDebt }] = query(`SELECT COALESCE(SUM(price-paid),0) as monthDebt FROM subscriptions WHERE paid < price AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime')`);

    res.json({ total, balance, monthRevenue, monthDebt });
  } catch (err) {
    console.error('Stats Error:', err);
    res.json({ total: 0, balance: 0, monthRevenue: 0, monthDebt: 0 });
  }
});

router.get('/stats/monthly/:yearMonth', (req, res) => {
  try {
    const { yearMonth } = req.params; 
    const condition = yearMonth === 'all' ? "1=1" : `strftime('%Y-%m', created_at) = '${yearMonth}'`;

    const [{ revenue }] = query(`SELECT COALESCE(SUM(paid),0) as revenue FROM subscriptions WHERE ${condition}`);
    const [{ debt }] = query(`SELECT COALESCE(SUM(price-paid),0) as debt FROM subscriptions WHERE paid < price AND ${condition}`);
    const [{ count }] = query(`SELECT COUNT(*) as count FROM subscriptions WHERE ${condition}`);
    const [{ totalPrice }] = query(`SELECT COALESCE(SUM(price),0) as totalPrice FROM subscriptions WHERE ${condition}`);
    const byPlan = query(`SELECT plan, COUNT(*) as count, COALESCE(SUM(paid),0) as paid, COALESCE(SUM(price),0) as price FROM subscriptions WHERE ${condition} GROUP BY plan`);

    res.json({ revenue, debt, count, totalPrice, byPlan });
  } catch (err) {
    res.json({ revenue: 0, debt: 0, count: 0, totalPrice: 0, byPlan: [] });
  }
});

router.get('/stats/monthly/:yearMonth/plan/:plan', (req, res) => {
  try {
    const { yearMonth, plan } = req.params;
    const condition = yearMonth === 'all' ? "1=1" : `strftime('%Y-%m', s.created_at) = '${yearMonth}'`;
    
    const customers = query(`
      SELECT c.name, c.phone, s.price, s.paid, s.start_date, s.end_date 
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      WHERE ${condition} AND s.plan = ?
      ORDER BY s.created_at DESC
    `, [plan]);
    res.json(customers);
  } catch(e) {
    res.json([]);
  }
});

router.get('/stats/available-months', (req, res) => {
  const rows = query(`SELECT DISTINCT strftime('%Y-%m', created_at) as ym FROM subscriptions ORDER BY ym DESC`);
  res.json(rows.map(r => r.ym));
});

router.post('/notify/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const [customer] = query('SELECT * FROM customers WHERE id = ?', [customerId]);
  const [sub] = query('SELECT * FROM subscriptions WHERE customer_id = ? AND is_active=1 ORDER BY created_at DESC LIMIT 1', [customerId]);
  if (!customer || !sub) return res.status(404).json({ error: 'not found' });
  await sendExpiryNotification(customer, sub);
  res.json({ ok: true });
});

module.exports = router;