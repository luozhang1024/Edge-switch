"""Minimal JSONC root-property editor; preserves comments and unrelated settings."""
import json
import re


def jsonc_spans(source):
    """Lex JSONC, recording root properties while respecting strings/comments."""
    token = re.compile(r'\s+|//[^\n]*|/\*[\s\S]*?\*/|"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+')
    tokens = [(m.group(), m.start(), m.end()) for m in token.finditer(source)
              if not m.group().isspace() and not m.group().startswith(('//', '/*'))]
    if not tokens or tokens[0][0] != '{' or tokens[-1][0] != '}':
        raise ValueError('Settings must be a JSONC object')
    spans = {}
    i = 1
    while i < len(tokens) - 1:
        key = json.loads(tokens[i][0])
        if not isinstance(key, str) or tokens[i + 1][0] != ':':
            raise ValueError('Invalid settings property')
        i += 2
        start = tokens[i][1]
        depth = 0
        while i < len(tokens):
            value = tokens[i][0]
            if depth == 0 and value in (',', '}'):
                break
            if value in ('{', '['):
                depth += 1
            elif value in ('}', ']'):
                depth -= 1
            end = tokens[i][2]
            i += 1
        if key in spans:
            raise ValueError('Duplicate settings key: ' + key)
        spans[key] = (start, end)
        if tokens[i][0] == ',':
            i += 1
    return spans, tokens


def patch_jsonc(source, changes):
    for key, value in changes.items():
        spans, tokens = jsonc_spans(source)
        encoded = json.dumps(value, ensure_ascii=False)
        if key in spans:
            start, end = spans[key]
            source = source[:start] + encoded + source[end:]
        else:
            # Append after the last token, preserving comments and trailing commas.
            close = tokens[-1][1]
            comma = '' if tokens[-2][0] in ('{', ',') else ','
            if comma:
                pos = tokens[-2][2]
                source = source[:pos] + ',' + source[pos:]
                close += 1
            source = source[:close] + '\n    ' + json.dumps(key) + ': ' + encoded + '\n' + source[close:]
    jsonc_spans(source)
    return source


