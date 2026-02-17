# Autonomous Paper Trading Agent - Deployment Guide

## Overview

This is a **production-grade Autonomous Paper Trading Agent** built with Next.js 14, TypeScript, and serverless infrastructure. The system runs a cron job every 4 hours to analyze Bitcoin market sentiment using Perplexity AI, execute trading decisions, and manage a paper trading portfolio stored in Upstash Redis.

### Key Features

- **Autonomous Trading**: Sentiment-driven buy/sell decisions without manual intervention
- **Serverless Architecture**: Deployed on Vercel with zero infrastructure management
- **Real-time Sentiment Analysis**: Leverages Perplexity AI's sonar model for fast, cost-effective market analysis
- **Reliable State Management**: Upstash Redis for persistent portfolio tracking
- **Instant Notifications**: Telegram alerts on every trade execution
- **Production-Ready**: Comprehensive error handling, security validation, and audit logging

---

## Architecture Overview

### System Components

| Component | Purpose | Technology |
|-----------|---------|-----------|
| **Cron Scheduler** | Triggers trading logic every 4 hours | Vercel Cron (`vercel.json`) |
| **Market Analysis** | Fetches Bitcoin sentiment and price | Perplexity API (sonar model) |
| **Portfolio State** | Persists USD and BTC balances | Upstash Redis |
| **Trade Execution** | Implements buy/sell logic | Next.js API Route (`/api/cron/trade`) |
| **Notifications** | Sends trade alerts | Telegram Bot API |
| **Security** | Validates cron requests | Bearer token authentication |

### Data Flow

```
Vercel Cron (every 4 hours)
    ↓
GET /api/cron/trade (with Authorization header)
    ↓
Validate Bearer token against CRON_SECRET
    ↓
Initialize portfolio in Redis if needed
    ↓
Fetch Bitcoin sentiment from Perplexity API
    ↓
Retrieve current portfolio state from Redis
    ↓
Make trading decision (BUY / SELL / HOLD)
    ↓
Execute trade and update Redis
    ↓
Log trade to Redis history
    ↓
Send Telegram notification
    ↓
Return JSON response
```

---

## Prerequisites

Before deploying, ensure you have:

