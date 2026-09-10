"""Verify the startup attachment recovery against a real isolated extension."""
from e2e_support import PlaywrightTimeoutError, extension_session, wait_for_extension_worker


class MissedStartupNotification:
    """Hide only the first notification; all recovery operations use Chromium."""

    def __init__(self, context):
        self.context = context
        self.missed = True

    @property
    def service_workers(self):
        return [] if self.missed else self.context.service_workers

    def wait_for_event(self, event):
        if self.missed:
            self.missed = False
            raise PlaywrightTimeoutError("Synthetic missed startup notification")
        return self.context.wait_for_event(event)

    def __getattr__(self, key):
        return getattr(self.context, key)


def main():
    with extension_session("prompt-director-worker-attachment-") as session:
        worker = wait_for_extension_worker(MissedStartupNotification(session.context))
        assert worker.url == f"chrome-extension://{session.extension_id}/background.js"
        page = session.open_page("collector.html")
        state = page.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert state["ok"] is True
        print("PASS: isolated worker reattached and extension state available")


if __name__ == "__main__":
    main()
