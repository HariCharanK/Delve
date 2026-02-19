# Project Ideas

## Local-first search engine

Build an interesting approach to full-text search that works entirely offline.
The key insight is combining trigram-based substring matching with vector
embeddings for semantic understanding. This gives you the best of both worlds:
exact matches when you remember the specific term, and fuzzy semantic matches
when you only remember the concept.

## Interactive dashboard

Create an interactive data visualization dashboard using D3.js and React.
The dashboard should support real-time streaming data and allow users to
drill down into specific metrics. Consider using WebSockets for live updates.

## Memory-safe systems programming

Explore Rust's borrow checker and memory safety guarantees. The ownership
model prevents data races at compile time, which is fascinating for building
concurrent systems. Need to understand lifetimes better — they're the most
confusing part of the language.

## Distributed consensus

Study the Raft consensus algorithm and implement a simple version.
Key concepts: leader election, log replication, and safety properties.
Compare with Paxos which is theoretically elegant but harder to implement.
