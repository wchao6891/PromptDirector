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

function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}
