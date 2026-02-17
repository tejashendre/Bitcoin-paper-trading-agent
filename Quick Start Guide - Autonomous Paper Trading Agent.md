# Quick Start Guide - Autonomous Paper Trading Agent

## 📦 What You're Getting

A **production-ready autonomous trading system** that:
- Runs on **Vercel** (serverless, free tier)
- Analyzes Bitcoin sentiment every **4 hours**
- Executes **buy/sell trades** automatically
- Stores portfolio in **Upstash Redis**
- Sends **Telegram notifications**
- Costs **~$1/month** to operate

---

## 🚀 Deployment in 5 Steps

### Step 1: Set Up Upstash Redis (2 minutes)

1. Go to https://console.upstash.com/
2. Click **Create Database** → **Redis** → **Free**
3. Copy the **REST URL** and **REST Token**
4. Save them securely

### Step 2: Get Perplexity API Key (2 minutes)

1. Visit https://www.perplexity.ai/api
2. Sign up and create an API key
3. Save it securely

### Step 3: Create Telegram Bot (3 minutes)

1. Open Telegram, search for **@BotFather**
2. Send `/newbot` and follow prompts
3. Copy the **Bot Token**
4. Send a message to your new bot
5. Visit `https://api.telegram.org/bot{TOKEN}/getUpdates`
6. Find your **Chat ID** in the response
7. Save both securely

### Step 4: Generate Cron Secret (1 minute)

```bash
openssl rand -base64 32
```

Save this value.

### Step 5: Deploy to Vercel (5 minutes)

#### Option A: GitHub Integration (Recommended)

1. Push code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/paper-trading-agent.git
   git push -u origin main
   ```

2. Go to https://vercel.com/dashboard
3. Click **Add New** → **Project**
4. Import your GitHub repository
5. Go to **Settings** → **Environment Variables**
6. Add these variables:
   - `UPSTASH_REDIS_REST_URL` = Your Upstash URL
   - `UPSTASH_REDIS_REST_TOKEN` = Your Upstash token
   - `PERPLEXITY_API_KEY` = Your Perplexity key
   - `TELEGRAM_BOT_TOKEN` = Your Telegram bot token
   - `TELEGRAM_CHAT_ID` = Your Telegram chat ID
   - `CRON_SECRET` = Your generated secret

7. Click **Deploy**

#### Option B: Vercel CLI

```bash
npm install -g vercel
cd paper-trading-agent
vercel
# Follow prompts, then add environment variables in Vercel Dashboard
```

---

## ✅ Verify It's Working

### Test the Endpoint

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-project.vercel.app/api/cron/trade
```

Expected response:
```json
{
  "success": true,
  "timestamp": "2026-02-15T22:50:00.000Z",
  "analysis": {
    "price": 45230.50,
    "sentiment": 75,
    "reasoning": "..."
  },
  "decision": {
    "action": "BUY",
    "reason": "..."
  },
  "portfolio": {
    "usd": 7500.00,
    "btc": 0.11
  }
}
```

### Check Vercel Logs

1. Go to Vercel Dashboard → Your Project
2. Click **Functions** tab
3. Select `/api/cron/trade`
4. View execution logs

### Check Portfolio in Redis

1. Go to Upstash Console
2. Select your database
3. Run commands:
   - `GET portfolio:usd` → Should show $10,000
   - `GET portfolio:btc` → Should show 0
   - `LRANGE trade:history 0 -1` → Should show trades

---

## 📁 Project Structure

```
paper-trading-agent/
├── src/
│   ├── app/
│   │   └── api/
│   │       └── cron/
│   │           └── trade/
│   │               └── route.ts          ⭐ Main trading logic
│   └── lib/
│       ├── redis.ts                      ⭐ Portfolio management
│       ├── perplexity.ts                 ⭐ Market sentiment
│       └── telegram.ts                   ⭐ Notifications
├── vercel.json                           ⭐ Cron schedule
├── next.config.js                        ⭐ Next.js config
├── package.json                          ⭐ Dependencies
├── README.md                             📖 Full documentation
├── DEPLOYMENT.md                         📖 Detailed setup guide
├── ARCHITECTURE.md                       📖 Technical design
└── QUICK_START.md                        📖 This file
```

---

## 🤖 How It Works

### Every 4 Hours:

1. **Vercel Cron** triggers the endpoint
2. **Perplexity API** analyzes Bitcoin sentiment (0-100)
3. **Redis** retrieves current portfolio
4. **Trading Logic** decides: BUY, SELL, or HOLD
5. **Redis** updates portfolio if trade executed
6. **Telegram** sends notification
7. **Logs** are stored for audit trail

### Trading Rules:

