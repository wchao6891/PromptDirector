export async function commitMetadataThenDeleteImages({
  imageIds,
  commitMetadata,
  deleteImage,
  deleteImages
}) {
  if (typeof commitMetadata !== "function" || (typeof deleteImage !== "function" && typeof deleteImages !== "function")) {
    throw new Error("图片删除事务缺少存储能力");
  }
  const ids = uniqueIds(imageIds);
  await commitMetadata();
  if (typeof deleteImages === "function") {
    try {
      await deleteImages(ids);
      return { deletedIds: ids, failedIds: [] };
    } catch {
      return { deletedIds: [], failedIds: ids };
    }
  }
  const results = await Promise.allSettled(ids.map((id) => deleteImage(id)));
  return {
    deletedIds: ids.filter((_id, index) => results[index].status === "fulfilled"),
    failedIds: ids.filter((_id, index) => results[index].status === "rejected")
  };
}

export async function replaceImagesWithRollback({
  replacements,
  readImage,
  writeImage,
  deleteImage,
  commitMetadata
}) {
  if (!replacements || typeof replacements[Symbol.asyncIterator] !== "function") {
    throw new Error("图片替换事务缺少异步图片流");
  }
  for (const operation of [readImage, writeImage, deleteImage, commitMetadata]) {
    if (typeof operation !== "function") throw new Error("图片替换事务缺少存储能力");
  }

  const originals = new Map();
  const touchedIds = [];
  try {
    for await (const replacement of replacements) {
      const id = String(replacement?.id ?? "").trim();
      if (!id || originals.has(id)) throw new Error("图片替换事务包含无效或重复编号");
      originals.set(id, await readImage(id));
      touchedIds.push(id);
      await writeImage(id, replacement.blob);
    }
    await commitMetadata();
    return { replacedIds: touchedIds };
  } catch (error) {
    const rollbackErrors = [];
    for (const id of touchedIds.toReversed()) {
      try {
        const original = originals.get(id);
        if (original) await writeImage(id, original);
        else await deleteImage(id);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], "图片事务失败且未能完整回滚", { cause: error });
    }
    throw error;
  }
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}
