/**
 * The crude JSX reader the a11y lints share (`a11y-labels.test.ts`,
 * `a11y-roles.test.ts`). Not a parser — a brace/string-aware scan for one
 * element shape at a time — and deliberately so: the cost of a false negative
 * in a lint is a missing label, not a broken build.
 *
 * Not a `*.test.ts`, so jest does not collect it (`testMatch` in
 * jest.config.js); it lives here because nothing outside the tests reads it.
 */

export interface OpeningTag {
  /** Element name as written: `Pressable`, `TextInput`, … */
  name: string;
  /** Offset of the `<`. */
  start: number;
  /** Offset of the `>` that closes the opening tag. */
  end: number;
  /** Source of the opening tag, `<` up to (not including) its `>`. */
  attrs: string;
  selfClosing: boolean;
  /** 1-based line of the `<`. */
  line: number;
}

/**
 * Offset of the `>` ending the opening tag whose name ends at `from`: the
 * first `>` outside a brace expression and outside a string.
 *
 * A `//` comment inside the tag is skipped to end of line. Without that, a
 * prose apostrophe in one — `// ADR-0033's Amendment 2 …` — reads as an
 * opening quote, the scan runs on to the next `'` somewhere in the body, and a
 * correctly labelled row is reported as a violation (`FastingTrendsCard`, #98).
 * It has to happen HERE rather than as a pre-pass, because only the scan knows
 * whether a `//` is a comment at all — stripping them up front mutilates every
 * `https://` URL and produced four new false positives in `settings.tsx`.
 */
export function openingTagEnd(source: string, from: number): number {
  let depth = 0;
  let inString: string | null = null;
  let i = from;
  for (; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      if (nl === -1) return source.length;
      i = nl;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') inString = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) break;
  }
  return i;
}

/** Every opening tag of the named elements, in source order. */
export function openingTags(source: string, names: readonly string[]): OpeningTag[] {
  const out: OpeningTag[] = [];
  const open = new RegExp(`<(${names.join('|')})\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) != null) {
    // `useRef<TextInput>(null)` is a type argument, not an element: a `<`
    // straight after an identifier (or `.`) is generics, never JSX.
    if (match.index > 0 && /[\w$.]/.test(source[match.index - 1])) continue;
    const end = openingTagEnd(source, match.index + match[0].length);
    out.push({
      name: match[1],
      start: match.index,
      end,
      attrs: source.slice(match.index, end),
      selfClosing: source[end - 1] === '/',
      line: source.slice(0, match.index).split('\n').length,
    });
  }
  return out;
}

/**
 * The element's children: from just after its opening tag to its own closing
 * tag, with same-name nesting counted. Empty for a self-closing tag.
 *
 * This replaced a fixed 300-character window, which ran PAST the closing tag
 * into whatever came next — so an unlabelled icon button followed by a title
 * `<Text>` counted as labelled by its neighbour's text.
 */
export function elementBody(source: string, tag: OpeningTag): string {
  if (tag.selfClosing) return '';
  const from = tag.end + 1;
  const re = new RegExp(`<(/?)${tag.name}\\b`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) != null) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return source.slice(from, m.index);
    } else {
      const end = openingTagEnd(source, m.index + m[0].length);
      if (source[end - 1] !== '/') depth++;
      re.lastIndex = end;
    }
  }
  // Unbalanced (a fragment of JSX in a string, a sample in a comment): the
  // rest of the file is the honest answer — over-reading can only hide a
  // finding, never invent one.
  return source.slice(from);
}
