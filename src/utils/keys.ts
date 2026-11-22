type Letter =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type Symbol = ' ' | ',' | '.' | '/' | ';' | "'" | '[' | ']' | '\\' | '-' | '=' | '`';
type NamedKey =
  | 'Enter' | 'Escape' | 'Tab' | 'Backspace' | 'Delete'
  | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  | 'Home' | 'End' | 'PageUp' | 'PageDown'
  | 'Shift' | 'Control' | 'Alt' | 'Meta'
  | `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

/**
 * A key as the browser names it in `KeyboardEvent.key`: a letter, in either case, a digit or
 * symbol, `' '` for the space bar, a named key such as `'Enter'` or `'ArrowLeft'`, or any other
 * name the browser gives, such as `'ö'`.
 */
// `string & {}` takes any name while editors still suggest the ones above, which `string` would hide
export type ResponseKey = Letter | Uppercase<Letter> | Digit | Symbol | NamedKey | (string & {});

/**
 * The key a press counts as: the one in `keys` it matches in any case, so that caps lock, shift
 * and `'enter'` for `'Enter'` make no difference; or with `true`, the pressed key, a letter in
 * lowercase. `undefined` if it does not count.
 */
export function responseKey(keys: readonly string[] | boolean | undefined, pressed: string): string | undefined {
  if (keys === true) return pressed.length === 1 ? pressed.toLowerCase() : pressed;
  if (!keys) return undefined;
  return keys.find((key) => key.toLowerCase() === pressed.toLowerCase());
}

/**
 * The answer a key press gives: the name of the choice whose key it is, or a listed key, or with
 * `keys: true` any key, as itself. Undefined for a key that does not answer.
 */
export function keyAnswer(
  answers: { keys?: readonly string[] | true; choices?: Record<string, { key?: string }> } | undefined,
  pressed: string,
): { response: string; key: string } | undefined {
  for (const [name, choice] of Object.entries(answers?.choices ?? {})) {
    const key = choice.key === undefined ? undefined : responseKey([choice.key], pressed);
    if (key !== undefined) return { response: name, key };
  }
  const key = responseKey(answers?.keys ?? false, pressed);
  return key === undefined ? undefined : { response: key, key };
}
