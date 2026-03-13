require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.APP_URL || process.env.SCHEDULER_URL;
let bot = null;
let isEnabled = false;

// Initialize bot if token is configured
if (token && token !== 'your-telegram-bot-token-here') {
  try {
    bot = new TelegramBot(token, { 
      polling: false,
      webHook: false // We'll set webhook manually via route
    });
    isEnabled = true;
    
    // Handle /start command (with optional link code)
    bot.onText(/\/start(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const username = msg.from.username;
      const firstName = msg.from.first_name;
      const linkCode = match[1] ? match[1].trim() : '';
      
      // If there's a link code, try to auto-link
      if (linkCode) {
        try {
          // Link codes are stored in database temporarily
          const db = require('./database');
          const linkRecord = db.prepare('SELECT staff_id FROM telegram_link_codes WHERE code = ? AND used = 0 AND expires_at > ?')
            .get(linkCode, Date.now());
          
          if (linkRecord) {
            // Get staff info
            const staff = db.prepare('SELECT id, full_name, email FROM users WHERE id = ?').get(linkRecord.staff_id);
            
            if (staff) {
              // Link the Telegram ID
              db.prepare('UPDATE users SET telegram_id = ? WHERE id = ?').run(chatId.toString(), staff.id);
              
              // Mark code as used
              db.prepare('UPDATE telegram_link_codes SET used = 1, used_at = ? WHERE code = ?').run(Date.now(), linkCode);
              
              // Send success message to staff
              bot.sendMessage(chatId,
                `✅ <b>Connected Successfully!</b>\n\n` +
                `Hi <b>${staff.full_name}</b>! Your Telegram account is now linked to your LSBH Scheduler account.\n\n` +
                `You'll receive notifications for:\n` +
                `• New shift assignments\n` +
                `• Schedule changes\n` +
                `• Shift requests\n` +
                `• Emergency alerts\n\n` +
                `Your admin has been notified. ✨`,
                { parse_mode: 'HTML' }
              );
              
              // Notify admin (get admin telegram IDs)
              const admins = db.prepare('SELECT telegram_id, full_name FROM users WHERE role = ? AND telegram_id IS NOT NULL').all('admin');
              for (const admin of admins) {
                try {
                  bot.sendMessage(admin.telegram_id,
                    `✅ <b>Telegram Linked</b>\n\n` +
                    `<b>${staff.full_name}</b> just connected their Telegram account!\n\n` +
                    `📱 Telegram ID: <code>${chatId}</code>`,
                    { parse_mode: 'HTML' }
                  );
                } catch (err) {
                  console.error('Failed to notify admin:', err);
                }
              }
              
              return; // Exit - successful link
            }
          }
          
          // Invalid or expired code
          bot.sendMessage(chatId,
            `❌ <b>Invalid Link</b>\n\n` +
            `This link has expired or is invalid.\n\n` +
            `Please ask your admin for a new link, or use /start to get your Telegram ID manually.`,
            { parse_mode: 'HTML' }
          );
          return;
        } catch (err) {
          console.error('Error processing link code:', err);
          // Fall through to manual ID display
        }
      }
      
      // No link code or error - show manual instructions
      bot.sendMessage(chatId, 
        `👋 Welcome to LilSongBirdHomes Scheduler, ${firstName}!\n\n` +
        `📱 Your Telegram ID: <code>${chatId}</code>\n` +
        `👤 Username: ${username ? '@' + username : 'Not set'}\n\n` +
        `To receive shift notifications:\n` +
        `1. Copy your Telegram ID above\n` +
        `2. Ask your admin to link it to your staff account\n` +
        `3. You'll start receiving instant notifications!\n\n` +
        `💡 Tip: Long-press the ID to copy it\n\n` +
        `Or ask your admin for a magic link for instant setup!`,
        { parse_mode: 'HTML' }
      );
      
      // ALWAYS notify admin when someone uses /start (for testing & monitoring)
      try {
        const db = require('./database');
        const admins = db.prepare('SELECT telegram_id, full_name FROM users WHERE role = ? AND telegram_id IS NOT NULL').all('admin');
        for (const admin of admins) {
          try {
            bot.sendMessage(admin.telegram_id,
              `🔔 <b>New /start Command</b>\n\n` +
              `Someone just used /start on the bot:\n\n` +
              `👤 Name: ${firstName}\n` +
              `📱 Telegram ID: <code>${chatId}</code>\n` +
              `🔗 Username: ${username ? '@' + username : 'Not set'}\n\n` +
              `${linkCode ? '⚠️ Used an invalid/expired link code' : 'ℹ️ No link code (manual setup)'}`,
              { parse_mode: 'HTML' }
            );
          } catch (err) {
            console.error('Failed to notify admin:', err);
          }
        }
      } catch (err) {
        console.error('Error notifying admins:', err);
      }
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

    // Handle /myid command - shows Telegram ID and notifies admin
    bot.onText(/\/myid/, async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username;
      const firstName = msg.from.first_name;
      
      bot.sendMessage(chatId,
        `📱 <b>Your Telegram ID</b>\n\n` +
        `ID: <code>${chatId}</code>\n` +
        `Name: ${firstName}\n` +
        `Username: ${username ? '@' + username : 'Not set'}\n\n` +
        `💡 Long-press the ID above to copy it`,
        { parse_mode: 'HTML' }
      );
      
      // Notify admin
      try {
        const db = require('./database');
        const admins = db.prepare('SELECT telegram_id, full_name FROM users WHERE role = ? AND telegram_id IS NOT NULL').all('admin');
        for (const admin of admins) {
          try {
            bot.sendMessage(admin.telegram_id,
              `🔔 <b>/myid Command Used</b>\n\n` +
              `👤 Name: ${firstName}\n` +
              `📱 Telegram ID: <code>${chatId}</code>\n` +
              `🔗 Username: ${username ? '@' + username : 'Not set'}`,
              { parse_mode: 'HTML' }
            );
          } catch (err) {
            console.error('Failed to notify admin:', err);
          }
        }
      } catch (err) {
        console.error('Error notifying admins:', err);
      }
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

// Webhook handler for receiving bot messages
function handleWebhook(req, res) {
  if (!isEnabled) {
    return res.sendStatus(200);
  }
  
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Telegram webhook error:', error);
    res.sendStatus(500);
  }
}

// Setup webhook
async function setupWebhook(appUrl) {
  if (!isEnabled || !appUrl) {
    return;
  }
  
  try {
    const webhookUrl = `${appUrl}/api/telegram/webhook`;
    await bot.setWebHook(webhookUrl);
    console.log('✅ Telegram webhook set:', webhookUrl);
  } catch (error) {
    console.error('❌ Failed to set Telegram webhook:', error);
  }
}

module.exports = {
  bot,
  isEnabled,
  sendNotification,
  sendBulkNotifications,
  templates,
  handleWebhook,
  setupWebhook
}; // templates includes: tradeRequestSent, tradeRequestReceived, tradeRequestAdmin, shiftRequestAdmin
