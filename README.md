# Browser Video Resizer

A lightweight, single-page video resizer inspired by online-video-cutter's resize tool.

## Features

- Upload a local video and preview it.
- Resize to presets or custom width/height.
- Choose fit mode:
  - **Contain** (letterbox/pillarbox)
  - **Cover** (crop to fill)
  - **Stretch**
- Encode and download an MP4 output.
- Runs locally in the browser using `ffmpeg.wasm`.

## Run

Because browsers block some features over `file://`, run a local web server:

```bash
python3 -m http.server 8080
```

Then open: `http://localhost:8080`

## Deploy

This project now vendors the required `ffmpeg.wasm` browser files under `vendor/ffmpeg/`, so it can be deployed as a static site on Vercel without serving `node_modules/`.

## What to do next

1. Open the app in your browser.
2. Upload a video file.
3. Pick a preset or custom width/height.
4. Choose fit mode (`contain`, `cover`, or `stretch`).
5. Click **Resize Video**.
6. Click **Download resized video** when processing finishes.

## Publish to GitHub

See `GITHUB_PUSH.md` for exact push commands.
