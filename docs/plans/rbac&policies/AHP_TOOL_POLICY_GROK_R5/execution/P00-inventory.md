# P00 architecture and SDK inventory

Candidate: `agentIdentity@22fa7955b8e43839e041228f647f26e00762ebbe`, no tracked changes. Source inventory supplied by worker `w8:p4` (read-only); orchestrator checked the initialize/subscribe/create/dispose/dispatch and invocation paths, global role selection, SDK transport declaration and state mirror. This records current behavior, not implemented R5 protection.

## Ingress and egress ownership (B02)

All source paths below are relative to `src/`. Regression paths are relative to `src/tests/` and name existing suites, not new privacy evidence.

| Path / symbol | Trusted input / current authority | Current output | Target packet | Regression suite |
| --- | --- | --- | --- | --- |
| `agents/types.ts`, `helpers/authenticator.ts:createStaticTokenAuthenticator` | Handshake bearer adapter supplies subject; clientId is not authentication | Principal or undefined | P04 | `agents/authenticator.test.ts` |
| `websocket/helpers/server.ts:authenticate/establish`, `connection.ts:attachConnection` | Authenticator composed only with agentWork | Connection principal, JSON-RPC sends | P04/P10 | `websocket/agentWork.transport.test.ts`, `websocket.test.ts` |
| `websocket/helpers/ahp/helpers.ts:createSession/disposeSession` | Optional principal and owner registry; absent owner is not a deny | Synchronous owner attachment; later unbind | P05 | `websocket/agentWork.binding.test.ts` |
| `websocket/helpers/host/helpers.ts:createAHPServer/hostedSessions` | Trusted in-process caller; no participant context on session facade | Full factory create/list/snapshot/dispatch | P04/P05/P10 | `application.test.ts`, `websocket/agentWork.disposal.test.ts` |
| `sessions/helpers/factory/helpers.ts:createSessionsFactory`, `application/host.ts:createApplicationSession` | Trusted factory options/type header | Canonical records, full state | P02/P04/P05 | `sessions/applicationHost.test.ts`, sessions suites |
| `sessions/helpers/application/helpers.ts:visibleTools/prepareSessionCreation` | Captured factory role, default anonymous; standard tools still admitted | Shared tool manifest, not per-actor assignments | P03/P05 | `sessions/typedCreation.test.ts`, `sessions/toolManifest.test.ts`, `sessions/toolAdmission.test.ts` |
| `websocket/helpers/ahp/helpers.ts:initialize/snapshotForUri` | Initialized clientId and URI selectors, no scoped grants | Full initialSubscriptions snapshots; buffered events committed after reply | P04/P10 | `websocket/ahp.test.ts`, `websocket/sdk.test.ts` |
| `websocket/helpers/ahp/helpers.ts:buildRootSnapshot` | No recipient resource filtering | All session count and agent catalogue | P10 | `sessions/dispatch.test.ts`, `websocket/ahp.test.ts` |
| `websocket/helpers/ahp/helpers.ts:listSessions`; factory `listSessions/encodeListCursor` | Initialized peer; global offset cursor `{v:1,o:offset}` | All summaries/pages; cursor not actor/view-bound | P10 | `websocket/ahp.test.ts` |
| `websocket/helpers/ahp/helpers.ts:subscribe` | Initialized peer; repeated subscribe skips pending barrier | Full native snapshot | P10 | `websocket/ahp.test.ts` |
| `websocket/helpers/ahp/helpers.ts:publish/onCatalogueNotification/buildSessionSummary` | Root subscription, with removal side channel | URI/provider/title/status/activity/workingDirectories | P10 | `websocket/compliance.test.ts` |
| `sessions/createSession/helpers.ts`, `application/manifest.ts:projectSessionToolManifest` | Canonical factory-selected tool set | Full schemas in `_meta['x-ahp-application']` | P10/P11 | `sessions/toolManifest.test.ts`, `sessions/sessionTypeCapacity.test.ts` |
| `sessions/helpers/state/helpers.ts:applySessionAction`, `application/admission.ts:admitTypedAdvertisement` | Typed descriptors exact; clientId checked; untyped ads raw | Canonical activeClients tools, shared broadcast; no current serverTools producer | P09/P10/P15 | `sessions/dispatch.test.ts`, `sessions/toolAdmission.test.ts`, `websocket/toolInvocation.test.ts` |
| `websocket/helpers/ahp/helpers.ts:onSessionEnvelope` | Channel membership, no per-recipient projection | Full accepted ActionEnvelope including advertised tools | P10 | `websocket/ahp.test.ts` |
| `websocket/helpers/ahp/helpers.ts:dispatchAction`; factory dispatch | Origin peer gets rejected action; rejected envelope not reduced/broadcast | Original action plus rejectionReason (can contain hidden/malicious requested metadata) | P10 | `websocket/ahp.test.ts` |
| `websocket/helpers/ahp/helpers.ts:beginPending/commitPending` | Pending subscription; buffer limited to 256 | Previously captured raw events flushed without authority recheck | P10 | `websocket/ahp.test.ts` |
| `websocket/helpers/ahp/toolInvocation.ts:call/complete` | Caller subscription; unique ready clientId, exact advertisement and selected connection correlation; no actor policy | Private executor input, private caller result; bounded payload/capacity/time | P09/P11 | `websocket/toolInvocation.test.ts` |
| Artifact routes | None currently registered | None | P17 | No existing artifact suite |
| `toolClient/index.ts`, `transport.ts` | Existing client runtime subscribes root and reads shared manifest | Native advertisements and legacy call broker | P07/P09/P11 | `toolClient.test.ts`, `toolClient/transport.test.ts` |

