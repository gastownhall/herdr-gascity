// The Function constructor read into a name first, then called through it.
const AsyncFunction = (async function () {}).constructor;
export const run = (code: string) => new AsyncFunction(code)();
