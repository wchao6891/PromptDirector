// Inspect decoded pixels in small tiles so large originals do not require a
// second full-size canvas or block opening the viewer.
export function observeImageTransparency(image, onResult) {
  let generation = 0;
  const inspect = async () => {
    const token = ++generation;
    if (!image.naturalWidth || !image.naturalHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    try {
      for (let y = 0; y < image.naturalHeight; y += canvas.height) {
        for (let x = 0; x < image.naturalWidth; x += canvas.width) {
          if (token !== generation) return;
          const width = Math.min(canvas.width, image.naturalWidth - x);
          const height = Math.min(canvas.height, image.naturalHeight - y);
          context.clearRect(0, 0, width, height);
          context.drawImage(image, x, y, width, height, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data;
          for (let at = 3; at < pixels.length; at += 4) {
            if (pixels[at] < 255) { onResult(true); return; }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!image.isConnected || token !== generation) return;
      }
      onResult(false);
    } catch { /* An unreadable external image keeps the solid viewer background. */ }
  };
  image.addEventListener('load', inspect);
  if (image.complete) void inspect();
}
