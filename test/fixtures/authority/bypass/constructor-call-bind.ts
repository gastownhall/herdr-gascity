// The constructor reached through call and bind instead of a direct call.
export const viaCall = (f: () => void, code: string) => f.constructor.call(null, code);
export const viaBind = (f: () => void, code: string) => f.constructor.bind(null, code)();
