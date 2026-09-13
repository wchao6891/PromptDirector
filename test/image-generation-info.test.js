import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readImageGenerationInfo, parseA1111, parseComfyGraph, embeddedMediaPrompts } from '../extension/image-generation-info.js';
import { normalizeEntryMedia, setEntryMediaPrompt } from '../extension/media.js';
import { prepareLocalMedia } from '../extension/local-media.js';
import { normalizeImportStagingState, stagedAssetMediaRecord } from '../extension/import-staging.js';

// Constructed edge fixtures, never presented as genuine generator output.
const ascii = value => Buffer.from(value, 'latin1');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function crc32(bytes) { let crc = -1; for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function chunk(kind, data) { const payload = Buffer.concat([ascii(kind), data]); return Buffer.concat([u32(data.length), payload, u32(crc32(payload))]); }
function png(...chunks) { return new Blob([Buffer.from([137,80,78,71,13,10,26,10]), ...chunks, chunk('IEND', Buffer.alloc(0))], { type: 'image/png' }); }
function txt(key, value, kind = 'tEXt', compressed = false) {
  let b = Buffer.from(value, kind === 'iTXt' ? 'utf8' : 'latin1');
  if (kind === 'zTXt' || compressed) b = deflateSync(b);
  const header = kind === 'tEXt' ? [] : kind === 'zTXt' ? [0] : [compressed ? 1 : 0,0,0,0];
  return chunk(kind, Buffer.concat([ascii(key+'\0'), Buffer.from(header), b]));
}
function tiff(tag, value, little = false) {
  const b = Buffer.alloc(26 + value.length);
  b.write(little ? 'II' : 'MM');
  const w16 = (v,o) => little ? b.writeUInt16LE(v,o) : b.writeUInt16BE(v,o);
  const w32 = (v,o) => little ? b.writeUInt32LE(v,o) : b.writeUInt32BE(v,o);
  w16(42,2); w32(8,4); w16(1,8); w16(tag,10); w16(7,12); w32(value.length,14); w32(26,18); value.copy(b,26); return b;
}
function jpeg(exif) { const payload = Buffer.concat([ascii('Exif\0\0'),exif]), size=Buffer.alloc(2); size.writeUInt16BE(payload.length+2); return new Blob([Buffer.from([255,216,255,225]),size,payload,Buffer.from([255,217])],{type:'image/jpeg'}); }
function webp(exif) { const size=Buffer.alloc(4), total=Buffer.alloc(4); size.writeUInt32LE(exif.length); total.writeUInt32LE(12+exif.length+exif.length%2); return new Blob([ascii('RIFF'),total,ascii('WEBPEXIF'),size,exif,Buffer.alloc(exif.length%2)],{type:'image/webp'}); }
const footer = '\nSteps: 28, Sampler: DPM++ 2M, CFG scale: 7, Seed: 18446744073709551615';
const graph = () => ({
 '1': {class_type:'CLIPTextEncode',inputs:{text:'雨夜书店'}},
 '2': {class_type:'CLIPTextEncode',inputs:{text:'水印'}},
 '3': {class_type:'KSampler',inputs:{positive:['1',0],negative:['2',0],seed:123,steps:28}},
 '4': {class_type:'SaveImage',inputs:{images:['3',0]}}
});
test('PNG text, compressed text and Unicode text preserve long prompts and exact seed text', async () => {
 for (const [kind,compressed,prompt] of [['tEXt',false,'bookstore'],['zTXt',true,'bookstore'.repeat(20000)],['iTXt',false,'雨夜🌧️'],['iTXt',true,'中文长提示词'.repeat(20000)]]) {
  const blob=png(txt('parameters',prompt+'\nNegative prompt: watermark'+footer,kind,compressed));
  const before=createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
  const info=await readImageGenerationInfo(blob);
  assert.equal(info.status,'extracted'); assert.equal(info.candidates[0].prompt,prompt); assert.equal(info.candidates[0].negativePrompt,'watermark');
  assert.equal(info.candidates[0].parameters.at(-1).value,'18446744073709551615');
  assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),before);
 }
});
test('JPEG and WebP read producer Unicode comments including big-endian text within little-endian TIFF', async () => {
 const source='中文雨夜'+footer;
 const encoded=Buffer.from(source,'utf16le').swap16();
 for (const little of [false,true]) for (const wrap of [jpeg,webp]) {
  const info=await readImageGenerationInfo(wrap(tiff(0x9286,Buffer.concat([ascii('UNICODE\0'),encoded]),little)));
  assert.equal(info.candidates[0].prompt,'中文雨夜');
 }
});
test('ComfyUI PNG and current WebP Model/prompt convention resolve a single branch', async () => {
 for (const blob of [png(txt('prompt',JSON.stringify(graph()),'iTXt')),webp(tiff(0x0110,Buffer.from('prompt:'+JSON.stringify(graph())+'\0')))]) {
  const info=await readImageGenerationInfo(blob); assert.equal(info.status,'extracted'); assert.equal(info.candidates[0].prompt,'雨夜书店'); assert.equal(info.candidates[0].negativePrompt,'水印');
 }
});
test('large ComfyUI seed is never rounded by JSON parsing', async () => {
 const source=JSON.stringify(graph()).replace('"seed":123','"seed":18446744073709551615');
 const info=await readImageGenerationInfo(png(txt('prompt',source,'iTXt')));
 assert.equal(info.candidates[0].parameters.find(p=>p.name==='seed').value,'18446744073709551615');
});
test('multiple output branches, unknown conditions and cyclic graphs do not guess or concatenate', async () => {
 const multi=graph(); multi['5']={class_type:'KSampler',inputs:{positive:['2',0],negative:['1',0]}};multi['6']={class_type:'SaveImage',inputs:{images:['5',0]}};
 assert.equal(parseComfyGraph(multi).ambiguous,true);
 const info=await readImageGenerationInfo(png(txt('prompt',JSON.stringify(multi),'iTXt')));
 assert.equal(info.status,'ambiguous'); assert.equal(embeddedMediaPrompts([{id:'a',kind:'image',generationInfo:info}]).length,0);
 const unknown=graph();unknown['1'].class_type='UnknownCustomNode';unknown['1'].inputs.loop=['3',0];
 const partial=await readImageGenerationInfo(png(txt('prompt',JSON.stringify(unknown),'iTXt')));
 assert.equal(partial.status,'partial'); assert.equal(partial.candidates[0].prompt,'');
 assert.equal(embeddedMediaPrompts([{id:'a',kind:'image',generationInfo:partial}]).length,0);
});
test('bad metadata CRC and damaged compressed data are isolated without losing later valid records', async () => {
 const bad=txt('parameters','wrong'+footer);bad[bad.length-1]^=1;
 const broken=chunk('zTXt',Buffer.concat([ascii('parameters\0'),Buffer.from([0,255,0])]));
 const info=await readImageGenerationInfo(png(bad,broken,txt('parameters','healthy'+footer)));
 assert.equal(info.status,'partial');assert.equal(info.candidates[0].prompt,'healthy');assert.equal(info.warnings.length,2);
});
test('no metadata is not an error, and cancellation propagates without changing bytes', async () => {
 assert.equal(await readImageGenerationInfo(new Blob(['not metadata'])),null);
 const controller=new AbortController();controller.abort();
 await assert.rejects(readImageGenerationInfo(png(),{signal:controller.signal}),{name:'AbortError'});
 assert.equal(parseA1111('normal camera description'),null);
});
test('parameter separators inside quoted producer values remain part of that value', () => {
 const info=parseA1111('prompt'+footer+', Extension: "one, Name: two", Size: 512x512');
 assert.equal(info.parameters.find(p=>p.name==='Extension').value,'"one, Name: two"');
 assert.equal(info.parameters.some(p=>p.name==='Name'),false);
});
test('new local media retains metadata through staging; edits and clearing survive normalization without auto-refill', async () => {
 const blob=png(txt('parameters','embedded'+footer));const file=new File([blob],'sample.png',{type:'image/png'});
 const prepared=await prepareLocalMedia(file,'asset',{readImageDimensions:async()=>({width:1,height:1})});
 const staged=normalizeImportStagingState({assets:[{...prepared.asset,id:'stage',assetId:'asset',name:file.name,relativePath:file.name}]}).assets[0];
 assert.ok(staged);
 const asset=stagedAssetMediaRecord({...staged,id:'stage'});
 assert.deepEqual(asset.generationInfo,prepared.asset.generationInfo);
 const entry=normalizeEntryMedia({id:'case',text:'shared',mediaAssets:[asset],mediaPrompts:embeddedMediaPrompts([asset])});
 assert.equal(entry.mediaPrompts[0].source,'embedded');assert.equal(entry.text,'shared');
 const edited=setEntryMediaPrompt(entry,'asset','my edited prompt','manual',{preserveOtherSource:true});
 assert.equal(embeddedMediaPrompts([asset],edited.mediaPrompts).length,0);
 const cleared=normalizeEntryMedia(JSON.parse(JSON.stringify(setEntryMediaPrompt(edited,'asset',''))));
 assert.equal(cleared.mediaPrompts.length,0);assert.deepEqual(cleared.mediaAssets[0].generationInfo,asset.generationInfo);
 for(const source of ['manual','webpage']) assert.equal(embeddedMediaPrompts([asset],[{assetId:'asset',source,text:'explicit'}]).length,0);
});

