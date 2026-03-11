// ═══════════════════════════════════════════════════════════
// EMAIL SERVICE MODULE - BREVO V4 VERSION
// ═══════════════════════════════════════════════════════════

const { BrevoClient } = require('@getbrevo/brevo');

// Email configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'lilsongbirdhomes@gmail.com';
const FROM_NAME = process.env.FROM_NAME || 'LSBH Scheduler';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || 'lilsongbirdhomes@gmail.com';
const SCHEDULER_URL = process.env.SCHEDULER_URL || 'https://lsbh-scheduler-production.up.railway.app';
const TELEGRAM_BOT = process.env.TELEGRAM_BOT_USERNAME || '@LilSongbirdbot';
const ORG_NAME = process.env.ORG_NAME || 'LSBH';

// Initialize Brevo client
let brevo = null;
if (BREVO_API_KEY) {
  brevo = new BrevoClient({ apiKey: BREVO_API_KEY });
}

// Send email function
async function sendEmail(to, subject, textContent) {
  if (!brevo) {
    throw new Error('Email not configured. Please set BREVO_API_KEY environment variable.');
  }

  const result = await brevo.transactionalEmails.sendTransacEmail({
    subject,
    textContent,
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: to }],
    replyTo: { email: REPLY_TO_EMAIL }
  });

  console.log('✅ Email sent via Brevo:', to);
  return result;
}

// Welcome email
async function sendWelcomeEmail(staffEmail, staffName, username, tempPassword) {
  const subject = `Welcome to ${ORG_NAME} Scheduler`;
  const text = `Hello ${staffName},

Welcome to the ${ORG_NAME} Scheduler! Your account has been created.

═══════════════════════════════════════
LOGIN INFORMATION
═══════════════════════════════════════

Website: ${SCHEDULER_URL}
Username: ${username}
Temporary Password: ${tempPassword}

⚠️ IMPORTANT: You must change your password on first login.

═══════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════

1. Visit ${SCHEDULER_URL}
2. Log in with the credentials above
3. You'll be prompted to create a new password
4. Set up Telegram notifications (optional but recommended!)

Questions? Reply to this email or contact ${REPLY_TO_EMAIL}

---
${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
  
  return sendEmail(staffEmail, subject, text);
}

// Password reset email
async function sendPasswordResetEmail(staffEmail, staffName, username, newPassword) {
  const subject = `${ORG_NAME} Scheduler - Password Reset`;
  const text = `Hello ${staffName},

Your password has been reset by an administrator.

═══════════════════════════════════════
NEW LOGIN INFORMATION
═══════════════════════════════════════

Username: ${username}
New Temporary Password: ${newPassword}

⚠️ IMPORTANT: You must change this password on next login.

═══════════════════════════════════════
TO LOG IN
═══════════════════════════════════════

1. Visit ${SCHEDULER_URL}
2. Log in with the new password above
3. You'll be prompted to create a permanent password

Questions? Reply to this email or contact ${REPLY_TO_EMAIL}

---
${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
  
  return sendEmail(staffEmail, subject, text);
}

// Telegram setup email (generic)
async function sendTelegramSetupEmail(staffEmail, staffName) {
  const subject = `Set Up Telegram for ${ORG_NAME} Scheduler Notifications`;
  const text = `Hello ${staffName},

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
• Copy your Telegram ID
• Send it to your admin to link

═══════════════════════════════════════
NEED HELP?
═══════════════════════════════════════

Questions? Reply to this email or contact ${REPLY_TO_EMAIL}

---
${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
  
  return sendEmail(staffEmail, subject, text);
}

// Telegram magic link email (one-click setup!)
async function sendTelegramMagicLinkEmail(staffEmail, staffName, magicLink) {
  const subject = `🚀 One-Click Telegram Setup for ${ORG_NAME} Scheduler`;
  const text = `Hello ${staffName},

You're one click away from instant shift notifications! ⚡

═══════════════════════════════════════
✨ ONE-CLICK SETUP (30 SECONDS!)
═══════════════════════════════════════

Just click this magic link:

👉 ${magicLink}

That's it! The link will:
1. Open Telegram on your phone
2. Connect you to ${TELEGRAM_BOT}
3. Auto-link your account

No searching, no typing - just tap the link and you're done! ✨

═══════════════════════════════════════
WHAT YOU'LL GET
═══════════════════════════════════════

✓ Instant notifications for new shifts
✓ Alerts when schedule changes
✓ Trade request updates
✓ Emergency notifications
✓ 100% free - no subscription needed

═══════════════════════════════════════
DON'T HAVE TELEGRAM YET?
═══════════════════════════════════════

No problem! Install it first (takes 2 minutes):

iPhone/iPad: App Store → "Telegram Messenger"
Android: Play Store → "Telegram Messenger"

Then click the magic link above!

═══════════════════════════════════════
NEED HELP?
═══════════════════════════════════════

Questions? Reply to this email or contact ${REPLY_TO_EMAIL}

⚠️ Note: This link expires in 7 days. If it expires, ask your admin for a new one.

---
${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
  
  return sendEmail(staffEmail, subject, text);
}

// Guest credentials email
async function sendGuestCredentialsEmail(recipientEmail, recipientName, password, expiryDate) {
  const expiry = expiryDate ? new Date(expiryDate).toLocaleDateString() : 'Not set';
  const subject = `${ORG_NAME} Schedule - Temporary Guest Access`;
  const text = `Hello${recipientName ? ' ' + recipientName : ''},

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

For privacy, staff names are hidden. You'll see "Assigned" instead of individual names.

This is a read-only view. You cannot make any changes to the schedule.

═══════════════════════════════════════
NEED HELP?
═══════════════════════════════════════

Questions? Reply to this email or contact ${REPLY_TO_EMAIL}

---
${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
  
  return sendEmail(recipientEmail, subject, text);
}

// Test email
async function sendTestEmail(recipientEmail) {
  const subject = `${ORG_NAME} Scheduler - Email Configuration Test`;
  const text = `This is a test email from ${ORG_NAME} Scheduler.

If you're reading this, your email configuration is working correctly! ✅

Email Provider: Brevo (v4 SDK)
Sent to: ${recipientEmail}
Timestamp: ${new Date().toISOString()}

You can now:
✓ Send welcome emails to new staff
✓ Send password reset emails
✓ Send Telegram setup instructions
✓ Send guest credentials

---
${ORG_NAME} Scheduler
${SCHEDULER_URL}`;
  
  return sendEmail(recipientEmail, subject, text);
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendTelegramSetupEmail,
  sendTelegramMagicLinkEmail,
  sendGuestCredentialsEmail,
  sendTestEmail,
  isConfigured: () => !!BREVO_API_KEY
};
