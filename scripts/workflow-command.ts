// GitHub Actions workflow commands (`::error title=…::message`), escaped the
// way the runner unescapes them, so text from elsewhere (an upstream spec's
// field names, a compiler message) cannot end the command early or start
// another one.

/** Escapes a command's message: `%`, CR and LF. */
export function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** Escapes a property value: as a message, plus `:` and `,`. */
export function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/** One workflow command line, e.g. workflowCommand("error", {title: "x"}, "message"). */
export function workflowCommand(command: string, properties: Record<string, string>, message: string): string {
  const props = Object.entries(properties).map(([k, v]) => `${k}=${escapeProperty(v)}`).join(",");
  return `::${command}${props ? ` ${props}` : ""}::${escapeData(message)}`;
}
