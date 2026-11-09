// The constructor handed to Reflect, or read by Reflect, instead of called.
export const viaApply = (f: () => void, code: string) => Reflect.apply(f.constructor, undefined, [code]);
export const viaGet = (f: () => void, code: string) => Reflect.get(f, "constructor")(code);
