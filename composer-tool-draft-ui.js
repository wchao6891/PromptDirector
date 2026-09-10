// Draft content is rendered as text and edited locally; saving uses the existing background write queue.
export function createToolDraftCard(event,{sessionId,onSaved,busy=false}) {
  const draft=event.draft;
  const card=node('section','composer-tool-draft');
  card.append(node('strong','',draft.kind==='skill'?draft.callName:`标签建议 · ${draft.title}`));
  card.append(node('p','',draft.kind==='skill'?draft.description:draft.tags.join('、')));
  if(draft.savedId) {
    const link=node('a','button-secondary',draft.kind==='skill'?'在 Skill 中心查看':'查看案例');
    link.href=draft.kind==='skill'?`skills.html?view=detail&skill=${encodeURIComponent(draft.savedId)}`:`library.html?case=${encodeURIComponent(draft.savedId)}`;
    link.target='_blank'; card.append(link);
  } else {
    const button=node('button','button-secondary','查看并保存');
    button.type='button'; button.disabled=busy;
    button.addEventListener('click',()=>openDraft(event,{sessionId,onSaved})); card.append(button);
  }
  return card;
}
function openDraft(event,{sessionId,onSaved}) {
  const draft=event.draft;
  const dialog=node('dialog','composer-assembly-dialog composer-tool-draft-dialog');
  dialog.setAttribute('aria-label',draft.kind==='skill'?'查看并保存 Skill':'查看并保存标签');
  const header=node('header');header.append(node('strong','',draft.kind==='skill'?'查看并保存 Skill':`标签建议 · ${draft.title}`));
  const form=node('form','composer-tool-draft-form');
  const fields={};
  for(const [key,label,value,multiline] of draft.kind==='skill'
    ?[['callName','调用名',draft.callName,false],['description','说明',draft.description,false],['skillMarkdown','Skill 正文',draft.skillMarkdown,true]]
    :[['tags','要添加的标签（每行一个）',draft.tags.join('\n'),true]]) {
    const wrap=node('label','',label); const input=node(multiline?'textarea':'input');
    input.name=key;input.value=value;input.required=true;if(multiline) input.rows=key==='skillMarkdown'?14:6;
    wrap.append(input);form.append(wrap);fields[key]=input;
  }
  const status=node('p','composer-tool-draft-status');status.setAttribute('role','status');
  const footer=node('footer');const cancel=node('button','button-secondary','取消');cancel.type='button';
  const save=node('button','button-primary',draft.kind==='skill'?'保存到 Skill 中心':'添加到案例');save.type='submit';
  cancel.addEventListener('click',()=>dialog.close());footer.append(cancel,save);form.append(status,footer);
  form.addEventListener('submit',async e=>{
    e.preventDefault();save.disabled=true;cancel.disabled=true;
    try {
      const edited=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,key==='tags'?input.value.split('\n').map(item=>item.trim()).filter(Boolean):input.value.trim()]));
      const response=await chrome.runtime.sendMessage({type:'SAVE_COMPOSER_TOOL_DRAFT',sessionId,callId:event.callId,userMessageId:event.userMessageId,draft:edited});
      if(!response?.ok) throw Error(response?.message||'保存失败，请重试');
      onSaved(response.session); dialog.close();
    } catch(error) { status.textContent=error.message; }
    finally {save.disabled=false;cancel.disabled=false;}
  });
  dialog.addEventListener('cancel',e=>{if(save.disabled)e.preventDefault();});
  dialog.addEventListener('close',()=>dialog.remove());dialog.append(header,form);document.body.append(dialog);dialog.showModal();
}
function node(tag,className='',text='') {const element=document.createElement(tag);element.className=className;element.textContent=text;return element;}
