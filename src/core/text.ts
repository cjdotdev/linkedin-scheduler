/** LinkedIn has no markup: **words** become Unicode sans-serif bold. Accents are kept (NFD). */
export function linkedinText(body: string): string {
  return body.replace(/\*\*(.+?)\*\*/g, (_, inner: string) => bold(inner));
}

export function bold(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFD")) {
    const c = ch.codePointAt(0)!;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d5d4 + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d5ee + c - 97);
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1d7ec + c - 48);
    else out += ch;
  }
  return out;
}

/** LinkedIn's limit is 3000 characters, counted as code points. */
export const MAX_CHARS = 3000;
export const length = (text: string) => [...text].length;
