import { redis } from "./redis";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS";

export interface LogEntry {
    id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    details?: any;
}

export class Logger {
    private static readonly LOG_KEY = "system:logs";
    private static readonly MAX_LOGS = 100;

    static async log(level: LogLevel, message: string, details?: any) {
        const entry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            message,
            details,
        };

        // 1. Console Log (for Vercel logs)
        const consoleMethod = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
        consoleMethod(`[${level}] ${message}`, details || "");

        // 2. Redis Log (for Dashboard)
        try {
            await redis.lpush(this.LOG_KEY, JSON.stringify(entry));
            await redis.ltrim(this.LOG_KEY, 0, this.MAX_LOGS - 1); // Keep only last 100 logs
        } catch (error) {
            console.error("Failed to write log to Redis:", error);
        }
    }

    static async info(message: string, details?: any) {
        await this.log("INFO", message, details);
    }

    static async warn(message: string, details?: any) {
        await this.log("WARN", message, details);
    }

    static async error(message: string, details?: any) {
        await this.log("ERROR", message, details);
    }

    static async success(message: string, details?: any) {
        await this.log("SUCCESS", message, details);
    }

    static async getLogs(): Promise<LogEntry[]> {
        try {
            const logs = await redis.lrange(this.LOG_KEY, 0, -1);
            return logs.map((log) => JSON.parse(log));
        } catch (error) {
            console.error("Failed to fetch logs:", error);
            return [];
        }
    }
}
