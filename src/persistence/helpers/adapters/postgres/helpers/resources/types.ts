import type { PoolClientLike } from "../connection";
import type { ResourceRecord } from "@persistence/helpers/durability/types";

export interface ResourceRow {
  readonly pk: string;
  readonly record: ResourceRecord;
}
export type DurableTransaction = <T>(write: (client: PoolClientLike) => Promise<T>, checkpoint?: boolean, namespace?: boolean) => Promise<T>;
