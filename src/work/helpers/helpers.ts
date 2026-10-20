import { RepositoryError as PersistenceError } from "@persistence/types";
import type {
  AuthorizedAgentContext,
  SessionOwnerRegistry,
  WorkLease,
  WorkService,
  WorkServiceOptions,
  WorkSubmission,
  WorkView,
} from "../types";
import { WorkError } from "./errors";

const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_RESULT_BYTES = 256 * 1024;
const MAX_REQUEST_KEY_LENGTH = 256;
const MAX_KIND_LENGTH = 128;
const MAX_FAILURE_MESSAGE_LENGTH = 2_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const boundedJsonBytes = (value: unknown, label: string, limit: number): void => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new WorkError("invalid", `${label} must be JSON.`);
  }
  if (Buffer.byteLength(serialized, "utf8") > limit) {
    throw new WorkError("invalid", `${label} exceeds the size limit.`);
  }
};

const requireUuid = (value: string, label: string): void => {
  if (!UUID_PATTERN.test(value)) {
    throw new WorkError("invalid", `${label} is not a valid identifier.`);
  }
};

const mapRepositoryFailure = (error: unknown): never => {
  if (error instanceof PersistenceError) {
    switch (error.code) {
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

const assertSubmission = (
  submission: WorkSubmission,
  allowedKinds: ReadonlySet<string>,
  limit: number,
): void => {
  if (typeof submission.sessionUri !== "string" || submission.sessionUri.length === 0) {
    throw new WorkError("invalid", "A session URI is required.");
  }
  if (typeof submission.requestKey !== "string"
    || submission.requestKey.length === 0
    || submission.requestKey.length > MAX_REQUEST_KEY_LENGTH) {
    throw new WorkError("invalid", "A bounded request key is required.");
  }
  if (typeof submission.kind !== "string"
    || submission.kind.length === 0
    || submission.kind.length > MAX_KIND_LENGTH
    || !allowedKinds.has(submission.kind)) {
    throw new WorkError("invalid", "The work kind is not allowed.");
  }
  if (!isRecord(submission.input)) {
    throw new WorkError("invalid", "Work input must be a JSON object.");
  }
  boundedJsonBytes(submission.input, "Work input", limit);
  if (submission.targetAgentId !== undefined) {
    requireUuid(submission.targetAgentId, "Target agent");
  }
};

const presentAgent = (
  options: WorkServiceOptions,
  agent: AuthorizedAgentContext,
): void => {
  const binding = options.presence.getByConnection(agent.connectionId);
  const now = options.now?.() ?? Date.now();
  if (binding === undefined
    || binding.agentId !== agent.agentId
    || binding.principalSubject !== agent.principal.subject
    || binding.generation !== agent.generation
    || binding.expiresAt <= now) {
    throw new WorkError("unauthorized", "Agent presence is not active on this connection.");
  }
};

const enabledAgent = async (
  options: WorkServiceOptions,
  agent: AuthorizedAgentContext,
): Promise<void> => {
  const registration = await options.registrations.getById(agent.agentId);
  if (registration === undefined || !registration.enabled
    || registration.principalSubject !== agent.principal.subject) {
    throw new WorkError("unauthorized", "Agent registration is not enabled for this principal.");
  }
};

const assertLeaseInput = (workId: string, token: string): void => {
  requireUuid(workId, "Work ID");
  requireUuid(token, "Lease token");
};

const toView = (item: Awaited<ReturnType<WorkServiceOptions["repository"]["get"]>>): WorkView | null => {
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
        throw new Error("The session already belongs to another principal.");
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

export const createWorkService = (options: WorkServiceOptions): WorkService => {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;

  return {
    async submit(principal, submission) {
      assertSubmission(submission, options.allowedKinds, maxInputBytes);
      const live = options.describeSession(submission.sessionUri);
      const boundOwner = options.sessions.owner(submission.sessionUri);
      if (live === undefined || boundOwner === undefined) {
        throw new WorkError("not_found", "The authorized live session was not found.");
      }
      if (live.ownerPrincipalSubject !== principal.subject || boundOwner !== principal.subject) {
        throw new WorkError("unauthorized", "The session belongs to another principal.");
      }
      if (submission.targetAgentId !== undefined) {
        const target = await options.registrations.getById(submission.targetAgentId);
        if (target === undefined || !target.enabled) {
          throw new WorkError("invalid", "The target agent was not found.");
        }
        if (target.principalSubject !== principal.subject) {
          throw new WorkError("unauthorized", "The target agent belongs to another principal.");
        }
      }
      try {
        const result = await options.repository.submit({
          session: live,
          requestKey: submission.requestKey,
          kind: submission.kind,
          input: submission.input,
          targetAgentId: submission.targetAgentId,
        });
        return { id: result.id };
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async claim(agent, sessionUri) {
      presentAgent(options, agent);
      await enabledAgent(options, agent);
      if (typeof sessionUri !== "string" || sessionUri.length === 0) {
        throw new WorkError("invalid", "A session URI is required.");
      }
      try {
        await options.repository.reconcileExpired();
        const lease = await options.repository.claim({
          agentId: agent.agentId,
          principalSubject: agent.principal.subject,
          sessionUri,
          kinds: [...options.allowedKinds].sort(),
        });
        if (lease === null) {
          return null;
        }
        const mapped: WorkLease = {
          workId: lease.workId,
          sessionUri: lease.sessionUri,
          kind: lease.kind,
          input: lease.input,
          leaseToken: lease.leaseToken,
          leaseExpiresAt: lease.leaseExpiresAt,
          attempt: lease.attempt,
        };
        return mapped;
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async renew(agent, workId, token) {
      presentAgent(options, agent);
      await enabledAgent(options, agent);
      assertLeaseInput(workId, token);
      try {
        const renewed = await options.repository.renew({
          agentId: agent.agentId,
          principalSubject: agent.principal.subject,
          workId,
          token,
        });
        if (renewed === null) {
          throw new WorkError("stale", "The work lease is no longer current.");
        }
        return renewed;
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async complete(agent, workId, token, result) {
      presentAgent(options, agent);
      await enabledAgent(options, agent);
      assertLeaseInput(workId, token);
      if (!isRecord(result)) {
        throw new WorkError("invalid", "Work result must be a JSON object.");
      }
      boundedJsonBytes(result, "Work result", maxResultBytes);
      try {
        const completed = await options.repository.complete({
          agentId: agent.agentId,
          principalSubject: agent.principal.subject,
          workId,
          token,
          result,
        });
        if (!completed) {
          throw new WorkError("stale", "The work lease is no longer current.");
        }
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async fail(agent, workId, token, reason) {
      presentAgent(options, agent);
      await enabledAgent(options, agent);
      assertLeaseInput(workId, token);
      if (typeof reason.retryable !== "boolean"
        || typeof reason.message !== "string"
        || reason.message.length === 0
        || reason.message.length > MAX_FAILURE_MESSAGE_LENGTH) {
        throw new WorkError("invalid", "A bounded failure reason is required.");
      }
      try {
        const status = await options.repository.fail({
          agentId: agent.agentId,
          principalSubject: agent.principal.subject,
          workId,
          token,
          retryable: reason.retryable,
        });
        if (status === null) {
          throw new WorkError("stale", "The work lease is no longer current.");
        }
        return { status };
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async cancel(principal, workId) {
      requireUuid(workId, "Work ID");
      try {
        const status = await options.repository.cancel({
          workId,
          principalSubject: principal.subject,
        });
        if (status === null) {
          throw new WorkError("not_found", "The work item was not found.");
        }
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async get(principal, workId) {
      requireUuid(workId, "Work ID");
      try {
        const item = await options.repository.get({
          workId,
          principalSubject: principal.subject,
        });
        return toView(item);
      } catch (error) {
        return mapRepositoryFailure(error);
      }
    },

    async assertSessionDisposable(sessionUri) {
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
