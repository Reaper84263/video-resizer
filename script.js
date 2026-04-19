const videoInput = document.getElementById('videoInput');
const dropZone = document.getElementById('dropZone');
const preview = document.getElementById('preview');
const previewWrap = document.getElementById('previewWrap');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const presetSelect = document.getElementById('preset');
const fitMode = document.getElementById('fitMode');
const resizeBtn = document.getElementById('resizeBtn');
const statusEl = document.getElementById('status');
const jobMetaEl = document.getElementById('jobMeta');
const downloadLink = document.getElementById('downloadLink');

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;

const APP_CONFIG = window.APP_CONFIG || {
  apiBaseUrl: '',
  createJobPath: '/jobs',
  defaultStatusPath: '/jobs/{jobId}',
  uploadMethod: 'PUT'
};

let selectedFile;
let previewUrl;
let activePollTimer;
let currentJobId;

const setStatus = (message) => {
  statusEl.textContent = message;
};

const setJobMeta = (message) => {
  if (message) {
    jobMetaEl.textContent = message;
    jobMetaEl.classList.remove('hidden');
  } else {
    jobMetaEl.textContent = '';
    jobMetaEl.classList.add('hidden');
  }
};

const clearObjectUrl = (url) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
};

const describeError = (error) => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;

  try {
    return JSON.stringify(error);
  } catch (_jsonError) {
    return String(error);
  }
};

const clearPolling = () => {
  if (activePollTimer) {
    clearTimeout(activePollTimer);
    activePollTimer = undefined;
  }
};

const resetDownloadState = () => {
  downloadLink.removeAttribute('href');
  downloadLink.classList.add('hidden');
};

const resetJobState = () => {
  clearPolling();
  currentJobId = undefined;
  setJobMeta('');
  resetDownloadState();
};

const applyPreset = (value) => {
  if (value === 'custom') return;
  const [w, h] = value.split('x').map(Number);
  widthInput.value = w;
  heightInput.value = h;
};

const getRequestUrl = (path) => {
  if (!APP_CONFIG.apiBaseUrl) return '';
  return new URL(path, APP_CONFIG.apiBaseUrl).href;
};

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response.json();
};

const updateSelectedFile = (file) => {
  resetJobState();
  selectedFile = file;

  if (!selectedFile) {
    preview.removeAttribute('src');
    previewWrap.classList.add('hidden');
    resizeBtn.disabled = true;
    setStatus('Load a video to begin.');
    return;
  }

  if (!selectedFile.type.startsWith('video/')) {
    selectedFile = undefined;
    videoInput.value = '';
    preview.removeAttribute('src');
    previewWrap.classList.add('hidden');
    resizeBtn.disabled = true;
    setStatus('Please drop or select a video file.');
    return;
  }

  if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
    const selectedSizeText = formatFileSize(selectedFile.size);
    const maxSizeText = formatFileSize(MAX_FILE_SIZE_BYTES);
    selectedFile = undefined;
    videoInput.value = '';
    preview.removeAttribute('src');
    previewWrap.classList.add('hidden');
    resizeBtn.disabled = true;
    setStatus(`This file is ${selectedSizeText}. The frontend cap is ${maxSizeText}.`);
    return;
  }

  clearObjectUrl(previewUrl);
  previewUrl = URL.createObjectURL(selectedFile);
  preview.src = previewUrl;
  previewWrap.classList.remove('hidden');
  resizeBtn.disabled = false;
  setStatus(`Loaded: ${selectedFile.name} (${formatFileSize(selectedFile.size)}).`);
  setJobMeta('Ready to create a remote processing job.');
};

const getResizePayload = () => {
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) {
    throw new Error('Width and height must be valid numbers above 32.');
  }

  return {
    width,
    height,
    fitMode: fitMode.value
  };
};

