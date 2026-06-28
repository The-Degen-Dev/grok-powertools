# TODO

## Video/GIF Recreate Quality Hardening

Status: works end to end in Chrome, but output quality is not good enough yet.

Current proof:
- The workflow accepts the canonical Grok video post URL, generates a Grok Imagine Video prompt, submits to Video mode, and reaches `Generated video ready.`
- The generated post is playable video, so the core automation path is functional.

Known gap:
- Prompt and analysis quality still need work. The outputs can be technically valid videos while not preserving the reference motion, subject continuity, visual identity, framing, and overall intent well enough.

Follow-up scope:
- Improve Grok Imagine-specific video prompt context for photorealistic and motion-heavy references.
- Track prompt-version changes against output quality so Grok model changes and prompt changes are not conflated.
- Add a lightweight operator rating or notes field for generated results.
- Review whether contact sheets, frame metadata, source prompt text, or uploaded reference handling should be weighted differently for video/GIF prompts.
- Keep this separate from the next pressing feature unless it directly blocks that work.
