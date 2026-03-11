// ═══════════════════════════════════════════════════════════
// EMAIL SERVICE MODULE - BREVO VERSION
// ═══════════════════════════════════════════════════════════
// Handles all email notifications using Brevo (Sendinblue) HTTPS API
// (Compatible with Railway - no SMTP blocking)
// FREE: 300 emails/day forever - https://brevo.com

const brevo = require('@getbrevo/brevo');

// Email configuration from environment variables
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'lilsongbirdhomes@gmail.com';
const FROM_NAME = process.env.FROM_NAME || 'LSBH Scheduler';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || 'lilsongbirdhomes@gmail.com';
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'https://lsbh-scheduler-production.up.railway.app';
const TELEGRAM_BOT = process.env.TELEGRAM_BOT_USERNAME || '@LilSongbirdbot';
const ORG_NAME = process.env.ORG_NAME || 'LSBH';

// Initialize Brevo
let apiInstance = null;
if (BREVO_API_KEY) {
  const defaultClient = brevo.ApiClient.instance;
  const apiKey = defaultClient.authentications['api-key'];
  apiKey.apiKey = BREVO_API_KEY;
  apiInstance = new brevo.TransactionalEmailsApi();
}

// ═══════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════

function getWelcomeEmailTemplate(staffName, username, tempPassword, includeTelegram = true) {
  const telegramSection = includeTelegram ? `
═══════════════════════════════════════
SET UP TELEGRAM (RECOMMENDED)
═══════════════════════════════════════

Get instant notifications about your schedule:

Step 1: Install Telegram
• iPhone/iPad: App Store → Search "Telegram Messenger"
• Android: Play Store → Search "Telegram Messenger"

Step 2: Link Your Account
• Open Telegram
• Search for: ${TELEGRAM_BOT}
• Tap "START"
• You're all set!

You'll receive notifications for:
✓ New shift assignments
✓ Schedule changes
✓ Trade requests
✓ Emergency alerts
` : '';

  return `Hello ${staffName},

Your ${ORG_NAME} Scheduler account has been created!

═══════════════════════════════════════
LOGIN CREDENTIALS
═══════════════════════════════════════

Website: ${SCHEDULER_URL}
Username: ${username}
Temporary Password: ${tempPassword}

⚠️ You must change your password on first login.

═══════════════════════════════════════
GETTING STARTED
═══════════════════════════════════════

Step 1: Log in with the credentials above
Step 2: Change your password
Step 3: View your schedule
${includeTelegram ? 'Step 4: Set up Telegram notifications' : ''}
${telegramSection}
═══════════════════════════════════════
NEED HELP?
═══════════════════════════════════════

Questions? Reply to this email or contact:
${REPLY_TO_EMAIL}

---
This is an automated message from ${ORG_NAME} Scheduler.
For assistance, contact ${REPLY_TO_EMAIL}

${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
}

function getPasswordResetEmailTemplate(staffName, username, newPassword) {
  return `Hello ${staffName},

Your password has been reset by an administrator.

═══════════════════════════════════════
NEW TEMPORARY PASSWORD
═══════════════════════════════════════

${newPassword}

⚠️ You must change this password on your next login.

═══════════════════════════════════════
LOGIN INFORMATION
═══════════════════════════════════════

Website: ${SCHEDULER_URL}
Username: ${username}
Password: ${newPassword}

═══════════════════════════════════════
NEED HELP?
═══════════════════════════════════════

Questions? Reply to this email or contact:
${REPLY_TO_EMAIL}

---
This is an automated message from ${ORG_NAME} Scheduler.
For assistance, contact ${REPLY_TO_EMAIL}

${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
}

function getTelegramSetupEmailTemplate(staffName) {
  return `Hello ${staffName},

Get notified instantly about schedule changes!

═══════════════════════════════════════
WHY USE TELEGRAM?
═══════════════════════════════════════

✓ Instant notifications for new shifts
✓ Alerts when schedule changes
✓ Trade request updates
✓ Emergency notifications
✓ 100% free - no subscription needed

═══════════════════════════════════════
SETUP (3 MINUTES)
═══════════════════════════════════════

STEP 1: Install Telegram

iPhone/iPad:
• Open App Store
• Search "Telegram Messenger"
• Install the app

Android:
• Open Play Store
• Search "Telegram Messenger"
• Install the app

STEP 2: Link Your Account

• Open Telegram
• Search for: ${TELEGRAM_BOT}
• Tap "START"
• You're all set!

═══════════════════════════════════════
ALREADY HAVE TELEGRAM?
═══════════════════════════════════════

Just search for ${TELEGRAM_BOT} and tap START!

═══════════════════════════════════════
NEED HELP?
═══════════════════════════════════════

Questions? Reply to this email or contact:
${REPLY_TO_EMAIL}

---
This is an automated message from ${ORG_NAME} Scheduler.
For assistance, contact ${REPLY_TO_EMAIL}

${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
}

function getGuestCredentialsEmailTemplate(recipientName, password, expiryDate) {
  const expiry = expiryDate ? new Date(expiryDate).toLocaleDateString() : 'Not set';
  
  return `Hello${recipientName ? ' ' + recipientName : ''},

You have been granted temporary view-only access to the ${ORG_NAME} staff schedule.

═══════════════════════════════════════
ACCESS INFORMATION
═══════════════════════════════════════

Website: ${SCHEDULER_URL}
Username: guest
Password: ${password}
Expires: ${expiry}

═══════════════════════════════════════
WHAT YOU'LL SEE
═══════════════════════════════════════

✓ Which shifts are covered
✓ Which shifts are open
✓ Shift times and types

For privacy, staff names are hidden. You'll see "Assigned" 
instead of individual names.

This is a read-only view. You cannot make any changes to 
the schedule.

═══════════════════════════════════════
QUESTIONS?
═══════════════════════════════════════

Contact: ${REPLY_TO_EMAIL}

---
This is an automated message from ${ORG_NAME} Scheduler.
For assistance, contact ${REPLY_TO_EMAIL}

${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
}

function getTestEmailTemplate() {
  return `This is a test email from ${ORG_NAME} Scheduler.

═══════════════════════════════════════
EMAIL CONFIGURATION TEST
═══════════════════════════════════════

✓ Brevo API: Working
✓ From: ${FROM_NAME} <${FROM_EMAIL}>
✓ Reply-To: ${REPLY_TO_EMAIL}
✓ Scheduler URL: ${SCHEDULER_URL}
✓ Telegram Bot: ${TELEGRAM_BOT}

If you received this email, your email configuration is 
working correctly!

═══════════════════════════════════════
CONFIGURATION DETAILS
═══════════════════════════════════════

Organization: ${ORG_NAME}
From: ${FROM_NAME} <${FROM_EMAIL}>
Reply-To: ${REPLY_TO_EMAIL}
Email Provider: Brevo (HTTPS API)
Free Tier: 300 emails/day (9,000/month)

When staff reply to emails, their responses will go to:
${REPLY_TO_EMAIL}

═══════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════

You can now:
✓ Send welcome emails when creating staff
✓ Send password reset emails
✓ Send Telegram setup instructions
✓ Send guest credentials

---
This is a test message from ${ORG_NAME} Scheduler.
Powered by Brevo - https://brevo.com
${SCHEDULER_URL}`;
}

// ═══════════════════════════════════════════════════════════
// EMAIL SENDING FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function sendEmail(to, subject, text) {
  if (!apiInstance) {
    throw new Error('Email not configured. Please set BREVO_API_KEY environment variable.');
  }

  const sendSmtpEmail = new brevo.SendSmtpEmail();
  
  sendSmtpEmail.sender = {
    name: FROM_NAME,
    email: FROM_EMAIL
  };
  
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.replyTo = { email: REPLY_TO_EMAIL };
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.textContent = text;

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('✅ Email sent via Brevo:', data.messageId, 'to', to);
    return { success: true, messageId: data.messageId };
  } catch (error) {
    console.error('❌ Brevo error:', error);
    throw error;
  }
}

