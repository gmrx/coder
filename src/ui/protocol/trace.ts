export interface TraceEventPayload {
  phase: string;
  text: string;
  data: Record<string, any>;
}

export interface PersistedTraceRun {
  id: string;
  state: 'done' | 'error' | 'stopped';
  summary: string;
  events: TraceEventPayload[];
}

export interface TraceResetMessage {
  type: 'traceReset';
}

export interface TraceEventMessage {
  type: 'traceEvent';
  phase: string;
  text: string;
  data: Record<string, any>;
}
