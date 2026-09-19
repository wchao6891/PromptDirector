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


def set_composer_reference_media(page, *, images=None, videos=None):
    """Choose originals through the visible toolbar menu and wait for the saved state."""
    from playwright.sync_api import expect
    menu = page.locator('#composer-reference-inputs')
    trigger = page.locator('#composer-reference-inputs-trigger')
    if not menu.evaluate('node => node.open'):
        trigger.click()
    for selector, value in [('#composer-send-images', images), ('#composer-send-videos', videos)]:
        if value is None:
            continue
        page.locator(selector).set_checked(value)
        image = page.locator('#composer-send-images').is_visible() and page.locator('#composer-send-images').is_checked()
        video = page.locator('#composer-send-videos').is_visible() and page.locator('#composer-send-videos').is_checked()
        title = '参考输入：' + ('文字' + ('＋原图' if image else '') + ('＋原视频' if video else '') if image or video else '仅文字')
        expect(trigger).to_have_attribute('title', title)
    trigger.click()


def set_composer_direction(page, direction):
    from playwright.sync_api import expect
    menu = page.locator('#composer-direction')
    trigger = page.locator('#composer-direction-trigger')
    if not menu.evaluate('node => node.open'):
        trigger.click()
    page.locator(f'input[name="composer-type"][value="{direction}"]').check()
    expect(page.locator('#composer-direction-icon')).to_have_attribute('href', f'assets/ui-icons.svg#icon-{direction}')
    if menu.evaluate('node => node.open'):
        trigger.click()
