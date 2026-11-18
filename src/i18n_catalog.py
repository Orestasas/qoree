#!/usr/bin/env python3
"""The app's messages, as written in its source: every tr('…'), trx('…'), trc('ctx', '…') and trLater('…') in src/js,
with where each one is. Used by assemble.py to fill in and check the translations.

A message's text must be a string literal, or literals joined with +, so it can be read here; a call with anything
else (tr(name), which translates a trLater text kept in a table) is listed as dynamic, with where it is.

Run it to list the messages:  python3 src/i18n_catalog.py src/js
"""
import json
import pathlib
import re
import sys

CALLS = ("trLater", "trc", "trx", "tr")
CTX_SEP = "\u0004"
ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}


class Source:
    """A JavaScript file read as tokens: strings, comments, regular expressions and the rest, enough to find calls."""

    def __init__(self, path, text=None, line=1):
        self.path = path
        self.text = path.read_text(encoding="utf-8") if text is None else text
        self.first_line = line  # the line the text starts on, for code inside a template literal's ${…}
        self.nested = []  # (start, end) of each ${…} met while reading template literals

    def line_of(self, i):
        return self.text.count("\n", 0, i) + self.first_line

    def skip_space(self, i):
        t = self.text
        while i < len(t):
            if t[i].isspace():
                i += 1
            elif t.startswith("//", i):
                j = t.find("\n", i)
                i = len(t) if j < 0 else j
            elif t.startswith("/*", i):
                j = t.find("*/", i + 2)
                i = len(t) if j < 0 else j + 2
            else:
                break
        return i

    def read_string(self, i):
        """(value, end, static) for the string literal starting at i; static is False for a template with ${}."""
        t = self.text
        q = t[i]
        out = []
        static = True
        j = i + 1
        while j < len(t):
            c = t[j]
            if c == "\\":
                n = t[j + 1]
                if n in ESCAPES:
                    out.append(ESCAPES[n])
                    j += 2
                elif n == "u":
                    if t[j + 2] == "{":
                        k = t.index("}", j)
                        out.append(chr(int(t[j + 3:k], 16)))
                        j = k + 1
                    else:
                        out.append(chr(int(t[j + 2:j + 6], 16)))
                        j += 6
                elif n == "x":
                    out.append(chr(int(t[j + 2:j + 4], 16)))
                    j += 4
                elif n == "\n":
                    j += 2
                else:
                    out.append(n)
                    j += 2
            elif c == q:
                return "".join(out), j + 1, static
            elif q == "`" and t.startswith("${", j):
                static = False
                depth = 0
                start = j + 2
                while j < len(t):
                    if t[j] == "{":
                        depth += 1
                    elif t[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                self.nested.append((start, j))
                j += 1
            else:
                if c == "\n" and q != "`":
                    raise SyntaxError(f"{self.path.name}:{self.line_of(i)}: unterminated string")
                out.append(c)
                j += 1
        raise SyntaxError(f"{self.path.name}:{self.line_of(i)}: unterminated string")

    def read_literal_sum(self, i):
        """The value of string literals joined with + starting at i: (value, end), or (None, i) if it isn't one."""
        t = self.text
        parts = []
        j = self.skip_space(i)
        while j < len(t) and t[j] in "'\"`":
            value, end, static = self.read_string(j)
            if not static:
                return None, i
            parts.append(value)
            k = self.skip_space(end)
            if k < len(t) and t[k] == "+":
                j = self.skip_space(k + 1)
                continue
            if k < len(t) and t[k] in ",)":
                return "".join(parts), k
            return None, i
        return None, i

    def calls(self):
        """Every translation call: (name, ctx, text or None, line)."""
        t = self.text
        i = 0
        prev = ""  # the last significant character outside strings and comments, to tell a regex from a division
        while i < len(t):
            c = t[i]
            if c.isspace():
                i += 1
                continue
            if t.startswith("//", i) or t.startswith("/*", i):
                i = self.skip_space(i)
                continue
            if c in "'\"`":
                _, i, _ = self.read_string(i)
                prev = "a"
                continue
            if c == "/":
                if prev and (prev.isalnum() or prev in "_$)]"):
                    i += 1
                    prev = "/"
                    continue
                j = i + 1
                in_class = False
                while j < len(t):
                    if t[j] == "\\":
                        j += 2
                        continue
                    if t[j] == "[":
                        in_class = True
                    elif t[j] == "]":
                        in_class = False
                    elif t[j] == "/" and not in_class:
                        break
                    elif t[j] == "\n":
                        raise SyntaxError(f"{self.path.name}:{self.line_of(i)}: unterminated regular expression")
                    j += 1
                i = j + 1
                while i < len(t) and t[i].isalpha():
                    i += 1
                prev = "a"
                continue
            if c.isalpha() or c in "_$":
                m = re.match(r"[A-Za-z_$][A-Za-z0-9_$]*", t[i:])
                word = m.group(0)
                before = t[:i].rstrip()
                end = i + len(word)
                after = self.skip_space(end)
                if word in CALLS and after < len(t) and t[after] == "(" and not before.endswith(".") and not re.search(r"\bfunction\s*$", before):
                    line = self.line_of(i)
                    ctx = None
                    start = after + 1
                    if word == "trc":
                        ctx, k = self.read_literal_sum(start)
                        k = self.skip_space(k)
                        if ctx is None or t[k] != ",":
                            yield word, None, None, line
                            i = end
                            prev = "a"
                            continue
                        start = k + 1
                    text, _ = self.read_literal_sum(start)
                    yield word, ctx, text, line
                i = end
                prev = "a"
                continue
            prev = c
            i += 1
        # Calls inside a template literal's ${…}, read as code of their own.
        for start, end in self.nested:
            inner = Source(self.path, self.text[start:end], self.line_of(start))
            yield from inner.calls()


def extract(js_dir):
    """{key: {"text", "ctx", "places": [(file, line, call)]}} and the dynamic calls [(file, line, call)]."""
    messages = {}
    dynamic = []
    for path in sorted(pathlib.Path(js_dir).glob("*.js")):
        for call, ctx, text, line in Source(path).calls():
            if text is None:
                dynamic.append((path.name, line, call))
                continue
            key = f"{ctx}{CTX_SEP}{text}" if ctx else text
            m = messages.setdefault(key, {"text": text, "ctx": ctx, "places": []})
            m["places"].append((path.name, line, call))
    return messages, dynamic


def parse(msg):
    """The message's placeholders as {name: kind} (kind: arg, plural or select, with each option's keys); raises
    ValueError when it isn't well formed (the same rules as parseMessage in src/js/01b-i18n.js)."""
    found = {}
    i = 0

    def word():
        nonlocal i
        while i < len(msg) and msg[i].isspace():
            i += 1
        m = re.match(r"=?[A-Za-z0-9_]+", msg[i:])
        if not m:
            raise ValueError(f"expected a name at {i}")
        i += len(m.group(0))
        while i < len(msg) and msg[i].isspace():
            i += 1
        return m.group(0)

    def parts():
        nonlocal i
        while i < len(msg) and msg[i] != "}":
            if msg[i] == "{":
                arg()
            else:
                i += 1

    def arg():
        nonlocal i
        i += 1
        name = word()
        if i < len(msg) and msg[i] == "}":
            i += 1
            found.setdefault(name, ("arg", ()))
            return
        if i >= len(msg) or msg[i] != ",":
            raise ValueError(f"expected , or }} after {name}")
        i += 1
        kind = word()
        if kind not in ("plural", "select") or i >= len(msg) or msg[i] != ",":
            raise ValueError(f"unknown kind {kind}")
        i += 1
        keys = []
        while i < len(msg) and msg[i].isspace():
            i += 1
        while i < len(msg) and msg[i] != "}":
            keys.append(word())
            if i >= len(msg) or msg[i] != "{":
                raise ValueError(f"expected {{ after {keys[-1]}")
            i += 1
            parts()
            if i >= len(msg) or msg[i] != "}":
                raise ValueError("unclosed option")
            i += 1
            while i < len(msg) and msg[i].isspace():
                i += 1
        if i >= len(msg):
            raise ValueError("unclosed placeholder")
        i += 1
        if "other" not in keys:
            raise ValueError(f"{name} has no 'other' option")
        found[name] = (kind, tuple(keys))

    parts()
    if i < len(msg):
        raise ValueError("stray }")
    return found


def names(msg):
    """The names a message fills in."""
    return set(parse(msg))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--json"]
    msgs, dyn = extract(args[0] if args else "src/js")
    if "--json" in sys.argv:
        # For tests/i18n.cjs: {key: {text, ctx, places}} and the dynamic calls.
        print(json.dumps({"messages": msgs, "dynamic": dyn}, ensure_ascii=False))
        sys.exit(0)
    for key, m in msgs.items():
        where = ", ".join(f"{f}:{n}" for f, n, _ in m["places"])
        print(json.dumps(m["text"], ensure_ascii=False), ("[" + m["ctx"] + "] ") if m["ctx"] else "", where)
    print(f"{len(msgs)} messages; {len(dyn)} dynamic calls:", ", ".join(f"{f}:{n} {c}" for f, n, c in dyn), file=sys.stderr)
