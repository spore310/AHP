import { spawnSync } from "node:child_process";

const WORKFLOW_CONTEXT = [
  "Follow the repository task workflow in `.agents/AGENTS.md`.",
  "For nontrivial repository work, use `.agents/skills/architecture-aware-delivery/SKILL.md`.",
  "Use its fast path for trivial changes; honor plan-only, review-only, and execute scope.",
  "Before finishing a changed worktree, the native stop hook runs `pnpm validate`.",
].join(" ");

interface WorkingTree {
  root: string;
  dirty: boolean;
}

interface ValidationResult {
  ok: boolean;
  exitCode: number | null;
}

interface HookDependencies {
  inspectWorkingTree(cwd: string): WorkingTree;
  runValidation(root: string): ValidationResult;
}

interface HookOutput {
  additionalContext?: string;
  decision?: "allow" | "block";
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectWorkingTree(cwd: string): WorkingTree {
  const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  if (rootResult.error || rootResult.status !== 0) {
    throw new Error("Unable to find the repository root.");
  }

  const root = rootResult.stdout.trim();
  if (!root) {
    throw new Error("Git returned an empty repository root.");
  }

  const statusResult = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );

  if (statusResult.error || statusResult.status !== 0) {
    throw new Error("Unable to inspect repository changes.");
  }

  return { root, dirty: statusResult.stdout.trim().length > 0 };
}

function runValidation(root: string): ValidationResult {
  const command
    = process.platform === "win32" ? "pnpm.cmd validate" : "pnpm validate";
  const result = spawnSync(command, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  return { ok: !result.error && result.status === 0, exitCode: result.status };
}

const defaultDependencies: HookDependencies = {
  inspectWorkingTree,
  runValidation,
};

function isSessionStart(input: Record<string, unknown>): boolean {
  return (
    input.hook_event_name === "SessionStart"
    || (typeof input.source === "string"
      && ("sessionId" in input || "session_id" in input))
  );
}

function isAgentStop(input: Record<string, unknown>): boolean {
  return (
    input.hook_event_name === "Stop"
    || "transcriptPath" in input
    || "transcript_path" in input
    || "stopReason" in input
    || "stop_reason" in input
  );
}

export function handleHookEvent(
  input: unknown,
  dependencies: HookDependencies = defaultDependencies,
): HookOutput {
  if (!isRecord(input)) {
    return {};
  }

  if (isSessionStart(input)) {
    return { additionalContext: WORKFLOW_CONTEXT };
  }

  if (!isAgentStop(input)) {
    return {};
  }

  const cwd = input.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) {
    return {
      decision: "block",
      reason: "The native workflow gate could not identify the repository. Retry from the project workspace.",
    };
  }

  let workingTree: WorkingTree;
  try {
    workingTree = dependencies.inspectWorkingTree(cwd);
  } catch {
    return {
      decision: "block",
      reason: "The native workflow gate could not inspect the repository. Run `git status` and retry.",
    };
  }

  if (!workingTree.dirty) {
    return { decision: "allow" };
  }

  let validation: ValidationResult;
  try {
    validation = dependencies.runValidation(workingTree.root);
  } catch {
    return {
      decision: "block",
      reason: "The native workflow gate could not run project validation. Run `pnpm validate` and retry.",
    };
  }

  if (!validation.ok) {
    const exitCode
      = validation.exitCode === null ? "unknown" : String(validation.exitCode);
    return {
      decision: "block",
      reason: `Project validation failed (exit ${exitCode}). Run \`pnpm validate\`, resolve the failures, and retry completion.`,
    };
  }

  return { decision: "allow" };
}
