"""Read the actual native provider conversation for composer assertions."""
import json


def composer_request_payload(body):
    messages=body.get('messages',body.get('input',[]))
    for index in range(len(messages)-1,-1,-1):
        message=messages[index]
        if message.get('role')!='user': continue
        content=message.get('content','')
        if not isinstance(content,list) or not content: continue
        text=content[0].get('text','')
        try: payload=json.loads(text)
        except (ValueError,TypeError): continue
        if not isinstance(payload,dict) or 'targetType' not in payload or 'route' not in payload: continue
        assert 'messages' not in payload, 'Execution history must use provider-native roles'
        payload['messages']=[{'role':m['role'],'content':m['content']} for m in messages[:index] if m.get('role') in ['user','assistant']]
        if content[-1].get('type') in ['text','input_text'] and len(content)>1:
            payload['messages'].append({'role':'user','content':content[-1]['text']})
        return payload
    raise AssertionError('Composer execution context not found in native messages')
