/* BibleCast: Whisper GPU Worker
 * Runs in a hidden BrowserWindow with nodeIntegration:true so it has access to
 * both Electron IPC and the Chromium WebGPU API.
 *
 * The main process tags every transcribe message with a numeric requestId so
 * it can route the result back to the right caller. We echo that id back on
 * both the success and error paths.
 */

let gpuPipeline = null;

window.electronAPI.on('whisper:gpu:transcribe', async ({ requestId, audioArray, modelId, cacheDir }) => {
  try {
    if (!gpuPipeline) {
      window.electronAPI.send('whisper:gpu:progress', { status: 'initiate' });
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = cacheDir;
      gpuPipeline = await pipeline(
        'automatic-speech-recognition',
        modelId || 'Xenova/whisper-small.en',
        {
          device: 'webgpu',
          progress_callback: p => window.electronAPI.send('whisper:gpu:progress', p),
        }
      );
    }
    const float32 = new Float32Array(audioArray);
    const result  = await gpuPipeline(float32, { language: 'english', task: 'transcribe' });
    window.electronAPI.send('whisper:gpu:result', { requestId, ok: true, text: result.text || '' });
  } catch (err) {
    console.error('[WhisperGPU]', err.message);
    // Reset pipeline so next attempt retries from scratch
    gpuPipeline = null;
    window.electronAPI.send('whisper:gpu:result', { requestId, ok: false, error: err.message });
  }
});

window.electronAPI.on('whisper:gpu:reset', () => {
  gpuPipeline = null;
});
