"""Opt-in synthetic library benchmark in an isolated browser; never uses a real profile/model."""
import argparse
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--counts', type=int, nargs='+', default=[1000, 10000, 200000])
    parser.add_argument('--page', action='store_true')
    parser.add_argument('--items', type=int, default=3)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='pd-batch-perf-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        source = (EXTENSION_DIR / 'background.js').read_text()
        original = 'createExternalAnalysisBatches({storage:libraryStorage,loadState:readState,\n  commit:commitLocalChanges,'
        assert original in source
        source = source.replace(original, "createExternalAnalysisBatches({storage:libraryStorage,loadState:()=>benchmarkMeasure('loadState',readState),\n  commit:update=>benchmarkMeasure('commit',()=>commitLocalChanges(update)),")
        source += '''\nimport {normalizeEntryMedia as benchmarkNormalize} from './media.js';
import {caseRevision as benchmarkRevision} from './case-operations.js';
async function benchmarkMeasure(stage,fn) {
          const start=performance.now();try{return await fn();}finally{(globalThis.benchmarkTimings??=[]).push({stage,ms:performance.now()-start});}
        }
        globalThis.benchmarkBatch=async({count,page,items:itemCount})=>{
          await readState();
          const base=benchmarkNormalize({id:'fixture',title:'合成案例',text:'人工正文',savedAt:'2026-10-01T00:00:00Z'});
          const entries=Array.from({length:count},(_,i)=>({...base,id:`perf-${count}-${i}`}));
          const fixtureBytes=new Blob([JSON.stringify(entries)]).size;
          await chrome.storage.local.set({entries,organizerState:{collections:[]},compoundCases:[]});
          const state=await readState();
          const items=await Promise.all(state.entries.slice(0,itemCount).map(async entry=>({caseId:entry.id,expectedRevision:await benchmarkRevision(state,entry),assets:[]})));
          await dispatchAgentOperation('manage_analysis_batch',{action:'create',requestId:`perf-${count}`,instruction:'合成性能夹具，不是真实分析',items});
          const batch=await dispatchAgentOperation('read_analysis_batch',{batchId:`perf-${count}`});
          globalThis.benchmarkTimings=[];const samples=[];
          if(page) {
            const started=performance.now();
            const result=await dispatchAgentOperation('submit_analysis_results',{requestId:`page-${count}`,batchId:batch.id,epoch:0,items:batch.items.map(row=>({caseId:row.caseId,attemptId:row.attemptId,result:{tags:[{g:'scene.place',t:'摄影棚'}]}}))});
            if(result.items.length!==itemCount||result.items.some(item=>item.state!=='saved'))throw Error(JSON.stringify(result));
            samples.push(performance.now()-started);
          } else for(const row of batch.items) {
            const started=performance.now();
            const result=await dispatchAgentOperation('submit_analysis_result',{requestId:`result-${row.caseId}`,batchId:batch.id,caseId:row.caseId,attemptId:row.attemptId,epoch:0,result:{tags:[{g:'scene.place',t:'摄影棚'}]}});
            if(result.item.state!=='saved')throw Error(JSON.stringify(result));
            samples.push(performance.now()-started);
          }
          const stages=globalThis.benchmarkTimings;
          const started=performance.now();const found=await dispatchAgentOperation('list_analysis_batches',{query:`perf-${count}`});
          if(found.total!==1)throw Error('Discovery failed');
          const discoveryMs=performance.now()-started;
          const after=await readState();
          if(after.entries.length!==count||after.entries.slice(0,itemCount).some(e=>e.text!=='人工正文'||!e.facetAssignments?.length))throw Error('Readback failed');
          return {count,mode:page?'page':'single',items:itemCount,fixtureBytes,samples,stages,discoveryMs,readback:true};
        };\n'''
        (ext / 'background.js').write_text(source)
        with extension_session('pd-batch-perf-profile-', extension_dir=ext) as run:
            worker = run.context.service_workers[0]
            for count in args.counts:
                print(json.dumps(worker.evaluate('(input)=>benchmarkBatch(input)', {'count': count, 'page': args.page, 'items': args.items}), ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
