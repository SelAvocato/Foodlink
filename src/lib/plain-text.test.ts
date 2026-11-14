import { describe, expect, it } from "vitest";
import { stripMarkup, stripMarkupMultiline } from "./plain-text";

describe("stripMarkup", () => {
  it("removes angle brackets and keeps the text between them", () => {
    expect(stripMarkup("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
    expect(stripMarkup("<b>Pancit</b>")).toBe("bPancit/b");
  });

  it("turns control characters into spaces so words stay apart", () => {
    expect(stripMarkup("bad\u0000sign")).toBe("bad sign");
    expect(stripMarkup("oily\tresidue")).toBe("oily residue");
    expect(stripMarkup("line\u007Fbreak")).toBe("line break");
  });

  it("turns a newline into a space and collapses runs of spaces", () => {
    expect(stripMarkup("a\nb")).toBe("a b");
    expect(stripMarkup("  too   many    spaces  ")).toBe("too many spaces");
  });

  it("trims the result", () => {
    expect(stripMarkup("   Pancit   ")).toBe("Pancit");
    expect(stripMarkup("<>")).toBe("");
  });

  it("leaves letters, digits, ampersands, accents and emoji alone", () => {
    expect(stripMarkup("Bread & Pastry")).toBe("Bread & Pastry");
    expect(stripMarkup('Café "Crème"')).toBe('Café "Crème"');
    expect(stripMarkup("🍞 Fresh bread 25")).toBe("🍞 Fresh bread 25");
  });

  it("is idempotent", () => {
    for (const value of ["  <b>a</b>   b ", "bad\u0000sign", "🍞  &  Café", "<>"]) {
      const once = stripMarkup(value);
      expect(stripMarkup(once)).toBe(once);
    }
  });

  it("keeps an empty string empty", () => {
    expect(stripMarkup("")).toBe("");
  });
});

describe("stripMarkupMultiline", () => {
  it("keeps a single line break", () => {
    expect(stripMarkupMultiline("First line\nSecond line")).toBe("First line\nSecond line");
  });

  it("normalises CRLF and CR to LF", () => {
    expect(stripMarkupMultiline("First\r\nSecond\rThird")).toBe("First\nSecond\nThird");
  });

  it("collapses three or more blank lines into one blank line", () => {
    expect(stripMarkupMultiline("First\n\n\n\nSecond")).toBe("First\n\nSecond");
    expect(stripMarkupMultiline("First\n\nSecond")).toBe("First\n\nSecond");
  });

  it("strips markup and control characters on every line", () => {
    expect(stripMarkupMultiline("  <b>First</b>  \n\tSecond\u0000line  ")).toBe("bFirst/b\nSecond line");
  });

  it("keeps ampersands, accents and emoji and is idempotent", () => {
    const value = "Bread & Pastry\n\n🍞 Café";
    expect(stripMarkupMultiline(value)).toBe(value);
    expect(stripMarkupMultiline(stripMarkupMultiline(value))).toBe(value);
    for (const sample of ["<b>a</b>\r\n\r\n\r\nb", "  a  \n\n\n  <b>b</b>  ", "<>"]) {
      const once = stripMarkupMultiline(sample);
      expect(stripMarkupMultiline(once)).toBe(once);
    }
  });

  it("keeps an empty string empty", () => {
    expect(stripMarkupMultiline("")).toBe("");
    expect(stripMarkupMultiline("<>")).toBe("");
  });
});
