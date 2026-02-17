# Autonomous Paper Trading Agent

A **production-grade, serverless autonomous trading system** that analyzes Bitcoin market sentiment every 4 hours and executes trading decisions automatically. Built with Next.js 14, TypeScript, and deployed on Vercel.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- Vercel account (free tier)
- Upstash Redis account
- Perplexity API key
- Telegram bot token

### Local Development

```bash
# Clone the repository
git clone https://github.com/your-username/paper-trading-agent.git
cd paper-trading-agent

# Install dependencies
pnpm install

# Create .env.local with your credentials
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
pnpm dev

# Test the cron endpoint
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/trade
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables in Vercel Dashboard
# See DEPLOYMENT.md for detailed instructions
```

---

## 📋 Features

✅ **Autonomous Trading**: Sentiment-driven buy/sell decisions without manual intervention  
✅ **Serverless Deployment**: Zero infrastructure management on Vercel  
✅ **Real-time Sentiment Analysis**: Powered by Perplexity AI's sonar model  
✅ **Persistent State**: Portfolio tracking in Upstash Redis  
✅ **Instant Notifications**: Telegram alerts on every trade  
✅ **Production-Ready**: Comprehensive error handling and security  
✅ **Audit Trail**: Complete trade history logging  
✅ **Cost-Effective**: ~$1/month operating cost  

---

## 🏗️ Architecture

### Core Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Scheduler** | Vercel Cron | Triggers trading every 4 hours |
| **Market Analysis** | Perplexity API | Fetches Bitcoin sentiment |
| **State Management** | Upstash Redis | Persists portfolio data |
| **Trading Engine** | Next.js API Route | Executes buy/sell logic |
| **Notifications** | Telegram Bot API | Sends trade alerts |

### Data Flow

```
Vercel Cron (every 4 hours)
    ↓
GET /api/cron/trade (with Bearer token)
    ↓
Fetch Bitcoin sentiment from Perplexity
    ↓
Retrieve portfolio from Redis
    ↓
Make trading decision (BUY/SELL/HOLD)
    ↓
Execute trade and update Redis
    ↓
Send Telegram notification
    ↓
Return JSON response
```

---

## 🤖 Trading Algorithm

### Decision Logic

The agent analyzes Bitcoin sentiment (0-100 scale) and makes autonomous decisions:

| Sentiment | Condition | Action |
|-----------|-----------|--------|
| **> 70** | USD > $100 | **BUY** 50% of available cash |
| **< 30** | BTC > 0.001 | **SELL** 100% of holdings |
| **30-70** | Any | **HOLD** current position |

### Example Trade Flow

```
Sentiment: 75/100 (Bullish)
Portfolio: $10,000 USD, 0 BTC
BTC Price: $45,000

Decision: BUY
Amount: $10,000 × 50% = $5,000
BTC Purchased: $5,000 ÷ $45,000 = 0.111 BTC

New Portfolio: $5,000 USD, 0.111 BTC
Notification: Telegram alert with trade details
```

---

## 📁 Project Structure

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
├── vercel.json                           # Cron schedule (every 4 hours)
├── package.json                          # Dependencies
├── README.md                             # This file
└── DEPLOYMENT.md                         # Detailed deployment guide
```

---

## 🔧 Environment Variables

Create a `.env.local` file with the following variables:

```env
# Upstash Redis
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here

# Perplexity API
PERPLEXITY_API_KEY=your_api_key_here

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Cron Security
CRON_SECRET=your_secret_here
```

See `.env.example` for a template.

---

## 🔐 Security

### Authentication

The cron endpoint validates requests using Bearer token authentication:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-project.vercel.app/api/cron/trade
```

### Best Practices

- ✅ Never commit `.env.local` or secrets to Git
- ✅ Use Vercel Environment Variables for production
- ✅ Rotate `CRON_SECRET` every 30-90 days
- ✅ Monitor API usage in Perplexity and Upstash dashboards
- ✅ Limit Telegram chat IDs to trusted recipients

