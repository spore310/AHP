import type { JsonRpcMessage } from "@jsonrpc";
import type { ResourceViewCatalogue, ResourceViewProof, ResourceViewRecipient, ResourceViewRecord } from "@sessions/views";

export interface ViewDeliveryIntent {
  readonly type: "native";
  readonly channel: string;
  readonly message: JsonRpcMessage;
  readonly record?: ResourceViewRecord;
  readonly catalogue?: ResourceViewCatalogue;
  readonly bytes: number;
}
export interface WorkDeliveryIntent {
  readonly type: "work";
  readonly channel: string;
  readonly bytes: number;
  deliver(): Promise<void>;
}
export interface PeerViewState {
  readonly recipient: ResourceViewRecipient;
  readonly controller: AbortController;
  readonly queue: (ViewDeliveryIntent | WorkDeliveryIntent)[];
  readonly workPending: Map<string, WorkDeliveryIntent[]>;
  readonly fromSeq: Map<string, number>;
  readonly generations: Map<string, object>;
  readonly known: Set<string>;
  readonly proofs: Map<string, ResourceViewProof<unknown>>;
  bytes: number;
  running: boolean;
  refresh: boolean;
}
