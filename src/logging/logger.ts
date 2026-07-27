import { appendLog } from "../google/jobs.js";
import { maskMobile } from "../utils/mask.js";
import type { LogLevel, LogType, RunStage } from "../domain/types.js";

/** Masks any 10-digit run of digits found in a free-text log message. */
function maskMessage(message: string): string {
  return message.replace(/\b\d{10}\b/g, (m) => maskMobile(m));
}

export interface EventOptions {
  level?: LogLevel;
  candidateRow?: number;
  candidateName?: string;
  attempt?: number;
  elapsedSeconds?: number;
  errorCode?: string;
}

export class RunLogger {
  constructor(private readonly runId: string) {}

  async event(stage: RunStage, message: string, opts: EventOptions = {}): Promise<void> {
    const safeMessage = maskMessage(message);
    await this.write("EVENT", stage, safeMessage, opts);
    this.toConsole(opts.level ?? "INFO", stage, safeMessage);
  }

  async heartbeat(stage: RunStage, message = "heartbeat"): Promise<void> {
    await this.write("HEARTBEAT", stage, message, {});
  }

  private async write(type: LogType, stage: RunStage, message: string, opts: EventOptions): Promise<void> {
    await appendLog({
      timestamp: new Date(),
      runId: this.runId,
      type,
      level: opts.level ?? "INFO",
      stage,
      candidateRow: opts.candidateRow,
      candidateName: opts.candidateName,
      attempt: opts.attempt,
      elapsedSeconds: opts.elapsedSeconds,
      message,
      errorCode: opts.errorCode,
    });
  }

  private toConsole(level: LogLevel, stage: RunStage, message: string): void {
    const line = `[${this.runId}] [${stage}] ${message}`;
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
  }
}
