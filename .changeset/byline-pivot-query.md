---
"emdash": patch
---

Make byline-only collection filters drive from the `_emdash_content_bylines` pivot instead of scanning the whole `ec_*` table. Migration `075_content_bylines_denorm` denormalizes `status`, `deleted_at`, `locale`, `published_at`, and `created_at` from each content row onto its byline credits and adds covering indexes keyed by `(byline_id, collection_slug, ...)`. The loader now uses a pivot CTE for byline-only filters, short-circuiting on `LIMIT` and touching `ec_*` only by primary key. Combined byline+taxonomy continues to use the taxonomy pivot; byline+field filters fall back to the single-table shape.
