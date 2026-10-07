import test from 'node:test';
import assert from 'node:assert/strict';
import { translateForLocale } from '../extension/i18n.js';
import { collectDialogMessages, collectUiMessages, checkUiTranslations } from '../tools/check-ui-i18n.mjs';

const sources = source => collectDialogMessages(source).map(item => item.source);

test('every dialog and t/helper message source has English copy, including raw titles and descriptions', async () => {
  const { messages, missing } = await checkUiTranslations();
  assert.ok(messages.some(item => item.option === 'title' && item.source === '拆分组合案例？'));
  assert.ok(messages.some(item => item.option === 'description' && item.source === '所有原案例、图片、标签和项目关系都会保留。'));
  assert.deepEqual(missing, [], missing.map(item => `${item.file}:${item.line} ${item.option}: ${JSON.stringify(item.source)}`).join('\n'));
});

test('the reported split-dialog leak is found even though its confirm button was already translated', () => {
  const records = collectDialogMessages(`confirmAppAction({title:'拆分组合案例？',
    description:'所有原案例、图片、标签和项目关系都会保留。',confirmLabel:'拆分'});`);
  const simulatedCatalog = new Set(['拆分']);
  assert.deepEqual(records.filter(item => !simulatedCatalog.has(item.source)).map(item => [item.option, item.source]), [
    ['title', '拆分组合案例？'], ['description', '所有原案例、图片、标签和项目关系都会保留。']
  ]);
});

test('AST coverage includes quote styles, conditionals, templates and nested field options', () => {
  const source = `showAppDialog({
    title: condition ? t('标题甲') : t("标题乙"),
    description: unavailable && '暂不可用' || t(\`说明模板：{name}\\n完整说明\`, {name: caseName}),
    confirmLabel: '继续', cancelLabel: "取消", pendingLabel: \`正在处理\`,
    fields: [
      {id:'name',label: optional ? '可选名称' : t('名称'),placeholder:'填写名称',value:caseName},
      {id:'kind',label:'种类',type:'select',options:[{value:'内部中文值',label:'选项一'}]},
      ...items.map(item => ({id:item.id,label:item.title || '未命名条目',help:'选择此项'}))
    ]
  });`;
  assert.deepEqual(sources(source), ['标题甲', '标题乙', '暂不可用', '说明模板：{name}\n完整说明', '继续', '取消',
    '正在处理', '可选名称', '名称', '填写名称', '种类', '选项一', '未命名条目', '选择此项']);
});

test('user content, field values and t interpolation values are not interface keys', () => {
  assert.deepEqual(sources(`
    const userCase={title:'我的中文案例',text:'完整中文正文'};
    const title='外层系统标题';
    function edit(title) {
      promptAppText({title,description:userCase.text,value:'用户输入内容',placeholder:'输入名称',
        label:t('编辑{name}',{name:'中文案例名'}),fields:[{id:'title',value:'原始中文标题'}]});
    }
  `), ['输入名称', '编辑{name}']);
});

test('local option objects, spreads, aliases and description helper returns retain source locations', () => {
  const source = `import {showAppDialog as show} from './ui-dialogs.js';
    import {t as tr} from './i18n.js';
    const shared={cancelLabel:'取消'};
    function description(){return ready ? '就绪说明' : tr('等待说明');}
    const options={...shared,title:'确认操作',description:description()};
    show(options);`;
  const records = collectDialogMessages(source, 'fixture.js');
  assert.deepEqual(records.map(item => item.source), ['取消', '确认操作', '就绪说明', '等待说明']);
  assert.ok(records.every(item => item.file === 'fixture.js' && item.line >= 3));
});

test('explicit English locale branches do not require Chinese-only branch catalog entries', () => {
  assert.deepEqual(sources(`
    const message=currentLocale()==='en' ? 'English description' : '已有英文分支的中文说明';
    confirmAppAction({description:message,title:currentLocale()!=='en' ? '中文标题' : 'English title'});
  `), []);
});

test('all t calls and real translation wrappers are checked without scanning raw text or input values', () => {
  const source = `import {t as translate} from './i18n.js';
    function textEl(tag, className, text){return translate(text);}
    function labeledInput(label,value){return {label:textEl('span','',label),value};}
    function rawTextEl(tag,text){return text;}
    translate(condition ? '已加入' : "加入");
    textEl('button','',expanded ? '收起' : '展开');
    labeledInput('标题标签','用户输入的标题');
    rawTextEl('p','用户原始提示词');
    function rawScope(){
      function textEl(tag,text){return text;}
      textEl('p','同名原始文本助手的用户内容');
    }
  `;
  assert.deepEqual(collectUiMessages(source).map(item => item.source), ['已加入', '加入', '收起', '展开', '标题标签']);
});

test('calls inside explicit Chinese-only branches do not produce false English-catalog failures', () => {
  assert.deepEqual(collectUiMessages(`
    const label=currentLocale()==='en' ? t('英文分支的系统键') : t('中文分支无需英文');
    if(currentLocale() !== 'en') promptAppText({title:'只在中文显示'});
    else promptAppText({title:t('英文弹窗键')});
  `).map(item => item.source), ['英文弹窗键', '英文分支的系统键', '英文弹窗键']);
});

test('dynamic raw Chinese templates are reported instead of pretending fragment translations suffice', () => {
  const [record] = collectDialogMessages('promptAppText({description:`删除 ${entry.title} 后无法恢复`});');
  assert.equal(record.dynamic, true);
  assert.equal(record.source, '`删除 ${entry.title} 后无法恢复`');
  assert.deepEqual(sources(`// confirmAppAction({title:'注释不是界面'});
    const example="promptAppText({title:'说明里的示例'})";`), []);
});

test('escaped literals and static concatenation use the actual complete catalog key', () => {
  assert.deepEqual(sources(String.raw`promptAppText({title:'\u62c6\u5206' + '组合案例？',description:'第一行\n第二行'});`),
    ['拆分组合案例？', '第一行\n第二行']);
  assert.ok(collectUiMessages(`t('删除' + entry.title);`).some(item => item.dynamic));
});

test('expired manual capture selection keeps the existing actionable English error', () => {
  assert.equal(translateForLocale('手选范围已失效，请在当前页面重新选择一个案例', 'en'),
    'Your selection is no longer available. Select a case on the current page again.');
});
