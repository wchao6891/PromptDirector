// Old pd-ref links name both case and media. Resolve within that case only;
// an alias cannot grant access to an original that the case does not own.
export function resolveCaseMediaId(entry, assetId) {
  if (!assetId) return assetId;
  const members = entry.memberEntries?.length ? entry.memberEntries : [entry];
  const matches = new Set();
  for (const member of members) {
    const assets = member.mediaAssets || member.visuals || [];
    if (assets.some(asset => asset.id === assetId)) matches.add(assetId);
    for (const alias of member.mediaIdAliases || []) {
      if (alias?.from === assetId && typeof alias.to === 'string' && assets.some(asset => asset.id === alias.to)) matches.add(alias.to);
    }
  }
  if (matches.size > 1) throw Object.assign(new Error('旧素材引用对应多个独立成员，请指定成员案例读取。'), { code: 'ambiguous_asset_reference' });
  return matches.size ? [...matches][0] : assetId;
}
