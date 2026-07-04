# Movie Maker Export Engine Decision

Date: 2026-06-28

Decision: Use FFmpeg.wasm single-thread as the Phase 1 export engine.

Why:

- Phase 1 needs reliable MP4 with AAC audio proof more than a larger editor engine.
- FFmpeg.wasm is already in the web app dependency graph.
- Single-thread FFmpeg.wasm avoids cross-origin isolation and SharedArrayBuffer work.
- MediaRecorder remains a WebM fallback only.

Rejected for Phase 1:

- Remotion server rendering, because local-only Phase 1 must not introduce a hidden server or licensing decision.
- FFmpeg.wasm multithread, because cross-origin isolation and SharedArrayBuffer were not part of this phase.
- WebCodecs without Mediabunny or another muxer, because WebCodecs alone does not produce MP4 containers.
- WebCodecs plus Mediabunny as the default engine, because the conservative FFmpeg.wasm path is already present and the same-fixture browser proof belongs in a separate spike unless Phase 1 export fails.

Proof:

- Fixture: `tests/e2e-web/fixtures/tiny-video-with-audio.mp4`
- Fixture audio proof: `aac`
- Local FFmpeg round-trip output: `/tmp/grok-movie-export-spike/ffmpeg-output.mp4`
- Local FFmpeg round-trip audio proof: `aac`
- Local FFmpeg round-trip duration: `1.514000`
- Local FFmpeg round-trip size: `26195`
- Browser export proof: must be completed in Task 10 E2E before final validation.

Versions checked on 2026-06-28:

- `@ffmpeg/core`: `0.12.10`
- `@ffmpeg/core-mt`: `0.12.10`
- `@ffmpeg/ffmpeg`: `0.12.15`
- `mediabunny`: `1.49.0`
- `remotion`: `4.0.484`

Fallback:

- Keep WebM export available.
- Pause if MP4 with AAC audio cannot be proven in browser with the fixture media.
