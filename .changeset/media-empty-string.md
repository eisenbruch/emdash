---
"emdash": patch
---

Fixes saving an entry turning an empty image or file field (`""`) into `{ "provider": "external", "id": "", "src": "" }`. An empty string is now left as it is, so entries with no image no longer change on every save.
