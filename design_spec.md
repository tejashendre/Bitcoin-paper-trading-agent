# Bitcoin Paper Trading Agent - User Journey & Architecture

This document explains how the bot works from a user's perspective, focusing on "What does it do for me?" and "How do I interact with it?".

## The Core Concept

The bot is an **autonomous financial assistant** that trades Bitcoin on your behalf using **fake money (paper trading)**. It reads the news using AI, decides if the market is good or bad, and executes trades automatically.

## User Journey: How it Works Step-by-Step

### 1. Setup (One-Time)

You configure the bot with API keys for:

- **Perplexity AI** (The Brain: Reads news and sentiment).
- **Telegram** (The Messenger: Sends you alerts).
- **Upstash Redis** (The Ledger: Stores your fake money and transaction history).

### 2. The Trigger (Every 4 Hours)

Every 4 hours (e.g., 12:00, 4:00, 8:00), the bot wakes up automatically. You don't need to do anything.

### 3. The Analysis ("The Brain")

The bot asks Perplexity AI:
> *"What is the current market sentiment for Bitcoin? Are news sources bullish (positive) or bearish (negative)?"*

Perplexity reads real-time news articles, crypto twitter, and financial reports. It returns a **Sentiment Score** (1-10) and a reasoning summary.

### 4. The Decision Logic

Based on the sentiment, the bot makes a decision:

- **Strong Buy (Score > 8)**: "Everyone is buying, market is hot. I should buy."
- **Buy (Score > 6)**: "Market looks good."
- **Hold (Score 4-6)**: "Uncertain. Best to do nothing."
- **Sell (Score < 4)**: "Market looks bad. I should sell to protect profits."
- **Strong Sell (Score < 2)**: "Crash imminent. Sell everything."

### 5. The Trade Execution ("The Wallet")

The bot checks your **Redis Database** (your virtual wallet).

- **Buying**: If the decision is BUY and you have fake USD (e.g., $10,000), it calculates how much BTC it can afford at the current real-world price. It updates your wallet: `-$10,000 USD`,`+0.15 BTC`.
- **Selling**: If the decision is SELL and you have BTC, it sells it at the current real-world price. It updates your wallet: `-0.15 BTC`, `+$11,000 USD`.

### 6. The Notification ("The Alert")

Your phone buzzes. You receive a **Telegram Message**:
> 🟢 **BUY ALERT**
> **Price**: $65,432
> **Amount**: 0.15 BTC
> **Reason**: "Major ETFs approved, market sentiment extremely bullish."
> **Portfolio Value**: $10,500 (+5%)

### 7. The Dashboard (Monitoring)

At any time, you can visit your personal website (deployed on Vercel). It shows:

- **Current Portfolio Value**: Total worth in USD.
- **Asset Allocation**: How much is in Cash vs. Bitcoin.
- **Trade History**: User-friendly list of past trades and their profit/loss.
- **Bot Status**: "Next trade run in 2 hours."

## Architecture Diagram (Simplified)

```mermaid
graph TD
    User((User)) -->|Configures| Vercel[Vercel Server]
    Cron[Cron Job (Every 4h)] -->|Wakes up| TradeBot[Trading Bot Logic]
    
    TradeBot -->|1. Get News| Perplexity[Perplexity AI]
    Perplexity -->|2. Sentiment: Bullish| TradeBot
    
    TradeBot -->|3. Get Price| Coingecko[Crypto Price API]
    
    TradeBot -->|4. Read Wallet| Redis[(Redis Database)]
    Redis -->|Wallet: $5k USD, 0 BTC| TradeBot
    
    TradeBot -->|5. Execute BUY| Redis
    Redis -->|Update: $0 USD, 0.08 BTC| Redis
    
    TradeBot -->|6. Send Alert| Telegram[Telegram App]
    Telegram -->|Notification| User
    
    User -->|View Dashboard| WebApp[Next.js Website]
    WebApp -->|Read Stats| Redis
```
