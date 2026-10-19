import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseUnknownJson } from "@jsonrpc";
import { handleHookEvent } from "../../scripts/agent-workflow-hook";

const cleanRepository = vi.fn(() => ({ root: "C:\\repo", dirty: false }));
const passingValidation = vi.fn(() => ({ ok: true, exitCode: 0 }));

describe("agent workflow native hook", () => {
  it("adds repository workflow context at session start", () => {
    const result = handleHookEvent(
      { sessionId: "session-1", source: "new", cwd: "C:\\repo" },
      { inspectWorkingTree: cleanRepository, runValidation: passingValidation },
    );

    expect(result.additionalContext).toContain(
      ".agents/skills/architecture-aware-delivery/SKILL.md",
    );
    expect(result.additionalContext).toContain("fast path");
    expect(passingValidation).not.toHaveBeenCalled();
  });

  it("adds context for the VS Code-compatible session-start payload", () => {
    const result = handleHookEvent(
      {
        hook_event_name: "SessionStart",
        session_id: "session-1",
        source: "new",
        cwd: "C:\\repo",
      },
      { inspectWorkingTree: cleanRepository, runValidation: passingValidation },
    );

    expect(result.additionalContext).toContain("architecture-aware-delivery");
  });

  it("does not run validation when the repository has no changes", () => {
    const result = handleHookEvent(
      {
        sessionId: "session-1",
        transcriptPath: "C:\\temp\\transcript.jsonl",
        cwd: "C:\\repo",
      },
      { inspectWorkingTree: cleanRepository, runValidation: passingValidation },
    );

    expect(result).toEqual({ decision: "allow" });
    expect(passingValidation).not.toHaveBeenCalled();
  });

  it("requires project validation before stopping with worktree changes", () => {
    const runValidation = vi.fn(() => ({ ok: true, exitCode: 0 }));
    const result = handleHookEvent(
      {
        sessionId: "session-1",
        transcriptPath: "C:\\temp\\transcript.jsonl",
        cwd: "C:\\repo",
      },
      {
        inspectWorkingTree: vi.fn(() => ({ root: "C:\\repo", dirty: true })),
        runValidation,
      },
    );

    expect(result).toEqual({ decision: "allow" });
    expect(runValidation).toHaveBeenCalledWith("C:\\repo");
  });

  it("blocks completion when project validation fails", () => {
    const result = handleHookEvent(
      {
        sessionId: "session-1",
        transcriptPath: "C:\\temp\\transcript.jsonl",
        cwd: "C:\\repo",
      },
      {
        inspectWorkingTree: vi.fn(() => ({ root: "C:\\repo", dirty: true })),
        runValidation: vi.fn(() => ({ ok: false, exitCode: 1 })),
      },
    );

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("pnpm validate");
    expect(result.reason).not.toContain("secret");
  });

  it("keeps enforcing validation after the stop hook has already continued once", () => {
    const result = handleHookEvent(
      {
        sessionId: "session-1",
        transcriptPath: "C:\\temp\\transcript.jsonl",
        stop_hook_active: true,
        cwd: "C:\\repo",
      },
      {
        inspectWorkingTree: vi.fn(() => ({ root: "C:\\repo", dirty: true })),
        runValidation: vi.fn(() => ({ ok: false, exitCode: 1 })),
      },
    );

    expect(result.decision).toBe("block");
  });

  it("blocks completion if repository state cannot be checked", () => {
    const result = handleHookEvent(
      {
        sessionId: "session-1",
        transcriptPath: "C:\\temp\\transcript.jsonl",
        cwd: "C:\\repo",
      },
      {
        inspectWorkingTree: vi.fn(() => {
          throw new Error("git unavailable");
        }),
        runValidation: passingValidation,
      },
    );

    expect(result.decision).toBe("block");
    expect(result.reason).toContain("inspect the repository");
  });

  it("registers native Copilot session-start and stop events", () => {
    const configPath = resolve(
      process.cwd(),
      ".github/hooks/ahp-agent-workflow.json",
    );
    const parsedConfig = parseUnknownJson(readFileSync(configPath, "utf8"));
    const config = parsedConfig as {
      version: number;
      hooks: Record<
        string,
        Array<{
          type: string;
          powershell?: string;
          bash?: string;
          timeoutSec?: number;
        }>
      >;
    };

    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart?.[0]?.bash).toBe(
      "pnpm exec vite-node scripts/run-agent-workflow-hook.ts",
    );
    expect(config.hooks.sessionStart?.[0]?.powershell).toBe(
      "pnpm exec vite-node scripts\\run-agent-workflow-hook.ts",
    );
    expect(config.hooks.agentStop?.[0]?.bash).toBe(
      "pnpm exec vite-node scripts/run-agent-workflow-hook.ts",
    );
    expect(config.hooks.agentStop?.[0]?.timeoutSec).toBe(120);
    expect(config.hooks.preToolUse).toBeUndefined();
  });

  it("runs the configured hook command and returns native session-start output", () => {
    const command
      = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
    const args
      = process.platform === "win32"
        ? ["/d", "/s", "/c", "pnpm exec vite-node scripts/run-agent-workflow-hook.ts"]
        : ["exec", "vite-node", "scripts/run-agent-workflow-hook.ts"];
    const result = spawnSync(
      command,
      args,
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: JSON.stringify({
          sessionId: "session-1",
          source: "new",
          cwd: process.cwd(),
        }),
        timeout: 10_000,
        windowsHide: true,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const output = parseUnknownJson(result.stdout) as { additionalContext: string };
    expect(output.additionalContext).toContain("architecture-aware-delivery");
  });
});
