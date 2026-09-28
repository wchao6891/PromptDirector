const PACKAGE_REQUEST_OPTIONS = Object.freeze({
  cache: "no-store",
  credentials: "omit",
  redirect: "follow"
});

export async function fetchCuratedPackage(url, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(url, PACKAGE_REQUEST_OPTIONS);
    if (!isTransientStatus(response.status)) return response;
  } catch {
    // A single fresh retry covers temporary network failures without hiding a persistent error.
  }
  return fetchImpl(url, PACKAGE_REQUEST_OPTIONS);
}

export async function readResponseBlobWithProgress(response, { onProgress = () => undefined } = {}) {
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const declaredSize = Number(response.headers.get("content-length"));
  const total = Number.isSafeInteger(declaredSize) && declaredSize > 0 ? declaredSize : 0;
  if (!response.body?.pipeThrough) {
    const blob = await response.blob();
    onProgress({ loaded: blob.size, total, ratio: total ? Math.min(1, blob.size / total) : null });
    return blob;
  }

  let loaded = 0;
  const stream = response.body.pipeThrough(new TransformStream({
    transform(value, controller) {
      if (!value?.byteLength) return;
      loaded += value.byteLength;
      if (total && loaded > total) throw new Error("精选案例包下载大小与响应不一致");
      controller.enqueue(value);
      onProgress({ loaded, total, ratio: total ? Math.min(1, loaded / total) : null });
    },
    flush() {
      if (total && loaded !== total) throw new Error("精选案例包下载不完整");
    }
  }));
  return new Response(stream, { headers: { "content-type": contentType } }).blob();
}

function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
