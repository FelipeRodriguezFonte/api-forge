const qs = new URLSearchParams(window.location.search);
const curlId = qs.get('id');

const curlTextEl = document.getElementById('curl-text');
const curlMeta = document.getElementById('curl-meta');
const curlSubtitle = document.getElementById('curl-subtitle');
const btnCopy = document.getElementById('btn-copy-curl');
const btnSave = document.getElementById('btn-save-curl');

async function init() {
  if (!window.app?.getCurl || !curlId) {
    curlTextEl.textContent = 'No hay datos.';
    return;
  }

  const entry = await window.app.getCurl(curlId);
  if (!entry) {
    curlTextEl.textContent = 'No hay datos.';
    return;
  }

  curlTextEl.textContent = entry.curl || '';
  curlMeta.textContent = entry.url || '';
  curlSubtitle.textContent = entry.name || 'Request';

  btnCopy.onclick = async () => {
    await window.app.writeClipboard(entry.curl || '');
    btnCopy.textContent = 'Copiado';
    setTimeout(() => (btnCopy.textContent = 'Copiar'), 1200);
  };

  if (btnSave) {
    btnSave.onclick = async () => {
      const safeName = (entry.name || 'request')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      await window.app.saveText({
        text: entry.curl || '',
        defaultName: `${safeName || 'request'}.curl`
      });
    };
  }
}

init();