---

## 📊 Monitoring

### View Cron Logs

In Vercel Dashboard → Functions → `/api/cron/trade` → Logs

### Check Portfolio State

In Upstash Console → Data Browser:
- `GET portfolio:usd` - Current USD balance
- `GET portfolio:btc` - Current BTC balance
- `LRANGE trade:history 0 -1` - Trade history

### Manual Testing

```bash
# Test the endpoint
curl -X GET \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-project.vercel.app/api/cron/trade

# Expected response:
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

## 💰 Cost Analysis

| Service | Free Tier | Monthly Cost |
|---------|-----------|--------------|
| Vercel | ✓ Included | $0 |
| Upstash Redis | ✓ 10K commands/day | $0 |
| Perplexity API | Pay-as-you-go | ~$0.50-1.00 |
| Telegram | ✓ Free | $0 |
| **Total** | | **~$0.50-1.00/month** |

---

## 🛠️ Customization

### Change Trading Strategy

Edit `src/app/api/cron/trade/route.ts`:

```typescript
function makeTradeDecision(
  sentiment: number,
  price: number,
  usdBalance: number,
  btcBalance: number
): TradeDecision {
  // Modify thresholds and logic here
  if (sentiment > 75) {  // Changed from 70
    // Your custom logic
  }
}
```

### Modify Cron Schedule

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

### Add Custom Metrics

Extend the Perplexity prompt in `src/lib/perplexity.ts` to analyze additional data (volume, volatility, on-chain metrics, etc.).

---

## 📚 API Reference

### GET /api/cron/trade

Executes the trading algorithm. Called automatically by Vercel Cron every 4 hours.

**Headers**:
```
Authorization: Bearer {CRON_SECRET}
```

**Response** (200 OK):
```json
{
  "success": true,
  "timestamp": "2026-02-15T22:50:00.000Z",
  "analysis": {
    "price": 45230.50,
    "sentiment": 75,
    "reasoning": "Market analysis from Perplexity"
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

**Response** (401 Unauthorized):
```json
{
  "error": "Unauthorized"
}
```

**Response** (500 Error):
```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2026-02-15T22:50:00.000Z"
}
```

---

## 🐛 Troubleshooting

### Cron Not Running

1. Check Vercel Functions logs
2. Verify `vercel.json` is in root directory
3. Ensure environment variables are set
4. Manually trigger: `curl -H "Authorization: Bearer SECRET" https://your-project.vercel.app/api/cron/trade`

### Redis Connection Issues

1. Verify `UPSTASH_REDIS_REST_URL` and token
2. Check Upstash console for database status
3. Test: `curl https://YOUR_UPSTASH_URL/ping`

### Perplexity API Errors

1. Verify API key is active
2. Check rate limits in Perplexity dashboard
3. Ensure account has available credits

### Telegram Messages Not Sending

1. Verify bot token: `curl https://api.telegram.org/bot{TOKEN}/getMe`
2. Confirm chat ID: `curl https://api.telegram.org/bot{TOKEN}/getUpdates`
3. Check bot permissions

---

## 📖 Detailed Documentation

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for:
- Step-by-step deployment instructions
- Detailed setup for each service
- Monitoring and debugging guide
- Customization options
- Cost estimation

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is provided as-is for educational and personal use.

---

## 🔗 Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [Upstash Documentation](https://upstash.com/docs)
- [Perplexity API](https://docs.perplexity.ai)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

## 📞 Support

For issues and questions:

1. Check [DEPLOYMENT.md](./DEPLOYMENT.md) troubleshooting section
2. Review Vercel Functions logs
3. Check Upstash console for database status
4. Verify all environment variables are set correctly

---

**Version**: 1.0.0  
**Last Updated**: February 15, 2026  
**Status**: Production-Ready