1. **Vercel Account**: Free tier is sufficient for this project
2. **Upstash Account**: For Redis database (free tier includes 10,000 commands/day)
3. **Perplexity API Key**: Sign up at https://www.perplexity.ai/api
4. **Telegram Bot Token**: Create a bot with [@BotFather](https://t.me/botfather) on Telegram
5. **Git Repository**: GitHub, GitLab, or Bitbucket account

---

## Step-by-Step Deployment

### 1. Set Up Upstash Redis

1. Visit [Upstash Console](https://console.upstash.com/)
2. Click **Create Database** → Select **Redis**
3. Choose **Free** tier, select your region, and create
4. Copy the **REST URL** and **REST Token** from the database details
5. Store these securely (you'll need them in Step 5)

### 2. Obtain Perplexity API Key

1. Visit [Perplexity API](https://www.perplexity.ai/api)
2. Sign up or log in
3. Navigate to **API Keys** section
4. Create a new API key
5. Store it securely

### 3. Set Up Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Copy the **Bot Token** provided
4. Send a message to your new bot
5. Visit `https://api.telegram.org/bot{YOUR_BOT_TOKEN}/getUpdates` in your browser
6. Find your **Chat ID** in the response (look for `"id"` field)
7. Store both the token and chat ID securely

### 4. Generate Cron Secret

Generate a strong secret for authorizing cron requests:

```bash
openssl rand -base64 32
```

Store this value securely.

### 5. Deploy to Vercel

#### Option A: Using Vercel CLI (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Navigate to project directory
cd paper-trading-agent

# Deploy to Vercel
vercel

# Follow the prompts to link your GitHub/GitLab account
```

#### Option B: Using GitHub Integration

1. Push your code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Autonomous Paper Trading Agent"
   git remote add origin https://github.com/YOUR_USERNAME/paper-trading-agent.git
   git push -u origin main
   ```

2. Visit [Vercel Dashboard](https://vercel.com/dashboard)
3. Click **Add New** → **Project**
4. Import your GitHub repository
5. Vercel will auto-detect Next.js configuration

### 6. Configure Environment Variables

In Vercel Dashboard:

1. Go to your project → **Settings** → **Environment Variables**
2. Add the following variables:

| Variable | Value |
|----------|-------|
| `UPSTASH_REDIS_REST_URL` | Your Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash REST Token |
| `PERPLEXITY_API_KEY` | Your Perplexity API Key |
| `TELEGRAM_BOT_TOKEN` | Your Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | Your Telegram Chat ID |
| `CRON_SECRET` | Your generated cron secret |

3. Click **Save**

### 7. Verify Deployment

After deployment completes:

1. Visit your Vercel project URL (e.g., `https://your-project.vercel.app`)
2. Test the cron endpoint manually:
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
    "reasoning": "Positive market momentum..."
  },
  "decision": {
    "action": "BUY",
    "reason": "Bullish sentiment with sufficient capital"
  },
  "portfolio": {
    "usd": 7500.00,
    "btc": 0.11
  }
}
```

---

## Trading Algorithm

### Decision Logic

The agent makes trading decisions based on Bitcoin sentiment (0-100 scale):

| Sentiment | Condition | Action | Logic |
|-----------|-----------|--------|-------|
| > 70 | USD balance > $100 | **BUY** | Invest 50% of available cash in BTC |
| < 30 | BTC balance > 0.001 | **SELL** | Liquidate 100% of BTC holdings |
| 30-70 | Any | **HOLD** | Maintain current position |

### Risk Management

- **Initial Portfolio**: $10,000 USD, 0 BTC
- **Buy Limit**: Maximum 50% of USD balance per trade
- **Sell Limit**: Only sells if BTC holdings exceed 0.001 (prevents dust)
- **Minimum Trade**: Requires at least $100 USD or 0.001 BTC

### Trade Execution Example

**Scenario**: Bitcoin sentiment = 75, price = $45,000, portfolio = $10,000 USD

1. Sentiment > 70 ✓
2. USD balance ($10,000) > $100 ✓
3. Action: **BUY**
4. Amount to invest: $10,000 × 0.5 = $5,000
5. BTC to purchase: $5,000 ÷ $45,000 = 0.111 BTC
6. New portfolio: $5,000 USD, 0.111 BTC

---

## Monitoring & Debugging

### View Cron Execution Logs

In Vercel Dashboard:

1. Go to **Functions** tab
2. Select `/api/cron/trade`
3. View real-time logs and execution history

### Check Portfolio State

Access Redis data directly via Upstash Console:

1. Visit [Upstash Console](https://console.upstash.com/)
2. Select your database
3. Use the **CLI** or **Data Browser** to inspect:
   - `GET portfolio:usd`
   - `GET portfolio:btc`
   - `LRANGE trade:history 0 -1`

### Manual Cron Trigger

To test the cron without waiting 4 hours:

```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-project.vercel.app/api/cron/trade
```

### Telegram Verification

Send a test message to your bot to confirm the chat ID is correct:

```bash
curl -X POST https://api.telegram.org/bot{BOT_TOKEN}/sendMessage \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "{CHAT_ID}", "text": "Test message"}'
```

---

## File Structure

```
paper-trading-agent/
├── src/
│   ├── app/
│   │   └── api/
│   │       └── cron/
│   │           └── trade/
│   │               └── route.ts          # Main cron handler
│   └── lib/
│       ├── redis.ts                      # Redis client & portfolio management
│       ├── perplexity.ts                 # Market sentiment analysis
│       └── telegram.ts                   # Notification helper
├── next.config.js                        # Next.js configuration
├── tsconfig.json                         # TypeScript configuration
├── vercel.json                           # Vercel cron schedule
├── package.json                          # Dependencies
└── DEPLOYMENT.md                         # This file
```

---

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint | `https://xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash authentication token | `AXXXxxx...` |
| `PERPLEXITY_API_KEY` | Perplexity API key | `pplx-xxx...` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | `123456:ABCxyz...` |
| `TELEGRAM_CHAT_ID` | Telegram chat ID | `987654321` |
| `CRON_SECRET` | Secret for cron authorization | `base64-encoded-string` |

### Optional Configuration

You can customize the cron schedule in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/trade",
      "schedule": "0 */4 * * *"  // Every 4 hours
    }
  ]
}
```

**Cron Expression Format**: `minute hour day month day-of-week`

Common schedules:
- `0 */4 * * *` - Every 4 hours
- `0 */6 * * *` - Every 6 hours
- `0 9 * * *` - Daily at 9 AM UTC
- `0 */2 * * *` - Every 2 hours

---

## Troubleshooting

### Issue: Cron Not Triggering

**Solution**:
1. Verify `vercel.json` is in the root directory
2. Ensure environment variables are set in Vercel Dashboard
3. Check Vercel Functions logs for errors
4. Manually trigger the endpoint to test

### Issue: "Unauthorized" Response

**Solution**:
1. Verify `CRON_SECRET` is set correctly in Vercel
2. Ensure the Authorization header uses `Bearer {SECRET}` format
3. Check that the secret hasn't been rotated

### Issue: Redis Connection Timeout

**Solution**:
1. Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are correct
2. Check Upstash console for database status
3. Ensure your Upstash plan hasn't exceeded rate limits
4. Test connectivity: `curl https://YOUR_UPSTASH_URL/ping`

