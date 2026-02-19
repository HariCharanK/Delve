"""Text chunking with paragraph/sentence-aware splitting and overlap."""


# Approximate chars per token for English text
CHARS_PER_TOKEN = 4

# Target ~400 tokens per chunk
TARGET_CHARS = 400 * CHARS_PER_TOKEN  # 1600
# Overlap ~80 tokens
OVERLAP_CHARS = 80 * CHARS_PER_TOKEN  # 320


def chunk_text(
    text: str,
    target_chars: int = TARGET_CHARS,
    overlap_chars: int = OVERLAP_CHARS,
) -> list[str]:
    """Split text into overlapping chunks using paragraph > sentence > hard split.

    Returns a list of chunk strings, each roughly `target_chars` long with
    `overlap_chars` of overlap between consecutive chunks.
    """
    if not text or not text.strip():
        return []

    # Split into paragraphs first
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    # Build chunks by accumulating paragraphs up to target size
    segments = _build_segments(paragraphs, target_chars)

    # Apply overlap
    chunks = _apply_overlap(segments, overlap_chars)

    return [c for c in chunks if c.strip()]


def _build_segments(paragraphs: list[str], target_chars: int) -> list[str]:
    """Accumulate paragraphs into segments of roughly target_chars."""
    segments: list[str] = []
    current: list[str] = []
    current_len = 0

    for para in paragraphs:
        para_len = len(para)

        # If a single paragraph exceeds target, split it further
        if para_len > target_chars:
            # Flush current buffer
            if current:
                segments.append("\n\n".join(current))
                current = []
                current_len = 0

            # Split long paragraph by sentences
            sub_segments = _split_long_text(para, target_chars)
            segments.extend(sub_segments)
            continue

        # Would adding this paragraph exceed target?
        join_cost = 2 if current else 0  # "\n\n" separator
        if current_len + join_cost + para_len > target_chars and current:
            segments.append("\n\n".join(current))
            current = []
            current_len = 0

        current.append(para)
        current_len += (2 if len(current) > 1 else 0) + para_len

    if current:
        segments.append("\n\n".join(current))

    return segments


def _split_long_text(text: str, target_chars: int) -> list[str]:
    """Split text that exceeds target by sentence boundaries, then hard split."""
    # Try sentence splitting (". " boundary)
    sentences = _split_sentences(text)

    segments: list[str] = []
    current: list[str] = []
    current_len = 0

    for sentence in sentences:
        s_len = len(sentence)

        # Single sentence too long → hard split
        if s_len > target_chars:
            if current:
                segments.append(" ".join(current))
                current = []
                current_len = 0
            # Hard split at target_chars boundaries
            for i in range(0, s_len, target_chars):
                segments.append(sentence[i : i + target_chars])
            continue

        join_cost = 1 if current else 0
        if current_len + join_cost + s_len > target_chars and current:
            segments.append(" ".join(current))
            current = []
            current_len = 0

        current.append(sentence)
        current_len += join_cost + s_len

    if current:
        segments.append(" ".join(current))

    return segments


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences at '. ' boundaries."""
    parts = text.split(". ")
    # Re-attach the period to each sentence except the last
    sentences = []
    for i, part in enumerate(parts):
        if i < len(parts) - 1:
            sentences.append(part + ".")
        else:
            sentences.append(part)
    return [s.strip() for s in sentences if s.strip()]


def _apply_overlap(segments: list[str], overlap_chars: int) -> list[str]:
    """Add overlap from end of previous chunk to start of next chunk."""
    if len(segments) <= 1:
        return segments

    chunks = [segments[0]]
    for i in range(1, len(segments)):
        prev = segments[i - 1]
        # Take the last overlap_chars from previous segment
        overlap = prev[-overlap_chars:] if len(prev) > overlap_chars else prev
        # Trim overlap to start at a word boundary
        space_idx = overlap.find(" ")
        if space_idx != -1:
            overlap = overlap[space_idx + 1 :]
        chunks.append(overlap + "\n\n" + segments[i])

    return chunks
