export function compile(body: string) {
  return new Function("input", body);
}
