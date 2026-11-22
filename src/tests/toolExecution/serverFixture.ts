import { vi } from "vitest";
import { ToolAction, type ToolActionContext } from "@toolExecution";
import { createServerToolRegistration } from "@toolExecution/server";
import { codingHarnessContracts, type Input, type Output } from "./fixtures";

/** Explicit in-memory host handler. The source hash binds this export, not remote code. */
export function createServerHarness(sourceId: string) {
  return codingHarnessContracts.map((definition) => {
    const execute = vi.fn((input: Input, context: ToolActionContext): Output | Promise<Output> => ({ value: "P15-HOST-RESULT:" + definition.key + ":" + input.path + ":" + context.caller.actor.principal.subject }));
    const prepare = vi.fn<() => void | Promise<void>>(() => undefined);
    const cleanup = vi.fn(() => undefined);
    class Action extends ToolAction<Input, Output> {
      override execute = execute;
      override prepare = prepare;
      override cleanup = cleanup;
    }
    const create = vi.fn(() => new Action());
    const registration = createServerToolRegistration({ definition, revision: 5, source: { id: sourceId + "-" + definition.name, revision: 7 },
      implementation: { location: "server", suppliedBy: "server", implementation: "host", implementationId: "p15-approved-" + definition.name }, create });
    return { definition, registration, create, execute, prepare, cleanup };
  });
}
