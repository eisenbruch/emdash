---
"emdash": patch
---

Fixes collection reads filtered to a list of ids walking the whole collection on SQLite once ANALYZE has run on a database with trashed entries. The ids are now always looked up by primary key.
