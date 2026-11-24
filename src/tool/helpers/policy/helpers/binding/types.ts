import type { z } from "zod";
import type { toolExecutionBindingSchema } from "./helpers";

export type ToolExecutionBinding = Readonly<z.infer<typeof toolExecutionBindingSchema>>;
