#!/usr/bin/env python3
import contextlib
import json
import os
import re
import sys
from collections import defaultdict


MODEL_ENV = "HANLP_MODEL"
MAX_CHARS_ENV = "HANLP_BOOTSTRAP_MAX_CHARS"
DEFAULT_MAX_CHARS = 800


sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))


def _fail(message):
    print(message, file=sys.stderr)
    return 1


def _load_model():
    try:
        import hanlp
        from hanlp.pretrained import mtl
    except Exception as exc:
        raise RuntimeError(f"Python HanLP package is not available: {exc}") from exc

    model_name = os.environ.get(MODEL_ENV) or mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH
    with contextlib.redirect_stdout(sys.stderr):
        return hanlp.load(model_name)


def _token_spans(tokens, text):
    spans = []
    cursor = 0
    for token in tokens:
        token_text = str(token)
        start = text.find(token_text, cursor)
        if start < 0:
            start = cursor
        end = min(len(text), start + len(token_text))
        spans.append((start, end))
        cursor = end
    return spans


def _entity_type(label):
    normalized = str(label).lower()
    if any(token in normalized for token in ("person", "per", "nr", "nh", "人名")):
        return "person"
    if any(token in normalized for token in ("location", "loc", "gpe", "ns", "地名")):
        return "location"
    if any(token in normalized for token in ("organization", "org", "nt", "机构", "组织")):
        return "organization"
    if any(token in normalized for token in ("facility", "fac", "event", "work", "misc", "time")):
        return "setting"
    return None


def _find_mentions(text, surface):
    if not surface:
        return []
    return [
        {"text": surface, "startOffset": match.start(), "endOffset": match.end()}
        for match in re.finditer(re.escape(surface), text)
    ]


def _chunk_text(text, max_chars):
    if len(text) <= max_chars:
        return [(0, text)]

    chunks = []
    start = 0
    punctuation = "。！？!?；;\n"
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            floor = start + max_chars // 2
            split_at = -1
            for index in range(end - 1, floor - 1, -1):
                if text[index] in punctuation:
                    split_at = index + 1
                    break
            if split_at > start:
                end = split_at

        chunk = text[start:end]
        if chunk.strip():
            chunks.append((start, chunk))
        start = end

    return chunks


def _shift_items(items, offset):
    if offset <= 0:
        return items

    shifted = []
    for surface, entity_type, mention in items:
        shifted.append((surface, entity_type, {
            **mention,
            "startOffset": mention["startOffset"] + offset,
            "endOffset": mention["endOffset"] + offset,
        }))
    return shifted


def _to_dict(doc):
    if hasattr(doc, "to_dict"):
        return doc.to_dict()
    if isinstance(doc, dict):
        return doc
    return {}


def _ner_items_from_document(doc, text):
    data = _to_dict(doc)
    tokens = data.get("tok/fine") or data.get("tok/coarse") or []
    token_spans = _token_spans(tokens, text) if isinstance(tokens, list) else []
    items = []
    seen = set()

    for key, entries in data.items():
        if not str(key).startswith("ner") or not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, (list, tuple)) or len(entry) < 2 or not isinstance(entry[0], str):
                continue
            surface = entry[0].strip()
            entity_type = _entity_type(entry[1])
            if not surface or entity_type is None:
                continue

            offsets = [value for value in entry[2:] if isinstance(value, int)]
            mention = None
            if len(offsets) >= 2:
                start, end = offsets[0], offsets[1]
                if 0 <= start < end <= len(text) and text[start:end] == surface:
                    mention = {"text": surface, "startOffset": start, "endOffset": end}
                elif token_spans and 0 <= start < end <= len(token_spans):
                    char_start = token_spans[start][0]
                    char_end = token_spans[end - 1][1]
                    mention = {"text": text[char_start:char_end], "startOffset": char_start, "endOffset": char_end}

            mentions = [mention] if mention else _find_mentions(text, surface)
            for item in mentions:
                if item["text"] != surface:
                    continue
                dedupe_key = (surface, entity_type, item["startOffset"], item["endOffset"])
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                items.append((surface, entity_type, item))

    return items


def _extract_ner_items(doc, text):
    return _ner_items_from_document(doc, text)


def _build_group(items, entity_type, chapter_no, text_length):
    grouped = defaultdict(list)
    for surface, item_type, mention in items:
        if item_type == entity_type:
            grouped[surface].append(mention)

    rows = []
    for surface in sorted(grouped):
        mentions = sorted(grouped[surface], key=lambda item: (item["startOffset"], item["endOffset"]))
        total_count = len(mentions)
        rows.append({
            "text": surface,
            "totalCount": total_count,
            "chapterCount": 1,
            "coverageRatio": 1,
            "score": min(1, 0.5 + min(total_count, 10) / 20),
            "chapters": [{"chapterNo": chapter_no, "mentions": mentions}],
        })

    return rows


def main():
    try:
        request = json.load(sys.stdin)
    except Exception as exc:
        return _fail(f"Invalid JSON request: {exc}")

    text = str(request.get("chapterText") or "")
    chapter_no = int(request.get("chapterNo") or 1)
    if not text.strip():
        return _fail("chapterText must not be empty")

    try:
        max_chars = int(os.environ.get(MAX_CHARS_ENV) or DEFAULT_MAX_CHARS)
    except ValueError:
        max_chars = DEFAULT_MAX_CHARS
    max_chars = max(200, max_chars)

    try:
        model = _load_model()
        items = []
        for offset, chunk in _chunk_text(text, max_chars):
            with contextlib.redirect_stdout(sys.stderr):
                doc = model(chunk)
            items.extend(_shift_items(_extract_ner_items(doc, chunk), offset))
    except Exception as exc:
        return _fail(f"HanLP bootstrap failed: {exc}")

    output = {
        "people": _build_group(items, "person", chapter_no, len(text)),
        "locations": _build_group(items, "location", chapter_no, len(text)),
        "organizations": _build_group(items, "organization", chapter_no, len(text)),
        "settings": _build_group(items, "setting", chapter_no, len(text)),
    }
    json.dump(output, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
