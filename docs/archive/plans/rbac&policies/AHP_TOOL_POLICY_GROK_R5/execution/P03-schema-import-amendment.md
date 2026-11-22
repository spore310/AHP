# P03 shared-validation import amendment

**Lead technical decision: approved narrow import-only amendment, not packet acceptance.**

Sol's independent execute regression demonstrated that a client-owned implementation with an empty implementationId could receive a descriptor. P01 already defines the exact runtime `toolExecutionBindingSchema`; duplicating or weakening it in P03 is inappropriate.

Permit one dependency-only change to the accepted file `src/toolPolicy/helpers/validation/helpers.ts`: import authorization constants/types from `@authorization/constants` and shared schema helpers from `@authorization/helpers/validation`, instead of the broad `@authorization` entrypoint. The schema implementation, public exports, accepted types, limits and behavior remain unchanged.

This breaks the root-barrel cycle when `src/authorization/helpers/evaluate/helpers.ts` reuses `toolExecutionBindingSchema` directly from the toolPolicy validation leaf to validate host-installed executor implementations. Invalid installation must throw before committing an assignment. Descriptor/assignment checks remain defense in depth.

The accepted P02 hash for this one file is intentionally superseded only for this import change; all other accepted baseline changes still require explicit justification. Include full contract/portable-import tests in final DB-safe validation. Final independent review must verify no behavior or API change was hidden in the amendment.

Test fixtures for invalid implementation registration should require rejection and no subsequent descriptor/authorization, rather than requiring invalid authority to be stored first. Preserve real valid execute-delivery controls.
