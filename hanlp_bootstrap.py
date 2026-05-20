#!/usr/bin/env python3
import contextlib
import json
import os
import re
import sys
from collections import defaultdict


MODEL_ENV = "HANLP_MODEL"
BATCH_SIZE_ENV = "HANLP_BOOTSTRAP_BATCH_SIZE"
MAX_SENT_CHARS_ENV = "HANLP_BOOTSTRAP_MAX_SENT_CHARS"
TASKS_ENV = "HANLP_BOOTSTRAP_TASKS"
SKIP_HEAVY_TASKS_ENV = "HANLP_BOOTSTRAP_SKIP_HEAVY_TASKS"

DEFAULT_BATCH_SIZE = 256
DEFAULT_MAX_SENT_CHARS = 220


sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))


def _fail(message):
    print(message, file=sys.stderr)
    return 1


def _read_positive_int(env_name, default):
    try:
        value = int(os.environ.get(env_name) or default)
    except ValueError:
        value = default
    return max(1, value)


def _env_flag(env_name, default=True):
    raw = os.environ.get(env_name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _load_model():
    try:
        import hanlp
        from hanlp.pretrained import mtl
    except Exception as exc:
        raise RuntimeError(f"Python HanLP package is not available: {exc}") from exc

    model_name = os.environ.get(MODEL_ENV) or mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH
    with contextlib.redirect_stdout(sys.stderr):
        return hanlp.load(model_name)


def _task_names(model):
    tasks = getattr(model, "tasks", None)
    if isinstance(tasks, dict):
        return list(tasks.keys())
    return []


def _configure_batch_size(model, batch_size):
    tasks = getattr(model, "tasks", None)
    if not isinstance(tasks, dict):
        return

    for task in tasks.values():
        sampler = getattr(task, "sampler_builder", None)
        if sampler is None or not hasattr(sampler, "batch_size"):
            continue
        try:
            sampler.batch_size = batch_size
        except Exception as exc:
            print(f"Warning: failed to set HanLP task batch_size: {exc}", file=sys.stderr)


def _select_tasks(model):
    configured = os.environ.get(TASKS_ENV, "auto").strip()
    if configured.lower() in {"", "all", "none"}:
        return None, None
    if configured.lower() != "auto":
        selected = [item.strip() for item in configured.split(",") if item.strip()]
        return selected or None, None

    names = _task_names(model)
    if not names:
        return None, None

    tok_tasks = [name for name in names if name.startswith("tok") or "/tok" in name or "tok/" in name]
    ner_tasks = [name for name in names if name.startswith("ner") or "/ner" in name or "ner/" in name]
    selected = []
    if tok_tasks:
        selected.append(tok_tasks[0])
    selected.extend(ner_tasks)

    if not selected:
        return None, None

    if not _env_flag(SKIP_HEAVY_TASKS_ENV, default=True):
        return selected, None

    keep = set(selected)
    skip_tasks = [name for name in names if name not in keep]
    return selected, skip_tasks or None


def _trimmed_segment(text, start, end):
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, text[start:end]


def _split_long_segment(text, start, end, max_chars):
    if end - start <= max_chars:
        yield start, text[start:end]
        return

    cursor = start
    soft_punctuation = "，,、"
    while cursor < end:
        chunk_end = min(end, cursor + max_chars)
        if chunk_end < end:
            split_at = -1
            floor = cursor + max_chars // 2
            for index in range(chunk_end - 1, floor - 1, -1):
                if text[index] in soft_punctuation:
                    split_at = index + 1
                    break
            if split_at > cursor:
                chunk_end = split_at

        segment_start, segment = _trimmed_segment(text, cursor, chunk_end)
        if segment:
            yield segment_start, segment
        cursor = chunk_end


def _split_text_for_hanlp(text, max_chars):
    segments = []
    start = 0
    punctuation = "。！？!?；;\n"
    for index, char in enumerate(text):
        if char not in punctuation:
            continue
        end = index + 1
        segment_start, segment = _trimmed_segment(text, start, end)
        if segment:
            segments.extend(_split_long_segment(text, segment_start, segment_start + len(segment), max_chars))
        start = end

    if start < len(text):
        segment_start, segment = _trimmed_segment(text, start, len(text))
        if segment:
            segments.extend(_split_long_segment(text, segment_start, segment_start + len(segment), max_chars))

    return segments or [(0, text)]


def _batched(items, batch_size):
    for start in range(0, len(items), batch_size):
        yield items[start:start + batch_size]


def _to_dict(doc):
    if hasattr(doc, "to_dict"):
        return doc.to_dict()
    if isinstance(doc, dict):
        return doc
    try:
        return dict(doc)
    except Exception:
        return {}


def _is_entity_tuple(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], str)
        and isinstance(value[1], str)
    )


