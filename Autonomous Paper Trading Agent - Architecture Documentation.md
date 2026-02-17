# Autonomous Paper Trading Agent - Architecture Documentation

## System Design Overview

This document provides a comprehensive technical overview of the Autonomous Paper Trading Agent system, including design decisions, component interactions, and implementation details.

---

## 1. High-Level Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      VERCEL SERVERLESS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐                                          │
│  │  Vercel Cron     │  Triggers every 4 hours                  │
│  │  Scheduler       │  (0 */4 * * *)                           │
│  └────────┬─────────┘                                          │
│           │                                                     │
│           ▼                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  GET /api/cron/trade                                     │  │
│  │  ├─ Validate Authorization header                        │  │
│  │  ├─ Initialize portfolio if needed                       │  │
│  │  ├─ Fetch market sentiment (Perplexity)                 │  │
│  │  ├─ Retrieve portfolio state (Redis)                    │  │
│  │  ├─ Make trading decision                               │  │
│  │  ├─ Execute trade (update Redis)                        │  │
│  │  ├─ Log trade history                                   │  │
│  │  ├─ Send notification (Telegram)                        │  │
│  │  └─ Return JSON response                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────────┐   ┌──────────────┐   ┌──────────────┐
    │ Perplexity  │   │ Upstash      │   │  Telegram    │
    │ API         │   │  Redis       │   │  Bot API     │
    │ (sonar)     │   │  (HTTP REST) │   │              │
    └─────────────┘   └──────────────┘   └──────────────┘
