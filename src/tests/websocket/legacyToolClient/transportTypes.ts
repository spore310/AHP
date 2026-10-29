// TEST ONLY: frozen P09 internal native-broker client. Not the public v2 runtime.
export interface InvokeParams {
  readonly callId: string;
  readonly channel: string;
  readonly key: string;
  readonly version: number;
  readonly input: unknown;
}
