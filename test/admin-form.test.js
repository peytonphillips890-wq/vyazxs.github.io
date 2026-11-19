const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function createFrontendHarness(form) {
  const requests = [];
  const messages = [];
  const logs = [];
  const context = {
    api: async (url, options) => requests.push({ url, options }),
    can: () => true,
    confirm: () => true,
    escapeHtml: value => String(value ?? ''),
    FormData: class {
      constructor(target) {
        return new Map(Object.entries(target.values || {}));
      }
    },
    load: async () => {},
    state: { data: {} },
    showAdmin: () => {},
    toast: (...args) => messages.push(args),
    console: { error: (...args) => logs.push(args) },
    $: selector => selector === '[data-collection-form]' ? form : null,
    $$: () => []
  };
  const start = appSource.indexOf('const managers = {');
  const end = appSource.indexOf('async function renderAdminUsers()');
  assert.notEqual(start, -1, 'manager definitions exist');
  assert.notEqual(end, -1, 'collection form handlers exist');
  vm.runInNewContext(appSource.slice(start, end), context);
  return { context, logs, messages, requests };
}

for (const collection of ['games', 'products', 'announcements', 'staff']) {
  test(`${collection} dashboard form submits create and edit to its collection route`, async () => {
    const form = {
      dataset: { collectionForm: collection, id: '' },
      values: { title: 'Test item' },
      addEventListener(eventName, handler) {
        assert.equal(eventName, 'submit');
        this.submit = handler;
      },
      querySelectorAll: () => []
    };
    const { context, requests } = createFrontendHarness(form);
    const markup = vm.runInNewContext(`editorForm('${collection}', managers['${collection}'])`, context);
    assert.match(markup, new RegExp(`data-collection-form="${collection}"`));

    context.wireCollectionForm();
    const submit = () => form.submit({
      preventDefault() {},
      currentTarget: form
    });

    await submit();
    form.dataset.id = 'item-123';
    await submit();

    assert.deepEqual(requests.map(({ url, options }) => [url, options.method]), [
      [`/api/admin/${collection}`, 'POST'],
      [`/api/admin/${collection}/item-123`, 'PUT']
    ]);
    assert.equal(requests.some(({ url }) => url.includes('/undefined')), false);
  });
}

test('collection form with missing metadata makes no API request and logs its context', async () => {
  const form = {
    dataset: {},
    addEventListener(eventName, handler) {
      assert.equal(eventName, 'submit');
      this.submit = handler;
    },
    querySelectorAll: () => []
  };
  const { context, logs, messages, requests } = createFrontendHarness(form);
  context.wireCollectionForm();
  await form.submit({ preventDefault() {}, currentTarget: form });

  assert.equal(requests.length, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'Admin collection form is not configured.');
  assert.equal(logs[0][1].form, 'collection editor');
  assert.equal(logs[0][1].action, 'create');
  assert.equal(logs[0][1].collection, undefined);
  assert.equal(messages.at(-1)[1], true);
});

test('API helper rejects incomplete endpoints before calling fetch', async () => {
  const start = appSource.indexOf('async function api(');
  const end = appSource.indexOf('\n}\n\nfunction toast', start);
  assert.notEqual(start, -1, 'API helper exists');
  assert.notEqual(end, -1, 'API helper ends before toast');
  let fetchCount = 0;
  const api = vm.runInNewContext(`(${appSource.slice(start, end + 2)})`, {
    apiBaseUrl: 'https://example.test',
    apiUrl: value => new URL(value, 'https://example.test').toString(),
    fetch: async () => { fetchCount += 1; },
    FormData: class {},
    URL
  });

  await assert.rejects(api('/api/admin/undefined'), /incomplete/);
  await assert.rejects(api('/api/admin/'), /incomplete/);
  await assert.rejects(api(undefined), /missing/);
  assert.equal(fetchCount, 0);
});
