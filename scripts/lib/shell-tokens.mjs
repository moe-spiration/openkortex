// Minimal shell tokenizer for the guard hook: splits a command line into simple commands
// (on && || ; | and newlines, outside quotes) and each command into words (quotes removed).
// Not a full parser: command substitution and variables stay literal text, which is good
// enough for a deny-list that errs on the side of blocking.

export function splitCommands(line) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      cur += c;
      if (c === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "\n" || c === ";" || c === "|" || c === "&") {
      if ((c === "|" || c === "&") && line[i + 1] === c) i++;
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function words(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += c;
  }
  if (has || cur) out.push(cur);
  return out;
}
