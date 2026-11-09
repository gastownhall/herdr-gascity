// zod's declarations name the WHATWG `URL` type in the signatures of its URL
// validators (z.url(), which this mod does not use). herdr-app's QuickJS host
// has no `URL` global, so this declares an opaque type for those signatures
// and no value: `new URL(...)` in src/ still fails to type-check.
interface URL {
  readonly __declaredForZodSignaturesOnly: never;
}
