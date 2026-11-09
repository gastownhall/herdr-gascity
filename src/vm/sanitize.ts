// Every string gc (or a program the mod ran) supplies is shown as plain
// text: city names, statuses, titles, errors, problem details, stderr, peek
// output. A terminal-style escape, a control character or a bidirectional
// override in that text could hide or reorder what the person reads, so it
// is removed before display. Removal is idempotent: cleaning clean text
// changes nothing.

/** ESC/CSI/OSC/DCS sequences: CSI (ESC [ or C1 0x9b) with its parameters, and string sequences up to BEL or ST. */
const ESCAPES = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]?|(?:\u001b[\]PX^_]|[\u0090\u009d\u0098\u009e\u009f])[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)?|\u001b[@-Z\\-_]?/g;

/**
 * C0 (except tab and line feed), DEL, C1, bidi controls (including the Arabic
 * letter mark U+061C), zero-width format characters, and the Unicode tag
 * characters U+E0000–U+E007F (invisible text; as UTF-16 surrogate pairs).
 */
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]|\udb40[\udc00-\udc7f]/g;

/** Line breaks other than LF: CRLF, a lone CR, and the line and paragraph separators U+2028/U+2029. */
const BREAKS = /\r\n?|[\u2028\u2029]/g;

/** Removes escape sequences and control characters; keeps line feeds and tabs. CRLF, lone CR, U+2028 and U+2029 become LF. */
export function cleanText(text: string): string {
  return text.replace(BREAKS, "\n").replace(ESCAPES, "").replace(CONTROLS, "");
}

/** One display line: like cleanText, and every run of line breaks and tabs becomes one space. */
export function cleanLine(text: string): string {
  return cleanText(text).replace(/[\n\t]+/g, " ");
}
