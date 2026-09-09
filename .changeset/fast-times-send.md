---
"@emdash-cms/admin": patch
---

Fixes the new-entry form so boolean switches (and other field types) initialise from a field's `defaultValue`. Untouched toggles now save the declared default instead of `false`.
