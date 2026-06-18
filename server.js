const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const multer = require('multer'); // مكتبة رفع الملفات
const { getDB, query } = require('./database');
const { sendExpiryNotification } = require('./routes/telegram');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = 3000;

// ==========================================
// 1. نظام الحماية (تسجيل الدخول) 🔒
// ==========================================
const ADMIN_USER = 'rabaa';
const ADMIN_PASS = '12345'; // تكدر تغير الباسورد منا بأي وقت

app.use((req, res, next) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  
  if (login === ADMIN_USER && password === ADMIN_PASS) {
    return next(); // دخول ناجح
  }
  
  res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
  res.status(401).send('عذراً، غير مصرح لك بالدخول. أدخل اسم المستخدم وكلمة المرور.');
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// إعداد مجلد رفع الملفات (للاسترجاع وصور QR)
const upload = multer({ dest: 'public/uploads/' });

// ==========================================
// 2. إصلاح خلل إحصائيات "الكل" 📊
// ==========================================
app.get('/api/stats/monthly/all', (req, res) => {
  try {
    const stats = query(`
      SELECT 
        COUNT(*) as count, 
        SUM(paid) as revenue, 
        SUM(price) as totalPrice, 
        SUM(price - paid) as debt 
      FROM subscriptions
    `)[0] || {};
    
    const byPlan = query(`
      SELECT plan, COUNT(*) as count, SUM(price) as price, SUM(paid) as paid 
      FROM subscriptions 
      GROUP BY plan
    `);

    res.json({
      revenue: stats.revenue || 0,
      totalPrice: stats.totalPrice || 0,
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
// 3. نظام النسخ الاحتياطي (Backup & Restore) 💾
// ==========================================
// تحميل قاعدة البيانات بالكامل (ملف .db الأصلي)
app.get('/api/backup', (req, res) => {
  const dbPath = path.join(__dirname, 'db', 'rabaa.db');
  if (fs.existsSync(dbPath)) {
    res.download(dbPath, `rabaa_backup_${Date.now()}.db`);
  } else {
    res.status(404).json({ error: 'ملف قاعدة البيانات غير موجود' });
  }
});

// استرجاع قاعدة البيانات (رفع ملف .db أو .json)
app.post('/api/restore', upload.single('backup'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  
  try {
    const dbPath = path.join(__dirname, 'db', 'rabaa.db');
    // استبدال قاعدة البيانات القديمة بالملف المرفوع فوراً
    fs.copyFileSync(req.file.path, dbPath);
    fs.unlinkSync(req.file.path); // تنظيف
    
    res.json({ success: true });
  } catch (err) {
    console.error('Restore Error:', err);
    res.status(500).json({ error: 'فشل استرجاع النسخة الاحتياطية' });
  }
});

// مسارات الـ API الأساسية
app.use('/api', apiRoutes);

// مسار الواجهة الرئيسي
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 4. الإشعارات التلقائية (الـ Cron Job) 🤖
// ==========================================
// يشتغل كل يوم الساعة 9:00 صباحاً
cron.schedule('0 11 * * *', async () => {
  console.log('\n🔍 جاري فحص الاشتراكات المنتهية لإرسال الإشعارات التلقائية...');
  try {
    const expired = query(`
      SELECT c.*, s.plan, s.price, s.paid, s.end_date, s.id as sub_id
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.is_active = 1 AND date(s.end_date) = date('now','localtime')
    `);

    if (expired.length === 0) {
      console.log('✅ لا توجد اشتراكات تنتهي اليوم.');
    }

    for (const row of expired) {
      console.log(`📨 جاري إرسال إشعار للزبون: ${row.name}`);
      await sendExpiryNotification({ id: row.id, name: row.name, qr_image: row.qr_image }, {
        plan: row.plan, price: row.price, paid: row.paid, end_date: row.end_date
      });
      // تحديث حالة الإشعار في قاعدة البيانات
      query(`UPDATE subscriptions SET notified_at = datetime('now','localtime') WHERE id = ${row.sub_id}`);
    }
  } catch (e) {
    console.error('❌ خطأ في الإشعارات التلقائية:', e.message);
  }
});

async function start() {
  await getDB();
  app.listen(PORT, () => {
    console.log(`\n==============================================`);
    console.log(`🛡️  تم تفعيل الحماية | اليوزر: rabaa - الباسورد: 12345`);
    console.log(`🚀 سيرفر الرابعة شغال ومحمي على: http://localhost:${PORT}`);
    console.log(`==============================================\n`);
  });
}

start();
