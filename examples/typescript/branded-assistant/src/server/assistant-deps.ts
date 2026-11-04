import type { UpstreamStatus } from './progress';

export type StartTaskInput = {
  deviceId: string;
  task: string;
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
  maxSteps: number;
  executionTimeout: number;
  llmModel?: string;
};

export type TaskStatusRecord = {
  status: UpstreamStatus;
  succeeded?: boolean | null;
  steps?: number | null;
  message?: string | null;
};

export type TaskResultRecord = {
  status: UpstreamStatus;
  succeeded?: boolean | null;
  steps?: number | null;
  message?: string | null;
  output?: Record<string, unknown> | null;
  creditsUsed?: number | null;
};

/**
 * Everything the service needs from Mobilerun. The adapter implements it and
 * lets SDK errors through unchanged; callers read `error.status`.
 */
export interface AssistantDeps {
  startTask: (input: StartTaskInput) => Promise<{ taskId: string }>;
  getStatus: (taskId: string) => Promise<TaskStatusRecord>;
  retrieveTask: (taskId: string) => Promise<TaskResultRecord>;
  /** Resolves to whether the API queued the message. */
  sendMessage: (taskId: string, message: string) => Promise<boolean>;
  stopTask: (taskId: string) => Promise<void>;
}
