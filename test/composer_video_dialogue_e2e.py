from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import expect

from e2e_support import SOURCE_EXTENSION_DIR, ai_configuration_fixture, extension_session, wait_for_async_condition
from zhipu_glm_analysis_e2e import extension_with_local_provider_permission


@contextmanager
def streaming_provider(requests, release):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(payload)
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            def send(text, finish=None):
                event = {'model': payload['model'], 'choices': [{'delta': {'content': text}, 'finish_reason': finish}]}
                self.wfile.write(('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode())
                self.wfile.flush()

            try:
                send('视频中的主体正在移动，')
                if not release.wait(30):
                    return
                send('镜头保持连续。', 'stop')
                self.wfile.write(b'data: [DONE]\n\n')
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/api/v1'
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def run_route(provider_id, model, temporary):
    requests = []
    release = threading.Event()
    with streaming_provider(requests, release) as endpoint, extension_with_local_provider_permission(endpoint) as extension_dir, extension_session(
        'promptdirector-video-dialogue-', extension_dir=extension_dir
    ) as run:
        setup = run.open_page('collector.html')
        provider_endpoint = endpoint if provider_id == 'openrouter' else endpoint + '/chat/completions'
        run.seed_storage(setup, {
            'schemaVersion': 24, 'entries': [],
            **ai_configuration_fixture(providers={provider_id: {
                'apiKey': 'local-fixture-key', 'consent': True, 'endpoint': provider_endpoint,
                'models': {'creativePlanning': model, 'videoAnalysis': model},
                'discoveredModels': [{'id': model, 'status': 'available', 'tasks': ['creativePlanning', 'videoAnalysis'],
                                      'inputModalities': ['text', 'image', 'video'], 'outputModalities': ['text']}]
            }}, assignments={'creativePlanning': {'providerId': provider_id, 'model': model}})
        })
        setup.evaluate(r'''async ({providerId, model, temporary}) => {
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const {createComposerSession} = await import(chrome.runtime.getURL('composer.js'));
          await saveMediaBlob('video-fixture', new Blob(['video'], {type: 'video/mp4'}));
          const session = createComposerSession({
            id: 'video-dialogue', targetType: 'video', routeMode: 'analyze_materials',
            messages: [{id: 'context', role: 'user', type: 'request', content: '我会添加一段视频作为参考。'}],
            aiProfile: {serviceId: providerId, model},
            appliedSkills: [{skillId: 'visible-motion', versionId: '1', callName: '动作观察', portableId: 'visible-motion',
              skillMarkdown: '# 动作观察\n先描述可见动作，再说明不确定项。'}],
            referenceSnapshots: temporary ? [] : [{entryId: 'case', alias: '@参考1', referenceKind: 'video_sources',
              referenceText: '[原始提示词] 主体移动\n[人工时间点笔记] 00:01 向右移动', originalText: '主体移动',
              assetRefs: [{assetId: 'video-fixture', kind: 'video', mimeType: 'video/mp4'}]}]
          });
          const saved = await chrome.runtime.sendMessage({type: 'UPSERT_COMPOSER_SESSION', session});
          if (!saved.ok) throw new Error(saved.message);
        }''', {'providerId': provider_id, 'model': model, 'temporary': temporary})
        page = run.open_page('composer.html?session=video-dialogue', wait_until='networkidle')
        if temporary:
            page.locator('#composer-attachment-files').set_input_files(str(SOURCE_EXTENSION_DIR / 'test/fixtures/zhipu-local-video-smoke.mp4'))
        try:
            expect(page.locator('.composer-temp-reference-card' if temporary else '.composer-input-reference-card')).to_have_count(1)
        except AssertionError:
            print({'attachmentFeedback': page.locator('#composer-feedback').inner_text(), 'pageErrors': run.page_errors})
            raise
        page.locator('#composer-instruction').fill('分析视频中可见的动作，不推断音轨')
        page.locator('#composer-action').click()
        wait_for_async_condition(page, '''async () => {
          const {session} = await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION', sessionId:'video-dialogue'});
          return session?.activeTurn?.partialText === '视频中的主体正在移动，';
        }''')
        page.reload()
        expect(page.locator('.composer-streaming-caret')).to_contain_text('视频中的主体正在移动，')
        assert len(requests) == 1
        release.set()
        wait_for_async_condition(page, '''async () => {
          const {creativeJobs} = await chrome.storage.local.get('creativeJobs');
          return creativeJobs?.items?.at(-1)?.status === 'completed';
        }''')
        expect(page.locator('.composer-message.analysis')).to_contain_text('镜头保持连续。')
        body = requests[0]
        assert body['model'] == model and body['stream'] is True
        assert '先描述可见动作，再说明不确定项。' in json.dumps(body, ensure_ascii=False)
        video = next(part['video_url']['url'] for part in body['messages'][-1]['content'] if part['type'] == 'video_url')
        assert video.startswith('data:video/mp4;base64,') if provider_id == 'openrouter' else not video.startswith('data:')

        release.clear()
        page.locator('#composer-instruction').fill('再次分析这一镜头')
        page.locator('#composer-action').click()
        wait_for_async_condition(page, '''async () => {
          const {session} = await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION', sessionId:'video-dialogue'});
          return session?.activeTurn?.partialText === '视频中的主体正在移动，';
        }''')
        page.locator('#composer-action').click()
        wait_for_async_condition(page, '''async () => {
          const {creativeJobs} = await chrome.storage.local.get('creativeJobs');
          return ['canceled', 'interrupted'].includes(creativeJobs?.items?.at(-1)?.status);
        }''')
        release.set()
        page.reload()
        assert len(requests) == 2
        jobs = page.evaluate("async () => (await chrome.storage.local.get('creativeJobs')).creativeJobs.items")
        assert jobs[-1]['executionState'] == 'stop_unknown'
        print({'provider': provider_id, 'videoBody': True, 'refreshPartial': True, 'stopUnknown': True, 'requests': len(requests), 'paidRequests': 0})


def main():
    run_route('zhipu', 'glm-5.3-flash', False)
    run_route('openrouter', 'google/gemini-3.8-flash', True)


if __name__ == '__main__':
    main()
