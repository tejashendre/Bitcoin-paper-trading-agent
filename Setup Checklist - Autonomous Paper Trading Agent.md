# Setup Checklist - Autonomous Paper Trading Agent

Use this checklist to ensure your deployment is complete and working correctly.

---

## Phase 1: Prerequisites ✅

- [ ] Node.js 18+ installed locally
- [ ] Git installed and configured
- [ ] GitHub account created
- [ ] Vercel account created (free tier)
- [ ] Terminal/Command prompt ready

---

## Phase 2: External Services Setup (15 minutes)

### Upstash Redis Setup

- [ ] Visit https://console.upstash.com/
- [ ] Create a free Redis database
- [ ] Copy **REST URL** and save to secure location
- [ ] Copy **REST Token** and save to secure location
- [ ] Test connection: `curl https://YOUR_UPSTASH_URL/ping`

**Saved Values**:
```
UPSTASH_REDIS_REST_URL: ___________________________
UPSTASH_REDIS_REST_TOKEN: ___________________________
```

### Perplexity API Setup

- [ ] Visit https://www.perplexity.ai/api
- [ ] Sign up or log in
- [ ] Navigate to API Keys section
- [ ] Create a new API key
- [ ] Copy **API Key** and save to secure location
- [ ] Verify account has available credits

**Saved Values**:
```
PERPLEXITY_API_KEY: ___________________________
```

### Telegram Bot Setup

- [ ] Open Telegram app
- [ ] Search for **@BotFather**
- [ ] Send `/newbot` command
- [ ] Choose a name for your bot
- [ ] Choose a username for your bot
- [ ] Copy **Bot Token** and save to secure location
- [ ] Send a test message to your new bot
- [ ] Visit `https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getUpdates`
- [ ] Find your **Chat ID** in the JSON response (look for `"id": XXXXX`)
- [ ] Copy **Chat ID** and save to secure location

**Saved Values**:
```
TELEGRAM_BOT_TOKEN: ___________________________
TELEGRAM_CHAT_ID: ___________________________
```

### Generate Cron Secret

- [ ] Open terminal/command prompt
- [ ] Run: `openssl rand -base64 32`
- [ ] Copy the output and save to secure location
- [ ] This will be your `CRON_SECRET`

**Saved Values**:
```
CRON_SECRET: ___________________________
```

---

## Phase 3: GitHub Repository Setup (5 minutes)

- [ ] Create a new GitHub repository named `paper-trading-agent`
- [ ] Clone the repository locally:
  ```bash
  git clone https://github.com/YOUR_USERNAME/paper-trading-agent.git
  cd paper-trading-agent
  ```
- [ ] Copy all project files into the repository
- [ ] Verify files are present:
  ```bash
  ls -la src/app/api/cron/trade/route.ts
  ls -la src/lib/redis.ts
  ls -la src/lib/perplexity.ts
  ls -la src/lib/telegram.ts
  ls -la vercel.json
  ```
- [ ] Add files to git:
  ```bash
  git add .
  git commit -m "Initial commit: Autonomous Paper Trading Agent"
  git push -u origin main
  ```
- [ ] Verify files are on GitHub (refresh repository page)

---

## Phase 4: Vercel Deployment (10 minutes)

### Deploy to Vercel

- [ ] Visit https://vercel.com/dashboard
- [ ] Click **Add New** → **Project**
- [ ] Select **Import Git Repository**
- [ ] Find and select your `paper-trading-agent` repository
- [ ] Click **Import**
- [ ] Vercel will auto-detect Next.js configuration
- [ ] Click **Deploy** (wait for deployment to complete)
- [ ] Verify deployment succeeded (check for green checkmark)
- [ ] Note your project URL: `https://YOUR_PROJECT_NAME.vercel.app`

### Configure Environment Variables

- [ ] In Vercel Dashboard, go to your project
- [ ] Click **Settings** → **Environment Variables**
- [ ] Add each variable with its value:

| Variable | Value |
|----------|-------|
| `UPSTASH_REDIS_REST_URL` | (from Phase 2) |
| `UPSTASH_REDIS_REST_TOKEN` | (from Phase 2) |
| `PERPLEXITY_API_KEY` | (from Phase 2) |
| `TELEGRAM_BOT_TOKEN` | (from Phase 2) |
| `TELEGRAM_CHAT_ID` | (from Phase 2) |
| `CRON_SECRET` | (from Phase 2) |

- [ ] Click **Save** for each variable
- [ ] Trigger a redeploy: Click **Deployments** → Latest → **Redeploy**
- [ ] Wait for redeploy to complete

---

## Phase 5: Testing & Verification (10 minutes)

### Manual Endpoint Test

- [ ] Open terminal/command prompt
- [ ] Run the following command (replace YOUR_CRON_SECRET):
  ```bash
  curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
    https://YOUR_PROJECT_NAME.vercel.app/api/cron/trade
  ```
- [ ] Expected response should include:
  - `"success": true`
  - `"analysis"` with `price`, `sentiment`, and `reasoning`
  - `"decision"` with `action` (BUY/SELL/HOLD)
  - `"portfolio"` with `usd` and `btc` balances

### Check Vercel Logs

- [ ] Go to Vercel Dashboard → Your Project
- [ ] Click **Functions** tab
- [ ] Select `/api/cron/trade`
- [ ] View recent invocations
- [ ] Verify logs show successful execution

### Verify Redis State

