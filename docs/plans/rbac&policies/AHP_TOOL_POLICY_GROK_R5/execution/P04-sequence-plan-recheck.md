# P04 sequence-resolution direction recheck

**Verdict: PASS — the proposed direction resolves P1-1 without a protocol or privacy bypass.** This is a narrow plan recheck only. The original candidate remains frozen and unmodified; this does not authorize source/test changes or accept P04.

## Basis

The installed protocol requires `InitializeResult.serverSeq` to be the current server sequence, and the host runtime consumes it even when `snapshots` is empty. Omitting it or substituting zero would misrepresent the shared cursor. The proposed resolution correctly treats that cursor as a separate host-wide activity fact needing explicit authorization, rather than pretending it is a resource-scoped count.

`allowGlobalSequence` is an appropriate narrow capability because it is produced only by the already-trusted `InitialAuthoritySource` after identity/actor resolution, is not wire-controlled, and grants neither a resource scope nor tool/session permission. Requiring its captured value to be exactly `true` and its existing setup currentness/expiry guard to remain live at initialize closes the disclosure identified in P1-1. Denial before entering the kernel/getting `serverSeq` avoids both the leak and protected side effects. An explicitly approved setup can still return the genuine canonical cursor with empty snapshots, preserving native protocol/runtime semantics.

This is consistent with `AUTHORITY.md` A10: safe native initialization may be public, but need not be; and with `DELIVERY_WIRE.md` D1/D2: scoped views/counts must not leak, and the canonical server sequence must not be replaced by a fabricated counter. Explicitly permitting the shared cursor is not permission to disclose root/resource counts or protected views.

## Conditions carried into implementation

- Missing approval defaults to denial; supplied values must be runtime-validated as booleans. Promise, malformed, mutable-after-capture, expired, or stale values must never authorize initialization.
- Check live setup and captured `allowGlobalSequence === true` before the canonical initialize handler or any sequence getter. The permission must be covered by the same snapshot currentness, expiry and release contract.
- Keep resource/session/list/tool routes denied even when the global cursor is permitted. Wire `clientId`, `kind`, `role`, or any other initialize field must not set or widen this permission.
- Replace the now-invalid anonymous successful-initialize positive with the specified no-authority/false-approval denial and zero-getter regression; retain an explicit trusted-setup positive that asserts the exact canonical sequence and empty snapshots. Include stale/expiry and malformed-value controls as proposed.
- Update the accepted P04 plan/authorization and scoped README wording before implementation so they no longer promise anonymous successful initialize. Public ping need not disclose the cursor; keep its behavior consistent with the accepted plan and do not use it to reach the initialize getter.

No remaining technical blocker to this direction. Lead acceptance of the amendment, implementation, frozen-candidate validation, and independent final review remain outstanding; P05 remains blocked.
