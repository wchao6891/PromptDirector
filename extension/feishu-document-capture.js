// Runs in the page's isolated world. Accumulate rendered blocks before virtualization removes them.
export async function collectFeishuDocument({ sessionId, timeoutMs } = {}) {
  const rootSelector = '.docx-page-block .page-block.root-block';
  const root = document.querySelector(rootSelector);
  if (!root || String(window.getSelection?.() || '').trim()) return null;
  let scroller = root.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
  if (!scroller) return null;
  const start = { top: scroller.scrollTop, left: scroller.scrollLeft };
  let cancelled = false;
  const cancel = (message, _sender, reply) => {
    if (message?.type === 'PROMPTDIRECTOR_PAGE_CAPTURE' && message.sessionId === sessionId && message.action === 'cancel') {
      cancelled = true;
      reply({ ok: true, cancelled: true });
    }
  };
  chrome.runtime.onMessage.addListener(cancel);
  const clean = text => String(text || '').replace(/[\u200b\ufeff]/g, '').trim();
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const items = new Map();
  const pending = new Set();
  const pendingPositions = new Map();
  const mediaByKey = new Map();
  const blobData = new Map();
  const tables = new Map();
  const targets = new Map();
  const marker = `feishu:${sessionId}`;
  const rootTitle = clean(root.querySelector('h1')?.textContent);
  let sequence = 0;
  let timedOut = false;
  const position = node => {
    const r = node.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    return { top: r.top - s.top + scroller.scrollTop, left: r.left - s.left + scroller.scrollLeft };
  };
  const ordered = values => [...values].sort((a,b)=>a.top-b.top || a.left-b.left || a.order-b.order);
  function registerCell(cell) {
    const table = cell.closest('[data-block-type=table]');
    const tableId = table?.getAttribute('data-record-id');
    const cellId = cell.getAttribute('data-record-id');
    const row = cell.parentElement;
    const rowKey = row.getAttribute('data-index');
    if (!tableId || !cellId || rowKey === null || !Number.isFinite(Number(rowKey))) return null;
    let group = tables.get(tableId);
    if (!group) { group = { ...position(table), order: sequence++, rows: new Map() }; tables.set(tableId, group); }
    if (!group.rows.has(rowKey)) group.rows.set(rowKey, new Map());
    const cells = group.rows.get(rowKey);
    if (!cells.has(cellId)) cells.set(cellId, { index:[...row.cells].indexOf(cell), rowspan:cell.rowSpan, colspan:cell.colSpan,
      width:cell.getBoundingClientRect().width, align:getComputedStyle(cell).textAlign, valign:getComputedStyle(cell).verticalAlign, header:cell.tagName==='TH', items:new Map() });
    return { tableId, cell: cells.get(cellId) };
  }
  async function collect() {
    const current = document.querySelector(rootSelector);
    if (!current) return false;
    current.setAttribute('data-promptdirector-capture-region', marker);
    // Empty cells and rows also carry layout, even when there is no text or media to collect.
    for (const cell of current.querySelectorAll('td[data-record-id],th[data-record-id]')) registerCell(cell);
    for (const node of current.querySelectorAll('h1,h2,h3,h4,h5,h6,.zone-container.text-editor,img,video,canvas')) {
      if (node.closest('nav,aside,[role=complementary],#docCommentContainer')) continue;
      if (node.matches('img,canvas') && (!node.getBoundingClientRect().width || !node.getBoundingClientRect().height)) continue;
      if (node.matches('.zone-container.text-editor') && node.closest('h1,h2,h3,h4,h5,h6')) continue;
      const block = node.closest('[data-record-id]');
      const identity = block?.getAttribute('data-record-id');
      const peers = block ? [...block.querySelectorAll('h1,h2,h3,h4,h5,h6,.zone-container.text-editor,img,video,canvas')] : [];
      const ownImage = node.matches('img') && block?.getAttribute('data-block-type') === 'image';
      const canvasNode = node.matches('canvas');
      const key = identity ? `${identity}:${ownImage ? 'image' : canvasNode ? 'canvas' : peers.indexOf(node)}` : node.matches('h1') ? 'title' : '';
      if (!key) continue;
      if (canvasNode) {
        const layers=[...block.querySelectorAll('canvas')].filter(layer=>layer.getBoundingClientRect().width && layer.getBoundingClientRect().height);
        if (layers[0] !== node) continue;
        const r=node.getBoundingClientRect(), v=scroller.getBoundingClientRect();
        if (r.bottom<=v.top || r.top>=v.bottom) continue;
      }
      let html = '';
      const canvas = node.matches('canvas');
      const image = node.matches('img') || canvas;
      const video = node.matches('video');
      const text = clean(node.textContent);
      if (image || video) {
        const src = canvas ? '' : node.currentSrc || node.getAttribute('src');
        if (!canvas && (!src || image && (!node.complete || !node.naturalWidth))) { pending.add(key); pendingPositions.set(key,position(node).top); continue; }
        let dataUrl = blobData.get(src) || "";
        if (canvas) {
          try {
            const layers=[...block.querySelectorAll('canvas')].filter(layer=>layer.getBoundingClientRect().width && layer.getBoundingClientRect().height);
            const base=node.getBoundingClientRect();
            const snapshot=document.createElement('canvas');snapshot.width=node.width;snapshot.height=node.height;
            const context=snapshot.getContext('2d');
            for(const layer of layers) {
              const rect=layer.getBoundingClientRect();
              context.drawImage(layer,(rect.left-base.left)*node.width/base.width,(rect.top-base.top)*node.height/base.height,rect.width*node.width/base.width,rect.height*node.height/base.height);
            }
            dataUrl=snapshot.toDataURL('image/png');
          }
          catch { pending.add(key); pendingPositions.set(key,position(node).top); continue; }
        }
        if (image && src.startsWith('blob:') && !dataUrl) {
          try {
            const response = await fetch(src);
            if (!response.ok) throw new Error('Image unavailable');
            const blob = await response.blob();
            dataUrl = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
            blobData.set(src,dataUrl);
          } catch { pending.add(key); pendingPositions.set(key,position(node).top); continue; }
        }
        pending.delete(key);
        const width = node.naturalWidth || node.videoWidth || node.width || 0;
        const height = node.naturalHeight || node.videoHeight || node.height || 0;
        const previous = mediaByKey.get(key);
        if (!canvas && previous && previous.width * previous.height > width * height) continue;
        const assetId = `feishu-media:${key}`;
        mediaByKey.set(key,{id:assetId,kind:image?'image':'video',url:src.startsWith('blob:')?'':src,dataUrl,
          width,height,alt:canvas?'思维导图画面快照':node.alt||'',captureMethod:canvas?'pixel-fallback':dataUrl?'page-session':'source',placement:'inline'});
        html = image ? `<img data-promptdirector-asset-id="${escape(assetId)}" src="${escape(canvas ? dataUrl : src)}" width="${width}" height="${height}" alt="${escape(node.alt || '')}">` : `<video controls src="${escape(src)}" poster="${escape(node.poster || '')}"></video>`;
      } else {
        if (!text) continue;
        const tag = /^H[1-6]$/.test(node.tagName) ? node.tagName.toLowerCase() : 'p';
        const clone = node.cloneNode(true);
        for (const line of clone.querySelectorAll('div')) {
          const span = document.createElement('span'); span.innerHTML = line.innerHTML;
          if (line.nextSibling) span.append(document.createElement('br'));
          line.replaceWith(span);
        }
        for (const element of clone.querySelectorAll('*')) for (const attr of [...element.attributes]) {
          if (!['href','style'].includes(attr.name)) element.removeAttribute(attr.name);
        }
        html = `<${tag}>${clone.innerHTML}</${tag}>`;
      }
      const old = items.get(key);
      const item = { key, html, ...position(node), order: old?.order ?? sequence++ };
      const cell = node.closest('td[data-record-id],th[data-record-id]');
      const table = cell?.closest('[data-block-type=table]');
      if (cell && table) {
        const registered = registerCell(cell);
        if (!registered) continue;
        registered.cell.items.set(key, item);
        item.table = registered.tableId;
      }
      items.set(key, item);
      if (identity && !image && !video) targets.set(key, { kind:'text',path:`[data-record-id="${identity}"] .zone-container.text-editor`,articleBlockIds:[],mediaIds:[] });
    }
    return true;
  }
  async function settle() {
    // Require a quiet DOM after scroll-triggered asynchronous block rendering.
    await new Promise(resolve => {
      let quiet;
      const done = () => { clearTimeout(quiet); clearTimeout(deadline); observer.disconnect(); resolve(); };
      const changed = () => { clearTimeout(quiet); quiet = setTimeout(done, 150); };
      const observer = new MutationObserver(changed);
      observer.observe(root, { childList:true, subtree:true, characterData:true });
      const deadline = setTimeout(()=>{ timedOut=true; done(); }, timeoutMs);
      changed();
    });
    const images = [...(document.querySelector(rootSelector)?.querySelectorAll('img') || [])].filter(node => {
      const r=node.getBoundingClientRect(), s=scroller.getBoundingClientRect(); return r.bottom>s.top && r.top<s.bottom;
    });
    let timer;
    await Promise.race([Promise.allSettled(images.map(node=>node.decode())),new Promise(resolve=>{timer=setTimeout(()=>{timedOut=true;resolve();},timeoutMs);})]);
    clearTimeout(timer);
  }
  let reachedEnd = false;
  try {
    scroller.scrollTo({top:0,left:0,behavior:'instant'});
    let bottomPasses = 0;
    while (!cancelled) {
      await settle();
      if (!await collect()) break;
      const end = Math.max(0, scroller.scrollHeight-scroller.clientHeight);
      if (scroller.scrollTop >= end-1) {
        bottomPasses += 1;
        if (bottomPasses >= 2) { reachedEnd=true; break; }
      } else bottomPasses=0;
      const next = Math.min(end, scroller.scrollTop + Math.max(1,Math.floor(scroller.clientHeight * 0.85)));
      const previous=scroller.scrollTop;
      scroller.scrollTo({top:next,behavior:'instant'});
      if (next>previous && scroller.scrollTop===previous) break;
    }
    // Revisit unloaded media once it has a chance to enter the viewport, including clipped table cells.
    for (const key of [...pending]) {
      if (cancelled) break;
      scroller.scrollTo({top:pendingPositions.get(key),behavior:'instant'});
      await settle();
      const recordId=key.slice(0,key.lastIndexOf(':'));
      const node=document.querySelector(`[data-record-id="${recordId}"] img`);
      node?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      await settle();
      await collect();
    }
  } finally {
    scroller.scrollTo({...start,behavior:'instant'});
    chrome.runtime.onMessage.removeListener(cancel);
  }
  const output = ordered([...items.values()].filter(item=>!item.table));
  for (const table of tables.values()) {
    const rows=[...table.rows].sort((a,b)=>Number(a[0])-Number(b[0])).map(([,cells])=>'<tr>'+[...cells.values()].sort((a,b)=>a.index-b.index).map(cell=>`<${cell.header?'th':'td'} rowspan="${cell.rowspan}" colspan="${cell.colspan}" width="${cell.width}" align="${escape(cell.align)}" valign="${escape(cell.valign)}">${ordered(cell.items.values()).map(item=>item.html).join('')}</${cell.header?'th':'td'}>`).join('')+'</tr>').join('');
    output.push({...table,html:`<table>${rows}</table>`});
  }
  const html=ordered(output).map(item=>item.html).join('\n');
  const fragment=document.createElement('div');fragment.innerHTML=html;
  return { html, media:[...mediaByKey.values()], title:rootTitle, text:clean(fragment.textContent), mediaCount:fragment.querySelectorAll('img,video').length,
    complete:reachedEnd&&!cancelled&&!timedOut&&!pending.size, pendingMediaCount:pending.size, reachedEnd, timedOut, cancelled, marker, targets:[...targets.values()] };
}
