(() => {
  const optimize = async file => {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a source photo smaller than 20 MB.');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    if (!blob || blob.size > 4 * 1024 * 1024) throw new Error('Use a smaller photo. The optimized upload must be under 4 MB.');
    return blob;
  };
  window.RegalCatalogPhoto = { save: async (form, id) => {
    const file = form.elements.image.files[0]; const remove = form.elements.removeImage.checked;
    if (!file && !remove) return;
    const endpoint = `/api/admin/products/${encodeURIComponent(id)}/image?alt=${encodeURIComponent(form.elements.imageAlt.value)}`;
    const blob = file ? await optimize(file) : null;
    const response = await fetch(endpoint, { method: file ? 'POST' : 'DELETE', credentials: 'same-origin',
      ...(blob ? { headers: { 'Content-Type': blob.type }, body: blob } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error('Item details saved. Photo: ' + (data.error?.message || 'Upload failed; retry the photo.'));
  } };
})();