const createRemoteJob = async (file, resize) => {
  if (!APP_CONFIG.apiBaseUrl) {
    throw new Error(
      'No backend is configured yet. Set window.APP_CONFIG.apiBaseUrl and connect this frontend to a large-file processing service.'
    );
  }

  const url = getRequestUrl(APP_CONFIG.createJobPath);
  return requestJson(url, {
    method: 'POST',
    body: JSON.stringify({
      input: {
        filename: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream'
      },
      output: resize
    })
  });
};

const uploadFileToJob = (file, job) =>
  new Promise((resolve, reject) => {
    if (!job.uploadUrl) {
      reject(new Error('The backend did not return an uploadUrl.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const method = job.uploadMethod || APP_CONFIG.uploadMethod || 'PUT';

    xhr.open(method, job.uploadUrl, true);

    const headers = job.uploadHeaders || {};
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setStatus(`Uploading video... ${percent}%`);
    };

    xhr.onerror = () => reject(new Error('Upload failed.'));
    xhr.onabort = () => reject(new Error('Upload was cancelled.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}.`));
      }
    };

    xhr.send(file);
  });

const getStatusUrl = (job) => {
  if (job.statusUrl) return job.statusUrl;
  const template = APP_CONFIG.defaultStatusPath || '/jobs/{jobId}';
  return getRequestUrl(template.replace('{jobId}', job.jobId));
};

const pollJob = async (job) => {
  const statusUrl = getStatusUrl(job);
  if (!statusUrl) {
    throw new Error('No status URL is configured for this job.');
  }

  const payload = await requestJson(statusUrl, { method: 'GET', headers: {} });
  const state = payload.state || payload.status || 'unknown';

  if (payload.message) {
    setJobMeta(payload.message);
  } else {
    setJobMeta(`Job ${job.jobId}: ${state}`);
  }

  if (state === 'completed') {
    const downloadUrl = payload.downloadUrl || payload.outputUrl;
    if (!downloadUrl) {
      throw new Error('The job completed but no download URL was returned.');
    }

    downloadLink.href = downloadUrl;
    downloadLink.download = payload.filename || 'resized.mp4';
    downloadLink.classList.remove('hidden');
    setStatus('Done! Your processed video is ready to download.');
    return;
  }

  if (state === 'failed' || state === 'error') {
    throw new Error(payload.error || payload.message || 'The backend reported that processing failed.');
  }

  setStatus(`Processing remotely... ${state}`);
  activePollTimer = setTimeout(() => {
    pollJob(job).catch((error) => {
      resizeBtn.disabled = false;
      setStatus(`Resize failed: ${describeError(error)}`);
    });
  }, POLL_INTERVAL_MS);
};

const queueRemoteResize = async () => {
  if (!selectedFile) return;

  resizeBtn.disabled = true;
  resetDownloadState();
  clearPolling();

  try {
    const resize = getResizePayload();
    setStatus('Creating remote job...');
    const job = await createRemoteJob(selectedFile, resize);

    currentJobId = job.jobId || job.id;
    if (!currentJobId) {
      throw new Error('The backend did not return a job id.');
    }

    setJobMeta(`Job ${currentJobId} created. Upload target is ready.`);
    await uploadFileToJob(selectedFile, job);

    if (job.startUrl) {
      setStatus('Starting remote processing...');
      await requestJson(job.startUrl, {
        method: 'POST',
        body: JSON.stringify({ jobId: currentJobId })
      });
    }

    setStatus('Upload complete. Waiting for remote processor...');
    await pollJob({ ...job, jobId: currentJobId });
  } catch (error) {
    resizeBtn.disabled = false;
    setStatus(`Resize failed: ${describeError(error)}`);
    return;
  }

  resizeBtn.disabled = false;
};

presetSelect.addEventListener('change', () => {
  applyPreset(presetSelect.value);
});

videoInput.addEventListener('change', () => {
  updateSelectedFile(videoInput.files?.[0]);
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  });
});

['dragleave', 'dragend', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});

dropZone.addEventListener('drop', (event) => {
  updateSelectedFile(event.dataTransfer?.files?.[0]);
});

resizeBtn.addEventListener('click', () => {
  queueRemoteResize();
});
