# Meeting Notes

## 2026-02-10 — Architecture Review

Discussed the internal review of the search infrastructure. Key decisions:

- Move from PostgreSQL full-text search to a hybrid approach
- Use embeddings for semantic matching alongside keyword search
- Evaluate sqlite-vec as a lightweight alternative to Pinecone
- Timeline: prototype by end of February

Action items:
- [ ] Benchmark sqlite-vec vs pgvector for our dataset size
- [ ] Set up embedding pipeline with Gemini API
- [x] Review OpenClaw's memory architecture for inspiration

## 2026-02-14 — Sprint Planning

Winter deployment schedule finalized. The team agreed on:

- Feature freeze: March 1st
- QA window: March 1-7
- Production release: March 10th

Performance targets:
- Search latency < 50ms for 10k documents
- Indexing throughput > 100 docs/second
- Memory footprint < 200MB for the search service

## 2026-02-18 — Debugging Session

Investigated the intermittent timeout issue in the API gateway.
Root cause: connection pool exhaustion under high concurrency.
Fix: increase pool size from 10 to 50, add circuit breaker pattern.

The interesting thing about connection pooling is that it mirrors
the producer-consumer pattern from operating systems. Each connection
is a shared resource that must be carefully managed.
