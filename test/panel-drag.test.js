import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../extension/panel-drag.js', import.meta.url), 'utf8').replace(/^import .*\n/m,'').replace(/export /g,'');

test('saving a drag uses the final clamped pointer target even when the screen still reports the preceding frame', () => {
  const listeners = {};
  let saved, target;
  const handle = {addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:()=>{},
    setPointerCapture:()=>{},hasPointerCapture:()=>true,releasePointerCapture:()=>{}};
  const context = vm.createContext({});vm.runInContext(source,context);
  context.installPanelDrag(handle,{getPosition:()=>({left:100,top:100}),
    setPosition:position=>{target=position;return {left:Math.min(position.left,120),top:position.top}},onEnd:position=>{saved=position}});
  const event=(type,x,y)=>({type,button:0,pointerId:1,clientX:x,clientY:y,target:{closest:()=>null},preventDefault:()=>{},stopPropagation:()=>{}});
  listeners.pointerdown(event('pointerdown',10,10));
  listeners.pointermove(event('pointermove',20,20));
  listeners.pointerup(event('pointerup',40,30));
  assert.equal(target.left,130); assert.equal(target.top,120);
  assert.equal(saved.left,120); assert.equal(saved.top,120);
});
