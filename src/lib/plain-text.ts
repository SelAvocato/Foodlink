/**
 * The one rule for free text stored as plain text (the System Structure asks for
 * HTML stripped). This only removes angle brackets and control characters; it is
 * not an HTML parser, so `&` and quotes are left alone. React still escapes on output.
 */

/** Same range as the screening module always used; it includes newline and tab. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

/** One line: control characters become spaces, markup goes, spaces collapse, trimmed. */
function stripLine(value: string): string {
  return value
    // A control character becomes a space so words on either side stay apart.
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Single-line free text (names, addresses, reasons). */
export function stripMarkup(value: string): string {
  return stripLine(value);
}

/** Multi-line free text (the draft description). Line breaks survive; three or more become two. */
export function stripMarkupMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(stripLine)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
