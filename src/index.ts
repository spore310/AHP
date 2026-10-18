import { fileURLToPath } from "node:url";

export const APP_NAME = "Agent Hosting Protocol";

export const main = (): void => {
  // Placeholder entrypoint. Real startup behavior arrives with the first capability.
  console.log(APP_NAME);
};

// Run only when executed as the process entrypoint, so importing this module
// from tests or tools has no side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
