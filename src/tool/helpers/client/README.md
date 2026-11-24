# Tool client

Use `createToolClient(connection)` to attach private V1 tool handling to an initialized general client. `connectToolClient(connection, options)` connects and attaches in one call. Native methods are available through `tools.connection.protocol`. Closing the tool client shuts down its connection. Failed attachment to an existing client releases the partial adapter and leaves the other connection users available.

Joining a session closes the tool adapter's temporary native event reader
after subscribing. Independent native consumers retain their readers.
Shutdown rejects active and queued joins even when application artifact
verification is still pending. A late verifier result cannot advertise a tool.

## Files

| File | Responsibility |
| --- | --- |
| `index.ts` | Public tool adapter, errors and types. |
| `types.ts` | Tool client options, correlation and local implementation contracts. |
| `helpers.ts` | Negotiation, assignments, advertisements, dispatch and polling. |
| `helpers/transport/index.ts` | Tool endpoint exports. |
| `helpers/transport/helpers.ts` | Tool invocation and cancellation observers, correlated completions and the local execution limit. |
| `helpers/transport/types.ts` | Local advertisement and invocation state. |

## Client behavior and limits

Native initialization requests no automatic subscriptions; the pinned SDK omits the
empty list on the wire. Private capabilities negotiation precedes tool operations.
Joins serialize per channel, subscribe through the native SDK, release their
local subscription reader after acknowledgment, and select local
implementations by exact assigned contract id/key/version and descriptor. No raw
manifest fallback exists. Registration activates only after an exact private reply
matches channel, view revision, resource incarnation, connection generation and
selected tools; rejection/mismatch preserves prior handlers. Empty registration
clears them. Requests time out after 5 seconds. At most 64 pending requests, 64 unresolved sends, 64 queued/active joins and
64 whole convenience-call lifetimes are retained. Request timeout does not free
unsettled send ownership. Shutdown rejects active and queued join callers even
when application artifact verification or loading is still pending. The active
callback keeps its slot until it settles and cannot publish a late advertisement.
The active/staged channel union caps at 128; replacements
remain allowed at capacity. At most 64 early invocations and 64 executing handlers
are retained. Cooperative cancellation delivers an AbortSignal; active work keeps
its slot until the local handler settles. Unrelated or stale correlation cannot
cancel it. Exact call-ID tombstones prevent replay; at 4096 admitted IDs the
endpoint closes instead of evicting replay protection.

The public client exposes dispatchTool, statusTool, cancelTool and resumeTool.
`dispatchTool` and `callTool` also accept a cancellation `signal` and an
integer `timeoutMs` between 1 and 35,000. The convenience call shares its
deadline across assignment lookup, dispatch, status reads and polling delays.
`dispatchTool` and `callTool` accept an optional fourth argument `{ work }` containing the work ID, attempt and lease token. Only the caller-to-host private dispatch carries it. A tagged call requires the host's `ToolWorkPreparation` adapter and ordinary invoke and executor authority. The adapter checks the resolved route and captured input, including any normalized input. The broker checks the held guard before execution, projection and retained result disclosure. Removing the private call releases its guard. Direct broker owners call the returned handle's `release()` after their final disclosure.
Resume verifies one opaque continuation for the same connection and invocation. Convenience callTool resolves an exact
private assignment, dispatches once, and polls status with 25-500 ms backoff and
a 35-second overall budget. It returns only completed output; known unresolved
receipts throw ToolPendingError(callId), and challenge replies throw
ToolChallengeRequiredError(reply). Lost dispatch replies are never retried.
No automatic challenge resume or execution resubmission occurs.

The wrapper intercepts valid JSON-RPC 2.0 notification-only invocations and its
own correlated responses in text, binary and parsed SDK frames. Private envelopes use the shared 2 MiB/depth-64 JSON capture. Text over the
interception limit passes to the SDK. Binary interception decodes valid UTF-8 only
up to a 2 MiB envelope; oversized/invalid binary and other ordinary frames pass
unchanged to the SDK. That limit does not enforce underlying transport admission.
Parsed frames are trusted SDK adapter objects with supplier-owned framing/size
admission; no hostile getter/proxy sandbox is claimed. The adapter also owns
authentication and safe error semantics. The runtime does not synthesize auth
headers/query tokens or log credential URLs. URL adapter errors are not promised
to be sanitized by this layer.

The public V1 path is exercised by the real host and pinned SDK in the WebSocket and client suites.
