import { z } from "zod";
import { isPortableText } from "@persistence/helpers/text";

const text = (max: number) => z.string().min(1).max(max).refine((s) => s.trim().length > 0 && isPortableText(s));
const locator = z.strictObject({ kind: text(128), id: text(2048), instanceId: text(2048).optional() });
export const workViewStatuses = ["queued", "leased", "completed", "failed", "cancelled"] as const;
const unique = (items: readonly string[]) => new Set(items).size === items.length;
const filter = z.strictObject({ kinds: z.array(text(128)).max(64).refine(unique).optional(),
  statuses: z.array(z.enum(workViewStatuses)).max(5).refine(unique).optional() });
const page = { version: z.literal(1), filter: filter.optional(), limit: z.int().min(1).max(100).optional() };
export const workListSchema = z.strictObject({ ...page, session: locator.extend({ kind: z.literal("session") }).optional(),
  announceTo: locator.optional(), cursor: z.uuid().optional(), subscriptionId: z.uuid().optional() }).refine((r) => !!(r.session || r.announceTo));
export const workSubscribeSchema = z.strictObject({ ...page, resource: locator });
export const workUnsubscribeSchema = z.strictObject({ version: z.literal(1), subscriptionId: z.uuid() });
