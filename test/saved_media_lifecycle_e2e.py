"""Lost successful commit replies cannot remove Skill or composer originals."""
import json,base64
from e2e_support import extension_session,wait_for_async_condition
from playwright.sync_api import expect

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
HOOK='''type=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);window.restoreSend=()=>{chrome.runtime.sendMessage=original};chrome.runtime.sendMessage=async(...args)=>{const response=await original(...args);if(args[0]?.type===type&&response?.ok){window.auditCommitted=true;throw new Error('fixture: reply lost after successful commit')};return response;};}'''
results=[]
with extension_session('pd-commit-cleanup-audit-') as run:
 page=run.open_page('skills.html')
 expect(page.locator('#skill-import')).to_be_visible()
 page.locator('#skill-import').click()
 page.evaluate(HOOK,'CREATE_CREATIVE_SKILL')
 page.locator('#skill-zip-file').set_input_files({'name':'audit-method.md','mimeType':'text/markdown','buffer':b'# Audit method\nPreserve complete originals.\n'})
 wait_for_async_condition(page,'()=>window.auditCommitted===true')
 expect(page.locator('#skill-feedback')).to_contain_text('fixture: reply lost')
 wait_for_async_condition(page,"async()=>!Object.keys((await chrome.storage.local.get('stagedMediaWrites')).stagedMediaWrites||{}).length")
 result=page.evaluate('''async()=>{const {skillPackageFiles}=await import('./skill-files.js');const {getMediaBlob}=await import('./media-store.js');const s=(await chrome.storage.local.get('creativeSkills')).creativeSkills;const rows=[];for(const skill of s.items)for(const f of skillPackageFiles(skill))rows.push({path:f.path,text:await (await getMediaBlob(f.assetId))?.text()});return {skills:s.items.length,files:rows};}''')
 assert result['skills']==1 and result['files']==[{'path':'SKILL.md','text':'# Audit method\nPreserve complete originals.\n'}], result
 results.append({'id':'real-skill-lost-reply','result':result})
 assert page.locator('dialog[open]').count()==0
 page.evaluate('()=>window.restoreSend()')
 page.locator('#skill-import').click()
 page.locator('#skill-zip-file').set_input_files({'name':'next-method.md','mimeType':'text/markdown','buffer':b'# Next method\nContinue after the failed reply.\n'})
 wait_for_async_condition(page,"async()=>(await chrome.storage.local.get('creativeSkills')).creativeSkills?.items.length===2")
 composer=run.open_page('composer.html')
 expect(composer.locator('#composer-instruction')).to_be_visible()
 composer.evaluate(HOOK,'ADD_TEMP_REFERENCES')
 composer.locator('#composer-attachment-files').set_input_files({'name':'audit.png','mimeType':'image/png','buffer':PNG})
 wait_for_async_condition(composer,'()=>window.auditCommitted===true')
 wait_for_async_condition(composer,"()=>document.body.innerText.includes('fixture: reply lost')")
 wait_for_async_condition(composer,"async()=>!Object.keys((await chrome.storage.local.get('stagedMediaWrites')).stagedMediaWrites||{}).length")
 result=composer.evaluate('''async()=>{const {getMediaBlob}=await import('./media-store.js');const s=(await chrome.storage.local.get('composerSessions')).composerSessions;const refs=s.flatMap(x=>x.referenceSnapshots).filter(x=>x.sourceType==='temporary');const rows=[];for(const ref of refs)for(const a of ref.assetRefs||[])rows.push({bytes:Array.from(new Uint8Array(await (await getMediaBlob(a.id||a.assetId))?.arrayBuffer()))});return {sessions:s.length,references:refs.length,files:rows};}''')
 assert result['references']==1 and result['files']==[{'bytes':list(PNG)}], result
 results.append({'id':'real-composer-lost-reply','result':result})
 assert composer.locator('dialog[open]').count()==0
 composer.evaluate('()=>window.restoreSend()')
 composer.locator('#composer-attachment-files').set_input_files({'name':'next.png','mimeType':'image/png','buffer':PNG})
 wait_for_async_condition(composer,"async()=>(await chrome.storage.local.get('composerSessions')).composerSessions?.flatMap(x=>x.referenceSnapshots).filter(x=>x.sourceType==='temporary').length===2")
print(json.dumps(results,ensure_ascii=False,indent=2))
