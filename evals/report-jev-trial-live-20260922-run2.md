# Jev offline trial — live-jev

- cases: 18
- corpus size: 284
- theoretical chance top-1 rate (reference, any ranker): 25.9%
- top-1 hit rate: 94.4%
- top-3 hit rate: 100.0%
- MRR: 0.972
- Brier score: 0.055
- billed input tokens: 20129 (about $0.000845 at $42 per billion)
- pipeline commit: `3c212e592ce8f70a6bf6ea7e278a5958d23582c5`
- curated cases sha256: `acaba7471870d6b7e561ac47a9a661178ca2e39d900c5a04df9b84f84da59247`

## Reliability bins (confidence vs. empirical hit rate)

| range | n | mean confidence | empirical hit rate |
|---|---|---|---|
| [0.0, 0.2) | 0 | - | - |
| [0.2, 0.4) | 0 | - | - |
| [0.4, 0.6) | 3 | 0.49 | 0.67 |
| [0.6, 0.8) | 2 | 0.72 | 1.00 |
| [0.8, 1.0) | 13 | 0.98 | 1.00 |

## Cases that missed top-1

- `optimization-qaoa-benchmark`: ranked ['qaoa-maxcut-ring', 'benchmark-qaoa-ring-16q', 'benchmark-qaoa-ring-3q']...

note: LIVE run: spent real TypeSafe AI tokens
