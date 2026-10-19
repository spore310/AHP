import { parseUnknownJson } from "@jsonrpc";

import { handleHookEvent } from "./agent-workflow-hook";

async function main(): Promise<void> {
  let rawInput = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    rawInput += String(chunk);
  }

  let input: unknown;
  try {
    input = parseUnknownJson(rawInput);
  } catch {
    process.stderr.write("The native workflow hook received invalid JSON.\n");
    process.stdout.write(
      JSON.stringify({
        decision: "block",
        reason: "The native workflow hook could not read its event. Retry the operation.",
      }),
    );
    return;
  }

  process.stdout.write(JSON.stringify(handleHookEvent(input)));
}

await main();
