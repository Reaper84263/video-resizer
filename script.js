const { FFmpeg } = FFmpegWASM;
const { fetchFile } = FFmpegUtil;

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
const downloadLink = document.getElementById('downloadLink');

let ffmpeg;
let selectedFile;
let outputUrl;
let previewUrl;
let lastFfmpegMessage = '';
let ffmpegLogHistory = [];

const setStatus = (message) => {
  statusEl.textContent = message;
};

const clearObjectUrl = (url) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
};

const rememberFfmpegMessage = (message) => {
  if (!message) return;

  lastFfmpegMessage = message;

  const trimmed = message.trim();
  if (!trimmed) return;

  ffmpegLogHistory.push(trimmed);
  if (ffmpegLogHistory.length > 12) {
    ffmpegLogHistory = ffmpegLogHistory.slice(-12);
  }
};

const getLastMeaningfulLog = () => {
  for (let index = ffmpegLogHistory.length - 1; index >= 0; index -= 1) {
    const message = ffmpegLogHistory[index];
    if (
      message &&
      !message.includes('time=') &&
      !message.includes('frame=') &&
      !message.startsWith('video:')
    ) {
      return message;
    }
  }

  return lastFfmpegMessage;
};

const deleteTempFile = async (ff, path) => {
  try {
    await ff.deleteFile(path);
  } catch (_error) {
    // Ignore cleanup failures for files that were never created.
  }
};

const describeError = (error) => {
  if (!error) return '';
  if (typeof error === 'string') return error;

  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === 'object') {
    const candidates = [
      error.message,
      error.reason,
      error.type,
      error.name,
      error.target && error.target.src,
      error.currentTarget && error.currentTarget.src
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    try {
      return JSON.stringify(error);
    } catch (_jsonError) {
      return Object.prototype.toString.call(error);
    }
  }

  return String(error);
};

const formatErrorMessage = (error) => {
  const rawMessage = describeError(error) || getLastMeaningfulLog() || 'Unknown error';

  if (typeof rawMessage !== 'string') {
    return 'Resize failed. Please try a smaller MP4 or refresh the page.';
  }

  if (rawMessage.includes('SharedArrayBuffer')) {
    return 'Resize failed because this browser tab is missing SharedArrayBuffer support. Try Chrome or Edge over http://localhost.';
  }

  if (rawMessage.includes('ERR_REQUEST_RANGE_NOT_SATISFIABLE') || rawMessage.includes('Failed to fetch')) {
    return 'Resize failed while loading ffmpeg files. Refresh the page and try again.';
  }

  if (rawMessage.includes('Invalid data found when processing input')) {
    return 'Resize failed because the file could not be decoded. Try another video format or a different file.';
  }

  if (rawMessage.includes('Aborted')) {
    const detail = getLastMeaningfulLog();
    if (detail && detail !== rawMessage) {
      return `Resize failed: ${detail}`;
    }

    return 'Resize failed because the browser ran out of room while encoding. Try a smaller video or a smaller output size like 720p.';
  }

  if (rawMessage.includes('createObjectURL') || rawMessage.includes('blob:')) {
    return 'Resize failed while preparing FFmpeg in this browser tab. Refresh the page and try again.';
  }

  if (rawMessage.includes('404') || rawMessage.includes('ERR_ABORTED')) {
    return 'Resize failed because an FFmpeg file could not be loaded from the CDN. Refresh the page and try again.';
  }

  return `Resize failed: ${rawMessage}`;
};

const resetLoadedVideo = () => {
  clearObjectUrl(outputUrl);
  clearObjectUrl(previewUrl);
  outputUrl = undefined;
  previewUrl = undefined;
  downloadLink.classList.add('hidden');
};

const handleSelectedFile = (file) => {
  resetLoadedVideo();
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

  previewUrl = URL.createObjectURL(selectedFile);
  preview.src = previewUrl;
  previewWrap.classList.remove('hidden');
  resizeBtn.disabled = false;
  setStatus(`Loaded: ${selectedFile.name}`);
};

const getScaleFilter = ({ width, height, mode }) => {
  if (mode === 'stretch') {
    return `scale=${width}:${height}`;
  }

  if (mode === 'cover') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }

  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
};

const roundToEven = (value) => Math.max(32, Math.round(value / 2) * 2);

const getFallbackDimensions = (width, height) => {
  const maxEdge = 854;
  const longestEdge = Math.max(width, height);

  if (longestEdge <= maxEdge) {
    return { width, height };
  }

  const ratio = maxEdge / longestEdge;
  return {
    width: roundToEven(width * ratio),
    height: roundToEven(height * ratio)
  };
};

