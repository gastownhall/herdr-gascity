Negative fixtures for the authority lint (`scripts/authority.ts`). Each file
except `clean.ts` breaks one rule on purpose; `test/unit/authority.test.ts`
asserts the lint rejects it. These files are never bundled or type-checked.
