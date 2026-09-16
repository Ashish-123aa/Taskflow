# File Handling

Added in Phase 4, alongside the CSV and image processing handlers, which
are the first job types that involve files at all.

## Safe filenames, not client-trusted ones

`apps/api/src/middleware/upload.ts` never uses the client-supplied
filename to build a path on disk. The stored filename is always a fresh
`crypto.randomUUID()` plus the file's extension; the original filename is
kept only as display metadata in the job's payload
(`originalFilename`), never passed anywhere near `fs`. This is the actual
defense against path traversal (section 35: "do not trust the filename
supplied by the client") — a client sending a file named
`../../etc/passwd` or containing shell-meaningful characters can't
influence where anything gets written, because their filename is never
used as a path component at all.

## Why CSV and image uploads are two separate multer instances

`uploadCsv` and `uploadImage` (both in `middleware/upload.ts`) are
separately configured multer instances with their own `fileFilter`,
rather than one generic "upload anything" endpoint that inspects a
`type` field to decide what MIME types to allow. Multer parses a
multipart form's fields and file in whatever order the client sent them,
so a single endpoint can't reliably know "what type is this upload
supposed to be" *before* the file itself arrives and needs to be
filtered. Two endpoints (`POST /jobs/upload/csv`, `POST /jobs/upload/image`)
each with a fixed, correct set of allowed MIME types sidesteps that
ordering problem entirely.

## Why the API and worker share a Docker volume for uploads

The API's upload endpoints write the file; the worker's `CSV_PROCESSING`
and `IMAGE_PROCESSING` handlers read it back by the same stored filename.
Since the API and worker are separate containers/processes (that's the
whole point of the architecture — see `docs/architecture.md`), they need
to actually share the same filesystem location for this to work. In
`docker-compose.yml`, both services mount the same named volume
(`taskflow-uploads-data`) at `/app/uploads`, with `UPLOAD_DIR` pointed at
it in both. Locally (outside Docker), both processes just point
`UPLOAD_DIR` at the same relative path on the host, which works the same
way without a volume because there's only one filesystem involved.

Generated output (a report's CSV, a processed image) is written back into
a `generated/` subfolder of that same shared directory, so
`GET /jobs/:id/download` on the API side can find and serve whatever the
worker produced, without needing any additional plumbing between the two
processes.

## What's validated, and when

- **At upload time** (`middleware/upload.ts`): file size (`MAX_UPLOAD_SIZE_MB`)
  and MIME type/extension, before anything is even written to disk for
  the wrong kind of file.
- **At job creation time** (`jobService.createJob`, via
  `JOB_PAYLOAD_SCHEMAS`): the payload shape built from the uploaded
  file's metadata is validated like any other job type's payload — see
  `docs/worker-system.md`.
- **At processing time** (the handler itself): does the file referenced
  by `storedFilename` actually still exist on disk. If not — deleted,
  never landed on the shared volume, whatever the cause — the handler
  throws `NonRetryableJobError`, since the file isn't going to reappear
  on a retry.

## Known gap: no cleanup lifecycle yet

Uploaded and generated files are never deleted once a job completes or is
removed. For a real production deployment this needs a retention policy
(e.g. delete files for jobs older than N days, or when a job's `DELETE`
endpoint is called) — not implemented yet, tracked as a future
improvement rather than silently left out.