- [ ] Go to Upstash Console
- [ ] Select your database
- [ ] Click **Data Browser** tab
- [ ] Run these commands:
  - [ ] `GET portfolio:usd` → Should show `10000`
  - [ ] `GET portfolio:btc` → Should show `0`
  - [ ] `LLEN trade:history` → Should show `0` or `1` (depending on if a trade executed)

### Test Telegram Notification

- [ ] Manually trigger the endpoint again:
  ```bash
  curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
    https://YOUR_PROJECT_NAME.vercel.app/api/cron/trade
  ```
- [ ] If sentiment > 70 or < 30, you should receive a Telegram message
- [ ] Check your Telegram bot for the trade notification

---

## Phase 6: Monitoring Setup (5 minutes)

### Set Up Daily Monitoring

- [ ] Bookmark Vercel Dashboard: https://vercel.com/dashboard
- [ ] Bookmark Upstash Console: https://console.upstash.com/
- [ ] Bookmark your Telegram bot chat

### Create Monitoring Checklist

- [ ] **Daily**: Check Telegram for trade notifications
- [ ] **Daily**: Check Vercel Functions logs for errors
- [ ] **Weekly**: Review portfolio balance in Upstash
- [ ] **Weekly**: Check API usage in Perplexity dashboard
- [ ] **Monthly**: Rotate `CRON_SECRET` (optional but recommended)

---

## Phase 7: Documentation Review (5 minutes)

- [ ] Read **README.md** for feature overview
- [ ] Read **QUICK_START.md** for quick reference
- [ ] Read **DEPLOYMENT.md** for detailed setup info
- [ ] Read **ARCHITECTURE.md** for technical design
- [ ] Bookmark all documentation files

---

## Phase 8: Customization (Optional)

### Modify Trading Strategy

- [ ] Edit `src/app/api/cron/trade/route.ts`
- [ ] Change buy threshold (currently 70)
- [ ] Change sell threshold (currently 30)
- [ ] Change buy amount (currently 50% of USD)
- [ ] Commit changes: `git add . && git commit -m "Update trading strategy"`
- [ ] Push to GitHub: `git push origin main`
- [ ] Vercel will auto-redeploy

### Change Cron Schedule

- [ ] Edit `vercel.json`
- [ ] Change schedule from `0 */4 * * *` to desired interval
- [ ] Commit and push changes
- [ ] Vercel will auto-redeploy

---

## Phase 9: Final Verification ✅

- [ ] All environment variables are set in Vercel
- [ ] Manual endpoint test returns successful response
- [ ] Redis shows initialized portfolio (USD=10000, BTC=0)
- [ ] Vercel logs show no errors
- [ ] Telegram bot is receiving notifications (if trades execute)
- [ ] You can access Vercel Dashboard and Upstash Console
- [ ] Documentation is reviewed and bookmarked

---

## Troubleshooting Checklist

### If Cron Not Running

- [ ] Verify `vercel.json` is in root directory
- [ ] Check that environment variables are set in Vercel
- [ ] Manually test endpoint with curl
- [ ] Check Vercel Functions logs for errors
- [ ] Verify `CRON_SECRET` is correct

### If Redis Connection Fails

- [ ] Verify `UPSTASH_REDIS_REST_URL` is correct
- [ ] Verify `UPSTASH_REDIS_REST_TOKEN` is correct
- [ ] Test connection: `curl https://YOUR_UPSTASH_URL/ping`
- [ ] Check Upstash console for database status
- [ ] Verify database hasn't exceeded rate limits

### If Perplexity API Fails

- [ ] Verify `PERPLEXITY_API_KEY` is correct
- [ ] Check Perplexity dashboard for API status
- [ ] Verify account has available credits
- [ ] Check rate limits (5 requests/minute)

### If Telegram Not Sending

- [ ] Verify `TELEGRAM_BOT_TOKEN` is correct
- [ ] Verify `TELEGRAM_CHAT_ID` is correct
- [ ] Test bot: `curl https://api.telegram.org/bot{TOKEN}/getMe`
- [ ] Test chat ID: `curl https://api.telegram.org/bot{TOKEN}/getUpdates`
- [ ] Verify bot has permission to send messages

---

## Success Criteria ✅

Your deployment is successful when:

1. ✅ All environment variables are set in Vercel
2. ✅ Manual endpoint test returns `"success": true`
3. ✅ Redis shows portfolio initialized with $10,000 USD
4. ✅ Vercel logs show no errors
5. ✅ Cron runs automatically every 4 hours
6. ✅ Telegram notifications are received on trades
7. ✅ Portfolio updates correctly after trades

---

## Next Steps

1. **Monitor**: Check daily for trade notifications
2. **Review**: Weekly review of portfolio performance
3. **Customize**: Modify trading strategy as needed (optional)
4. **Maintain**: Rotate secrets every 30-90 days
5. **Enhance**: Add features or metrics as desired

---

## Support Resources

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Upstash Docs**: https://upstash.com/docs
- **Perplexity API**: https://docs.perplexity.ai
- **Telegram Bot API**: https://core.telegram.org/bots/api

---

## Final Notes

- ✅ This is a **paper trading system** (simulated, no real money)
- ✅ Decisions are based on **AI sentiment analysis** (not guaranteed profitable)
- ✅ Monitor regularly and review logs
- ✅ Keep all secrets secure and never commit to Git
- ✅ Rotate `CRON_SECRET` every 30-90 days

---

**Estimated Total Setup Time**: 45-60 minutes

**Estimated Monthly Cost**: ~$1 (Perplexity API only)

**Status**: Ready for production use ✅

---

**Last Updated**: February 15, 2026  
**Version**: 1.0.0
