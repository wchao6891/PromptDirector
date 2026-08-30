from __future__ import annotations

import tempfile
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
                    phase: 'generation',
                    actualStages: ['preparing_media', 'media_prepared']
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
            composer.wait_for_function(
                """async () => {
                  const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
                  const session = await chrome.runtime.sendMessage({
                    type: 'GET_COMPOSER_SESSION',
                    sessionId: 'recovery-session'
                  });
                  const job = state.creativeJobs?.items?.find((item) => item.id === 'recovery-job');
                  return job?.status === 'interrupted'
                    && job.error?.retryable === true
                    && session?.ok === true
                    && session.session?.lastFailure?.retryable === true;
                }""",
                timeout=15_000,
            )
            jobs = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs)")

            assert jobs and len(jobs["items"]) == 1, jobs
            interrupted = jobs["items"][0]
            if interrupted["status"] != "interrupted":
                diagnostics = []
                for _ in range(5):
                    diagnostics.append(composer.evaluate(
                        """async () => {
                          const stored = await chrome.storage.local.get(['creativeJobs', 'composerSessions']);
                          const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
                          const session = await chrome.runtime.sendMessage({
                            type: 'GET_COMPOSER_SESSION', sessionId: 'recovery-session'
                          });
                          return {
                            storedJob: stored.creativeJobs?.items?.[0],
                            storedFailure: stored.composerSessions?.find(item => item.id === 'recovery-session')?.lastFailure,
                            publicJob: state.creativeJobs?.items?.[0],
                            publicFailure: session.session?.lastFailure,
                            timeline: document.querySelector('#composer-timeline')?.innerText || ''
                          };
                        }"""
                    ))
                    composer.wait_for_timeout(200)
                raise AssertionError({"interrupted": interrupted, "diagnostics": diagnostics})
            assert interrupted["status"] == "interrupted", interrupted
            assert interrupted["error"]["retryable"] is True, interrupted
            assert interrupted["actualStages"] == ["preparing_media", "media_prepared"], interrupted
            assert not interrupted.get("retryOf"), interrupted
            expect(composer.get_by_role("button", name="重试本轮", exact=True)).to_be_visible(timeout=15_000)
            serialized = str(jobs)
            assert "apiKey" not in serialized and "data:image" not in serialized

            cancel_result = composer.evaluate(
                """async () => {
                  const {createCreativeJob, updateCreativeJob} = await import(chrome.runtime.getURL('creative-jobs.js'));
                  const stored = await chrome.storage.local.get('creativeJobs');
                  const request = stored.creativeJobs.items[0].request;
                  const created = createCreativeJob(stored.creativeJobs, request, {id: 'missing-runner-job'});
                  const running = updateCreativeJob(created.state, 'missing-runner-job', {
                    status: 'running', phase: 'generation', actualStages: ['preparing_media']
                  });
                  await chrome.storage.local.set({creativeJobs: running});
                  return chrome.runtime.sendMessage({type: 'CANCEL_CREATIVE_JOB', jobId: 'missing-runner-job'});
                }"""
            )
            assert cancel_result["ok"] is True, cancel_result
            assert cancel_result["job"]["status"] == "canceled", cancel_result
            replacement = composer.evaluate("() => chrome.storage.local.get('creativeJobs').then(value => value.creativeJobs.items.find(item => item.id === 'missing-runner-job'))")
            assert replacement["status"] == "canceled", replacement
            assert replacement["actualStages"] == ["preparing_media"], replacement

            unknown_stop = composer.evaluate(
                """async () => {
                  const {createCreativeJob, updateCreativeJob} = await import(chrome.runtime.getURL('creative-jobs.js'));
                  const stored = await chrome.storage.local.get('creativeJobs');
                  const sourceRequest = stored.creativeJobs.items[0].request;
                  const request = {
                    ...sourceRequest,
                    session: {...sourceRequest.session, targetType: 'video', outputMode: 'create_video'}
                  };
                  const created = createCreativeJob(stored.creativeJobs, request, {id: 'accepted-missing-runner-job'});
                  const running = updateCreativeJob(created.state, 'accepted-missing-runner-job', {
                    status: 'running', phase: 'generation', providerMayHaveAccepted: true,
                    actualStages: ['preparing_media', 'media_prepared', 'provider_request'],
                    remoteVideo: {
                      serviceId: 'openai', remoteId: 'remote-stop-unknown', finalPrompt: '保留同一远程任务', requestParameters: {}
                    }
                  });
                  await chrome.storage.local.set({creativeJobs: running});
                  return chrome.runtime.sendMessage({type: 'CANCEL_CREATIVE_JOB', jobId: 'accepted-missing-runner-job'});
                }"""
            )
            assert unknown_stop["ok"] is True, unknown_stop
            assert unknown_stop["job"]["status"] == "interrupted", unknown_stop
            assert unknown_stop["job"]["executionState"] == "stop_unknown", unknown_stop
            assert unknown_stop["job"]["providerMayHaveAccepted"] is True, unknown_stop
            assert unknown_stop["job"]["actualStages"] == ["preparing_media", "media_prepared", "provider_request"], unknown_stop

            late_result = composer.evaluate(
                """async () => {
                  const {retryCreativeJob} = await import(chrome.runtime.getURL('creative-jobs.js'));
                  const stored = await chrome.storage.local.get('creativeJobs');
                  const retried = retryCreativeJob(stored.creativeJobs, 'accepted-missing-runner-job', {id: 'explicit-retry-job'});
                  await chrome.storage.local.set({creativeJobs: retried.state});
                  const waitForRetry = async () => {
                    for (let index = 0; index < 100; index += 1) {
                      const current = await chrome.storage.local.get('creativeJobs');
                      const retry = current.creativeJobs?.items?.find(item => item.id === 'explicit-retry-job');
                      if (retry) return retry;
                      await new Promise(resolve => setTimeout(resolve, 20));
                    }
                    throw new Error('显式重试任务没有稳定写入本地存储');
                  };
                  await waitForRetry();
                  const late = await chrome.runtime.sendMessage({
                    type: 'COMPLETE_CREATIVE_JOB',
                    jobId: 'accepted-missing-runner-job',
                    session: retried.job.request.session,
                    visuals: [],
                    generation: null
                  });
                  return {
                    late,
                    retry: await waitForRetry()
                  };
                }"""
            )
            assert late_result["late"]["ok"] is False, late_result
            assert late_result["retry"]["status"] == "queued", late_result
            assert late_result["retry"]["remoteVideo"]["remoteId"] == "remote-stop-unknown", late_result
            second.close()

            print({
                "interrupted": True,
                "automaticRetry": False,
                "jobCount": len(jobs["items"]),
                "manualRetryVisible": True,
                "missingRunnerLockReleased": True,
                "acceptedMissingRunnerStopUnknown": True,
                "lateResultRejected": True,
                "remoteIdentityPreserved": True,
            })


if __name__ == "__main__":
    main()
