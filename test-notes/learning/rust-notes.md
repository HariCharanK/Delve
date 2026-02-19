# Rust Language Notes

## Ownership and Borrowing

Rust's ownership system is the cornerstone of its memory safety guarantees.
Every value has exactly one owner. When the owner goes out of scope, the value
is dropped (freed). This eliminates use-after-free bugs entirely.

Borrowing rules:
- You can have either ONE mutable reference OR any number of immutable references
- References must always be valid (no dangling pointers)

```rust
fn main() {
    let s1 = String::from("hello");
    let s2 = &s1; // immutable borrow
    println!("{}", s2); // ok
    // s1 is still valid here
}
```

## Lifetimes

Lifetimes are Rust's way of ensuring references don't outlive the data
they point to. The compiler uses lifetime annotations to verify this
at compile time.

```rust
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

The `'a` annotation says: the returned reference will be valid for
as long as BOTH input references are valid.

## Error Handling

Rust uses `Result<T, E>` instead of exceptions. The `?` operator
provides ergonomic error propagation:

```rust
fn read_config() -> Result<Config, Box<dyn Error>> {
    let contents = fs::read_to_string("config.toml")?;
    let config: Config = toml::from_str(&contents)?;
    Ok(config)
}
```

## Async/Await

Rust's async runtime (tokio) provides zero-cost async abstractions.
Unlike Go's goroutines, Rust futures are lazy — they don't execute
until polled. This gives you fine-grained control over concurrency.
