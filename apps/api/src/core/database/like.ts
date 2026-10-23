/** `%`, `_` and `\` of user input match themselves in LIKE (the default escape is `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
