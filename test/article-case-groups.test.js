import test from 'node:test';
import assert from 'node:assert/strict';
import { splitArticleCases } from '../extension/article-case-groups.js';
const heading = (id,text,level=2) => ({id,kind:'heading',text,level});
const paragraph = (id,text) => ({id,kind:'paragraph',text});
const image = id => ({id,kind:'image',assetId:id});
function candidate(blocks) { return {id:'article',title:'Article',canonicalUrl:'https://example.com/article',sourceFacts:{},media:blocks.filter(b=>b.kind==='image').map(b=>({id:b.id,kind:'image',url:`https://example.com/${b.id}.png`})),articleDocument:{blocks:blocks.map((b,sourceOrder)=>({...b,sourceOrder}))}}; }
test('case boundaries keep multiple images with the correct prompt and leave intro separate',()=>{
 const groups=splitArticleCases(candidate([paragraph('intro','Introduction'),image('cover'),heading('a','No. 1: Portrait'),heading('ap','提示词',3),paragraph('at','Portrait prompt'),image('a1'),image('a2'),heading('b','No. 2: Landscape'),heading('bp','提示词',3),paragraph('bt','Landscape prompt'),image('b1'),paragraph('bonus','彩蛋：Extra case'),image('c1'),{id:'ct',kind:'quote',text:'Extra prompt'}]));
 assert.equal(groups.length,4);
 assert.deepEqual(groups.map(g=>g.media.map(m=>m.id)),[['a1','a2'],['b1'],['c1'],['cover']]);
 assert.ok(groups[0].contentText.includes('Portrait prompt'));
 assert.ok(!groups[0].contentText.includes('Landscape prompt'));
 assert.equal(groups[3].batchStructureStatus,'review');
});
test('ordinary article headings and images alone do not invent independent prompt cases',()=>{
 assert.deepEqual(splitArticleCases(candidate([heading('a','Chapter 1'),paragraph('x','Some prose'),image('a1'),heading('b','Chapter 2'),paragraph('y','More prose'),image('b1')])),[]);
});
test('numbered paragraph headings can delimit styled articles; numbers inside prompt code cannot',()=>{
 const groups=splitArticleCases(candidate([paragraph('a','1、人物案例'),paragraph('ap','提示词：portrait'),{id:'code',kind:'code',text:'1. lighting\n2. composition'},image('a1'),paragraph('b','2、建筑案例'),paragraph('bp','Prompt: architecture'),image('b1')]));
 assert.equal(groups.length,2);
 assert.deepEqual(groups[0].media.map(m=>m.id),['a1']);
 assert.ok(groups[0].contentText.includes('2. composition'));
});