test('original prompt conflicts require a choice; overwrite applies to one image and stale choices cannot overwrite changed content', async () => {
 const { planImageGenerationPrompts } = await import('../extension/image-generation-ingestion.js');
 const info=await readImageGenerationInfo(png(txt('parameters','embedded'+footer)));
 const asset={id:'one',kind:'image',sourceTitle:'one.png',generationInfo:info};
 const entry=normalizeEntryMedia({id:'case',text:'shared original',mediaAssets:[asset,{id:'two',kind:'image'}]});
 const first=await planImageGenerationPrompts(entry,[asset]);
 assert.equal(first.conflicts.length,1);assert.equal(first.entry.mediaPrompts.length,0);
 const token=first.conflicts[0].token;
 const skipped=await planImageGenerationPrompts(entry,[asset],{[token]:'skip'});
 assert.equal(skipped.conflicts.length,0);assert.equal(skipped.entry.mediaPrompts.length,0);
 const overwritten=await planImageGenerationPrompts(entry,[asset],{[token]:'overwrite'});
 assert.equal(overwritten.conflicts.length,0);assert.equal(overwritten.entry.mediaPrompts[0].text,'embedded');
 assert.equal(overwritten.entry.text,'shared original');assert.equal(overwritten.entry.mediaPrompts[0].assetId,'one');
 const changed=await planImageGenerationPrompts({...entry,text:'new user edit'},[asset],{[token]:'overwrite'});
 assert.equal(changed.conflicts.length,1);assert.equal(changed.entry.mediaPrompts.length,0);
});

