---
"emdash": patch
---

Fixes taxonomy-filtered listings sorted by `updated_at` or a field reading the whole collection on D1. The plain join from #3300 now applies only to `published_at` and `created_at` sorts, where the query can stop at its limit; other sorts start from the term's assignments again.
