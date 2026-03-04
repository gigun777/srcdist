/**
 * backup/file_io.js
 *
 * Purpose:
 * - Small browser helpers for the Backup Manager.
 *
 * API:
 *   downloadBlob(blob, filename)
 *   pickFile({ accept }) -> Promise<File|null>
 */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function pickFile({ accept } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '*/*';
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.top = '0';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.style.zIndex = '1000000';
    document.body.appendChild(input);

    let done = false;
    const onFocusBack = async () => {
      setTimeout(() => {
        const file = (input.files && input.files[0]) ? input.files[0] : null;
        finish(file);
      }, 250);
    };

    const finish = async (file) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocusBack, true);
      try { input.remove(); } catch (_) {}
      resolve(file || null);
    };

    input.onchange = async () => {
      const file = (input.files && input.files[0]) ? input.files[0] : null;
      finish(file);
    };

    window.addEventListener('focus', onFocusBack, true);
    input.click();
  });
}