test('optional extraction and automatic original prompts do not change dedup identity; human edits do', async () => {
 const { caseSemanticFingerprint }=await import('../extension/library-semantic-identity.js');
 const info=await readImageGenerationInfo(png(txt('parameters','embedded'+footer)));
 const asset={id:'one',kind:'image',contentHash:'a'.repeat(64),capturedAt:'2026-09-13T00:00:00.000Z'};
 const before=normalizeEntryMedia({id:'case',mediaAssets:[asset]});
 const after=normalizeEntryMedia({...before,mediaAssets:[{...asset,generationInfo:info}],mediaPrompts:embeddedMediaPrompts([{...asset,generationInfo:info}])});
 assert.equal(caseSemanticFingerprint(before),caseSemanticFingerprint(after));
 assert.notEqual(caseSemanticFingerprint(before),caseSemanticFingerprint(setEntryMediaPrompt(after,'one','human edit')));
});

test('existing source metadata rows adapt image parameters without mutating capture fields', async () => {
 const { entrySourceMetadataRows }=await import('../extension/library-model.js');
 const info=await readImageGenerationInfo(png(txt('parameters','embedded'+footer)));
 const entry={sourceFacts:{provider:'existing',model:'web model'},metadataLabels:['existing label'],mediaAssets:[{id:'one',kind:'image',generationInfo:info}]};
 const original=structuredClone(entry);const rows=entrySourceMetadataRows(entry);
 assert.deepEqual(entry,original);assert.ok(rows.some(row=>row.label==='Seed'&&row.value==='18446744073709551615'));
 assert.ok(rows.some(row=>row.label==='模型'&&row.value==='web model'));
});