| Sentiment | Action |
|-----------|--------|
| > 70 | BUY 50% of USD balance |
| < 30 | SELL 100% of BTC |
| 30-70 | HOLD (no action) |

### Example:

```
Sentiment: 75 (Bullish)
Portfolio: $10,000 USD, 0 BTC
BTC Price: $45,000

→ Decision: BUY
→ Amount: $10,000 × 50% = $5,000
→ BTC Purchased: $5,000 ÷ $45,000 = 0.111 BTC
→ New Portfolio: $5,000 USD, 0.111 BTC
→ Telegram Alert: ✅ Sent
```

---

## 🔧 Customization

### Change Cron Schedule

Edit `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/trade",
      "schedule": "0 */6 * * *"  // Every 6 hours instead of 4
    }
  ]
}
```

### Modify Trading Strategy

Edit `src/app/api/cron/trade/route.ts`:

```typescript
// Change buy threshold from 70 to 75
if (sentiment > 75 && usdBalance > 100) {
  // Buy logic
}

// Change sell amount from 100% to 50%
if (sentiment < 30 && btcBalance > 0.001) {
  const usdFromSale = btcBalance * price * 0.5;  // 50% instead of 100%
  // Sell logic
}
```

### Add More Metrics

Edit `src/lib/perplexity.ts` to request additional data:

```typescript
const prompt = `Analyze Bitcoin price, sentiment, volume, and volatility. Return JSON with: { price, sentiment_score, volume, volatility, reasoning }`;
```

---

## 📊 Monitoring

### Daily Check:

1. **Telegram**: Check for trade notifications
2. **Vercel Dashboard**: Check Functions logs for errors
3. **Upstash Console**: Verify portfolio balances

### Weekly Check:

1. Review trade history: `LRANGE trade:history 0 -1`
2. Calculate portfolio value: `(usd + btc × current_price)`
3. Check API usage in Perplexity dashboard

---

## 🐛 Troubleshooting

### Cron Not Running?

```bash
# Test manually
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-project.vercel.app/api/cron/trade

# Check Vercel logs
# Go to Vercel Dashboard → Functions → /api/cron/trade → Logs
```

### Redis Connection Error?

1. Verify `UPSTASH_REDIS_REST_URL` and token in Vercel
2. Test: `curl https://YOUR_UPSTASH_URL/ping`
3. Check Upstash console for database status

### Perplexity API Error?

1. Verify `PERPLEXITY_API_KEY` is active
2. Check rate limits in Perplexity dashboard
3. Ensure account has credits

### Telegram Not Sending?

1. Verify bot token: `curl https://api.telegram.org/bot{TOKEN}/getMe`
2. Verify chat ID: `curl https://api.telegram.org/bot{TOKEN}/getUpdates`
3. Check bot has permission to send messages

---

## 💰 Cost Breakdown

| Service | Free Tier | Monthly Cost |
|---------|-----------|--------------|
| Vercel | ✅ Yes | $0 |
| Upstash Redis | ✅ 10K commands/day | $0 |
| Perplexity API | Pay-as-you-go | ~$0.50-1.00 |
| Telegram | ✅ Free | $0 |
| **Total** | | **~$1/month** |

---

## 📚 Documentation

- **README.md** - Full feature overview
- **DEPLOYMENT.md** - Step-by-step deployment guide
- **ARCHITECTURE.md** - Technical design details
- **QUICK_START.md** - This file

---

## 🎯 Next Steps

1. ✅ Deploy to Vercel (follow Step 1-5 above)
2. ✅ Verify it's working (test the endpoint)
3. ✅ Monitor first few trades (check Telegram)
4. ✅ Review portfolio (check Redis)
5. 🔄 Customize strategy (optional)
6. 📊 Track performance (optional)

---

## ⚠️ Important Notes

- **Paper Trading Only**: This is a simulated trading system, no real money is involved
- **Sentiment-Based**: Decisions are based on AI sentiment analysis, not guaranteed to be profitable
- **Monitor Regularly**: Check logs and portfolio regularly
- **Rotate Secrets**: Change `CRON_SECRET` every 30-90 days
- **Never Commit Secrets**: Use Vercel Environment Variables, not `.env` files

---

## 🔗 Useful Links

- [Vercel Dashboard](https://vercel.com/dashboard)
- [Upstash Console](https://console.upstash.com/)
- [Perplexity API](https://www.perplexity.ai/api)
- [Telegram BotFather](https://t.me/botfather)
- [Next.js Docs](https://nextjs.org/docs)

---

**Ready to deploy?** Follow the 5 steps above and you'll be live in ~15 minutes! 🚀

For detailed information, see **DEPLOYMENT.md** or **ARCHITECTURE.md**.

---

**Version**: 1.0.0  
**Last Updated**: February 15, 2026
