# Rust Programming Language

## Memory Safety

Rust guarantees memory safety without a garbage collector. The ownership system
ensures that each value has a single owner, and the borrow checker verifies
references at compile time.

### Key Concepts

- **Ownership**: Each value in Rust has a variable that's called its owner.
- **Borrowing**: References allow you to refer to a value without taking ownership.
- **Lifetimes**: Rust uses lifetimes to ensure references are valid.

## Concurrency

Rust's type system prevents data races at compile time. The `Send` and `Sync`
traits mark types that can be safely transferred or shared between threads.

## Error Handling

Rust uses `Result<T, E>` for recoverable errors and `panic!` for unrecoverable ones.
The `?` operator makes error propagation concise and readable.
