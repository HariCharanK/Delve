"""Text chunking — one non-empty line per chunk."""


def chunk_text(text: str) -> list[str]:
    """Split text into chunks, one per non-empty line.

    Returns a list of stripped, non-empty lines.
    """
    if not text or not text.strip():
        return []

    return [line.strip() for line in text.splitlines() if line.strip()]
