/**
 * Structured logger with error ring buffer.
 *
 * Inspired by Claude Code's log.ts:
 * - Error ring buffer keeps the last N errors in memory for diagnostics
 * - Formatted output with timestamps, levels, and tags
 * - Level-based filtering via LOG_LEVEL env var
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const envLevel = process.env.LOG_LEVEL as LogLevel;
const minLevel: LogLevel = VALID_LEVELS.includes(envLevel) ? envLevel : "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function formatMessage(
  level: LogLevel,
  tag: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] [${tag}] ${message}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

// Error ring buffer — keeps last 100 errors for diagnostics
// (Claude Code pattern: in-memory error log for bug reports)
interface ErrorEntry {
  timestamp: string;
  tag: string;
  message: string;
  error?: string;
  stack?: string;
}

const ERROR_RING_BUFFER_SIZE = 100;
const errorRingBuffer: ErrorEntry[] = [];

function pushError(entry: ErrorEntry): void {
  errorRingBuffer.push(entry);
  if (errorRingBuffer.length > ERROR_RING_BUFFER_SIZE) {
    errorRingBuffer.shift();
  }
}

export const logger = {
  debug(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("debug")) console.debug(formatMessage("debug", tag, message, data));
  },
  info(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("info")) console.log(formatMessage("info", tag, message, data));
  },
  warn(tag: string, message: string, data?: Record<string, unknown>): void {
    if (shouldLog("warn")) console.warn(formatMessage("warn", tag, message, data));
  },
  error(tag: string, message: string, error?: Error | unknown): void {
    const entry: ErrorEntry = { timestamp: new Date().toISOString(), tag, message };
    if (error instanceof Error) {
      entry.error = error.message;
      entry.stack = error.stack;
    } else if (error) {
      entry.error = String(error);
    }
    pushError(entry);

    if (shouldLog("error")) {
      const errData =
        error instanceof Error
          ? { error: error.message, stack: error.stack }
          : error
            ? { error: String(error) }
            : undefined;
      console.error(formatMessage("error", tag, message, errData));
    }
  },

  /** Get recent errors from the ring buffer (for diagnostics endpoints) */
  getRecentErrors(limit = 20): ErrorEntry[] {
    return errorRingBuffer.slice(-limit);
  },
};
