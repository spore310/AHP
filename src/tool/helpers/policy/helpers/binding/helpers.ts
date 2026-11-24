import { z } from "zod";
import { identifierSchema } from "@authorization/helpers/validation";

export const createToolExecutionBindingSchema = (identifier: typeof identifierSchema) => z.discriminatedUnion("implementation", [
  z.strictObject({
    location: z.literal("server"),
    suppliedBy: z.literal("server"),
    implementation: z.literal("host"),
    implementationId: identifier,
  }),
  z.strictObject({
    location: z.literal("client"),
    suppliedBy: z.enum(["server", "client"]),
    implementation: z.literal("client-owned"),
    implementationId: identifier,
  }),
  z.strictObject({
    location: z.literal("client"),
    suppliedBy: z.literal("server"),
    implementation: z.literal("approved-artifact"),
    artifactRef: identifier,
  }),
]);

export const toolExecutionBindingSchema = createToolExecutionBindingSchema(identifierSchema);
