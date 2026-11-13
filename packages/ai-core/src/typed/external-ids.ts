// Externe IDs, die das Dedup-Modul (@kortex/db) aus metadata liest. Wird deterministisch aus dem
// Text gezogen, nie vom Modell erfunden: ein halluzinierter ISBN/IMDb-Wert würde falsche Dubletten melden.

const ISBN_CANDIDATE =
  /\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89][-\s]?)?\d(?:[-\s]?\d){8}[-\s]?[\dXx])\b/g;

function isbn10Valid(d: string): boolean {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] === "X" ? 10 : Number(d[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn13Valid(d: string): boolean {
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

/** Normalised ISBN (digits only, trailing X upper-case) or undefined if not checksum-valid. */
export function normalizeIsbn(value: string | null | undefined): string | undefined {
  const d = value?.replace(/[-\s]/g, "").toUpperCase();
  if (!d) return undefined;
  return isbn10Valid(d) || isbn13Valid(d) ? d : undefined;
}

/** First checksum-valid ISBN-10/13 in the text (also from Amazon-style `/dp/<isbn10>` URLs). */
export function findIsbn(text: string): string | undefined {
  for (const m of text.matchAll(ISBN_CANDIDATE)) {
    const isbn = normalizeIsbn(m[1]);
    if (isbn) return isbn;
  }
  const dp = text.match(/\/(?:dp|gp\/product)\/(\d{9}[\dX])\b/i)?.[1];
  return normalizeIsbn(dp);
}

/** `tt1234567` from an IMDb URL or the bare id. */
export function findImdbId(text: string): string | undefined {
  return text.match(/\b(tt\d{7,9})\b/i)?.[1]?.toLowerCase();
}