```

---

## 2. Component Architecture

### 2.1 Cron Scheduler (Vercel)

**File**: `vercel.json`

**Responsibility**: Trigger the trading algorithm at regular intervals

**Configuration**:
```json
{
  "crons": [
    {
      "path": "/api/cron/trade",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

**Cron Expression Format**: `minute hour day month day-of-week`

**Behavior**:
- Runs every 4 hours (0:00, 4:00, 8:00, 12:00, 16:00, 20:00 UTC)
- Automatically adds `Authorization` header with Vercel's internal token
- Retries on failure (up to 3 times)
- Logs execution results to Vercel Functions

---

### 2.2 Trading Engine (Next.js API Route)

**File**: `src/app/api/cron/trade/route.ts`

**Responsibility**: Orchestrate the entire trading workflow

**Key Features**:
- **Authorization**: Validates Bearer token against `CRON_SECRET`
- **Timeout**: Set to 60 seconds (Vercel max is 10s for free tier, extended for reliability)
- **Dynamic Execution**: Forces dynamic rendering to prevent caching
- **Error Handling**: Comprehensive try-catch with detailed logging

**Request/Response**:

```typescript
// Request
GET /api/cron/trade
Headers: {
  Authorization: "Bearer {CRON_SECRET}"
}

// Response (Success)
{
  success: true,
  timestamp: "2026-02-15T22:50:00.000Z",
  analysis: {
    price: 45230.50,
    sentiment: 75,
    reasoning: "Market analysis..."
  },
  decision: {
    action: "BUY",
    reason: "Bullish sentiment..."
  },
  portfolio: {
    usd: 7500.00,
    btc: 0.11
  }
}

// Response (Error)
{
  success: false,
  error: "Error message",
  timestamp: "2026-02-15T22:50:00.000Z"
}
```

---

### 2.3 Market Analysis Module

**File**: `src/lib/perplexity.ts`

**Responsibility**: Fetch Bitcoin sentiment and price from Perplexity API

**Key Features**:
- **Model**: Sonar (fast, cost-effective)
- **Prompt Engineering**: Requests structured JSON output
- **Markdown Stripping**: Handles LLM responses wrapped in markdown code blocks
- **Error Handling**: Validates response structure and clamps sentiment to 0-100

**API Call**:

```typescript
POST https://api.perplexity.ai/chat/completions
{
  model: "sonar",
  messages: [
    {
      role: "user",
      content: "Analyze Bitcoin price and sentiment..."
    }
  ],
  temperature: 0.2,
  max_tokens: 500
}
```

**Response Parsing**:

```typescript
interface MarketAnalysis {
  price: number;
  sentiment_score: number;  // 0-100
  reasoning: string;
}
```

**Edge Case Handling**:

```typescript
// LLM might return:
// ```json
// { "price": 45000, ... }
// ```

// Regex strips markdown:
const content = stripMarkdownCodeBlocks(response);
// Result: { "price": 45000, ... }

const analysis = JSON.parse(content);
```

---

### 2.4 Portfolio State Management

**File**: `src/lib/redis.ts`

**Responsibility**: Persist and manage portfolio data in Upstash Redis

**Redis Keys**:

| Key | Type | Purpose |
|-----|------|---------|
| `portfolio:usd` | String | Current USD balance |
| `portfolio:btc` | String | Current BTC balance |
| `trade:history` | List | Historical trade records |

**Functions**:

```typescript
// Initialize portfolio with $10,000 USD, 0 BTC
initializePortfolioIfNeeded(): Promise<void>

// Get current balances
getPortfolio(): Promise<{ usd: number; btc: number }>

// Update balances
updatePortfolio(usd: number, btc: number): Promise<void>

// Log trade for audit trail
logTrade(
  action: "BUY" | "SELL",
  btcAmount: number,
  price: number,
  sentiment: number,
  newUsdBalance: number,
  newBtcBalance: number
): Promise<void>
```

**Initialization Logic**:

```typescript
// On first run:
if (await redis.get("portfolio:usd") === null) {
  await redis.set("portfolio:usd", 10000);
}
if (await redis.get("portfolio:btc") === null) {
  await redis.set("portfolio:btc", 0);
}
```

**Trade History**:

```typescript
// Each trade is stored as JSON in a Redis list
trade:history = [
  {
    timestamp: "2026-02-15T22:50:00.000Z",
    action: "BUY",
    btcAmount: 0.111,
    price: 45000,
    sentiment: 75,
    newUsdBalance: 7500,
    newBtcBalance: 0.111
  },
  // ... more trades
]

// Keeps only last 100 trades (LTRIM trade:history 0 99)
```

---

### 2.5 Notification System

**File**: `src/lib/telegram.ts`

**Responsibility**: Send trade execution alerts via Telegram

**API Call**:

```typescript
POST https://api.telegram.org/bot{BOT_TOKEN}/sendMessage
{
  chat_id: "{CHAT_ID}",
  text: "🚨 *TRADE EXECUTED*\n\nStrategy: BUY\nPrice: $45000\n...",
  parse_mode: "Markdown"
}
```

**Message Format**:

```
🚨 *TRADE EXECUTED*

Strategy: *BUY*
Price: $45,000.00
Sentiment: 75/100
BTC Amount: 0.111111
New USD Balance: $7,500.00
New BTC Balance: 0.111111
```

**Error Handling**:
- Logs errors but doesn't crash the cron job
- Continues execution even if Telegram is unavailable
- Gracefully handles missing credentials

---

## 3. Trading Algorithm

### 3.1 Decision Logic

```typescript
function makeTradeDecision(
  sentiment: number,        // 0-100
  price: number,           // USD
  usdBalance: number,      // Current USD
  btcBalance: number       // Current BTC
): TradeDecision {
  
  // BUY Signal
  if (sentiment > 70 && usdBalance > 100) {
    const amountToInvest = usdBalance * 0.5;  // 50% of cash
    const btcToBuy = amountToInvest / price;
    return { action: "BUY", btcAmount: btcToBuy, ... };
  }
  
  // SELL Signal
  if (sentiment < 30 && btcBalance > 0.001) {
    const usdFromSale = btcBalance * price;
    return { action: "SELL", btcAmount: btcBalance, ... };
  }
  
  // HOLD
  return { action: "HOLD", btcAmount: 0, ... };
}
```

### 3.2 Risk Management

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Initial Portfolio | $10,000 USD | Reasonable starting capital |
| Buy Threshold | Sentiment > 70 | Strong bullish signal |
| Sell Threshold | Sentiment < 30 | Strong bearish signal |
| Buy Amount | 50% of USD | Balanced risk exposure |
| Sell Amount | 100% of BTC | Exit completely on bearish signal |
| Minimum USD | $100 | Prevents dust trades |
| Minimum BTC | 0.001 | Prevents micro-transactions |

### 3.3 Example Trade Sequence

**Scenario 1: Initial BUY**

```
Time: 0:00 UTC
Sentiment: 75/100 (Bullish)
BTC Price: $45,000
Portfolio: $10,000 USD, 0 BTC

Decision: BUY
Amount to invest: $10,000 × 0.5 = $5,000
BTC purchased: $5,000 ÷ $45,000 = 0.1111 BTC

New Portfolio: $5,000 USD, 0.1111 BTC
Notification: ✅ Sent to Telegram
```

**Scenario 2: HOLD**

```
Time: 4:00 UTC
Sentiment: 50/100 (Neutral)
BTC Price: $46,000
Portfolio: $5,000 USD, 0.1111 BTC

Decision: HOLD
Reason: Neutral sentiment (30-70 range)

Portfolio: $5,000 USD, 0.1111 BTC (unchanged)
Notification: ❌ Not sent
```

**Scenario 3: SELL**

```
Time: 8:00 UTC
Sentiment: 25/100 (Bearish)
BTC Price: $44,000
Portfolio: $5,000 USD, 0.1111 BTC

Decision: SELL
Amount to liquidate: 0.1111 BTC × $44,000 = $4,888.40

New Portfolio: $9,888.40 USD, 0 BTC
Notification: ✅ Sent to Telegram
```

---

## 4. Data Flow & State Management

### 4.1 Complete Execution Flow

```
1. Vercel Cron triggers at scheduled time
   └─ Sends GET /api/cron/trade with Authorization header

2. API Route Handler
   ├─ Validate Authorization (Bearer token)
   ├─ Initialize portfolio if needed (Redis)
   └─ Proceed to trading logic

3. Market Analysis
   ├─ Call Perplexity API
   ├─ Parse JSON response
   ├─ Clamp sentiment to 0-100
   └─ Return { price, sentiment, reasoning }

4. Portfolio Retrieval
   ├─ Get portfolio:usd from Redis
   ├─ Get portfolio:btc from Redis
   └─ Return { usd, btc }

5. Trading Decision
   ├─ Analyze sentiment vs thresholds
   ├─ Check balance conditions
   ├─ Determine action (BUY/SELL/HOLD)
   └─ Calculate amounts

6. Trade Execution
   ├─ Update portfolio:usd in Redis
   ├─ Update portfolio:btc in Redis
   ├─ Log trade to trade:history
   └─ Return new balances

7. Notification
   ├─ Format trade message
   ├─ Send to Telegram Bot API
   └─ Log result (don't crash on error)

8. Response
   └─ Return JSON with results
```

### 4.2 State Transitions

```
Initial State:
  portfolio:usd = 10000
  portfolio:btc = 0

After BUY (50% of $10,000 at $45,000):
  portfolio:usd = 5000
  portfolio:btc = 0.1111

After SELL (100% of BTC at $44,000):
  portfolio:usd = 9888.40
  portfolio:btc = 0

After BUY (50% of $9,888.40 at $46,000):
  portfolio:usd = 4944.20
  portfolio:btc = 0.1074
```

---

## 5. Security Architecture

### 5.1 Authentication

**Mechanism**: Bearer Token (CRON_SECRET)

```typescript
// Validation
const authHeader = request.headers.get("Authorization");
const token = authHeader.replace("Bearer ", "");
const isValid = token === process.env.CRON_SECRET;

if (!isValid) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**Security Properties**:
- ✅ Only Vercel can trigger the endpoint (internal cron)
- ✅ External requests are rejected without valid token
- ✅ Token is stored securely in Vercel Environment Variables
- ✅ Token should be rotated every 30-90 days

### 5.2 API Key Management

| Service | Key Storage | Access Control |
|---------|-------------|-----------------|
| Perplexity | Vercel Env Var | Backend only (server-side) |
| Upstash | Vercel Env Var | Backend only (server-side) |
| Telegram | Vercel Env Var | Backend only (server-side) |
| CRON_SECRET | Vercel Env Var | Vercel Cron + Bearer token |

**Best Practices**:
- ✅ Never commit `.env.local` to Git
- ✅ Use Vercel Environment Variables for production
- ✅ Rotate secrets every 30-90 days
- ✅ Use separate API keys for each service
- ✅ Monitor API usage for suspicious activity

### 5.3 Error Handling & Logging

```typescript
try {
  // Trading logic
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("[TRADE-CRON] Error:", errorMessage);
  
  // Return error response (don't crash)
  return NextResponse.json(
    { success: false, error: errorMessage, timestamp: new Date().toISOString() },
    { status: 500 }
  );
}
```

**Logging Strategy**:
- ✅ Log all major steps with timestamps
- ✅ Log errors with full context
- ✅ Log trade decisions and amounts
- ✅ Don't log sensitive data (API keys, tokens)

---

## 6. Deployment Architecture

### 6.1 Vercel Deployment

**Runtime**: Node.js 18+ (serverless)

**File Structure** (on Vercel):
```
/api/cron/trade/route.ts    → GET /api/cron/trade
/lib/redis.ts               → Imported by route
/lib/perplexity.ts          → Imported by route
/lib/telegram.ts            → Imported by route
```

**Environment Variables** (Vercel Dashboard):
```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
PERPLEXITY_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
CRON_SECRET
```

**Cold Start Optimization**:
- ✅ Minimal dependencies (only @upstash/redis)
- ✅ No database connections (HTTP-based Redis)
- ✅ No heavy libraries
- ✅ ~500ms cold start time

### 6.2 External Services

| Service | Type | Endpoint | Auth |
|---------|------|----------|------|
| Upstash Redis | HTTP REST | `https://*.upstash.io` | Token |
| Perplexity API | HTTPS | `https://api.perplexity.ai` | Bearer |
| Telegram Bot | HTTPS | `https://api.telegram.org` | Token in URL |

---

## 7. Performance Characteristics

### 7.1 Execution Time

| Component | Time | Notes |
|-----------|------|-------|
| Authorization | ~1ms | Local validation |
| Portfolio Init | ~50ms | Redis call |
| Market Analysis | ~2000ms | Perplexity API call |
| Portfolio Retrieval | ~50ms | Redis call |
| Trading Decision | ~1ms | Local logic |
| Trade Execution | ~100ms | Redis updates + logging |
| Notification | ~500ms | Telegram API call |
| **Total** | **~2700ms** | ~2.7 seconds |

**Timeout**: Set to 60 seconds (safe margin)

### 7.2 Resource Usage

| Resource | Limit | Usage |
|----------|-------|-------|
| Memory | 512 MB | ~50 MB |
| CPU | Shared | ~100ms |
| Network | Unlimited | ~5 API calls |
| Execution Time | 60s | ~2.7s |

---

## 8. Scalability & Reliability

### 8.1 Horizontal Scalability

**Current Design**:
- ✅ Stateless API route (can run on multiple instances)
- ✅ Shared Redis state (single source of truth)
- ✅ No local caching (always fresh data)

**Scaling Considerations**:
- Redis can handle 1000s of requests/second
- Perplexity API rate limits: 5 requests/minute (sufficient for 6 runs/day)
- Telegram API: No strict rate limits
- Vercel: Unlimited concurrent executions

### 8.2 Reliability & Fault Tolerance

**Failure Scenarios**:

| Scenario | Handling |
|----------|----------|
| Perplexity API down | Return 500 error, don't execute trade |
| Redis connection failed | Return 500 error, don't execute trade |
| Telegram API down | Log error, continue execution (non-critical) |
| Invalid sentiment response | Clamp to 0-100, continue |
| Insufficient balance | HOLD decision, no trade executed |

**Retry Strategy**:
- Vercel Cron retries up to 3 times on failure
- Telegram errors don't crash the cron job
- All errors are logged and returned in response

---

## 9. Cost Optimization

### 9.1 API Usage

| Service | Calls/Day | Cost/Month |
|---------|-----------|-----------|
| Perplexity | 6 | ~$0.50-1.00 |
| Upstash | ~30 | $0 (free tier) |
| Telegram | 6 | $0 (free) |
| Vercel | 6 | $0 (free tier) |

**Total**: ~$0.50-1.00/month

### 9.2 Optimization Techniques

- ✅ Use Perplexity sonar (cheaper than other models)
- ✅ HTTP-based Redis (no connection overhead)
- ✅ Minimal payload sizes
- ✅ Batch Redis operations where possible
- ✅ Cache sentiment for 4 hours (not implemented, but possible)

---

## 10. Future Enhancements

### 10.1 Potential Improvements

1. **Multi-Asset Trading**: Add ETH, SOL, etc.
2. **Advanced Sentiment**: Incorporate on-chain metrics, volume, volatility
3. **Portfolio Diversification**: Allocate across multiple assets
4. **Risk Management**: Stop-loss, take-profit orders
5. **Backtesting**: Historical simulation of strategy
6. **Dashboard**: Web UI for monitoring portfolio
7. **Webhooks**: Real-time notifications instead of polling
8. **Machine Learning**: Train models on historical data

### 10.2 Architecture Changes

```
Current: Sentiment → Decision → Trade
Future:  Sentiment + ML Model → Decision → Trade

Current: 4-hour intervals
Future:  Adaptive intervals based on volatility

Current: Single Redis instance
Future:  Redis cluster for high availability
```

---

## 11. Monitoring & Observability

### 11.1 Key Metrics

```typescript
// Track these metrics
- Cron execution count
- Successful trades
- Failed trades
- Average sentiment
- Portfolio value
- Sharpe ratio
- Win rate
```

### 11.2 Logging Strategy

```typescript
// Log levels
[TRADE-CRON] Starting cycle...
[TRADE-CRON] Market Analysis: Price=$45000, Sentiment=75
[TRADE-CRON] Decision: BUY
[TRADE-CRON] Executing BUY: 0.111 BTC
[TRADE-CRON] Cycle completed successfully
```

---

## Conclusion

The Autonomous Paper Trading Agent is designed with **simplicity, reliability, and cost-effectiveness** in mind. The architecture leverages serverless infrastructure to eliminate operational overhead while maintaining a clean, modular codebase that's easy to understand and extend.

**Key Design Principles**:
1. ✅ Stateless API routes
2. ✅ Shared Redis state
3. ✅ Comprehensive error handling
4. ✅ Security-first authentication
5. ✅ Minimal dependencies
6. ✅ Cost-optimized services

---

**Version**: 1.0.0  
**Last Updated**: February 15, 2026
