# Machine Learning Fundamentals

## Embeddings

Embeddings are dense vector representations of data (text, images, etc.)
in a continuous vector space. Similar items are close together in this space,
enabling semantic search and retrieval.

Key embedding models:
- OpenAI text-embedding-3-small (1536 dims)
- Gemini embedding-001 (768 dims)
- Sentence-BERT (384 dims)

Cosine similarity is the standard metric for comparing embeddings:
```
similarity = dot(a, b) / (||a|| * ||b||)
```

## Transformer Architecture

The transformer introduced self-attention, allowing the model to weigh
the importance of different parts of the input. Key components:

1. Multi-head attention: attend to different representation subspaces
2. Positional encoding: inject sequence order information
3. Feed-forward networks: process attention outputs
4. Layer normalization: stabilize training

The attention formula: Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) * V

## Retrieval-Augmented Generation (RAG)

RAG combines retrieval with generation:
1. Index documents into a vector store
2. At query time, retrieve relevant chunks
3. Inject retrieved context into the LLM prompt
4. Generate a grounded response

This reduces hallucinations and keeps knowledge current without
retraining the model.

## Fine-tuning vs RAG

| Aspect | Fine-tuning | RAG |
|--------|------------|-----|
| Knowledge freshness | Static (training time) | Dynamic (retrieval time) |
| Cost | High (GPU hours) | Low (embedding + retrieval) |
| Hallucination risk | Medium | Low (grounded in docs) |
| Best for | Style/format changes | Knowledge-intensive tasks |
