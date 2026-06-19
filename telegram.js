const axios = require('axios');
const { query } = require('./database');

async function getSetting(key) {
  const rows = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value || '';
}

async function sendTelegramMessage(text) {
  const token = await getSetting('telegram_token');
  const chatId = await getSetting('telegram_chat_id');
  if (!token || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    });
  } catch (e) { console.error('Telegram error:', e.message); }
}

async function sendExpiryNotification(customer, sub) {
  const PLAN_LABELS = { monthly: 'شهري', '3months': '3 أشهر', '6months': '6 أشهر', yearly: 'سنوي' };
  const text = `⚠️ <b>إشعار انتهاء اشتراك</b>\n\n👤 <b>الزبون:</b> ${customer.name}\n📱 <b>الهاتف:</b> ${customer.phone || 'لا يوجد'}\n📋 <b>الباقة:</b> ${PLAN_LABELS[sub.plan] || sub.plan}\n📅 <b>تاريخ الانتهاء:</b> ${sub.end_date}\n💰 <b>الحساب:</b> ${sub.paid >= sub.price ? 'واصل ✅' : 'باقي ديون 💸'}`;
  await sendTelegramMessage(text);
}

module.exports = { sendTelegramMessage, sendExpiryNotification };
