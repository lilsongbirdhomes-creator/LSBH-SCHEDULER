// ═══════════════════════════════════════════════════════════
// EMAIL SERVICE MODULE
// ═══════════════════════════════════════════════════════════
// Handles all email notifications using Gmail SMTP

const nodemailer = require('nodemailer');

// Email configuration from environment variables
const GMAIL_USER = process.env.GMAIL_USER || 'noreply.lsbh.scheduler@gmail.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || 'lilsongbirdhomes@gmail.com';
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'https://lsbh-scheduler-production.up.railway.app';
const TELEGRAM_BOT = process.env.TELEGRAM_BOT_USERNAME || '@LilSongbirdbot';
const ORG_NAME = process.env.ORG_NAME || 'LSBH';

// Create reusable transporter
let transporter = null;

function getTransporter() {
  if (!transporter && GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD
      }
    });
  }
  return transporter;
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
Please do not reply to ${GMAIL_USER}
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
Please do not reply to ${GMAIL_USER}
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
Please do not reply to ${GMAIL_USER}
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
Please do not reply to ${GMAIL_USER}
For assistance, contact ${REPLY_TO_EMAIL}

${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
}

function getTestEmailTemplate() {
  return `This is a test email from ${ORG_NAME} Scheduler.

═══════════════════════════════════════
EMAIL CONFIGURATION TEST
═══════════════════════════════════════

✓ SMTP Connection: Working
✓ From Address: ${GMAIL_USER}
✓ Reply-To Address: ${REPLY_TO_EMAIL}
✓ Scheduler URL: ${SCHEDULER_URL}
✓ Telegram Bot: ${TELEGRAM_BOT}

If you received this email, your email configuration is 
working correctly!

═══════════════════════════════════════
CONFIGURATION DETAILS
═══════════════════════════════════════

Organization: ${ORG_NAME}
From: ${ORG_NAME} Scheduler <${GMAIL_USER}>
Reply-To: ${REPLY_TO_EMAIL}

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
${SCHEDULER_URL}`;
}

// ═══════════════════════════════════════════════════════════
// EMAIL SENDING FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function sendEmail(to, subject, text) {
  const transport = getTransporter();
  
  if (!transport) {
    throw new Error('Email not configured. Please set GMAIL_APP_PASSWORD environment variable.');
  }

  const mailOptions = {
    from: `${ORG_NAME} Scheduler <${GMAIL_USER}>`,
    to: to,
    replyTo: REPLY_TO_EMAIL,
    subject: subject,
    text: text
  };

  try {
    const info = await transport.sendMail(mailOptions);
    console.log('✅ Email sent:', info.messageId, 'to', to);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Email error:', error);
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
  isConfigured: () => !!GMAIL_APP_PASSWORD
};
