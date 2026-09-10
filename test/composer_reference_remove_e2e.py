"""Removing a selected library reference must persist and stop sending its image/text."""
import json
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session, ai_configuration_fixture, wait_for_async_condition

def main():
    entry=base_entry('case','可移除的人像参考','ONLY_SELECTED_REFERENCE_TEXT','content:reference')
    entry['mediaAssets']=[{'id':'image','kind':'image','usage':'content','storageMode':'managed','mimeType':'image/png'}]
    draft={'id':'remove-reference','messages':[{'id':'q','role':'user','content':'选择这份参考'}], 'referenceSnapshots':[{'entryId':'case','assetId':'image','alias':'@参考1','title':'可移除的人像参考','referenceText':'ONLY_SELECTED_REFERENCE_TEXT','imageRefs':[{'visualId':'image'}]}]}
    with extension_session('prompt-director-remove-reference-') as run:
        setup=run.open_page('collector.html')
        run.seed_storage(setup,{'schemaVersion':24,'entries':[entry],'composerSessions':[draft],**ai_configuration_fixture(providers={'deepseek':{'apiKey':'fixture','consent':True,'models':{'creativePlanning':'deepseek-flash'}}},assignments={'creativePlanning':{'providerId':'deepseek','model':'deepseek-flash'}})})
        page=run.open_page('composer.html?session=remove-reference')
        expect(page.locator('#composer-reference-count')).to_have_text('1')
        page.get_by_role('button',name='取消参考：可移除的人像参考').click()
        expect(page.locator('#composer-reference-count')).to_have_text('0')
        page.reload();expect(page.locator('#composer-reference-count')).to_have_text('0')
        # The reference picker must also be able to remove its selected chip.
        page.locator('#composer-reference-open').click()
        page.locator('.composer-case-preview-checkbox').check()
        expect(page.locator('.composer-selection-chip')).to_have_count(1)
        page.locator('.composer-selection-chip').get_by_role('button',name='移除参考').click()
        expect(page.locator('.composer-selection-chip')).to_have_count(0)
        expect(page.locator('.composer-case-preview-checkbox')).not_to_be_checked()
        page.locator('#composer-reference-apply').click()
        expect(page.locator('#composer-reference-count')).to_have_text('0')
        requests=[]
        def reply(route):
            requests.append(route.request.post_data_json)
            route.fulfill(status=200,content_type='text/event-stream',body='data: '+json.dumps({'choices':[{'delta':{'content':'{"route":"chat","status":"ready"}\n现在正常讨论。'},'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n')
        page.route('https://api.deepseek.com/**',reply)
        page.locator('#composer-instruction').fill('不参考案例了，聊聊创意')
        page.locator('#composer-action').click()
        expect(page.locator('.composer-message.chat')).to_have_count(1)
        assert len(requests)==1
        assert 'ONLY_SELECTED_REFERENCE_TEXT' not in json.dumps(requests[0])
        assert 'image_url' not in json.dumps(requests[0])
        stored=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:'remove-reference'})).session")
        assert not stored['referenceSnapshots']
        assert not run.page_errors,run.page_errors
        print('PASS: footer remove, reload, picker X, persisted empty references, zero removed text/images in next request')
if __name__=='__main__':main()
