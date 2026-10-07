import { parse } from 'acorn';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasEnglishTranslation } from '../extension/i18n.js';

const dialogNames = new Set(['showAppDialog', 'confirmAppAction', 'promptAppText']);
const messageOptions = new Set(['title', 'description', 'label', 'placeholder', 'confirmLabel', 'cancelLabel',
  'pendingLabel', 'discardLabel', 'dirtyDismissMessage', 'help']);
const han = /\p{Script=Han}/u;
const root = fileURLToPath(new URL('../', import.meta.url));
const children = node => Object.values(node).flatMap(value => Array.isArray(value)
  ? value.filter(item => item?.type) : value?.type ? [value] : []);
const propertyName = property => property.computed ? property.key?.value : property.key?.name ?? property.key?.value;

// Follow only display expressions at the shared dialog boundary. In particular,
// field values, t() interpolation values, and entry.title are user data, not keys.
export function collectUiMessages(source, file = '<source>', { includeCalls = true } = {}) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const scopes = new WeakMap(), nodeParents = new WeakMap(), bindings = new Map(), parents = new Map(), calls = [];
  const names = new Set(dialogNames), translators = new Set(['t', 'translateUiMessage', 'uiText']), catalogCalls = new Set(['t']);
  function bind(scope, name, value) {
    if (name) bindings.get(scope).set(name, value);
  }
  function index(node, scope) {
    if (node.type === 'FunctionDeclaration') bind(scope, node.id?.name, node);
    if (['Program', 'BlockStatement', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      parents.set(node, scope); scope = node; bindings.set(scope, new Map());
      for (const parameter of node.params ?? []) {
        const shadow = pattern => {
          if (pattern.type === 'Identifier') bind(scope, pattern.name, null);
          else for (const child of children(pattern)) shadow(child);
        };
        shadow(parameter);
      }
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') bind(scope, node.id.name, node.init);
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) {
      const name = specifier.imported?.name;
      if (node.source.value.endsWith('/ui-dialogs.js') && dialogNames.has(name)) names.add(specifier.local.name);
      if (node.source.value.endsWith('/i18n.js') && ['t', 'translateUiMessage'].includes(name)) translators.add(specifier.local.name);
      if (node.source.value.endsWith('/i18n.js') && name === 't') catalogCalls.add(specifier.local.name);
    }
    if (node.type === 'CallExpression') calls.push(node);
    for (const child of children(node)) { nodeParents.set(child, node); index(child, scope); }
  }
  index(ast, null);
  function binding(identifier) {
    for (let scope = scopes.get(identifier); scope; scope = parents.get(scope)) {
      if (bindings.get(scope)?.has(identifier.name)) return bindings.get(scope).get(identifier.name);
    }
    return null;
  }
  const messages = [], seen = new Set();
  function englishCondition(condition) {
    const localeCall = value => value?.type === 'CallExpression' && value.callee.name === 'currentLocale';
    const englishLiteral = value => value?.type === 'Literal' && value.value === 'en';
    if (condition.type === 'BinaryExpression' && ['===', '==', '!==', '!='].includes(condition.operator)
      && (localeCall(condition.left) && englishLiteral(condition.right) || englishLiteral(condition.left) && localeCall(condition.right))) {
      return ['===', '=='].includes(condition.operator);
    }
    return null;
  }
  function englishReachable(node) {
    for (let parent = nodeParents.get(node); parent; node = parent, parent = nodeParents.get(node)) {
      if (!['ConditionalExpression', 'IfStatement'].includes(parent.type)) continue;
      const condition = englishCondition(parent.test);
      if (condition !== null && node === (condition ? parent.alternate : parent.consequent)) return false;
    }
    return true;
  }
  function add(node, option, text, dynamic = false) {
    if (!han.test(text)) return;
    const identity = `${node.start}:${option}:${text}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    messages.push({ file, line: node.loc.start.line, option, source: text, ...(dynamic ? { dynamic: true } : {}) });
  }
  function literalText(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
    if (node?.type === 'BinaryExpression' && node.operator === '+') {
      const left = literalText(node.left), right = literalText(node.right);
      if (left !== undefined && right !== undefined) return left + right;
    }
    return undefined;
  }
  function text(node, option, trail = new Set()) {
    if (!node || trail.has(node)) return;
    trail = new Set([...trail, node]);
    switch (node.type) {
      case 'Literal':
        if (typeof node.value === 'string') add(node, option, node.value);
        break;
      case 'TemplateLiteral':
        if (!node.expressions.length) add(node, option, node.quasis[0].value.cooked);
        else {
          if (node.quasis.some(part => han.test(part.value.cooked))) add(node, option, source.slice(node.start, node.end), true);
          for (const expression of node.expressions) text(expression, option, trail);
        }
        break;
      case 'Identifier': text(binding(node), option, trail); break;
      case 'ConditionalExpression': {
        const condition = englishCondition(node.test);
        if (condition !== null) text(condition ? node.consequent : node.alternate, option, trail);
        else { text(node.consequent, option, trail); text(node.alternate, option, trail); }
        break;
      }
      case 'BinaryExpression': {
        const literal = literalText(node);
        if (literal !== undefined) add(node, option, literal);
        else {
          text(node.left, option, trail); text(node.right, option, trail);
          if (node.operator === '+' && han.test(source.slice(node.start, node.end))) add(node, option, source.slice(node.start, node.end), true);
        }
        break;
      }
      case 'LogicalExpression':
        text(node.left, option, trail); text(node.right, option, trail); break;
      case 'SequenceExpression': text(node.expressions.at(-1), option, trail); break;
      case 'CallExpression': {
        if (node.callee.type === 'Identifier' && translators.has(node.callee.name)) text(node.arguments[0], option, trail);
        else if (node.callee.type === 'Identifier') {
          const fn = binding(node.callee);
          if (fn && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(fn.type)) {
            if (fn.body.type !== 'BlockStatement') text(fn.body, option, trail);
            else returns(fn.body, option, trail);
          }
        }
        break;
      }
    }
  }
  function returns(node, option, trail) {
    if (!englishReachable(node)) return;
    if (node.type === 'ReturnStatement') return text(node.argument, option, trail);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) return;
    for (const child of children(node)) returns(child, option, trail);
  }
  function options(node, trail = new Set()) {
    if (!node || trail.has(node)) return;
    trail = new Set([...trail, node]);
    if (node.type === 'Identifier') return options(binding(node), trail);
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (property.type === 'SpreadElement') { options(property.argument, trail); continue; }
        const key = propertyName(property);
        if (messageOptions.has(key)) text(property.value, key);
        else if (key === 'fields' || key === 'options') options(property.value, trail);
      }
      return;
    }
    // Arrays, mapped fields, and conditional options can contain actual field
    // objects. Their values are visited only through the explicit keys above.
    for (const child of children(node)) options(child, trail);
  }
  for (const call of calls) if (englishReachable(call) && call.callee.type === 'Identifier' && names.has(call.callee.name)) options(call.arguments[0]);
  if (includeCalls) {
    // Infer local wrappers from parameters actually forwarded to t(), then to
    // those wrappers (textEl -> labeledInput). Never assume a helper by name:
    // skills-page's textEl is raw user text, unlike library's translated textEl.
    const helpers = new Map();
    function parameterUses(node) {
      if (!node) return [];
      if (node.type === 'Identifier') {
        for (let scope = scopes.get(node); scope; scope = parents.get(scope)) {
          if (!bindings.get(scope)?.has(node.name)) continue;
          const index = (scope.params ?? []).findIndex(param => (param.type === 'AssignmentPattern' ? param.left : param).name === node.name);
          return index >= 0 ? [[scope, index]] : [];
        }
      }
      if (node.type === 'ConditionalExpression') return [...parameterUses(node.consequent), ...parameterUses(node.alternate)];
      if (['LogicalExpression', 'BinaryExpression'].includes(node.type)) return [...parameterUses(node.left), ...parameterUses(node.right)];
      return [];
    }
    const argumentsFor = call => call.callee.type !== 'Identifier' ? []
      : catalogCalls.has(call.callee.name) ? [0] : [...(helpers.get(binding(call.callee)) ?? [])];
    let changed;
    do {
      changed = false;
      for (const call of calls) for (const index of argumentsFor(call)) {
        for (const [fn, parameter] of parameterUses(call.arguments[index])) {
          const indices = helpers.get(fn) ?? new Set();
          if (!indices.has(parameter)) { indices.add(parameter); helpers.set(fn, indices); changed = true; }
        }
      }
    } while (changed);
    for (const call of calls) if (englishReachable(call)) {
      for (const index of argumentsFor(call)) text(call.arguments[index], `${call.callee.name}[${index}]`);
    }
  }
  return messages;
}

export function collectDialogMessages(source, file) {
  return collectUiMessages(source, file, { includeCalls: false });
}

export async function checkUiTranslations(directory = resolve(root, 'extension'), translated = hasEnglishTranslation) {
  const messages = [];
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.js')).sort()) {
    const path = resolve(directory, file);
    messages.push(...collectUiMessages(await readFile(path, 'utf8'), relative(root, path)));
  }
  return { messages, missing: messages.filter(item => item.dynamic || !translated(item.source)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await checkUiTranslations();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const item of report.missing) console.error(`${item.file}:${item.line} ${item.option}: ${JSON.stringify(item.source)}${item.dynamic ? ' (use a t() template)' : ''}`);
    console.log(`${report.messages.length} UI message sources checked; ${report.missing.length} missing or untranslatable.`);
  }
  if (report.missing.length) process.exitCode = 1;
}
