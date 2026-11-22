import type { JsonRpcMessage } from "@jsonrpc";
import type { ResourceViewCatalogue, ResourceViewProof, ResourceViewRecipient, ResourceViewRecord } from "@toolExecution/helpers/views";

export interface ViewDeliveryIntent {
  readonly channel: string;
  readonly message: JsonRpcMessage;
  readonly record?: ResourceViewRecord;
  readonly catalogue?: ResourceViewCatalogue;
  readonly bytes: number;
}
export interface PeerViewState {
  readonly recipient: ResourceViewRecipient;
  readonly controller: AbortController;
  readonly queue: ViewDeliveryIntent[];
  readonly fromSeq: Map<string, number>;
  readonly generations: Map<string, object>;
  readonly known: Set<string>;
  readonly proofs: Map<string, ResourceViewProof<unknown>>;
  bytes: number;
  running: boolean;
  refresh: boolean;
}
