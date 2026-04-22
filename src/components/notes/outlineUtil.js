/* Extract the heading outline from raw markdown content. Returns a
   list of { line, level, text } items, one per `#` / `##` / `###`
   heading. Used by NoteOutline and the format-detection badge. */
export function extractOutline(content) {
  if (!content) return [];
  const lines = content.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,3}) (.+)$/);
    if (m) {
      out.push({ line: i, level: m[1].length, text: m[2].trim() });
    }
  }
  return out;
}
