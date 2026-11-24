import type { AhpTransport } from "@microsoft/agent-host-protocol/client";
import { ClientTransport } from "@client/transport";
import { ToolEndpoint } from "@tool/helpers/client/helpers/transport";

/** Real owners on a scripted SDK endpoint for low-level frame and staging checks. */
export class ToolTestEndpoint extends ClientTransport {
  readonly tools: ToolEndpoint;
  constructor(inner: AhpTransport) {
    super(inner);
    this.tools = new ToolEndpoint({ rpc: this, lifetime: this, shutdown: () => this.close() });
  }
}
