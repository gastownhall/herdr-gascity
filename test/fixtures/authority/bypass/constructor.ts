export const f = (s: string) => (async () => {}).constructor(s);
export const g = (s: string) => new (() => 0)["constructor"](s);
export const h = (C: new (s: string) => unknown, s: string) => Reflect.construct(C, [s]);
