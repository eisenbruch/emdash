---
"emdash": patch
"@emdash-cms/cloudflare": patch
---

Fixes the `/_emdash/api/media/file/{key}` route so it honors single-range `Range` requests and returns `206 Partial Content` with `Content-Range` and `Accept-Ranges: bytes`. Video and audio served from the media library can now seek and play in Safari, which probes with `bytes=0-1`. The local, S3, and R2 storage adapters now support optional byte-range reads so the full file is no longer buffered for partial requests.