const buildEncodeArgs = ({
  inputName,
  outputName,
  width,
  height,
  mode,
  crf,
  preset,
  audioBitrate,
  frameRate,
  includeAudio
}) => {
  const args = [
    '-i',
    inputName,
    '-vf',
    getScaleFilter({ width, height, mode }),
    '-threads',
    '1',
    '-r',
    String(frameRate),
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p'
  ];

  if (includeAudio) {
    args.push('-c:a', 'aac', '-b:a', audioBitrate);
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', outputName);
  return args;
};

const isMemoryAbort = (error) => {
  const message = `${describeError(error)} ${getLastMeaningfulLog()}`.toLowerCase();
  return message.includes('aborted') || message.includes('memory') || message.includes('out of bounds');
};

const tryEncodeProfile = async (ff, profile) => {
  rememberFfmpegMessage(`Trying ${profile.label}...`);
  setStatus(profile.status);

  const exitCode = await ff.exec(
    buildEncodeArgs({
      inputName: profile.inputName,
      outputName: profile.outputName,
      width: profile.width,
      height: profile.height,
      mode: profile.mode,
      crf: profile.crf,
      preset: profile.preset,
      audioBitrate: profile.audioBitrate,
      frameRate: profile.frameRate,
      includeAudio: profile.includeAudio
    })
  );

  if (exitCode !== 0) {
    throw new Error(getLastMeaningfulLog() || `FFmpeg exited with code ${exitCode}`);
  }

  const data = await ff.readFile(profile.outputName);
  if (!(data instanceof Uint8Array) || data.byteLength === 0) {
    throw new Error('The resized video came back empty.');
  }

  return data;
};

const resizeWithFallbacks = async (ff, options) => {
  const reduced = getFallbackDimensions(options.width, options.height);
  const profiles = [
    {
      ...options,
      label: 'standard resize',
      status: 'Resizing video...',
      crf: 24,
      preset: 'ultrafast',
      audioBitrate: '96k',
      frameRate: 30,
      includeAudio: true,
      finalWidth: options.width,
      finalHeight: options.height
    },
    {
      ...options,
      label: 'memory saver resize',
      status: 'Retrying with memory saver settings...',
      crf: 30,
      preset: 'ultrafast',
      audioBitrate: '64k',
      frameRate: 24,
      includeAudio: false,
      finalWidth: options.width,
      finalHeight: options.height
    }
  ];

  if (reduced.width !== options.width || reduced.height !== options.height) {
    profiles.push({
      ...options,
      width: reduced.width,
      height: reduced.height,
      label: 'smaller fallback resize',
      status: `Retrying at a smaller size (${reduced.width}x${reduced.height})...`,
      crf: 30,
      preset: 'ultrafast',
      audioBitrate: '64k',
      frameRate: 24,
      includeAudio: false,
      finalWidth: reduced.width,
      finalHeight: reduced.height
    });
  }

  let lastError;

  for (const profile of profiles) {
    try {
      const data = await tryEncodeProfile(ff, profile);
      return {
        data,
        width: profile.finalWidth,
        height: profile.finalHeight,
        usedFallback: profile.label !== 'standard resize'
      };
    } catch (error) {
      lastError = error;
      await deleteTempFile(ff, profile.outputName);

      if (!isMemoryAbort(error)) {
        throw error;
      }
    }
  }

  throw lastError;
};

const loadFfmpeg = async () => {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    rememberFfmpegMessage(message);

    if (message && message.includes('time=')) {
      setStatus('Processing...');
    }
  });

  setStatus('Loading encoder (first run can take 10-20 seconds)...');
  const baseUrl = new URL('./vendor/ffmpeg', window.location.href).href;
  await ffmpeg.load({
    coreURL: `${baseUrl}/ffmpeg-core.js`,
    wasmURL: `${baseUrl}/ffmpeg-core.wasm`
  });

  return ffmpeg;
};

presetSelect.addEventListener('change', () => {
  if (presetSelect.value === 'custom') return;
  const [w, h] = presetSelect.value.split('x').map(Number);
  widthInput.value = w;
  heightInput.value = h;
});

videoInput.addEventListener('change', () => {
  handleSelectedFile(videoInput.files?.[0]);
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
  const file = event.dataTransfer?.files?.[0];
  handleSelectedFile(file);
});

resizeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  const width = Number(widthInput.value);
  const height = Number(heightInput.value);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) {
    setStatus('Width and height must be valid numbers above 32.');
    return;
  }

  resizeBtn.disabled = true;
  lastFfmpegMessage = '';
  ffmpegLogHistory = [];

  try {
    const ff = await loadFfmpeg();

    setStatus('Reading video...');
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const inputName = `input_${Date.now()}_${safeName}`;
    const outputName = `resized_${width}x${height}.mp4`;

    await ff.writeFile(inputName, await fetchFile(selectedFile));

    const result = await resizeWithFallbacks(ff, {
      inputName,
      outputName,
      width,
      height,
      mode: fitMode.value
    });

    clearObjectUrl(outputUrl);
    outputUrl = URL.createObjectURL(new Blob([result.data], { type: 'video/mp4' }));

    downloadLink.href = outputUrl;
    downloadLink.download = `resized_${result.width}x${result.height}.mp4`;
    downloadLink.classList.remove('hidden');

    if (result.usedFallback) {
      setStatus(`Done! Your resized video is ready. A lighter fallback mode was used (${result.width}x${result.height}).`);
    } else {
      setStatus('Done! Your resized video is ready to download.');
    }

    await deleteTempFile(ff, inputName);
    await deleteTempFile(ff, outputName);
  } catch (error) {
    console.error(error);
    setStatus(formatErrorMessage(error));
  } finally {
    resizeBtn.disabled = false;
  }
});
