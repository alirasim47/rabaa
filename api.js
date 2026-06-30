const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { query, run } = require('./database');

// إعداد Supabase Client للـ Storage
const supabase = createClient(
  'https://aotsntxicbqmvsbusgaz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdHNudHhpY2JxbXZzYnVzZ2F6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc5NjQ0MSwiZXhwIjoyMDk3MzcyNDQxfQ.nxn3w7abi8sB1w-OS08OepbbLn8sc2knX64TfX4oZjw'
);

const storage = multer.memoryStorage(); // حفظ في الذاكرة بدلاً من القرص
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
const PLAN_DAYS = { monthly: 30, '3months': 90, '6months': 180, yearly: 365 };

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ----------------------------------------------------
// قسم الإعدادات والمالية
// ----------------------------------------------------
router.get('/settings', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM settings');
    const obj = {}; rows.forEach(r => (obj[r.key] = r.value));
    res.json(obj);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----------------------------------------------------
// قسم الزبائن والرفع للسحابة
// ----------------------------------------------------
router.get('/customers', async (req, res) => {
  try {
    const customers = await query(`
      SELECT c.*, s.plan, s.price, s.paid, s.start_date, s.end_date, s.is_active, s.id as sub_id,
        (SELECT COUNT(*)::int FROM subscriptions WHERE customer_id = c.id) as total_subs
      FROM customers c
      LEFT JOIN subscriptions s ON s.id = (
        SELECT id FROM subscriptions WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY c.created_at DESC
    `);
    res.json(customers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/customers', upload.single('qr_image'), async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    
    let qrImageUrl = null;
    
    // رفع الصورة إلى Supabase Storage إذا موجودة
    if (req.file) {
      const ext = path.extname(req.file.originalname);
      const fileName = `qr_${Date.now()}${ext}`;
      
      const { data, error } = await supabase.storage
        .from('qr-codes')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });
      
      if (error) {
        console.error('Storage upload error:', error);
        return res.status(500).json({ error: 'فشل رفع الصورة' });
      }
      
      // الحصول على الرابط العام للصورة
      const { data: urlData } = supabase.storage
        .from('qr-codes')
        .getPublicUrl(fileName);
      
      qrImageUrl = urlData.publicUrl;
    }
    
    await run('INSERT INTO customers (name, phone, qr_image) VALUES ($1, $2, $3)', [name, phone || '', qrImageUrl]);
    const customer = await query('SELECT * FROM customers ORDER BY id DESC LIMIT 1');
    res.json(customer[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/customers/:id', async (req, res) => {
  try {
    const { name, phone } = req.body;
    await run('UPDATE customers SET name = $1, phone = $2 WHERE id = $3', [name, phone || '', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/customers/:id', async (req, res) => {
  try {
    // حذف الصورة من Storage قبل حذف الزبون
    const customer = await query('SELECT qr_image FROM customers WHERE id = $1', [req.params.id]);
    if (customer[0]?.qr_image) {
      const fileName = customer[0].qr_image.split('/').pop();
      await supabase.storage.from('qr-codes').remove([fileName]);
    }
    
    await run('DELETE FROM subscriptions WHERE customer_id = $1', [req.params.id]);
    await run('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1. مسار تفاصيل الزبون
router.get('/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const customerRows = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (customerRows.length === 0) return res.status(404).json({ error: 'الزبون غير موجود' });
    const customer = customerRows[0];

    const subs = await query('SELECT * FROM subscriptions WHERE customer_id = $1 ORDER BY created_at DESC', [id]);
    const latestSub = subs[0] || null;
    
    let timeInfo = null;
    if (latestSub && latestSub.end_date) {
      const diffMs = new Date(latestSub.end_date) - new Date();
      if (diffMs <= 0) {
        timeInfo = { expired: true, expiredDays: Math.abs(Math.floor(diffMs / 86400000)) };
      } else {
        timeInfo = { expired: false, days: Math.floor(diffMs / 86400000) };
      }
    }

    res.json({
      ...customer,
      subscriptions: subs,
      latestSub: latestSub,
      total_subs: subs.length,
      timeInfo: timeInfo
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. مسار تحديث صورة QR
router.put('/customers/:id/qr', upload.single('qr_image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع صورة' });
    
    const ext = path.extname(req.file.originalname);
    const fileName = `qr_${Date.now()}${ext}`;
    
    const { data, error } = await supabase.storage
      .from('qr-codes')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    
    if (error) return res.status(500).json({ error: 'فشل رفع الصورة' });
    
    const { data: urlData } = supabase.storage
      .from('qr-codes')
      .getPublicUrl(fileName);
    
    const qrImageUrl = urlData.publicUrl;
    await run('UPDATE customers SET qr_image = $1 WHERE id = $2', [qrImageUrl, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ----------------------------------------------------
// قسم الاشتراكات
// ----------------------------------------------------
router.post('/subscriptions', async (req, res) => {
  try {
    const { customer_id, plan, paid, start_date } = req.body;
    const settingsRows = await query('SELECT * FROM settings');
    const settings = {}; settingsRows.forEach(r => (settings[r.key] = r.value));

    const price = parseInt(settings[`price_${plan}`] || (plan==='monthly'?25000:plan==='3months'?60000:plan==='6months'?110000:200000));
    const cost = parseInt(settings[`cost_${plan}`] || (plan==='monthly'?20000:plan==='3months'?50000:plan==='6months'?90000:160000));
    
    const startD = (start_date && start_date.trim() !== "") ? start_date : new Date().toISOString().split('T')[0];
    const endD = addDays(startD, PLAN_DAYS[plan] || 30);

    await run('UPDATE subscriptions SET is_active = 0 WHERE customer_id = $1', [customer_id]);
    
    await run('INSERT INTO subscriptions (customer_id, plan, price, cost, paid, start_date, end_date, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [customer_id, plan, price, cost, parseInt(paid)||0, startD, endD, 1]);

    const sub = await query('SELECT * FROM subscriptions ORDER BY id DESC LIMIT 1');
    res.json(sub[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ----------------------------------------------------
// تعديل الاشتراك
// ----------------------------------------------------
router.put('/subscriptions/:id', async (req, res) => {
  try {
    const { plan, paid, start_date } = req.body;
    const settingsRows = await query('SELECT * FROM settings');
    const settings = {}; settingsRows.forEach(r => (settings[r.key] = r.value));

    const price = parseInt(settings[`price_${plan}`] || (plan==='monthly'?25000:plan==='3months'?60000:plan==='6months'?110000:200000));
    const cost = parseInt(settings[`cost_${plan}`] || (plan==='monthly'?20000:plan==='3months'?50000:plan==='6months'?90000:160000));

    const endD = addDays(start_date, PLAN_DAYS[plan] || 30);

    await run('UPDATE subscriptions SET plan = $1, price = $2, cost = $3, paid = $4, start_date = $5, end_date = $6 WHERE id = $7',
      [plan, price, cost, parseInt(paid)||0, start_date, endD, req.params.id]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------------
// حذف الاشتراك
// ----------------------------------------------------
router.delete('/subscriptions/:id', async (req, res) => {
  try {
    await run('DELETE FROM subscriptions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ----------------------------------------------------
// قسم الإحصائيات
// ----------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const total = await query('SELECT COUNT(*) as count FROM customers');
    const totalRecharge = await query('SELECT COALESCE(SUM(amount),0) as sum FROM recharges');
    const totalCost = await query('SELECT COALESCE(SUM(cost),0) as sum FROM subscriptions');
    
    const currentMonth = new Date().toISOString().substring(0,7); 
    
    const monthRevenue = await query("SELECT COALESCE(SUM(paid),0) as sum FROM subscriptions WHERE SUBSTRING(start_date, 1, 7) = $1", [currentMonth]);
    const monthDebt = await query("SELECT COALESCE(SUM(price-paid),0) as sum FROM subscriptions WHERE paid < price AND SUBSTRING(start_date, 1, 7) = $1", [currentMonth]);

    res.json({
      total: parseInt(total[0].count) || 0,
      balance: (parseInt(totalRecharge[0].sum) || 0) - (parseInt(totalCost[0].sum) || 0),
      monthRevenue: parseInt(monthRevenue[0].sum) || 0,
      monthDebt: parseInt(monthDebt[0].sum) || 0
    });
  } catch (err) { res.json({ total: 0, balance: 0, monthRevenue: 0, monthDebt: 0 }); }
});

router.get('/stats/available-months', async (req, res) => {
  try {
    const rows = await query("SELECT DISTINCT SUBSTRING(start_date, 1, 7) as ym FROM subscriptions ORDER BY ym DESC");
    res.json(rows.map(r => r.ym));
  } catch (err) { res.json([]); }
});

router.get('/stats/monthly/:yearMonth', async (req, res) => {
  try {
    const { yearMonth } = req.params;
    
    let s, byPlan;
    if (yearMonth === 'all') {
      s = await query("SELECT COALESCE(SUM(paid),0) as revenue, COALESCE(SUM(price-paid),0) as debt, COUNT(*)::int as count, COALESCE(SUM(price),0) as total FROM subscriptions");
      byPlan = await query("SELECT plan, COUNT(*)::int as count, COALESCE(SUM(paid),0) as paid, COALESCE(SUM(price),0) as price FROM subscriptions GROUP BY plan");
    } else {
      s = await query("SELECT COALESCE(SUM(paid),0) as revenue, COALESCE(SUM(price-paid),0) as debt, COUNT(*)::int as count, COALESCE(SUM(price),0) as total FROM subscriptions WHERE SUBSTRING(start_date, 1, 7) = $1", [yearMonth]);
      byPlan = await query("SELECT plan, COUNT(*)::int as count, COALESCE(SUM(paid),0) as paid, COALESCE(SUM(price),0) as price FROM subscriptions WHERE SUBSTRING(start_date, 1, 7) = $1 GROUP BY plan", [yearMonth]);
    }
    
    res.json({ revenue: s[0].revenue, debt: s[0].debt, count: s[0].count, totalPrice: s[0].total, byPlan });
  } catch (err) { res.json({ revenue: 0, debt: 0, count: 0, totalPrice: 0, byPlan: [] }); }
});

router.get('/stats/monthly/:yearMonth/plan/:plan', async (req, res) => {
  try {
    const { yearMonth, plan } = req.params;
    let rows;
    if (yearMonth === 'all') {
      rows = await query(`
        SELECT c.name, c.phone, s.paid, s.price, s.start_date, s.end_date 
        FROM subscriptions s
        JOIN customers c ON c.id = s.customer_id
        WHERE s.plan = $1 ORDER BY s.created_at DESC
      `, [plan]);
    } else {
      rows = await query(`
        SELECT c.name, c.phone, s.paid, s.price, s.start_date, s.end_date 
        FROM subscriptions s
        JOIN customers c ON c.id = s.customer_id
        WHERE s.plan = $1 AND SUBSTRING(s.start_date, 1, 7) = $2 ORDER BY s.created_at DESC
      `, [plan, yearMonth]);
    }
    res.json(rows);
  } catch (err) { res.status(500).json([]); }
});

// ----------------------------------------------------
// قسم شحنات الرصيد
// ----------------------------------------------------
router.get('/recharges', async (req, res) => {
  const rows = await query(`SELECT * FROM recharges ORDER BY created_at DESC`);
  res.json(rows);
});

router.post('/recharges', async (req, res) => {
  await run(`INSERT INTO recharges (amount) VALUES ($1)`, [parseInt(req.body.amount)]);
  res.json({ ok: true });
});

module.exports = router;
