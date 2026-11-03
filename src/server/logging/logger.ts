import crypto from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  module?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "pin",
  "token",
  "secret",
  "nik",
  "creditcard",
  "authorization",
  "signature",
]);

function maskSensitiveData(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveData);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "********";
    } else if (typeof value === "object" && value !== null) {
      result[key] = maskSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class StructuredLogger {
  constructor(private defaultContext: LogContext = {}) {}

  withContext(context: LogContext): StructuredLogger {
    return new StructuredLogger({ ...this.defaultContext, ...context });
  }

  static generateCorrelationId(): string {
    return `corr-${crypto.randomBytes(8).toString("hex")}`;
  }

  log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.defaultContext,
      data: data ? maskSensitiveData(data) : undefined,
    };

    const output = JSON.stringify(entry);
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errorDetails =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : { error };
    this.log("error", message, { ...errorDetails, ...data });
  }
}

export const logger = new StructuredLogger();