def _is_batched_field(key, value, expected_count):
    if not isinstance(value, list) or len(value) != expected_count:
        return False
    if expected_count > 1:
        return True

    first = value[0] if value else None
    if str(key).startswith("tok"):
        return isinstance(first, (list, tuple))
    if str(key).startswith("ner"):
        return not _is_entity_tuple(first)
    return isinstance(first, (list, tuple, dict))


def _documents_from_batch(doc, expected_count):
    if isinstance(doc, (list, tuple)) and len(doc) == expected_count:
        return [_to_dict(item) for item in doc]

    data = _to_dict(doc)
    documents = [{} for _ in range(expected_count)]
    for key, value in data.items():
        if _is_batched_field(key, value, expected_count):
            for index, item in enumerate(value):
                documents[index][key] = item
        else:
            for document in documents:
                document[key] = value
    return documents


def _predict(model, batch_texts, tasks, skip_tasks):
    with contextlib.redirect_stdout(sys.stderr):
        if hasattr(model, "predict"):
            try:
                return model.predict(batch_texts, tasks=tasks, skip_tasks=skip_tasks)
            except TypeError:
                pass
            except Exception as exc:
                print(f"Warning: HanLP predict(tasks=...) failed: {exc}; falling back", file=sys.stderr)

        try:
            return model(batch_texts, tasks=tasks, skip_tasks=skip_tasks)
        except TypeError:
            return model(batch_texts)


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


def _ner_items_from_document(doc, text):
    data = _to_dict(doc)
    tokens = data.get("tok/fine") or data.get("tok/coarse") or data.get("tok") or []
    token_spans = _token_spans(tokens, text) if isinstance(tokens, list) else []
    items = []
    seen = set()

    for key, entries in data.items():
        if not str(key).startswith("ner") or not isinstance(entries, list):
            continue
        for entry in entries:
            if not _is_entity_tuple(entry):
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


def _build_group(items, entity_type, chapter_no):
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


def _run(text, chapter_no):
    batch_size = _read_positive_int(BATCH_SIZE_ENV, DEFAULT_BATCH_SIZE)
    max_sent_chars = _read_positive_int(MAX_SENT_CHARS_ENV, DEFAULT_MAX_SENT_CHARS)
    model = _load_model()
    _configure_batch_size(model, batch_size)
    tasks, skip_tasks = _select_tasks(model)

    items = []
    segments = _split_text_for_hanlp(text, max_sent_chars)
    for batch in _batched(segments, batch_size):
        batch_texts = [segment for _, segment in batch]
        doc = _predict(model, batch_texts, tasks, skip_tasks)
        for (offset, segment), document in zip(batch, _documents_from_batch(doc, len(batch))):
            items.extend(_shift_items(_ner_items_from_document(document, segment), offset))

    return {
        "people": _build_group(items, "person", chapter_no),
        "locations": _build_group(items, "location", chapter_no),
        "organizations": _build_group(items, "organization", chapter_no),
        "settings": _build_group(items, "setting", chapter_no),
    }


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
        output = _run(text, chapter_no)
    except Exception as exc:
        return _fail(f"HanLP bootstrap failed: {exc}")

    json.dump(output, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
