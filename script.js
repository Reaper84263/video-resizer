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

const setStatus = (message) => {
  statusEl.textContent = message;
};

const clearObjectUrl = (url) => {
  if (url) {
    URL.revokeObjectURL(url);
  }
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
  const rawMessage = describeError(error) || lastFfmpegMessage || 'Unknown error';

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

const loadFfmpeg = async () => {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    if (message) {
      lastFfmpegMessage = message;
    }

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

  try {
    const ff = await loadFfmpeg();

    setStatus('Reading video...');
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const inputName = `input_${Date.now()}_${safeName}`;
    const outputName = `resized_${width}x${height}.mp4`;

    await ff.writeFile(inputName, await fetchFile(selectedFile));

    const vf = getScaleFilter({ width, height, mode: fitMode.value });

    setStatus('Resizing video...');
    const exitCode = await ff.exec([
      '-i',
      inputName,
      '-vf',
      vf,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '22',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outputName
    ]);

    if (exitCode !== 0) {
      throw new Error(lastFfmpegMessage || `FFmpeg exited with code ${exitCode}`);
    }

    const data = await ff.readFile(outputName);

    if (!(data instanceof Uint8Array) || data.byteLength === 0) {
      throw new Error('The resized video came back empty.');
    }

    clearObjectUrl(outputUrl);
    outputUrl = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));

    downloadLink.href = outputUrl;
    downloadLink.download = outputName;
    downloadLink.classList.remove('hidden');

    setStatus('Done! Your resized video is ready to download.');

    await deleteTempFile(ff, inputName);
    await deleteTempFile(ff, outputName);
  } catch (error) {
    console.error(error);
    setStatus(formatErrorMessage(error));
  } finally {
    resizeBtn.disabled = false;
  }
});
