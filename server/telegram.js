require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;
let isEnabled = false;

// Initialize bot if token is configured
if (token && token !== 'your-telegram-bot-token-here') {
  try {
    bot = new TelegramBot(token, { polling: false });
    isEnabled = true;
    
    // Handle /start command
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username;
      const firstName = msg.from.first_name;
      
      bot.sendMessage(chatId, 
        `👋 Welcome to LilSongBirdHomes Scheduler, ${firstName}!\n\n` +
        `📱 Your Telegram ID: <code>${chatId}</code>\n` +
        `👤 Username: ${username ? '@' + username : 'Not set'}\n\n` +
        `To receive shift notifications:\n` +
        `1. Copy your Telegram ID above\n` +
        `2. Ask your admin to link it to your staff account\n` +
        `3. You'll start receiving instant notifications!\n\n` +
        `💡 Tip: Long-press the ID to copy it`,
        { parse_mode: 'HTML' }
      );
    });

    // Handle /help command
    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId,
        `🤖 <b>LilSongBirdHomes Scheduler Bot</b>\n\n` +
        `This bot sends you notifications about:\n` +
        `• Shifts assigned to you\n` +
        `• Shift request updates\n` +
        `• Trade request alerts\n` +
        `• Time-off approvals\n` +
        `• Emergency coverage needs\n\n` +
        `<b>Commands:</b>\n` +
        `/start - Get your Telegram ID\n` +
        `/help - Show this help message\n` +
        `/myid - Show your Telegram ID again`,
        { parse_mode: 'HTML' }
      );
    });

    // Handle /myid command
    bot.onText(/\/myid/, (msg) => {
      const chatId = msg.chat.id;
      bot.sendMessage(chatId, 
        `Your Telegram ID: <code>${chatId}</code>\n\n` +
        `Give this to your admin to link your account.`,
        { parse_mode: 'HTML' }
      );
    });
    
    console.log('✅ Telegram bot initialized and listening');
  } catch (error) {
    console.error('❌ Telegram bot initialization failed:', error.message);
    isEnabled = false;
  }
} else {
  console.log('⚠️  Telegram bot disabled (no token configured)');
  console.log('   Set TELEGRAM_BOT_TOKEN in .env to enable notifications');
}

/**
 * Send a notification to a user via Telegram
 * @param {string} telegramId - User's Telegram chat ID
 * @param {string} message - Message to send (supports HTML)
 * @returns {Promise<boolean>} - Success status
 */
async function sendNotification(telegramId, message) {
  if (!isEnabled || !bot || !telegramId) {
    console.log('📭 Notification not sent (Telegram disabled or no ID)');
    return false;
  }

  try {
    await bot.sendMessage(telegramId, message, { 
      parse_mode: 'HTML',
      disable_web_page_preview: true 
    });
    console.log(`✅ Telegram notification sent to ${telegramId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send Telegram notification to ${telegramId}:`, error.message);
    return false;
  }
}

/**
 * Send notifications to multiple users
 * @param {Array<{telegramId: string, message: string}>} notifications
 * @returns {Promise<number>} - Count of successful sends
 */
