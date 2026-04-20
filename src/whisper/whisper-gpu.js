/* BibleCast — Whisper GPU Worker
 * Runs in a hidden BrowserWindow with nodeIntegration:true so it has access to
 * both Electron IPC and the Chromium WebGPU API.
 */

let gpuPipeline = null;

window.electronAPI.on('whisper:gpu:transcribe', async ({ audioArray, modelId, cacheDir }) => {
  try {
    if (!gpuPipeline) {
      window.electronAPI.send('whisper:gpu:progress', { status: 'initiate' });
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = cacheDir;
      gpuPipeline = await pipeline(
        'automatic-speech-recognition',
        modelId || 'Xenova/whisper-base.en',
        {
          device: 'webgpu',
          progress_callback: p => window.electronAPI.send('whisper:gpu:progress', p),
        }
      );
    }
    const float32 = new Float32Array(audioArray);
    const result  = await gpuPipeline(float32, { language: 'english', task: 'transcribe' });
    window.electronAPI.send('whisper:gpu:result', { ok: true, text: result.text || '' });
  } catch (err) {
    console.error('[WhisperGPU]', err.message);
    // Reset pipeline so next attempt retries from scratch
    gpuPipeline = null;
    window.electronAPI.send('whisper:gpu:result', { ok: false, error: err.message });
  }
});

window.electronAPI.on('whisper:gpu:reset', () => {
  gpuPipeline = null;
});
