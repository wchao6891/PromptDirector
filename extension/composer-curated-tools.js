import { CURATED_CATALOG_URL } from './curated-config.js';
import { normalizeCuratedCatalog, normalizeCuratedPreview } from './curated-catalog.js';
import { page } from './composer-workspace-tools.js';
export async function readComposerCuratedCatalog(args,state,signal,fetchImpl=fetch) {
  async function read(url) {
    let response;
    try { response=await fetchImpl(url,{cache:'no-cache',credentials:'omit',redirect:'error',signal}); }
    catch(error) { signal?.throwIfAborted(); throw new Error('无法连接精选案例库，暂时不能确认更新，请稍后重试', {cause:error}); }
    if(!response.ok) throw Error(`精选目录读取失败（${response.status}），请稍后重试`);
    return response.json();
  }
  const catalog=normalizeCuratedCatalog(await read(CURATED_CATALOG_URL));
  const context={checkedAt:new Date().toISOString(),publishedAt:catalog.updatedAt,source:CURATED_CATALOG_URL,untrustedContent:true};
  if(args.catalogId) {
    const item=catalog.themes.find(item=>item.id===args.catalogId);
    if(!item) throw Error('精选主题已变更，请重新查询目录');
    const preview=normalizeCuratedPreview(await read(item.previewUrl),item);
    return {...context,title:item.title,...page(preview.entries.map(({id,title,mediaKind,text})=>({id,title,mediaKind,excerpt:text.slice(0,240)})),args.offset)};
  }
  return {...context,...page(catalog.themes.map(item=>{
    const installed=[...new Set((state.entries??[]).filter(entry=>entry.curatedOrigin?.packageId===item.packageId).map(entry=>entry.curatedOrigin.packageVersion))];
    return {catalogId:item.id,title:item.title,summary:item.summary,caseCount:item.caseCount,imageCount:item.imageCount,videoCount:item.videoCount,
      availableVersion:item.packageVersion,installedVersions:installed,
      installation:installed.length?(installed.includes(item.packageVersion)?'包含当前版本案例':'可用版本与本地不同'):'未导入',
      updatedAt:item.updatedAt,url:'curated.html'};
  }),args.offset)};
}