async function sendBulkNotifications(notifications) {
  if (!isEnabled || !bot) {
    return 0;
  }

  let successCount = 0;
  for (const { telegramId, message } of notifications) {
    if (await sendNotification(telegramId, message)) {
      successCount++;
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return successCount;
}

/**
 * Pre-formatted notification templates
 */
const templates = {
  shiftAssigned: (staffName, date, shiftType, shiftTime, scheduleUrl) => 
    `✅ <b>New Shift Assigned</b>\n\n` +
    `You have been assigned:\n` +
    `📅 <b>${date}</b>\n` +
    `⏰ ${shiftType}: ${shiftTime}\n\n` +
    `Check the schedule for details.\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  shiftRequestApproved: (date, shiftType, shiftTime, scheduleUrl) =>
    `🎉 <b>Shift Request Approved!</b>\n\n` +
    `Your request has been approved:\n` +
    `📅 <b>${date}</b>\n` +
    `⏰ ${shiftType}: ${shiftTime}\n\n` +
    `The shift is now on your schedule.\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  shiftRequestDenied: (date, shiftType, adminNote, scheduleUrl) =>
    `❌ <b>Shift Request Denied</b>\n\n` +
    `Your request for ${date} ${shiftType} was not approved.\n\n` +
    (adminNote ? `📝 Note: ${adminNote}\n\n` : '') +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  tradeRequestReceived: (requesterName, theirDate, theirShiftLabel, theirShiftTime, yourDate, yourShiftLabel, yourShiftTime, scheduleUrl) =>
    `🔄 <b>Shift Swap Request Received</b>\n\n` +
    `<b>${requesterName}</b> has sent you a shift swap request.\n\n` +
    `📤 <b>They give you:</b>\n` +
    `📅 ${theirDate} · ${theirShiftLabel} (${theirShiftTime})\n\n` +
    `📥 <b>You give them:</b>\n` +
    `📅 ${yourDate} · ${yourShiftLabel} (${yourShiftTime})\n\n` +
    `Log in to accept or decline:\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  tradeRequestSent: (targetName, myDate, myShiftLabel, myShiftTime, theirDate, theirShiftLabel, theirShiftTime, scheduleUrl) =>
    `📤 <b>Shift Swap Request Sent</b>\n\n` +
    `You have sent <b>${targetName}</b> a shift swap request.\n\n` +
    `📥 <b>You give:</b>\n` +
    `📅 ${myDate} · ${myShiftLabel} (${myShiftTime})\n\n` +
    `📤 <b>You receive:</b>\n` +
    `📅 ${theirDate} · ${theirShiftLabel} (${theirShiftTime})\n\n` +
    `You will be notified once ${targetName} responds.\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  tradeRequestAdmin: (requesterName, targetName, reqDate, reqShiftLabel, reqShiftTime, tgtDate, tgtShiftLabel, tgtShiftTime, scheduleUrl) =>
    `🔄 <b>New Shift Swap Request</b>\n\n` +
    `A shift swap request has been sent between <b>${requesterName}</b> and <b>${targetName}</b>.\n\n` +
    `📋 <b>Details:</b>\n` +
    `• ${requesterName}: ${reqDate} · ${reqShiftLabel} (${reqShiftTime})\n` +
    `• ${targetName}: ${tgtDate} · ${tgtShiftLabel} (${tgtShiftTime})\n\n` +
    `Awaiting both staff to approve before admin action is needed.\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  tradeApproved: (partnerName, date, shiftType, scheduleUrl) =>
    `✅ <b>Trade Approved by Partner</b>\n\n` +
    `<b>${partnerName}</b> approved your trade request.\n` +
    `Waiting for admin final approval.\n\n` +
    `You'll get ${date} - ${shiftType}\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  tradeDenied: (partnerName, note, scheduleUrl) =>
    `❌ <b>Trade Request Denied</b>\n\n` +
    `<b>${partnerName}</b> declined your trade request.\n\n` +
    (note ? `📝 Reason: ${note}\n\n` : '') +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  tradeFinalized: (finalDate, finalShift, adminNote, scheduleUrl) =>
    `🎉 <b>Trade Finalized!</b>\n\n` +
    `Admin approved the trade.\n` +
    `Your new shift:\n` +
    `📅 <b>${finalDate}</b>\n` +
    `⏰ ${finalShift}\n\n` +
    (adminNote ? `📝 Admin note: ${adminNote}\n\n` : 'Check your updated schedule.\n\n') +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  timeOffApproved: (startDate, endDate, type, scheduleUrl) =>
    `🌴 <b>Time Off Approved</b>\n\n` +
    `Your time-off request has been approved:\n` +
    `📅 ${startDate}${endDate !== startDate ? ` - ${endDate}` : ''}\n` +
    `Type: ${type}\n\n` +
    `Enjoy your time off!\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  timeOffDenied: (startDate, adminNote, scheduleUrl) =>
    `❌ <b>Time Off Request Denied</b>\n\n` +
    `Your request for ${startDate} was not approved.\n\n` +
    (adminNote ? `📝 Reason: ${adminNote}\n\n` : '') +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  emergencyAbsence: (staffName, date, shiftType, scheduleUrl) =>
    `🚨 <b>Emergency Absence Reported</b>\n\n` +
    `<b>${staffName}</b> cannot make their shift:\n` +
    `📅 ${date}\n` +
    `⏰ ${shiftType}\n\n` +
    `URGENT: Coverage needed!\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  shiftReminder: (date, shiftType, shiftTime, hoursUntil, scheduleUrl) =>
    `⏰ <b>Shift Reminder</b>\n\n` +
    `You have a shift in ${hoursUntil} hours:\n` +
    `📅 ${date}\n` +
    `⏰ ${shiftType}: ${shiftTime}\n\n` +
    `See you soon!\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  scheduleChanged: (date, oldShift, newShift, reason, scheduleUrl) =>
    `📝 <b>Schedule Update</b>\n\n` +
    `Your shift on ${date} has changed:\n\n` +
    `❌ Was: ${oldShift}\n` +
    `✅ Now: ${newShift}\n\n` +
    (reason ? `📝 Reason: ${reason}\n\n` : 'Check the schedule for details.\n\n') +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`,

  shiftRequestAdmin: (requesterName, date, shiftLabel, shiftTime, scheduleUrl) =>
    `📋 <b>New Open Shift Request</b>\n\n` +
    `<b>${requesterName}</b> has requested an open shift.\n\n` +
    `📅 ${date} · ${shiftLabel} (${shiftTime})\n\n` +
    `Log in to approve or deny this request.\n\n` +
    `🔗 <a href="${scheduleUrl}">${scheduleUrl}</a>`
};

module.exports = {
  bot,
  isEnabled,
  sendNotification,
  sendBulkNotifications,
  templates
}; // templates includes: tradeRequestSent, tradeRequestReceived, tradeRequestAdmin, shiftRequestAdmin