async function sendWelcomeEmail(staffEmail, staffName, username, tempPassword, includeTelegram = true) {
  const subject = `Welcome to ${ORG_NAME} Scheduler - Account Created`;
  const text = getWelcomeEmailTemplate(staffName, username, tempPassword, includeTelegram);
  return sendEmail(staffEmail, subject, text);
}

async function sendPasswordResetEmail(staffEmail, staffName, username, newPassword) {
  const subject = `${ORG_NAME} Scheduler - Password Reset`;
  const text = getPasswordResetEmailTemplate(staffName, username, newPassword);
  return sendEmail(staffEmail, subject, text);
}

async function sendTelegramSetupEmail(staffEmail, staffName) {
  const subject = `Set Up Telegram for ${ORG_NAME} Scheduler Notifications`;
  const text = getTelegramSetupEmailTemplate(staffName);
  return sendEmail(staffEmail, subject, text);
}

async function sendGuestCredentialsEmail(recipientEmail, recipientName, password, expiryDate) {
  const subject = `${ORG_NAME} Schedule - Temporary Guest Access`;
  const text = getGuestCredentialsEmailTemplate(recipientName, password, expiryDate);
  return sendEmail(recipientEmail, subject, text);
}

async function sendTestEmail(recipientEmail) {
  const subject = `${ORG_NAME} Scheduler - Email Configuration Test`;
  const text = getTestEmailTemplate();
  return sendEmail(recipientEmail, subject, text);
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendTelegramSetupEmail,
  sendGuestCredentialsEmail,
  sendTestEmail,
  isConfigured: () => !!BREVO_API_KEY
};