test('share, full restore, retry, trash and rollback preserve optional extraction and never reparse an old image', async () => {
 const {renderLibraryJson,buildEntry}=await import('../extension/lib.js');
 const {inspectLibraryTransfer,planLibraryTransfer}=await import('../extension/library-transfer.js');
 const {moveMediaToTrash,restoreTrashItems}=await import('../extension/trash.js');
 const {createLibraryReplacementRecoveryPoint,swapLibraryReplacementRecoveryPoint}=await import('../extension/library-recovery-point.js');
 const blob=png(txt('parameters','embedded'+footer));const info=await readImageGenerationInfo(blob);
 const hash=createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
 const asset={id:'asset:one',kind:'image',mimeType:'image/png',contentHash:hash,byteSize:blob.size,assetPath:'images/one.png',generationInfo:info};
 const entry=normalizeEntryMedia({...buildEntry({text:'body',title:'case',url:''}),mediaAssets:[asset],mediaPrompts:embeddedMediaPrompts([asset]),customLabels:['human tag']});
 const source=JSON.parse(renderLibraryJson([entry]));const files=new Map([['images/one.png',blob]]);
 for(const sourceType of ['share-package','complete-backup']) {
  const checked=await inspectLibraryTransfer({sourceType,library:source,files});
  assert.deepEqual(checked.report.diagnostics,[]);assert.equal(checked.state.entries[0].text,'body');
  assert.deepEqual(checked.state.entries[0].mediaAssets[0].generationInfo,info);
  assert.equal(checked.state.entries[0].mediaPrompts[0].source,'embedded');
  const first=planLibraryTransfer({currentState:{entries:[]},inspection:checked});
  const retry=planLibraryTransfer({currentState:first.targetState,inspection:checked});
  assert.equal(retry.importedCount,0);assert.equal(retry.targetState.entries.length,1);
 }
 const removed=moveMediaToTrash({entries:[entry]},entry.id,[asset.id]);
 const restored=restoreTrashItems(removed,removed.trashState.items.map(item=>item.id));
 assert.deepEqual(restored.entries[0].mediaAssets[0].generationInfo,info);assert.equal(restored.entries[0].mediaPrompts[0].text,'embedded');
 const point=createLibraryReplacementRecoveryPoint({entries:[entry]},{retainedAssetIds:[asset.id]});
 assert.deepEqual(swapLibraryReplacementRecoveryPoint({entries:[]},point).targetState.entries[0].mediaAssets[0].generationInfo,info);
 const old=structuredClone(source);delete old.entries[0].mediaAssets[0].generationInfo;old.entries[0].mediaPrompts=[];
 const checked=await inspectLibraryTransfer({sourceType:'share-package',library:old,files});
 assert.equal(checked.state.entries[0].mediaAssets[0].generationInfo,undefined);assert.deepEqual(checked.state.entries[0].mediaPrompts,[]);
 const damaged=structuredClone(source);damaged.entries[0].mediaAssets[0].generationInfo={version:999,status:'bad'};
 const rescue=await inspectLibraryTransfer({sourceType:'share-package',library:damaged,files});
 assert.equal(rescue.state.entries.length,1);assert.equal(rescue.resources.assets.size,1);assert.ok(rescue.report.diagnostics.some(item=>item.code==='generation_info_isolated'));
 const reordered=structuredClone(source);reordered.entries[0].mediaAssets[0].generationInfo=Object.fromEntries(Object.entries(info).reverse());
 assert.deepEqual((await inspectLibraryTransfer({sourceType:'share-package',library:reordered,files})).report.diagnostics,[]);
});

test('sync preserves extraction and remaps per-image prompts when retaining a conflict copy', async () => {
 const {createRevisionSnapshot,mergeRevisionSnapshots}=await import('../extension/sync-model.js');
 const {buildEntry}=await import('../extension/lib.js');
 const info=await readImageGenerationInfo(png(txt('parameters','embedded'+footer)));
 const asset={id:'asset',kind:'image',generationInfo:info};
 const entry=normalizeEntryMedia({...buildEntry({text:'body',title:'case',url:''}),mediaAssets:[asset],mediaPrompts:embeddedMediaPrompts([asset])});
 const base=await createRevisionSnapshot({entries:[entry]},{deviceId:'base',logicalClock:1});
 const left=await createRevisionSnapshot({entries:[{...entry,text:'left'}]},{deviceId:'left',logicalClock:2,baseSnapshot:base});
 const right=await createRevisionSnapshot({entries:[{...entry,text:'right'}]},{deviceId:'right',logicalClock:2,baseSnapshot:base});
 const merged=mergeRevisionSnapshots([left,right]);assert.equal(merged.state.entries.length,2);
 for(const restored of merged.state.entries) {assert.deepEqual(restored.mediaAssets[0].generationInfo,info);assert.equal(restored.mediaPrompts[0].assetId,restored.mediaAssets[0].id);}
});

