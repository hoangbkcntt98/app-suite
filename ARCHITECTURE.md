# Application Architecture

New and refactored feature flows use:

```text
HTTP route -> one or more Services -> Repository -> Model
```

- Routes own HTTP parsing, status codes, and response serialization.
- Services own use cases, validation, policy, and orchestration. One request may call several services.
- Repositories own persistence and translate database rows to models.
- Models own feature types, invariants, and pure transformations. Models do not import services or repositories.
- Services may call other services and repositories. Repositories must not call services.

Feature code lives under `app/<feature>`, for example `app/video-creator/{models,repositories,services}`. Keep compatibility adapters in `lib` only while callers migrate; new route handlers should depend on services.

The Video Creator schedule endpoint is first migrated example. Apply same boundaries incrementally to other routes; keep URL behavior and public API contracts stable.
