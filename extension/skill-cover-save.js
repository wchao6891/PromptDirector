import { isSkillCoverPath, skillPackageRoot, validateSkillCover } from "./skill-cover.js";
import { sha256Hex } from "./sync-crypto.js";
import { skillPackageLimits } from "./creative-skill-package.js";

export async function commitSkillWithCover(result, cover, options) {
  const previousFiles = result.skill.packageFiles;
  const root = skillPackageRoot(previousFiles);
  const previousCoverIds = previousFiles.filter(file => isSkillCoverPath(file.path, root)).map(file => file.assetId);
  let stagedId = "";
  try {
    if (cover !== undefined) {
      let file = null;
      if (cover !== null) {
        let blob;
        if (cover.sourceAssetId) blob = await options.readBlob(cover.sourceAssetId);
        else if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(cover.dataUrl ?? "")) blob = await (await fetch(cover.dataUrl)).blob();
        const image = await validateSkillCover(blob, cover.sourceAssetId ? "" : cover.name, {
          maxBytes: skillPackageLimits().maxFileBytes,
          decode: options.decode
        });
        stagedId = `skill-file:${crypto.randomUUID()}`;
        await options.saveBlob(stagedId, image.blob);
        const stored = await options.readBlob(stagedId);
        if (!(stored instanceof Blob) || stored.size !== image.blob.size || await sha256Hex(stored) !== await sha256Hex(image.blob)) throw new Error("封面写入校验失败");
        file = { path: `${root}${image.path}`, assetId: stagedId, byteSize: image.blob.size, mimeType: image.mimeType };
      }
      result.skill.packageFiles = previousFiles.filter(item => !isSkillCoverPath(item.path, root));
      if (file) result.skill.packageFiles.push(file);
      result.skill.updatedAt = new Date().toISOString();
    }
    await options.commit(result.state);
  } catch (error) {
    if (stagedId) await options.cleanup([stagedId]).catch(cleanupError => options.onCleanupError?.(cleanupError));
    throw error;
  }
  if (cover !== undefined && previousCoverIds.length) {
    await options.cleanup(previousCoverIds).catch(error => options.onCleanupError?.(error));
  }
  return result;
}
