"""Text splitting: paragraphs first, sentences as a fallback, with overlap, without breaking sentences apart."""
from __future__ import annotations

import re

_SENTENCE_TERMINALS = "。！？…；;.!?"
# Paragraph boundary: consecutive blank lines (tolerating Windows line endings and full-width spaces)
_PARAGRAPH_RE = re.compile(r"\r?\n[ \t　]*\r?\n+")


def split_sentences(text: str) -> list[str]:
    """Sentence splitting for mixed Chinese/English text: split after sentence-final punctuation; an English period must be followed by whitespace or the end.

    Every returned sentence is a contiguous substring of the original text (after strip).
    """
    if not text:
        return []
    sentences: list[str] = []
    start = 0
    i = 0
    n = len(text)
    while i < n:
        char = text[i]
        if char in _SENTENCE_TERMINALS:
            j = i + 1
            while j < n and text[j] in _SENTENCE_TERMINALS:
                j += 1
            if char == "." and j < n and not text[j].isspace():
                i += 1
                continue  # a decimal point or an abbreviation, so do not break the sentence
            while j < n and text[j].isspace():
                j += 1
            segment = text[start:j].strip()
            if segment:
                sentences.append(segment)
            start = j
            i = j
        else:
            i += 1
    tail = text[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def join_sentences(sentences: list[str]) -> str:
    """Rejoin at boundaries: insert a space when two ASCII alphanumerics become adjacent, concatenate everything else directly."""
    result = ""
    for sentence in sentences:
        if not sentence:
            continue
        if (
            result
            and not result[-1].isspace()
            and not sentence[0].isspace()
            and result[-1].isascii()
            and result[-1].isalnum()
            and sentence[0].isascii()
            and sentence[0].isalnum()
        ):
            result += " "
        result += sentence
    return result


def _tail_boundary(text: str, overlap: int) -> str:
    """Take the last overlap characters of the text as the overlap, cutting from a word/sentence boundary where possible."""
    if overlap <= 0 or not text:
        return ""
    if len(text) <= overlap:
        return text
    tail = text[-overlap:]
    # Look for the nearest boundary (whitespace/punctuation) within the first 1/3, so the cut does not fall in the middle of a word
    window = tail[: max(1, len(tail) // 3)]
    candidates = [tail.find(ch, len(window) // 2) for ch in " \n。！？.!?\t，,；;"]
    cuts = [pos for pos in candidates if pos > 0]
    if cuts:
        tail = tail[min(cuts):]
    return tail.strip()


def _pack_long(paragraph: str, max_chars: int) -> list[str]:
    """Group an over-long paragraph by sentences, preferring whole sentences; only a single over-limit sentence degrades to a fixed-length hard cut."""
    pieces: list[str] = []
    buffer = ""
    for sentence in split_sentences(paragraph):
        if len(sentence) > max_chars:  # extreme case: a single sentence longer than the whole chunk
            if buffer:
                pieces.append(buffer)
                buffer = ""
            pieces.extend(
                sentence[k : k + max_chars] for k in range(0, len(sentence), max_chars)
            )
            continue
        candidate = f"{buffer}{sentence}" if not buffer else join_sentences([buffer, sentence])
        if len(candidate) <= max_chars:
            buffer = candidate
        else:
            if buffer:
                pieces.append(buffer)
            buffer = sentence
    if buffer:
        pieces.append(buffer)
    return pieces


def chunk_text(text: str, max_chars: int = 1200, overlap: int = 150) -> list[str]:
    """Paragraph-first greedy packing: paragraphs become chunks, over-long paragraphs are split by sentence; chunks carry overlap.

    Every chunk is contiguous original content (apart from the overlap); empty text returns [].
    """
    if not text or not text.strip() or max_chars <= 0:
        return []
    overlap = max(0, min(overlap, max_chars - 1))

    paragraphs = [p.strip() for p in _PARAGRAPH_RE.split(text) if p.strip()]
    pieces: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            pieces.append(paragraph)
        else:
            pieces.extend(_pack_long(paragraph, max_chars))

    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        if not buffer:
            buffer = piece
            continue
        separator = "\n\n"
        if len(buffer) + len(separator) + len(piece) <= max_chars:
            buffer = buffer + separator + piece
            continue
        chunks.append(buffer)
        tail = _tail_boundary(buffer, overlap)
        # The overlapping run and the next chunk are joined with the original paragraph separator, so the chunk stays a contiguous slice of the original
        while tail and len(tail) + 2 + len(piece) > max_chars:
            tail = _tail_boundary(buffer, len(tail) // 2)
        buffer = f"{tail}\n\n{piece}" if tail else piece
    if buffer:
        chunks.append(buffer)
    return [chunk for chunk in chunks if chunk.strip()]
