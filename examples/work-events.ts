import { runWorkEventsExample } from "./advanced/workEvents";

const result = await runWorkEventsExample();
process.stdout.write(`The senior received ${String(result.presented)} authorized chat messages. The observer and excluded chat saw no work. Periodic reconciliation recovered a dropped final hint, and a fresh connection restored the cancelled review.\n`);