### Issue: Perplexity API Errors

**Solution**:
1. Verify `PERPLEXITY_API_KEY` is valid and active
2. Check API rate limits in Perplexity dashboard
3. Ensure your account has available credits
4. Review the error message in Vercel logs

### Issue: Telegram Messages Not Sending

**Solution**:
1. Verify bot token is correct: `curl https://api.telegram.org/bot{TOKEN}/getMe`
2. Confirm chat ID is correct: `curl https://api.telegram.org/bot{TOKEN}/getUpdates`
3. Check that the bot has permission to send messages
4. Verify Telegram API is accessible from Vercel

---

## Security Considerations

### Best Practices

1. **Never commit secrets**: Use Vercel Environment Variables, not `.env` files
2. **Rotate CRON_SECRET regularly**: Generate a new secret every 30-90 days
3. **Monitor API usage**: Check Perplexity and Upstash dashboards for unusual activity
4. **Limit Telegram access**: Only add trusted chat IDs
5. **Use HTTPS only**: All API calls use HTTPS by default

### Rate Limiting

- **Perplexity**: Free tier allows 5 requests/minute. At 4-hour intervals, you're well within limits.
- **Upstash**: Free tier allows 10,000 commands/day. Each cron run uses ~5 commands, so 6 runs/day = 30 commands. Well within limits.
- **Telegram**: No strict rate limits for bot messages, but avoid spamming.

---

## Customization

### Modify Trading Strategy

Edit the `makeTradeDecision()` function in `src/app/api/cron/trade/route.ts`:

```typescript
function makeTradeDecision(
  sentiment: number,
  price: number,
  usdBalance: number,
  btcBalance: number
): TradeDecision {
  // Customize thresholds here
  if (sentiment > 70 && usdBalance > 100) {
    // Your custom logic
  }
  // ...
}
```

### Change Cron Schedule

Edit `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/trade",
      "schedule": "0 */6 * * *"  // Change to every 6 hours
    }
  ]
}
```

### Add Additional Metrics

Extend the Perplexity prompt in `src/lib/perplexity.ts` to include additional data points (e.g., volume, volatility).

---

## Cost Estimation (Monthly)

| Service | Free Tier | Usage | Cost |
|---------|-----------|-------|------|
| Vercel | ✓ Included | 6 cron runs/day | $0 |
| Upstash Redis | ✓ 10K commands/day | ~30 commands/day | $0 |
| Perplexity API | Pay-as-you-go | 6 requests/day = ~180/month | $0.50-1.00 |
| Telegram | ✓ Free | Unlimited messages | $0 |
| **Total** | | | **$0.50-1.00/month** |

---

## Support & Resources

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Upstash Docs**: https://upstash.com/docs
- **Perplexity API**: https://docs.perplexity.ai
- **Telegram Bot API**: https://core.telegram.org/bots/api

---

## License

This project is provided as-is for educational and personal use.

---

**Last Updated**: February 15, 2026  
**Version**: 1.0.0
