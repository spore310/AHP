export interface PersistenceOperationScope {
  run<TResult>(operation: () => Promise<TResult>): Promise<TResult>;
  dispose(): Promise<void>;
}
