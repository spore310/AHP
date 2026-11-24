import { describe, expect, it } from "vitest";
import type { ResourceRef } from "@authorization";
import type { ResourceRecord, StoredSession } from "@persistence/helpers/durability/types";
import { captureWorkSelectionInput, createWorkSelectionGraph, type ResourceSelectionInput } from "@work/helpers/selections";

const root = { domainId: "d", kind: "session", id: "session:/root", instanceId: "root" } as const;
const ref = (kind: string, id: string, instanceId = id): ResourceRef => ({ domainId: "d", kind, id, instanceId });
const chat = ref("chat", "same-id"), sibling = ref("chat", "sibling"), term = ref("terminal", "same-id");
const session: StoredSession = { ref: root, type: { id: "type", key: "review", version: 1 }, owner: "owner", providerId: "provider",
  lifecycle: "active", state: {}, graphRevision: "2", stateRevision: "1", lastServerSeq: 0, createdAt: "", modifiedAt: "" };
function row(resource: ResourceRef, parent?: ResourceRef, grantParent?: ResourceRef): ResourceRecord {
  return { ref: resource, session: root, parent, grantParent, owner: session.owner, providerId: session.providerId, registration: {},
    driver: { key: resource.kind, version: 1 }, operationId: resource.instanceId, lifecycle: "active", resourceRevision: "1", dataRevision: "1",
    data: {}, recoveryInput: {}, runtimeMetadata: {}, createdAt: "", modifiedAt: "" };
}
const rows = [row(root), row(chat, root), row(sibling, root), row(term, chat, sibling)];
function rule(resource: ResourceRef, include = true, includeDescendants = false): ResourceSelectionInput {
  return { resource: { kind: resource.kind, id: resource.id, instanceId: resource.instanceId }, include, includeDescendants };
}
describe("canonical work selections", () => {
  it("compares stored selectors after retirement without attaching a replay to a replacement", () => {
    const request = { scope: [rule(chat)] };
    const original = createWorkSelectionGraph("d", session, rows).normalize(request);
    const retired = rows.map((entry) => entry.ref === chat ? { ...entry, lifecycle: "retired" as const } : entry);
    const graph = createWorkSelectionGraph("d", session, retired);
    expect(() => graph.normalize(request)).toThrow();
    expect(graph.normalize(request, original)).toEqual(original);
    const successor = ref("chat", chat.id, "replacement");
    const replacement = createWorkSelectionGraph("d", session, [...retired, row(successor, root)]);
    expect(replacement.normalize(request, original)).toEqual(original);
    const unpinned = { scope: [{ resource: { kind: chat.kind, id: chat.id }, include: true }] };
    expect(replacement.normalize(unpinned, original).scope[0]?.resource).toEqual(successor);
    expect(graph.normalize(unpinned, original).scope[0]?.resource).toEqual(chat);
  });
  it("resolves a narrow locator's exact root and normalizes immutable requested intent", () => {
    const graph = createWorkSelectionGraph("d", session, rows);
    const scoped = graph.normalize({ scope: [{ resource: { kind: chat.kind, id: chat.id }, include: true }] });
    expect(scoped).toEqual({ session: root, graphRevision: "2", scope: [{ resource: chat, include: true, includeDescendants: false }], announce: [] });
    const first = graph.normalize({ scope: [rule(chat), rule(root), rule(chat)], announce: [rule(chat, false)] });
    expect(graph.normalize({ scope: [rule(root), rule(chat)], announce: [rule(chat, false)] })).toEqual(first);
    expect(graph.normalize({ scope: [rule(root, true, true)] }).scope).not.toEqual(first.scope);
    expect(() => graph.normalize({ scope: [rule(chat), rule(chat, true, true)] })).toThrow();
    expect(() => graph.normalize({ scope: [rule(chat, false)] })).toThrow();
    expect(Object.isFrozen(scoped.scope[0]?.resource)).toBe(true);
  });
  it.each([
    { rules: [rule(root, true, true)], target: term, value: true },
    { rules: [rule(root, true, true), rule(chat, false)], target: chat, value: false },
    { rules: [rule(root, true, true), rule(chat, false)], target: term, value: true },
    { rules: [rule(root, true, true), rule(chat, false, true)], target: term, value: false },
    { rules: [rule(root, true, true), rule(chat, false, true), rule(term)], target: term, value: true },
    { rules: [rule(sibling, true, true)], target: term, value: false },
    { rules: [rule(chat)], target: sibling, value: false },
  ])("evaluates nearest applicable containment rules for $target.kind/$value", ({ rules, target, value }) => {
    const graph = createWorkSelectionGraph("d", session, rows);
    const { scope, announce, graphRevision } = graph.normalize({ scope: rules });
    expect(graph.selected(target, scope, graphRevision)).toBe(value);
    expect(graph.selected(target, announce, graphRevision)).toBe(false);
  });
  it("checks the current graph revision, exact reincarnations, and available positive anchors", () => {
    const original = createWorkSelectionGraph("d", session, rows);
    const { scope } = original.normalize({ scope: [rule(chat, true, true)] });
    const later = ref("terminal", "new");
    const updated = createWorkSelectionGraph("d", { ...session, graphRevision: "3" }, [...rows, row(later, chat)]);
    expect(updated.selected(later, scope, "2")).toBe(false);
    expect(updated.selected(later, scope, "3")).toBe(true);
    const replacement = { ...chat, instanceId: "new" };
    const renewed = createWorkSelectionGraph("d", session, [row(root), { ...row(chat, root), lifecycle: "retired" }, row(replacement, root)]);
    expect(renewed.selected(replacement, scope, "2")).toBe(false);
    expect(renewed.hasActivePositiveScope(scope, "2")).toBe(false);
    expect(() => renewed.normalize({ scope: [rule(chat)] })).toThrow();
  });
  it("rejects mixed roots, stale identities and forged locator fields", () => {
    expect(() => createWorkSelectionGraph("other", session, rows)).toThrow();
    expect(() => createWorkSelectionGraph("d", session, [row(root), { ...row(chat, root), session: { ...root, instanceId: "other" } }])).toThrow();
    expect(() => createWorkSelectionGraph("d", session, [row(root), row(chat, sibling)])).toThrow();
    const graph = createWorkSelectionGraph("d", session, rows);
    expect(() => graph.normalize({ session: { kind: "session", id: "other" }, scope: [rule(chat)] })).toThrow();
    const forged = { ...chat, domainId: "other" };
    expect(() => graph.normalize({ scope: [{ resource: forged, include: true }] })).toThrow();
    expect(() => graph.normalize({ scope: [{ resource: { kind: "unknown", id: "unknown" }, include: true }] })).toThrow();
  });
  it("bounds duplicate and negative selections before normalization and descendants before expansion", () => {
    const graph = createWorkSelectionGraph("d", session, rows);
    expect(() => graph.normalize({ scope: Array.from({ length: 65 }, () => rule(chat)) })).toThrow();
    expect(() => graph.normalize({ scope: [rule(root)], announce: Array.from({ length: 65 }, () => rule(chat, false)) })).toThrow();
    const crowded = Array.from({ length: 256 }, (_, i) => row(ref("chat", String(i)), root));
    expect(() => createWorkSelectionGraph("d", session, [row(root), ...crowded])).toThrow();
  });
  it("captures caller inputs before an await and detaches graph identities from the repository", () => {
    const locator = { kind: chat.kind, id: chat.id };
    const captured = captureWorkSelectionInput({ scope: [{ resource: locator, include: true }] });
    locator.id = sibling.id;
    const records = structuredClone(rows);
    const graph = createWorkSelectionGraph("d", session, records);
    records.splice(1);
    expect(graph.normalize(captured).scope[0]?.resource).toEqual(chat);
  });
});
