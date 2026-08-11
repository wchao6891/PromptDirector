from __future__ import annotations

import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from e2e_support import launch_context


def extension_id(context) -> str:
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
    return worker.url.split("/")[2]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-director-creative-recovery-") as profile:
        profile_dir = Path(profile)
        with sync_playwright() as playwright:
            first = launch_context(
                playwright,
                str(profile_dir),
                viewport={"width": 1280, "height": 900},
                accept_downloads=True,
            )
            first_id = extension_id(first)
            setup = first.new_page()
            setup.goto(f"chrome-extension://{first_id}/collector.html")
            setup.evaluate(
                """async () => {
                  const {createCreativeJob, updateCreativeJob} = await import(chrome.runtime.getURL('creative-jobs.js'));
                  const session = {
                    id: 'recovery-session',
                    title: '浏览器中断恢复',
                    targetType: 'image',
                    outputMode: 'create_image',
                    aiProfile: {serviceId: 'openai', model: 'gpt-5-mini', thinking: false},
                    messages: [{
                      id: 'recovery-user-message',
                      role: 'user',
                      type: 'request',
                      content: '创建一张不会自动重试的图片'
                    }]
                  };
                  const created = createCreativeJob(undefined, {
                    session,
                    userMessageId: 'recovery-user-message',
                    startPhase: 'planning',
                    imageEdit: null
                  }, {id: 'recovery-job'});
                  const running = updateCreativeJob(created.state, 'recovery-job', {
                    status: 'running',
                    phase: 'generation'
                  });
                  await chrome.storage.local.set({
                    creativeJobs: running,
                    composerSessions: [created.job.request.session]
                  });
                }"""
            )
            first.close()

            second = launch_context(
                playwright,
                str(profile_dir),
                viewport={"width": 1280, "height": 900},
                accept_downloads=True,
            )
            second_id = extension_id(second)
            composer = second.new_page()
            composer.goto(f"chrome-extension://{second_id}/composer.html?session=recovery-session")
            deadline = time.monotonic() + 8
            jobs = None
            while time.monotonic() < deadline:
                jobs = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs)")
                if jobs and jobs["items"][0]["status"] == "interrupted":
                    break
                composer.wait_for_timeout(100)

            assert jobs and len(jobs["items"]) == 1, jobs
            interrupted = jobs["items"][0]
            assert interrupted["status"] == "interrupted", interrupted
            assert interrupted["error"]["retryable"] is True, interrupted
            assert not interrupted.get("retryOf"), interrupted
            expect(composer.get_by_role("button", name="重试本轮", exact=True)).to_be_visible()
            serialized = str(jobs)
            assert "apiKey" not in serialized and "data:image" not in serialized

            cancel_result = composer.evaluate(
                """async () => {
                  const {createCreativeJob, updateCreativeJob} = await import(chrome.runtime.getURL('creative-jobs.js'));
                  const stored = await chrome.storage.local.get('creativeJobs');
                  const request = stored.creativeJobs.items[0].request;
                  const created = createCreativeJob(stored.creativeJobs, request, {id: 'missing-runner-job'});
                  const running = updateCreativeJob(created.state, 'missing-runner-job', {
                    status: 'running', phase: 'generation'
                  });
                  await chrome.storage.local.set({creativeJobs: running});
                  return chrome.runtime.sendMessage({type: 'CANCEL_CREATIVE_JOB', jobId: 'missing-runner-job'});
                }"""
            )
            assert cancel_result["ok"] is True, cancel_result
            assert cancel_result["job"]["status"] == "canceled", cancel_result
            replacement = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs.items.find(item => item.id === 'missing-runner-job'))")
            assert replacement["status"] == "canceled", replacement
            second.close()

            print({
                "interrupted": True,
                "automaticRetry": False,
                "jobCount": len(jobs["items"]),
                "manualRetryVisible": True,
                "missingRunnerLockReleased": True,
            })


if __name__ == "__main__":
    main()
