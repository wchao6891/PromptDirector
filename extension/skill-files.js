// The current version owns the top-level files. A version that becomes history
// keeps its own file descriptors; absent descriptors mean unrecorded, not empty.
export function skillFileOwners(skill = {}) {
  return [skill, ...(Array.isArray(skill.versions) ? skill.versions : [])
    .filter(version => version.id !== skill.currentVersionId && Array.isArray(version.packageFiles))];
}

export function skillPackageFiles(skill) {
  return skillFileOwners(skill).flatMap(owner => Array.isArray(owner.packageFiles) ? owner.packageFiles : []);
}
