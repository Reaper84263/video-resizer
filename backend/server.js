const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DATA_ROOT = path.join(__dirname, 'data');
const JOBS_DIR = path.join(DATA_ROOT, 'jobs');
const INPUTS_DIR = path.join(DATA_ROOT, 'inputs');
const OUTPUTS_DIR = path.join(DATA_ROOT, 'outputs');
const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Packages',
    'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'ffmpeg-8.1-full_build',
    'bin',
    'ffmpeg.exe'
  ),
  'ffmpeg'
].filter(Boolean);

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload, null, 2));
};

const sendText = (res, statusCode, message) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(message);
};

const sanitizeFilename = (name) => {
  const safe = (name || 'upload.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'upload.mp4';
};

const resolveFfmpegPath = async () => {
  for (const candidate of FFMPEG_CANDIDATES) {
    try {
      if (candidate !== 'ffmpeg') {
        await fsp.access(candidate);
      }
      return candidate;
    } catch (_error) {
      // Try next candidate.
    }
  }

  return 'ffmpeg';
};

const ensureDirectories = async () => {
  await Promise.all([
    fsp.mkdir(JOBS_DIR, { recursive: true }),
    fsp.mkdir(INPUTS_DIR, { recursive: true }),
    fsp.mkdir(OUTPUTS_DIR, { recursive: true })
  ]);
};

const jobPath = (jobId) => path.join(JOBS_DIR, `${jobId}.json`);

const readJob = async (jobId) => {
  const raw = await fsp.readFile(jobPath(jobId), 'utf8');
  return JSON.parse(raw);
};

const writeJob = async (job) => {
  await fsp.writeFile(jobPath(job.id), JSON.stringify(job, null, 2));
};

const createScaleFilter = ({ width, height, fitMode }) => {
  if (fitMode === 'stretch') {
    return `scale=${width}:${height}`;
  }

  if (fitMode === 'cover') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }

  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
};

const markJob = async (jobId, patch) => {
  const job = await readJob(jobId);
  const next = {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeJob(next);
  return next;
};

const processJob = async (jobId) => {
  let job = await markJob(jobId, {
    state: 'processing',
    message: 'FFmpeg worker started.'
  });
  const ffmpegPath = await resolveFfmpegPath();

  const ffmpegArgs = [
    '-y',
    '-i',
    job.inputPath,
    '-vf',
    createScaleFilter(job.output),
    '-threads',
    '2',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    job.outputPath
  ];

  const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
    windowsHide: true
  });

  let stderr = '';

  ffmpeg.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  ffmpeg.on('error', async (error) => {
    await markJob(jobId, {
      state: 'failed',
      message: 'FFmpeg could not be started.',
      error:
        error.code === 'ENOENT'
          ? 'FFmpeg is not available to the backend process. Set FFMPEG_PATH or restart the backend shell after installation.'
          : error.message
    });
  });

  ffmpeg.on('close', async (code) => {
    if (code === 0) {
      await markJob(jobId, {
        state: 'completed',
        message: 'Processing complete.',
        downloadUrl: `${BASE_URL}/downloads/${jobId}`,
        filename: path.basename(job.outputPath)
      });
      return;
    }

    const lastLine =
      stderr
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-1)[0] || 'FFmpeg exited with a non-zero code.';

    await markJob(jobId, {
      state: 'failed',
      message: 'Processing failed.',
      error: lastLine
    });
  });
};

const collectJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });

