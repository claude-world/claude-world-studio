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
};
