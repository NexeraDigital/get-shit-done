// Log type definitions

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  phase?: number;
  step?: string;
  meta?: Record<string, unknown>;
}
