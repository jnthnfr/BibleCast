/* BibleCast: operator-panel updater UI module
 *
 * Owns the in-app update banner and the "Check for updates" button. Talks
 * to the main process via api.checkForUpdates / api.downloadUpdate /
 * api.installUpdate and listens for state changes via api.onUpdaterEvent.
 *
 * Loaded before renderer.js so init() and bindEvents() can reference
 * checkForUpdates and initUpdaterEvents at the same global scope.
 */

async function checkForUpdates() {
  const statusEl = document.getElementById('update-status-text');
  if (statusEl) statusEl.textContent = 'Checking...';
  try {
    const result = await api.checkForUpdates();
    if (!result.ok && statusEl) statusEl.textContent = 'Check failed';
  } catch (e) {
    if (statusEl) document.getElementById('update-status-text').textContent = 'Check failed';
  }
}

function initUpdaterEvents() {
  api.onUpdaterEvent(data => {
    const statusEl   = document.getElementById('update-status-text');
    const banner     = document.getElementById('update-banner');
    const bannerTxt  = document.getElementById('update-banner-text');
    const dlBtn      = document.getElementById('update-download-btn');
    const dismissBtn = document.getElementById('update-dismiss-btn');

    switch (data.event) {
      case 'checking':
        if (statusEl) statusEl.textContent = 'Checking...';
        break;

      case 'not-available':
        if (statusEl) statusEl.textContent = `Up to date (v${data.version})`;
        break;

      case 'available':
        if (statusEl) statusEl.textContent = `v${data.version} available`;
        if (banner && bannerTxt) {
          bannerTxt.textContent = `BibleCast v${data.version} is available, click to download`;
          banner.style.display = 'flex';
          // "Download" button starts background download
          if (dlBtn) dlBtn.onclick = async () => {
            dlBtn.textContent = 'Downloading...';
            dlBtn.disabled = true;
            await api.downloadUpdate();
          };
          if (dismissBtn) dismissBtn.onclick = () => { banner.style.display = 'none'; };
        }
        break;

      case 'progress': {
        if (dlBtn) dlBtn.textContent = `Downloading... ${data.percent}%`;
        if (statusEl) statusEl.textContent = `Downloading ${data.percent}%`;
        break;
      }

      case 'downloaded':
        if (statusEl) statusEl.textContent = `v${data.version} ready, restart to install`;
        if (banner && bannerTxt) {
          bannerTxt.textContent = `v${data.version} downloaded, restart BibleCast to install`;
          banner.style.display = 'flex';
          if (dlBtn) {
            dlBtn.textContent = 'Restart & Install';
            dlBtn.disabled = false;
            dlBtn.onclick = () => api.installUpdate();
          }
        }
        break;

      case 'error':
        if (statusEl) statusEl.textContent = 'Update check failed';
        console.warn('[updater]', data.message);
        break;
    }
  });
}
