// ═══════════════════════════════════════════════════════════
// EMAIL SERVICE MODULE - DISABLED FOR NOW
// ═══════════════════════════════════════════════════════════
// This is a temporary placeholder so the app doesn't crash
// Email functionality is disabled until we fix the Brevo integration

// Dummy functions that don't do anything
async function sendWelcomeEmail() {
  console.log('⚠️ Email disabled - skipping welcome email');
  return { success: false, error: 'Email not configured' };
}

async function sendPasswordResetEmail() {
  console.log('⚠️ Email disabled - skipping password reset email');
  return { success: false, error: 'Email not configured' };
}

async function sendTelegramSetupEmail() {
  console.log('⚠️ Email disabled - skipping Telegram setup email');
  return { success: false, error: 'Email not configured' };
}

async function sendGuestCredentialsEmail() {
  console.log('⚠️ Email disabled - skipping guest credentials email');
  return { success: false, error: 'Email not configured' };
}

async function sendTestEmail() {
  console.log('⚠️ Email disabled - skipping test email');
  return { success: false, error: 'Email not configured' };
}

function isConfigured() {
  return false;
}

module.exports = {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendTelegramSetupEmail,
  sendGuestCredentialsEmail,
  sendTestEmail,
  isConfigured
};
