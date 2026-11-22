import type { TrustedRequestContext } from "@authorization";
import type { ToolActionRegistration, ToolActionRegistrationOptions } from "../action";
import type { ToolDispatcherOptions } from "../dispatcher";
import type { ToolPolicyRegistration, ToolPolicyResolutionRequest, ToolExecutorPolicyOptions } from "../policy";

/** Explicit host-owned identity. No default actor or inherited caller privileges. */
export interface ServerToolExecutor {
  readonly context: TrustedRequestContext;
  readonly generation: number;
  current(): boolean;
  /** Pure host-owned generation/identity fence after all callback-bearing checks. */
  fence(): boolean;
}
export interface ServerToolRegistration extends ToolPolicyRegistration<"server"> {
  readonly action: ToolActionRegistration<unknown, unknown, unknown>;
}
export interface ServerToolRegistrationOptions<TInput, TOutput, TPrepared = void> extends ToolActionRegistrationOptions<TInput, TOutput, TPrepared> {
  readonly implementation: ToolPolicyRegistration<"server">["implementation"];
  readonly revision: number;
  readonly source: { readonly id: string; readonly revision: number };
}
export interface ServerToolBrokerOptions extends Omit<ToolExecutorPolicyOptions<"server">, "registrations"> {
  readonly registrations: readonly ServerToolRegistration[];
  readonly executor: ServerToolExecutor;
  readonly dispatcher?: ToolDispatcherOptions;
}
export interface ServerToolDispatchRequest extends ToolPolicyResolutionRequest<"server"> {
  readonly callId: string;
  current(): boolean;
  /** Pure captured caller/session ownership check. */
  fence(): boolean;
}
