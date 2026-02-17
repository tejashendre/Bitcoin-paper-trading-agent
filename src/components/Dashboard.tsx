"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCcw, Play, RotateCcw, TrendingUp, DollarSign, Bitcoin, Activity } from "lucide-react";

interface Portfolio {
    usd: number;
    btc: number;
    lastUpdated: string;
}

interface Trade {
    id: string;
    timestamp: string;
    action: string;
    amount: number;
    price: number;
    reason: string;
}

interface LogEntry {
    id: string;
    timestamp: string;
    level: string;
    message: string;
}

interface DashboardData {
    portfolio: Portfolio;
    trades: Trade[];
    logs: LogEntry[];
    btcPrice: number;
    totalValue: number;
}

export default function Dashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const res = await fetch("/api/user/status");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setData(json);
            setError(null);
        } catch (e) {
            console.error("Fetch failed:", e);
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleRunNow = async () => {
        setRunning(true);
        try {
            // Use ?manual=true to bypass CRON_SECRET auth
            const res = await fetch("/api/cron/trade?manual=true");
            const json = await res.json();
            if (!json.success) {
                alert("Bot returned error: " + (json.error || "Unknown"));
            }
            // Wait a moment for logs to propagate, then refresh
            setTimeout(fetchData, 2000);
        } catch (e) {
            alert("Failed to run bot: " + String(e));
        } finally {
            setRunning(false);
        }
    };

    const handleReset = async () => {
        if (!confirm("Are you sure? This will reset your portfolio to $10,000 USD and erase trade history.")) return;
        try {
            const res = await fetch("/api/user/reset", { method: "POST" });
            if (!res.ok) throw new Error("Reset failed");
            await fetchData();
        } catch (e) {
            alert("Reset failed: " + String(e));
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <Activity className="w-10 h-10 text-orange-500 animate-spin mx-auto mb-4" />
                    <p className="text-neutral-400">Loading Dashboard...</p>
                </div>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <p className="text-red-400 mb-4">Failed to load dashboard</p>
                    <p className="text-neutral-500 text-sm">{error}</p>
                    <button onClick={fetchData} className="mt-4 px-4 py-2 bg-neutral-800 rounded-lg hover:bg-neutral-700">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const roi = ((data.totalValue - 10000) / 10000 * 100);
    const roiColor = roi >= 0 ? "text-green-400" : "text-red-400";

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-8">
            {/* Header */}
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-500 via-amber-400 to-yellow-500 bg-clip-text text-transparent">
                        ₿ Bitcoin Paper Trader
                    </h1>
                    <p className="text-neutral-500 text-sm mt-1">Autonomous AI Trading Bot (Paper Mode)</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleRunNow}
                        disabled={running}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Play size={16} /> {running ? "Running..." : "Run Bot Now"}
                    </button>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-red-700 text-neutral-300 hover:text-white rounded-lg font-medium transition-all border border-neutral-700"
                    >
                        <RotateCcw size={16} /> Reset
                    </button>
                </div>
            </header>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card
                    title="Total Value"
                    value={`$${data.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    subtitle={<span className={roiColor}>{roi >= 0 ? "+" : ""}{roi.toFixed(2)}% ROI</span>}
                    icon={<DollarSign className="text-green-400" />}
                />
                <Card
                    title="Cash (USD)"
                    value={`$${data.portfolio.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                    icon={<DollarSign className="text-blue-400" />}
                />
                <Card
                    title="Bitcoin (BTC)"
                    value={`${data.portfolio.btc.toFixed(6)}`}
                    subtitle={data.btcPrice ? <span className="text-neutral-500">@ ${data.btcPrice.toLocaleString("en-US")}</span> : null}
                    icon={<Bitcoin className="text-orange-400" />}
                />
                <Card
                    title="Last Update"
                    value={new Date(data.portfolio.lastUpdated).toLocaleTimeString()}
                    subtitle={<span className="text-neutral-500">{new Date(data.portfolio.lastUpdated).toLocaleDateString()}</span>}
                    icon={<RefreshCcw className="text-purple-400" />}
                />
            </div>

            {/* Trades & Logs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Trade History */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                        <span className="font-semibold text-lg flex items-center gap-2">
                            <TrendingUp size={18} className="text-orange-400" /> Trade History
                        </span>
                        <span className="text-sm text-neutral-500">{data.trades.length} trades</span>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                        {data.trades.length === 0 ? (
                            <div className="p-8 text-center text-neutral-500">
                                <p>No trades yet</p>
                                <p className="text-sm mt-1">Click &quot;Run Bot Now&quot; to start</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-neutral-400 uppercase bg-neutral-950 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-3">Action</th>
                                        <th className="px-4 py-3">BTC Amount</th>
                                        <th className="px-4 py-3">Price</th>
                                        <th className="px-4 py-3">Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.trades.map((trade, idx) => (
                                        <tr key={trade.id || idx} className="border-b border-neutral-800 hover:bg-neutral-800/50 transition">
                                            <td className={`px-4 py-3 font-bold ${trade.action === "BUY" ? "text-green-500" : "text-red-500"}`}>
                                                {trade.action === "BUY" ? "🟢" : "🔴"} {trade.action}
                                            </td>
                                            <td className="px-4 py-3 font-mono">{Number(trade.amount).toFixed(6)}</td>
                                            <td className="px-4 py-3">${Number(trade.price).toLocaleString("en-US")}</td>
                                            <td className="px-4 py-3 text-neutral-400 text-xs">{new Date(trade.timestamp).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* System Logs */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                        <span className="font-semibold text-lg flex items-center gap-2">
                            <Activity size={18} className="text-blue-400" /> System Logs
                        </span>
                        <span className="text-sm text-neutral-500">{data.logs.length} entries</span>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto p-3 space-y-1 font-mono text-xs">
                        {data.logs.length === 0 ? (
                            <div className="p-8 text-center text-neutral-500">No logs yet</div>
                        ) : (
                            data.logs.map((log, idx) => (
                                <div key={log.id || idx} className="flex gap-2 leading-relaxed py-0.5">
                                    <span className="text-neutral-600 whitespace-nowrap">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                    <span
                                        className={
                                            log.level === "ERROR" ? "text-red-400" :
                                                log.level === "WARN" ? "text-yellow-400" :
                                                    log.level === "SUCCESS" ? "text-green-400" :
                                                        "text-blue-300"
                                        }
                                    >
                                        {log.message}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Card({
    title,
    value,
    subtitle,
    icon,
}: {
    title: string;
    value: string;
    subtitle?: React.ReactNode;
    icon: React.ReactNode;
}) {
    return (
        <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-xl flex items-center justify-between">
            <div>
                <p className="text-neutral-500 text-xs font-medium uppercase tracking-wider">{title}</p>
                <p className="text-xl font-bold mt-1">{value}</p>
                {subtitle && <p className="text-sm mt-0.5">{subtitle}</p>}
            </div>
            <div className="p-3 bg-neutral-800 rounded-lg">{icon}</div>
        </div>
    );
}