const handleCreateJob = async (req, res) => {
  const payload = await collectJsonBody(req);
  const input = payload.input || {};
  const output = payload.output || {};

  if (!input.filename || !Number.isFinite(input.size) || input.size <= 0) {
    json(res, 400, { error: 'A valid input filename and size are required.' });
    return;
  }

  if (!Number.isFinite(output.width) || !Number.isFinite(output.height)) {
    json(res, 400, { error: 'A valid output width and height are required.' });
    return;
  }

  const jobId = `job_${crypto.randomUUID()}`;
  const safeInputName = sanitizeFilename(input.filename);
  const inputPath = path.join(INPUTS_DIR, `${jobId}_${safeInputName}`);
  const outputPath = path.join(OUTPUTS_DIR, `${jobId}_resized_${output.width}x${output.height}.mp4`);

  const job = {
    id: jobId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: 'waiting_for_upload',
    message: 'Upload target created.',
    input: {
      filename: safeInputName,
      size: input.size,
      type: input.type || 'application/octet-stream'
    },
    output: {
      width: output.width,
      height: output.height,
      fitMode: output.fitMode || 'contain'
    },
    inputPath,
    outputPath
  };

  await writeJob(job);

  json(res, 201, {
    jobId,
    uploadUrl: `${BASE_URL}/uploads/${jobId}`,
    uploadMethod: 'PUT',
    uploadHeaders: {
      'Content-Type': input.type || 'application/octet-stream'
    },
    statusUrl: `${BASE_URL}/jobs/${jobId}`
  });
};

const handleUpload = async (req, res, jobId) => {
  const job = await readJob(jobId);

  if (job.state !== 'waiting_for_upload') {
    json(res, 409, { error: 'This job is not ready for upload.' });
    return;
  }

  await markJob(jobId, {
    state: 'uploading',
    message: 'Upload in progress.'
  });

  await fsp.mkdir(path.dirname(job.inputPath), { recursive: true });

  const fileStream = fs.createWriteStream(job.inputPath);

  req.pipe(fileStream);

  fileStream.on('error', async () => {
    await markJob(jobId, {
      state: 'failed',
      message: 'Upload failed.',
      error: 'Could not write the uploaded file to disk.'
    });
    sendText(res, 500, 'Upload failed.');
  });

  fileStream.on('finish', async () => {
    await markJob(jobId, {
      state: 'queued',
      message: 'Upload complete. Waiting for FFmpeg.'
    });

    sendText(res, 200, 'Upload complete.');
    processJob(jobId).catch(async (error) => {
      await markJob(jobId, {
        state: 'failed',
        message: 'Processing failed.',
        error: error.message
      });
    });
  });
};

const handleGetJob = async (res, jobId) => {
  const job = await readJob(jobId);

  json(res, 200, {
    jobId: job.id,
    state: job.state,
    message: job.message,
    error: job.error,
    downloadUrl: job.downloadUrl,
    filename: job.filename
  });
};

const handleDownload = async (res, jobId) => {
  const job = await readJob(jobId);

  if (job.state !== 'completed' || !job.outputPath) {
    json(res, 404, { error: 'Output is not ready yet.' });
    return;
  }

  const stat = await fsp.stat(job.outputPath);
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${job.filename || path.basename(job.outputPath)}"`,
    'Access-Control-Allow-Origin': '*'
  });

  fs.createReadStream(job.outputPath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 400, { error: 'Missing URL.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    const url = new URL(req.url, BASE_URL);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      json(res, 200, {
        ok: true,
        ffmpegCandidates: FFMPEG_CANDIDATES,
        note: 'The backend is running. Processing uses ffmpeg from PATH or FFMPEG_PATH, with a WinGet fallback on this machine.'
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/jobs') {
      await handleCreateJob(req, res);
      return;
    }

    if (req.method === 'PUT' && pathname.startsWith('/uploads/')) {
      const jobId = pathname.split('/').pop();
      await handleUpload(req, res, jobId);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/jobs/')) {
      const jobId = pathname.split('/').pop();
      await handleGetJob(res, jobId);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/downloads/')) {
      const jobId = pathname.split('/').pop();
      await handleDownload(res, jobId);
      return;
    }

    json(res, 404, { error: 'Route not found.' });
  } catch (error) {
    const message = error && error.code === 'ENOENT' ? 'Job not found.' : error.message;
    json(res, error && error.code === 'ENOENT' ? 404 : 500, { error: message });
  }
});

ensureDirectories()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Video backend listening on ${BASE_URL}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start backend:', error);
    process.exitCode = 1;
  });
