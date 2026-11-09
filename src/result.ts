// A value or an error, returned instead of thrown across module boundaries.

/** Success with a value, or failure with a typed error. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** A success. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** A failure. */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
