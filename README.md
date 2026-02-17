# Bitcoin Paper Trading Agent

A Next.js application that autonomously paper trades Bitcoin based on sentiment analysis from Perplexity AI.

## Project Structure

- `src/app`: Next.js App Router pages and API routes.
- `src/lib`: Shared utilities (Redis, Telegram, Perplexity).
- `vercel.json`: Vercel Cron configuration.

## Deployment

This project is configured for Vercel. Ensure the following environment variables are set:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `PERPLEXITY_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `CRON_SECRET`

## Development

Run `npm run dev` to start the development server.
