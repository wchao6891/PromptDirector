// Reading text must not wait for original files outside the reading viewport.
export function createArticleImageLoader(root, load, onError) {
  const requests = new WeakMap();
  let disposed = false;
  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      const asset = requests.get(target);
      void load(asset.id).then(url => {
        if (disposed || !target.isConnected) return;
        if (!url) throw new Error('图片文件缺失');
        target.src = url;
      }).catch(error => { if (!disposed && target.isConnected) onError(target, asset, error); });
    }
  }, { root });
  return {
    observe(image, asset) {
      if (asset.width && asset.height) {
        image.width = asset.width; image.height = asset.height;
        image.style.aspectRatio = `${asset.width} / ${asset.height}`;
        image.style.height = 'auto';
      }
      requests.set(image, asset);
      observer.observe(image);
    },
    dispose() { disposed = true; observer.disconnect(); }
  };
}
