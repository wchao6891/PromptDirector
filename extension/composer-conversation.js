// Preserve provider roles across turns. Only the current user message receives current attachments.
export function applyComposerConversation(body, request, protocol='chat_completions') {
  const history=(request.messages??[]).filter(message=>['user','assistant'].includes(message.role) && String(message.content??'').trim())
    .map(({role,content})=>({role,content:String(content)}));
  const latest=history.at(-1)?.role==='user' ? history.pop().content : String(request.instruction??'');
  const {messages: _messages,...context}=request;
  const sequence=protocol==='responses'?body.input:body.messages;
  const current=sequence.at(-1);
  const content=Array.isArray(current.content)?current.content:[{type:protocol==='responses'?'input_text':'text',text:String(current.content)}];
  content[0]={...content[0],text:JSON.stringify(context)};
  if(latest) content.push({type:protocol==='responses'?'input_text':'text',text:latest});
  const currentMessage={role:'user',content};
  const prefix=protocol==='responses'?[]:sequence.filter(message=>message.role==='system');
  const result=[...prefix,...history,currentMessage];
  if(protocol==='responses') body.input=result;
  else body.messages=result;
  return body;
}
