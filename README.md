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

To run the backend locally in a second terminal:

```bash
npm run backend
```

The frontend auto-connects to `http://localhost:3001` when opened from `localhost` or `127.0.0.1`.

## Fastest Working Path On Windows

If native Node child-process spawning is blocked on your Windows setup, the fastest reliable path is Docker.

1. Install Docker Desktop.
2. From the repo root, run:
   ```bash
   docker compose up --build
   ```
3. Open:
   - frontend: `http://localhost:8080`
   - backend health: `http://localhost:3001/health`

This runs the backend in a Linux container with `ffmpeg` installed, which avoids the local Windows `spawn EPERM` problem.

## Deploy

This project is now a static frontend plus a local/backend scaffold. The frontend can still be deployed directly to Vercel, but actual uploads and processing require a separate backend service.

## Configure A Backend

Edit `config.js` and set `window.APP_CONFIG.apiBaseUrl` to your processing API.

## Local Backend Notes

The backend scaffold lives in [backend/server.js](/c:/Users/bgian/OneDrive/Documents/GitHub/video-resizer/backend/server.js:1).

It currently:

- creates jobs with `POST /jobs`
- accepts raw file uploads with `PUT /uploads/:jobId`
- tracks job state with `GET /jobs/:jobId`
- serves completed outputs with `GET /downloads/:jobId`
- runs native `ffmpeg` on the backend machine after upload completes

Important:

- `ffmpeg` must be installed on the backend machine and available on `PATH`
- uploads are stored on local disk under `backend/data/`
- this is a good local/dev scaffold, not a final production storage design for Vercel
- Docker support is included via `compose.yaml`, `backend/Dockerfile`, and `frontend/Dockerfile`

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

## Production Direction

For a true large-file deployment, the next step is replacing local disk storage with object storage and moving the processor to a real server or worker environment. A practical setup is:

1. Vercel frontend
2. backend API on a VM/container
3. S3-compatible object storage
4. FFmpeg worker that reads from storage and writes the output back

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
