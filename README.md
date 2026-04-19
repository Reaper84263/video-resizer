# Video Resizer Queue

A lightweight frontend for large-file video resizing. The site runs on Vercel or any static host, uploads the source file to remote storage, and polls an external processing backend for completion.

## Features

- Upload a local video and preview it.
- Queue resize jobs for videos up to 10 GB on the frontend.
- Resize to presets or custom width/height.
- Choose fit mode:
  - **Contain** (letterbox/pillarbox)
  - **Cover** (crop to fill)
  - **Stretch**
- Poll a remote processor and download the finished output when the job completes.

## Run

Because browsers block some features over `file://`, run a local web server:

```bash
python3 -m http.server 8080
```

Then open: `http://localhost:8080`

## Deploy

This project is now a static frontend, so it can be deployed directly to Vercel. The site still needs a separate large-file backend for actual uploads and processing.

## Configure A Backend

Edit `config.js` and set `window.APP_CONFIG.apiBaseUrl` to your processing API.

The frontend currently expects this contract:

1. `POST {apiBaseUrl}/jobs`
   Send JSON:
   ```json
   {
     "input": {
       "filename": "clip.mp4",
       "size": 12345,
       "type": "video/mp4"
     },
     "output": {
       "width": 1280,
       "height": 720,
       "fitMode": "contain"
     }
   }
   ```

2. The backend responds with JSON like:
   ```json
   {
     "jobId": "job_123",
     "uploadUrl": "https://storage.example.com/presigned-put",
     "uploadMethod": "PUT",
     "uploadHeaders": {
       "Content-Type": "video/mp4"
     },
     "statusUrl": "https://api.example.com/jobs/job_123"
   }
   ```

3. The frontend uploads the file directly to `uploadUrl`.

4. `GET statusUrl` should return JSON with:
   ```json
   {
     "state": "queued"
   }
   ```
   or:
   ```json
   {
     "state": "processing",
     "message": "Transcoding 42%"
   }
   ```
   or:
   ```json
   {
     "state": "completed",
     "downloadUrl": "https://storage.example.com/output.mp4",
     "filename": "resized_1280x720.mp4"
   }
   ```
   or:
   ```json
   {
     "state": "failed",
     "error": "Transcoding failed"
   }
   ```

## What to do next

1. Open the app in your browser.
2. Upload a video file.
3. Pick a preset or custom width/height.
4. Choose fit mode (`contain`, `cover`, or `stretch`).
5. Click **Upload And Queue Resize**.
6. Wait for the remote processor to finish.
7. Click **Download processed video** when the job completes.

## Publish to GitHub

See `GITHUB_PUSH.md` for exact push commands.
