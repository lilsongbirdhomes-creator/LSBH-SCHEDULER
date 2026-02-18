# LilSongBirdHomes Staff Scheduler

Complete staff scheduling system with Telegram notifications, shift trading, time-off requests, and admin approval workflows.

## ✨ Features

### Admin Features
- ✅ Create, edit, delete shifts
- ✅ Assign shifts to staff or mark as "Open Shift"
- ✅ Manage staff accounts (add, edit, delete, assign colors)
- ✅ Approve/deny shift requests
- ✅ Approve/deny shift trades (after both staff approve)
- ✅ Approve/deny time-off requests
- ✅ View pending approvals dashboard
- ✅ Copy shifts by date range
- ✅ Emergency absence management
- ✅ Week/Month calendar views with navigation
- ✅ 40-hour weekly limit enforcement

### Staff Features
- ✅ View schedule (week/month views)
- ✅ View personal shifts and upcoming schedule
- ✅ Request open shifts
- ✅ Initiate shift trades with other staff
- ✅ Approve/deny incoming trade requests
- ✅ Submit time-off requests
- ✅ Report emergency absences
- ✅ Receive instant Telegram notifications
- ✅ Track weekly hours (40-hour limit)
- ✅ Personal dashboard

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Telegram Bot

1. **Create your bot:**
   - Open Telegram
   - Search for `@BotFather`
   - Send `/newbot`
   - Name your bot (e.g., "LilSongBird Scheduler")
   - Copy the bot token

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and paste your bot token
   ```

3. **Staff setup:**
   - Each staff member searches for your bot in Telegram
   - They click "Start"
   - Admin links their Telegram ID to their account in the system

### 3. Initialize Database
```bash
npm run init-db
```

This creates the database with:
- Default admin account: `admin` / `password123`
- Sample staff with temp passwords
- Sample schedule data

### 4. Start Server
```bash
npm start
# Development mode with auto-reload:
npm run dev
```

### 5. Access the System
Open your browser to `http://localhost:3000`

**Default Login:**
- Username: `admin`
- Password: `password123`

**Change the admin password immediately after first login!**

## 📱 Telegram Notifications

Staff receive instant notifications for:
- ✅ Shift assigned to them
- ✅ Shift request approved/denied
- ✅ Incoming shift trade request
- ✅ Trade request approved/denied/finalized
- ✅ Time-off request approved/denied
- ✅ Emergency absence alerts
- ✅ Schedule changes affecting them

## 📁 Project Structure

```
staffscheduler/
├── server.js              # Main Express server
├── database/
│   ├── init.js           # Database initialization
│   └── schema.sql        # Database schema
├── server/
│   ├── auth.js           # Authentication middleware
│   ├── routes.js         # API endpoints
│   └── telegram.js       # Telegram bot handler
├── utils/
│   ├── hours.js          # Hour calculation logic
│   └── notifications.js  # Notification helpers
├── public/
│   ├── index.html        # Main app UI
│   ├── styles.css        # Styles
│   └── app.js            # Frontend JavaScript
└── package.json
```

## 🔒 Security Notes

- Change `SESSION_SECRET` in `.env` to a random string
- Change default admin password on first login
- Keep `.env` file secure (never commit to git)
- Use HTTPS in production
- Set `NODE_ENV=production` when deploying

## 🌐 Deployment

### Free Hosting Options:
- **Render.com** (Recommended - free tier available)
- **Railway.app** (Free $5/month credit)
- **Fly.io** (Free tier available)

### Deploy Steps:
1. Push code to GitHub
2. Connect to hosting platform
3. Add environment variables (Telegram token, session secret)
4. Deploy!

## 💰 Cost Breakdown

- **Telegram Bot:** FREE forever ✅
- **Hosting:** FREE on Render/Railway/Fly.io ✅
- **Total:** $0/month for teams under 15

## 📖 Usage Guide

### For Staff:
1. Login with your username and temporary password
2. Change your password on first login
3. Link Telegram: Click "Settings" → "Link Telegram" → Send `/start` to the bot
4. View schedule in Week or Month view
5. Request open shifts by clicking the shift
6. Trade shifts: Find your shift → "Request Trade" → Select which shift you want
7. You'll get Telegram notifications for everything!

### For Admins:
1. Manage staff in "Manage Staff" tab
2. Create shifts: Click any day → "Add Shift"
3. View pending approvals: Top-right badge shows count
4. Approve/deny requests in "Approvals" tab
5. Assign colors to staff for easy calendar visibility

## 🛠️ Troubleshooting

**Telegram notifications not working?**
- Check bot token in `.env`
- Make sure staff clicked "Start" on the bot
- Check that Telegram IDs are linked in staff settings

**Database errors?**
- Run `npm run init-db` to reset
- Check file permissions on `database/` folder

**Port already in use?**
- Change PORT in `.env` to a different number

## 📞 Support

For issues or questions, contact your system administrator.

## 📄 License

MIT License - Free to use and modify
