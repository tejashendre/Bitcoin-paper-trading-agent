# Exact Steps: Local → Vercel

## 1. Get your secrets ready (before deploy)

- **Upstash Redis:** [console.upstash.com](https://console.upstash.com) → Create Database (Redis) → copy **REST URL** and **REST Token**.
- **Perplexity:** [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) → create API key.
- **Telegram:** Message [@BotFather](https://t.me/botfather) → `/newbot` → copy **Bot Token**. Send one message to your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy your **chat_id**.
- **Cron secret:** Run `openssl rand -base64 32` (or any password generator) and save it.

## 2. Put the project under Git (if not already)

In the project folder:

```bash
git init
git add .
git commit -m "Paper trading agent ready for Vercel"
```

## 3. Push to GitHub

- Create a **new empty repo** on [github.com](https://github.com) (e.g. `paper-trading-agent`).
- Then run (replace `YOUR_USERNAME` and repo name if different):

```bash
git remote add origin https://github.com/YOUR_USERNAME/paper-trading-agent.git
git branch -M main
git push -u origin main
```

## 4. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (GitHub is easiest).
2. Click **Add New…** → **Project**.
3. **Import** the repo you just pushed (e.g. `paper-trading-agent`).
4. Leave **Framework Preset** as **Next.js** and **Root Directory** empty.
5. Do **not** deploy yet — click **Environment Variables** first.

## 5. Add environment variables in Vercel

In the same “new project” screen (or later: Project → **Settings** → **Environment Variables**), add these for **Production** (and optionally Preview/Development):

| Name | Value |
|------|--------|
| `UPSTASH_REDIS_REST_URL` | Your Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash REST Token |
| `PERPLEXITY_API_KEY` | Your Perplexity API key |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `CRON_SECRET` | The secret you generated in step 1 |

Save each one, then click **Deploy**.

## 6. Wait for the build

Wait until the deployment finishes. Note your project URL (e.g. `https://paper-trading-agent-xxx.vercel.app`).

## 7. Confirm the cron endpoint

Call the cron route with your secret (replace the URL and `YOUR_CRON_SECRET`):

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_PROJECT_URL.vercel.app/api/cron/trade
```

You should get JSON with `"success": true` and `"action": "BUY"`, `"SELL"`, or `"HOLD"`. The cron will also run automatically every 4 hours (schedule in `vercel.json`).

---

**Optional – deploy from your machine (no GitHub):**

1. Install Vercel CLI: `npm i -g vercel`
2. In the project folder: `vercel`
3. Log in and follow prompts; when asked, add the same environment variables in the Vercel dashboard for that project.
