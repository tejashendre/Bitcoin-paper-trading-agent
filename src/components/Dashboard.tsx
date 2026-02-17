"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { RefreshCcw, Play, RotateCcw, TrendingUp, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardData {
    portfolio: { usd: number; btc: number; lastUpdated: string };
    trades: any[];
    logs: any[];
}

export default function Dashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);

    const fetchData = async () => {
        try {
            const res = await axios.get("/api/user/status");
            setData(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, []);

    const handleRunNow = async () => {
        setRunning(true);
        try {
            await axios.get("/api/cron/trade", {
                headers: { Authorization: "Bearer " + process.env.NEXT_PUBLIC_CRON_SECRET } // Ideally generic, but safe for manual trig
            });
            await fetchData(); // Refresh immediately
        } catch (e) {
            alert("Failed to run bot: " + String(e));
        } finally {
            setRunning(false);
        }
    };

    const handleReset = async () => {
        if (!confirm("Are you sure? This will reset your portfolio to $10,000.")) return;
        try {
            await axios.post("/api/user/reset");
            await fetchData();
        } catch (e) {
            alert("Reset failed");
        }
    };

    if (loading) return <div className="p-8 text-center">Loading Dashboard...</div>;
    if (!data) return <div className="p-8 text-center text-red-500">Failed to load data</div>;

    const totalValue = data.portfolio.usd + (data.portfolio.btc * 65000); // Approx value if price fetch fails, normally we'd fetch live price here too

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-8">
            <header className="flex justify-between items-center">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-500 to-yellow-500 bg-clip-text text-transparent">
                    Bitcoin Paper Trader
                </h1>
                <div className="flex gap-4">
                    <button
                        onClick={handleRunNow}
                        disabled={running}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition disabled:opacity-50"
                    >
                        <Play size={18} /> {running ? "Running..." : "Run Bot Now"}
                    </button>
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition"
                    >
                        <RotateCcw size={18} /> Reset Portfolio
                    </button>
                </div>
            </header>

            {/* Portfolio Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card title="Cash Balance" value={`$${data.portfolio.usd.toLocaleString()}`} icon={<DollarSign className="text-green-400" />} />
                <Card title="Bitcoin Holdings" value={`${data.portfolio.btc.toFixed(6)} BTC`} icon={<TrendingUp className="text-orange-400" />} />
                <Card title="Last Updated" value={new Date(data.portfolio.lastUpdated).toLocaleTimeString()} icon={<RefreshCcw className="text-blue-400" />} />
            </div>

            {/* Logs & Trades Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Trade History */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 font-semibold text-lg">Trade History</div>
                    <div className="max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-neutral-400 uppercase bg-neutral-950">
                                <tr>
                                    <th className="px-4 py-3">Action</th>
                                    <th className="px-4 py-3">Amount</th>
                                    <th className="px-4 py-3">Price</th>
                                    <th className="px-4 py-3">Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.trades.length === 0 ? (
                                    <tr><td colSpan={4} className="p-4 text-center text-neutral-500">No trades yet</td></tr>
                                ) : (
                                    data.trades.map((trade: any) => (
                                        <tr key={trade.id} className="border-b border-neutral-800 hover:bg-neutral-800/50">
                                            <td className={cn("px-4 py-3 font-bold", trade.action === "BUY" ? "text-green-500" : "text-red-500")}>
                                                {trade.action}
                                            </td>
                                            <td className="px-4 py-3">{trade.amount.toFixed(6)}</td>
                                            <td className="px-4 py-3">${trade.price.toLocaleString()}</td>
                                            <td className="px-4 py-3 text-neutral-400">{new Date(trade.timestamp).toLocaleTimeString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* System Logs */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-neutral-800 font-semibold text-lg">System Logs</div>
                    <div className="max-h-[400px] overflow-y-auto p-4 space-y-2 font-mono text-sm">
                        {data.logs.map((log: any) => (
                            <div key={log.id} className="flex gap-2">
                                <span className="text-neutral-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span className={cn(
                                    log.level === "ERROR" ? "text-red-400" :
                                        log.level === "WARN" ? "text-yellow-400" :
                                            log.level === "SUCCESS" ? "text-green-400" : "text-blue-300"
                                )}>
                                    {log.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}

function Card({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
    return (
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-xl flex items-center justify-between">
            <div>
                <p className="text-neutral-400 text-sm font-medium">{title}</p>
                <p className="text-2xl font-bold mt-1">{value}</p>
            </div>
            <div className="p-3 bg-neutral-800 rounded-lg">{icon}</div>
        </div>
    );
}
