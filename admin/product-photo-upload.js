// Inventory product photos: standard 1200 × 900 WebP, metadata stripped.
// No direct user-uploaded originals are retained. Compression takes place locally.
(() => {
  const picker = document.querySelector('#product-photo-file');
  const fit = document.querySelector('#product-photo-fit');
  const preview = document.querySelector('#product-photo-preview');
  const previewBox = document.querySelector('#product-photo-preview-box');
  const info = document.querySelector('#product-photo-info');
  if (!picker || !preview || !info) return;

  const WIDTH = 1200, HEIGHT = 900, MAX_BYTES = 450000;
  let pending = null;
  let generation = 0;
  const state = () => pending;
  const clear = (existingImageUrl = '') => {
    generation++;
    pending = null;
    picker.value = '';
    fit.value = 'contain';
    preview.removeAttribute('src');
    if (existingImageUrl) preview.src = existingImageUrl;
    previewBox.hidden = !existingImageUrl;
    info.textContent = existingImageUrl ? 'Current product image. Choose a new photo to replace it.' :
      'Upload a JPG, PNG, WebP, or supported phone photo. We will resize and optimize it.';
  };

  async function compress(file, mode) {
    if (!file || file.size > 20000000) throw Error('Choose an image smaller than 20 MB.');
    const blobURL = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error('This photo format is not supported by your browser. Try JPG or PNG.'));
        image.src = blobURL;
      });
      if (!image.naturalWidth || !image.naturalHeight) throw Error('Could not read the image.');
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw Error('Photo processing is unavailable in this browser.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const scale = mode === 'cover' ?
        Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight) :
        Math.min(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);

      for (const quality of [0.84, 0.74, 0.63, 0.50, 0.37]) {
        const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!result || result.type !== 'image/webp') throw Error('Your browser cannot create WebP photos. Try a recent version of Chrome.');
        if (result.size <= MAX_BYTES) return result;
      }
      throw Error('This photo could not be compressed enough. Try a different image.');
    } finally { URL.revokeObjectURL(blobURL); }
  }

  const prepare = async () => {
    const file = picker.files?.[0];
    const current = ++generation;
    if (!file) { pending = null; return; }
    pending = null;
    info.textContent = 'Preparing a consistent 4:3 product image…';
    try {
      const photo = await compress(file, fit.value);
      if (current !== generation) return;
      pending = photo;
      const url = URL.createObjectURL(photo);
      preview.onload = () => URL.revokeObjectURL(url);
      preview.src = url;
      previewBox.hidden = false;
      info.textContent = 'Ready: 1200 × 900 WebP · ' + Math.round(photo.size / 1024) +
        ' KB. Photo uploads when you save the item.';
    } catch(error) {
      if (current !== generation) return;
      pending = null;
      info.textContent = error.message;
      info.classList.add('photo-error');
    }
  };

  picker.addEventListener('change', () => {
    info.classList.remove('photo-error');
    prepare();
  });
  fit.addEventListener('change', () => {
    if (picker.files?.length) prepare();
  });
  window.RegalProductPhotos = {
    clear, pending: state,
    isProcessing: () => Boolean(picker.files?.length) && !pending,
    upload: async (id) => {
      if (!pending) return null;
      const response = await fetch('/api/admin/product-photo?id=' + encodeURIComponent(id), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'image/webp', 'Accept': 'application/json' },
        body: pending
      });
      let data = null;
      try { data = await response.json(); } catch {}
      if (!response.ok || !data?.ok) throw Error(data?.error?.message ||
        'Could not save this photo. The inventory item was saved; try the image again.');
      clear(data.imageUrl);
      return data.imageUrl;
    }
  };
  clear();
})();
