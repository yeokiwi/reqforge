/** "Alice Admin" → "AA"; "carol" → "C"; "" → "?". Avatar text only — never an identifier. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = (words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]]).map(
    (w) => Array.from(w as string)[0] ?? "",
  );
  return letters.join("").toUpperCase();
}
