const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const multer = require('multer');
const { getDB, query, run } = require('./database');
const { sendExpiryNotification } = require('./telegram');

const apiRoutes = require('./api'); 

const app = express();
const PORT = process.env.PORT || 3000; 

// ==========================================
// 1. نظام الحماية (تسجيل الدخول) 🔒
// ==========================================
const ADMIN_USER = 'rabaa';
const ADMIN_PASS = '12345'; 

app.use((req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  
  if (login === ADMIN_USER && password === ADMIN_PASS) {
    return next(); 
  }
  
  res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
  res.status(401).send('عذراً، غير مصرح لك بالدخول. أدخل اسم المستخدم وكلمة المرور.');
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'public/uploads/' });

// ==========================================
// 2. إصلاح خلل إحصائيات "الكل" بالسحابة 📊
// ==========================================
app.get('/api/stats/monthly/all', async (req, res) => {
  try {
    const statsRows = await query(`
      SELECT 
        COUNT(*)::int as count, 
        COALESCE(SUM(paid), 0)::int as revenue, 
        COALESCE(SUM(price), 0)::int as totalprice, 
        COALESCE(SUM(price - paid), 0)::int as debt 
      FROM subscriptions
    `);
    const stats = statsRows[0] || {};
    
    const byPlan = await query(`
      SELECT plan, COUNT(*)::int as count, COALESCE(SUM(price), 0)::int as price, COALESCE(SUM(paid), 0)::int as paid 
      FROM subscriptions 
      GROUP BY plan
    `);

    res.json({
      revenue: stats.revenue || 0,
      totalPrice: stats.totalprice || 0,
      debt: stats.debt || 0,
      count: stats.count || 0,
      byPlan: byPlan || []
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.json({ revenue: 0, totalPrice: 0, debt: 0, count: 0, byPlan: [] });
  }
});

// ==========================================
// 3. نظام النسخ الاحتياطي (تعطيل محلي مؤقت لحماية السيرفر) 💾
// ==========================================
app.get('/api/backup', (req, res) => {
  res.status(400).json({ error: 'النسخ الاحتياطي يعمل تلقائياً الآن عبر سحابة Supabase بقسم الـ Backups.' });
});

app.post('/api/restore', upload.single('backup'), (req, res) => {
  res.status(400).json({ error: 'البيانات تدار حركياً عبر السحابة مباشرة.' });
});

// مسارات الـ API الأساسية
app.use('/api', apiRoutes);

// مسار الواجهة الرئيسي
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 4. الإشعارات التلقائية الحركية (الـ Cron Job) 🤖
// ==========================================
cron.schedule('0 11 * * *', async () => {
  console.log('\n🔍 جاري فحص الاشتراكات المنتهية لإرسال الإشعارات التلقائية لـ Supabase...');
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const expired = await query(`
      SELECT c.*, s.plan, s.price, s.paid, s.end_date, s.id as sub_id
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.is_active = 1 AND s.end_date = $1
    `, [todayStr]);

    if (expired.length === 0) {
      console.log('✅ لا توجد اشتراكات تنتهي اليوم.');
    }

    for (const row of expired) {
      console.log(`📨 جاري إرسال إشعار للزبون: ${row.name}`);
      await sendExpiryNotification(row, {
        plan: row.plan, price: row.price, paid: row.paid, end_date: row.end_date
      });
    }
  } catch (e) {
    console.error('❌ خطأ في الإشعارات التلقائية:', e.message);
  }
});

async function start() {
  try {
    await getDB();
    app.listen(PORT, () => {
      console.log(`\n==============================================`);
      console.log(`🛡️  تم تفعيل الحماية | اليوزر: rabaa - الباسورد: 12345`);
      console.log(`🚀 سيرفر الرابعة شغال ومحمي على البورت: ${PORT}`);
      console.log(`==============================================\n`);
    });
  } catch (err) {
    console.error('❌ فشل بدء تشغيل السيرفر الموحد:', err.message);
  }
}

start();
