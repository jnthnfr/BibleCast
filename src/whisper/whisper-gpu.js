/* BibleCast — Whisper GPU Worker
 * Runs in a hidden BrowserWindow with nodeIntegration:true so it has access to
 * both Electron IPC and the Chromium WebGPU API.
 */

const { ipcRenderer } = require('electron');
let gpuPipeline = null;

ipcRenderer.on('whisper:gpu:transcribe', async (_e, { audioArray, modelId, cacheDir }) => {
  try {
    if (!gpuPipeline) {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = cacheDir;
      ipcRenderer.send('whisper:gpu:progress', { status: 'initiate' });
      gpuPipeline = await pipeline(
        'automatic-speech-recognition',
        modelId || 'Xenova/whisper-base.en',
        {
          device: 'webgpu',
          progress_callback: p => ipcRenderer.send('whisper:gpu:progress', p),
        }
      );
    }
    const float32 = new Float32Array(audioArray);
    const result  = await gpuPipeline(float32, { language: 'english', task: 'transcribe' });
    ipcRenderer.send('whisper:gpu:result', { ok: true, text: result.text || '' });
  } catch (err) {
    console.error('[WhisperGPU]', err.message);
    // Reset pipeline so next attempt retries from scratch
    gpuPipeline = null;
    ipcRenderer.send('whisper:gpu:result', { ok: false, error: err.message });
  }
});

ipcRenderer.on('whisper:gpu:reset', () => {
  gpuPipeline = null;
});