Every DELIVERY_WIRE D1 row is represented. Canonical state ownership remains with sessions; authorization will not become client authority or replace durable-work repository fences.

## Installed SDK 1.0.0 inspection (B03)

Paths relative to `node_modules/@microsoft/agent-host-protocol/`:

- `dist/types/version/registry.d.ts`: `PROTOCOL_VERSION`, supported versions and negotiation. Native version remains 1.0.0; project extension version 2 is separate.
- `dist/client/transport.d.ts:33-48`: `AhpTransport.send/recv/close` is the portable injection seam.
- `dist/ws/transport.d.ts:11-48`: `WebSocketTransport.connect(url, { protocols? })`, `fromSocket`; no headers/auth overload. Use an injected connected transport rather than URL credentials or invented browser/Node overloads.
- `dist/client/client.d.ts:159-170`: initialize accepts clientId, protocolVersions, optional initialSubscriptions/locale; reconnect accepts clientId, lastSeenServerSeq, subscriptions. The current host has no reconnect implementation. No client authenticate method.
- `dist/types/common/commands.d.ts:214-241`: InitializeResult requires protocolVersion, serverSeq and snapshots. AuthenticateParams exists as a type, not evidence of a current host handler.
- `dist/types/common/state.d.ts:311`: snapshot fromSeq separates subsequent greater serverSeq values. Do not invent contiguous per-subscriber numbering.
- `dist/types/common/actions.d.ts:146-156`: rejectionReason is optional on ActionEnvelope.
- `dist/types/channels-session/reducer.{d.ts,js}`: native sessionReducer applies activeClientSet including tools. P10 must project both snapshots and matching actions; setting snapshot tools empty alone is insufficient.
- `dist/client/state-mirror.js:130-143`: apply does not inspect rejectionReason before reducing. Never feed rejection echoes into the accepted action stream.

## Risks carried forward, not P00 production fixes

1. Current shared metadata, root/list counts, summaries, activeClients and action echoes are not recipient-private. P10 must prove D6 projected snapshots + projected accepted actions against the actual SDK reducer. A native action with a projected empty tools array may be usable; P00 inspection alone does not prove it impossible or sufficient.
2. Rejection echoes cannot be treated as accepted reducer events. Preserve useful origin acknowledgement without replaying malicious/hidden metadata.
3. Initialization must wait for independent trusted security, not assume clientId or a missing agent record proves user identity. Existing auth depends on durable work; P04 separates this.
4. Legacy client/tool brokers, direct host facade and buffered sends must not remain unchecked alternatives when protected composition is enabled.
5. Artifact routes are absent. P17 must introduce only an authorized bounded seam, not an unfiltered installer.
6. README/START_HERE refer to missing `GROK_PROMPT.md`; actual runner is `PROMPT.md`. This navigation discrepancy does not change the accepted target or authorize rewriting the bundle.

No source edits, tests or database actions were performed by the inventory worker. Baseline execution is separately evidenced in `P00-baseline.md` and its validate log.
