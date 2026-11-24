import { isPortableText, RepositoryError as PersistenceError } from "@persistence";
import { WorkError } from "../errors";
import { workDetail } from "../commands/views";
import type { WorkReadOptions, WorkReadPort, SessionOwnerRegistry, WorkView } from "./types";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireUuid = (value: string, label: string): void => {
  if (!UUID_PATTERN.test(value)) {
    throw new WorkError("invalid", `${label} is not a valid identifier.`);
  }
};

const mapRepositoryFailure = (error: unknown): never => {
  if (error instanceof PersistenceError) {
    switch (error.code) {
      case "outcome_unknown": throw error;
      case "conflict":
        throw new WorkError("conflict", "The work request conflicts with an existing submission.");
      case "not_found":
        throw new WorkError("not_found", "The requested work or target was not found.");
      case "unauthorized":
        throw new WorkError("unauthorized", "The session or work item is not authorized for this principal.");
      case "database":
        throw new Error("Durable work storage is unavailable.");
    }
  }
  throw error instanceof Error ? error : new Error("Durable work storage is unavailable.");
};

const toView = (item: Awaited<ReturnType<WorkReadOptions["repository"]["get"]>>): WorkView | null => {
  if (item === null) {
    return null;
  }
  return {
    id: item.id,
    sessionUri: item.sessionUri,
    kind: item.kind,
    status: item.status,
    input: item.input,
    result: item.result,
    targetAgentId: item.targetAgentId,
    leaseExpiresAt: item.leaseExpiresAt,
    attemptCount: item.attemptCount,
    maxAttempts: item.maxAttempts,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

export const createSessionOwnerRegistry = (): SessionOwnerRegistry => {
  const owners = new Map<string, string>();
  return {
    bind(sessionUri, principalSubject) {
      const current = owners.get(sessionUri);
      if (current !== undefined && current !== principalSubject) {
        throw new WorkError("conflict", "The session already belongs to another principal.");
      }
      owners.set(sessionUri, principalSubject);
    },
    owner(sessionUri) {
      return owners.get(sessionUri);
    },
    unbind(sessionUri) {
      owners.delete(sessionUri);
    },
    clear() {
      owners.clear();
    },
  };
};

export const createWorkReadPort = (options: WorkReadOptions): WorkReadPort => {
  return {
    async get(principal, workId, domainId, guardDelivery) {
      requireUuid(workId, "Work ID");
      workId = workId.toLowerCase();
      try {
        if (options.canonicalGet) {
          if (!domainId) return null;
          const { subject } = principal;
          const row = await options.canonicalGet(domainId, workId);
          if (!row || row.id !== workId || row.session.domainId !== domainId || row.owner !== subject) return null;
          const { id, instanceId } = row.session;
          const current = () => options.currentInstance?.(id, instanceId, subject, domainId) === true;
          if (!current()) return null;
          guardDelivery?.(current);
          return workDetail(row);
        }
        const item = await options.repository.get({
          ...(domainId === undefined ? {} : { domainId }),
          workId,
          principalSubject: principal.subject,
        });
        if (item && (options.currentInstance || item.sessionInstanceId !== undefined)) {
          const { sessionUri, sessionInstanceId } = item;
          const { subject } = principal;
          if (domainId === undefined || sessionInstanceId === undefined) return null;
          const current = () => options.currentInstance?.(sessionUri, sessionInstanceId, subject, domainId) === true;
          if (!current()) return null;
          guardDelivery?.(current);
        } else if (item && options.legacyReadCurrent) {
          guardDelivery?.(options.legacyReadCurrent);
        }
        return toView(item);
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async assertSessionDisposable(sessionUri) {
      // The dispose channel reaches the dependent-work lookup as a TEXT
      // parameter; bytes PostgreSQL cannot store as text must fail typed here,
      // as the submit/claim gates already do at this boundary.
      if (typeof sessionUri !== "string" || !isPortableText(sessionUri)) {
        throw new WorkError("invalid", "A session URI is required.");
      }
      try {
        if (await options.repository.hasDependentWork(sessionUri)) {
          throw new WorkError("conflict", "The session still has dependent work.");
        }
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },
  };
};
