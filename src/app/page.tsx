export default function HomePage() {
    return (
        <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
            <h1>📈 Paper Trading Agent</h1>
            <p>Autonomous Bitcoin paper trading bot.</p>
            <ul>
                <li><strong>Strategy:</strong> Sentiment-driven (Perplexity AI)</li>
                <li><strong>Data:</strong> Upstash Redis</li>
                <li><strong>Alerts:</strong> Telegram Bot</li>
                <li><strong>Schedule:</strong> Every 4 hours via Vercel Cron</li>
            </ul>
            <p style={{ marginTop: "1.5rem", color: "#888", fontSize: "0.85rem" }}>
                Cron endpoint: <code>/api/cron/trade</code>
            </p>
        </main>
    );
}
