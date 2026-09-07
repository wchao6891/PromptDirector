"""Native Chromium gesture check; headless cancellation is not OS-folder acceptance."""
from playwright.sync_api import expect
from e2e_support import extension_session


def main() -> None:
    with extension_session("promptdirector-native-picker-") as session:
        page = session.open_page("library.html")
        expect(page.locator("#settings-dialog")).to_be_visible()
        page.locator('[data-settings-tab="general"]').click()
        page.evaluate("""() => {
          const native = window.showDirectoryPicker.bind(window);
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          const expire = async () => {
            while (navigator.userActivation.isActive) await new Promise(r => setTimeout(r, 25));
          };
          chrome.runtime.sendMessage = async (...args) => {
            if (args[0]?.type === 'GET_FOLDER_BACKUP_STATE') await expire();
            return send(...args);
          };
          window.__pickerResults = [];
          window.showDirectoryPicker = async (options) => {
            const result = {active: navigator.userActivation.isActive};
            try { return await native(options); }
            catch (error) { result.error = error.name; throw error; }
            finally { window.__pickerResults.push(result); }
          };
          const control = document.createElement('button');
          control.id = 'expired-gesture-control';
          control.textContent = 'Expired gesture control';
          control.onclick = async () => {
            await expire();
            try { await window.showDirectoryPicker({mode: 'read'}); } catch {}
            finally { console.info('promptdirector:expired-picker-completed'); }
          };
          document.querySelector('#settings-dialog').append(control);
        }""")
        page.locator("#create-folder-backup").click()
        expect(page.locator("#data-safety-feedback")).to_contain_text("已取消备份", timeout=15000)
        results = page.evaluate("window.__pickerResults")
        assert results == [{"active": True, "error": "AbortError"}], results
        # Polling page state renews automation user activation; wait for an event instead.
        with page.expect_console_message(predicate=lambda message: message.text == "promptdirector:expired-picker-completed", timeout=15000):
            page.locator("#expired-gesture-control").click()
        results = page.evaluate("window.__pickerResults")
        assert results[1] == {"active": False, "error": "SecurityError"}, results
        assert not session.page_errors, session.page_errors
        print("Native picker: product click passes gesture gate; expired control rejected; headless cancels without writing.")


if __name__ == "__main__":
    main()
