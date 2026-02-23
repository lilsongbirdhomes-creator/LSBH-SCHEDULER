const bcrypt = require('bcrypt');

/**
 * Middleware to check if user is authenticated
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

/**
 * Middleware to check if user is admin
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Admin privileges required' });
}

/**
 * Login handler
 */
async function login(db, username, password) {
  const user = db.prepare(`
    SELECT id, username, password, full_name, role, job_title, 
           tile_color, text_color, is_approved, is_active, must_change_password,
           email, phone, telegram_id
    FROM users 
    WHERE username = ? AND is_active = 1
  `).get(username);

  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  if (!user.is_approved) {
    return { success: false, error: 'Account pending approval' };
  }

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return { success: false, error: 'Invalid username or password' };
  }

  // Don't send password hash to client
  delete user.password;

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      jobTitle: user.job_title,
      tileColor: user.tile_color,
      textColor: user.text_color,
      mustChangePassword: user.must_change_password === 1,
      email: user.email,
      phone: user.phone,
      telegramId: user.telegram_id
    }
  };
}

/**
 * Change password handler
 */
async function changePassword(db, userId, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters' };
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  db.prepare(`
    UPDATE users 
    SET password = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(hashedPassword, userId);

  return { success: true };
}

/**
 * Get current user from session
 */
function getCurrentUser(db, userId) {
  if (!userId) return null;

  const user = db.prepare(`
    SELECT id, username, full_name, role, job_title,
           tile_color, text_color, email, phone, telegram_id
    FROM users 
    WHERE id = ? AND is_active = 1
  `).get(userId);

  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    jobTitle: user.job_title,
    tileColor: user.tile_color,
    textColor: user.text_color,
    email: user.email,
    phone: user.phone,
    telegramId: user.telegram_id
  };
}

module.exports = {
  requireAuth,
  requireAdmin,
  login,
  changePassword,
  getCurrentUser
};
