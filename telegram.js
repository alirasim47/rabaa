const axios = require('axios');
const { query } = require('./database'); // تعديل المسار المباشر

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

module.exports = { sendTelegramMessage };
