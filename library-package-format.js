export const LIBRARY_PACKAGE_FORMAT = "prompt-case-library";
export const CURRENT_LIBRARY_PACKAGE_VERSION = 4;
export const SUPPORTED_LIBRARY_PACKAGE_VERSIONS = Object.freeze([1, 2, 3, 4]);

export function isSupportedLibraryPackageVersion(value) {
  return Number.isInteger(value) && SUPPORTED_LIBRARY_PACKAGE_VERSIONS.includes(value);
}
