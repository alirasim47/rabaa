const axios = require('axios');
const { query } = require('../db/database');
const fs = require('fs');
const path = require('path');

async function getSetting(key) {
  const rows = query('SELECT value FROM settings WHERE key = ?', [key]);
  return rows[0]?.value || '';
}
const axios = require('axios');
// 👇 1. تم تصحيح مسار قاعدة البيانات
const { query } = require('./database');
const fs = require('fs');
const path = require('path');

async function getSetting(key) {
  const rows = query('SELECT value FROM settings WHERE key = ?', [key]);
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
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

async function sendTelegramPhoto(photoPath, caption) {
  const token = await getSetting('telegram_token');
  const chatId = await getSetting('telegram_chat_id');
  if (!token || !chatId) return;

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption, { contentType: 'text/plain' });
    form.append('photo', fs.createReadStream(photoPath));

    await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });
  } catch (e) {
    console.error('Telegram photo error:', e.message);
  }
}

async function sendExpiryNotification(customer, subscription) {
  const planNames = {
    monthly: 'شهري',
    '3months': 'ثلاثة أشهر',
    '6months': 'ستة أشهر',
    yearly: 'سنوي',
  };

  const remaining = subscription.paid - subscription.price;
  const debtInfo =
    remaining < 0
      ? `\n💸 <b>المتبقي من الحساب:</b> ${Math.abs(remaining).toLocaleString()} IQD`
      : `\n✅ <b>الحساب:</b> مكتمل`;

  const caption =
    `🔔 <b>انتهاء اشتراك</b>\n\n` +
    `👤 <b>الزبون:</b> ${customer.name}\n` +
    `📋 <b>نوع الاشتراك:</b> ${planNames[subscription.plan] || subscription.plan}\n` +
    `📅 <b>تاريخ الانتهاء:</b> ${subscription.end_date}\n` +
    debtInfo +
    `\n\n⚠️ يرجى التجديد`;

  // Send text first
  await sendTelegramMessage(caption);

  // Send QR if exists
  if (customer.qr_image) {
    // 👇 2. تم تصحيح مسار مجلد public للصور
    const qrPath = path.join(__dirname, 'public', customer.qr_image);
    if (fs.existsSync(qrPath)) {
      await sendTelegramPhoto(qrPath, `QR Code - ${customer.name}`);
    }
  }
}

module.exports = { sendTelegramMessage, sendTelegramPhoto, sendExpiryNotification };
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
  } catch (e) {
    console.error('Telegram error:', e.message);
  }
}

async function sendTelegramPhoto(photoPath, caption) {
  const token = await getSetting('telegram_token');
  const chatId = await getSetting('telegram_chat_id');
  if (!token || !chatId) return;

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption, { contentType: 'text/plain' });
    form.append('photo', fs.createReadStream(photoPath));

    await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });
  } catch (e) {
    console.error('Telegram photo error:', e.message);
  }
}

async function sendExpiryNotification(customer, subscription) {
  const planNames = {
    monthly: 'شهري',
    '3months': 'ثلاثة أشهر',
    '6months': 'ستة أشهر',
    yearly: 'سنوي',
  };

  const remaining = subscription.paid - subscription.price;
  const debtInfo =
    remaining < 0
      ? `\n💸 <b>المتبقي من الحساب:</b> ${Math.abs(remaining).toLocaleString()} IQD`
      : `\n✅ <b>الحساب:</b> مكتمل`;

  const caption =
    `🔔 <b>انتهاء اشتراك</b>\n\n` +
    `👤 <b>الزبون:</b> ${customer.name}\n` +
    `📋 <b>نوع الاشتراك:</b> ${planNames[subscription.plan] || subscription.plan}\n` +
    `📅 <b>تاريخ الانتهاء:</b> ${subscription.end_date}\n` +
    debtInfo +
    `\n\n⚠️ يرجى التجديد`;

  // Send text first
  await sendTelegramMessage(caption);

  // Send QR if exists
  if (customer.qr_image) {
    const qrPath = path.join(__dirname, '../public', customer.qr_image);
    if (fs.existsSync(qrPath)) {
      await sendTelegramPhoto(qrPath, `QR Code - ${customer.name}`);
    }
  }
}

module.exports = { sendTelegramMessage, sendTelegramPhoto, sendExpiryNotification };