test('oversized compressed metadata produces an explicit extraction result and leaves the full original readable', async () => {
 const {GENERATION_TEXT_BUDGET}=await import('../extension/image-generation-container.js');
 const source='x'.repeat(GENERATION_TEXT_BUDGET+1)+footer;
 const blob=png(txt('parameters',source,'zTXt'));
 const before=Buffer.from(await blob.arrayBuffer());const info=await readImageGenerationInfo(blob);
 assert.equal(info.status,'partial');assert.match(info.warnings.join(' '),/预算/u);assert.deepEqual(info.candidates,[]);
 assert.deepEqual(Buffer.from(await blob.arrayBuffer()),before);
});

test('EXIF UserComment subdirectory has no image-directory next pointer in producer output', async () => {
 const value=Buffer.concat([ascii('UNICODE\0'),Buffer.from('书店'+footer,'utf16le').swap16()]);
 const data=Buffer.alloc(40+value.length);data.write('MM');data.writeUInt16BE(42,2);data.writeUInt32BE(8,4);
 data.writeUInt16BE(1,8);data.writeUInt16BE(0x8769,10);data.writeUInt16BE(4,12);data.writeUInt32BE(1,14);data.writeUInt32BE(26,18);
 data.writeUInt16BE(1,26);data.writeUInt16BE(0x9286,28);data.writeUInt16BE(7,30);data.writeUInt32BE(value.length,32);data.writeUInt32BE(40,36);value.copy(data,40);
 const info=await readImageGenerationInfo(jpeg(data));assert.equal(info.status,'extracted');assert.equal(info.candidates[0].prompt,'书店');
});

test('Agent reads generation info only for the requested image, without filling an old library or default context', async () => {
 const {createAgentLibrary}=await import('../extension/agent-library.js');
 const blob=png(txt('parameters','old original'+footer));let reads=0;
 const entry=normalizeEntryMedia({id:'case',text:'body',mediaAssets:[{id:'old',kind:'image'}]});const before=structuredClone(entry);
 const api=createAgentLibrary({loadState:async()=>({entries:[entry]}),readBlob:async()=>{reads++;return blob;},readDerived:async()=>null,readDerivedMetadata:async()=>new Map(),libraryUrl:'chrome-extension://test/library.html'});
 await api.read({caseId:'case'});assert.equal(reads,0);
 const result=await api.read({caseId:'case',part:'generation_info',assetId:'old'});
 assert.equal(reads,1);assert.equal(JSON.parse(result.content).candidates[0].prompt,'old original');assert.deepEqual(entry,before);
 await assert.rejects(api.read({caseId:'case',part:'generation_info',assetId:'foreign'}),{code:'asset_not_in_case'});
});

test('reading legacy-export originals restores parameter visibility without rewriting cleared prompts or stored entries', async () => {
  const { createGenerationInfoViewReader } = await import('../extension/image-generation-view.js');
  const original = png(txt('parameters', 'original\nNegative prompt: watermark\nSteps: 20, Seed: 9'));
  let reads = 0;
  const read = createGenerationInfoViewReader(async () => { reads++; return original; });
  const entry = { id: 'old-export', text: 'user body', mediaPrompts: [], mediaAssets: [{ id: 'image', kind: 'image', contentHash: 'hash' }] };
  const snapshot = structuredClone(entry);
  const view = await read(entry);
  assert.equal(view.mediaAssets[0].generationInfo.candidates[0].parameters[1].value, '9');
  assert.deepEqual(view.mediaPrompts, []);
  assert.deepEqual(entry, snapshot);
  const compound = await read({ ...entry, memberEntries: [snapshot] });
  assert.deepEqual(compound.memberEntries[0].mediaAssets, compound.mediaAssets);
  assert.deepEqual(snapshot.mediaAssets, entry.mediaAssets);
  await read({ ...entry, text: 'edited' });
  assert.equal(reads, 1);
  await read({ id: 'other', mediaAssets: [] });
  await read(entry);
  assert.equal(reads, 2);
});
