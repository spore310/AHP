export interface InvokeParams {
  readonly callId: string;
  readonly channel: string;
  readonly key: string;
  readonly version: number;
  readonly input: unknown;
}
