/**
 * Form structure from synthetic pages: action, method, field names, types,
 * required flags and choices; prefilled values are never recorded, labels
 * and choices go through the redactor, fields outside a form are ignored.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractForms } from "../../src/providers/schoolsoft/capture/forms.js";
import { Redactor } from "../../src/providers/schoolsoft/capture/redact.js";

const PAGE = `<!doctype html><html><head><script>var x = "<form>";</script></head><body><!-- c -->
<input name="search" value="outside any form">
<label for="nowhere">Datum</label>
<form name="absence_4401" id="f_4401" action="right_student_absence.jsp?studentid=4401" method="POST" enctype="multipart/form-data">
  <input type="hidden" name="csrf" value="0f9e8d7c">
  <label for="from_4401">Från <b>datum</b></label>
  <input id="from_4401" name="from" value="2026-09-26" required>
  <input name="to" aria-required="true">
  <label>Ingen for</label>
  <select name="reason" required>
    <option value="1" selected>Sjuk
    <option value="998877">Tandläkare hos Ada</option>
    <option>Annat</option>
  </select>
  <select name="children" multiple><option value="4401">Ada Exempelsson</select>
  <select name="empty"></select>
  <option value="stray">not in a select</option>
  <input type="radio" name="part" value="whole" checked>
  <input type="checkbox" name="notify" value="Ring mig">
  <textarea name="comment">Hon mår bättre</textarea>
  <textarea name="blank"></textarea>
  <button>Skicka</button>
  <button type="button" name="cancel">Avbryt</button>
  <input type="reset" value="Rensa">
</form>
<form><input name="q"></form>
</body></html>`;

test("form structure: fields, choices and flags; values never recorded", () => {
  const forms = extractForms(PAGE, new Redactor({ knownNames: ["Ada Exempelsson"] }));
  assert.equal(forms.length, 2);
  const [f, g] = forms;
  assert.deepEqual(
    { name: f.name, id: f.id, action: f.action, method: f.method, enctype: f.enctype },
    {
      name: "absence_1001",
      id: "f_1001",
      action: "right_student_absence.jsp?studentid=1001",
      method: "post",
      enctype: "multipart/form-data",
    },
  );
  assert.deepEqual(f.fields, [
    { tag: "input", type: "hidden", name: "csrf", id: null, required: false, prefilled: true },
    {
      tag: "input",
      type: "text",
      name: "from",
      id: "from_1001",
      required: true,
      prefilled: true,
      label: "Från datum",
    },
    { tag: "input", type: "text", name: "to", id: null, required: true, prefilled: false },
    {
      tag: "select",
      type: "select",
      name: "reason",
      id: null,
      required: true,
      prefilled: false,
      options: [
        { value: "1", label: "Sjuk", selected: true },
        { value: "1002", label: "[text 1]", selected: false },
        { value: null, label: "Annat", selected: false },
      ],
    },
    {
      tag: "select",
      type: "select",
      name: "children",
      id: null,
      required: false,
      prefilled: false,
      options: [{ value: "1001", label: "[text 2]", selected: false }],
      multiple: true,
    },
    {
      tag: "select",
      type: "select",
      name: "empty",
      id: null,
      required: false,
      prefilled: false,
      options: [],
    },
    {
      tag: "input",
      type: "radio",
      name: "part",
      id: null,
      required: false,
      prefilled: false,
      value: "whole",
      checked: true,
    },
    {
      tag: "input",
      type: "checkbox",
      name: "notify",
      id: null,
      required: false,
      prefilled: false,
      value: "[text 3]",
      checked: false,
    },
    {
      tag: "textarea",
      type: "textarea",
      name: "comment",
      id: null,
      required: false,
      prefilled: true,
    },
    {
      tag: "textarea",
      type: "textarea",
      name: "blank",
      id: null,
      required: false,
      prefilled: false,
    },
    {
      tag: "button",
      type: "submit",
      name: null,
      id: null,
      required: false,
      prefilled: false,
      label: "Skicka",
    },
    {
      tag: "button",
      type: "button",
      name: "cancel",
      id: null,
      required: false,
      prefilled: false,
      label: "Avbryt",
    },
    {
      tag: "input",
      type: "reset",
      name: null,
      id: null,
      required: false,
      prefilled: false,
      label: "[text 4]",
    },
  ]);
  assert.deepEqual(g, {
    name: null,
    id: null,
    action: "",
    method: "get",
    enctype: null,
    fields: [
      { tag: "input", type: "text", name: "q", id: null, required: false, prefilled: false },
    ],
  });
  const json = JSON.stringify(forms);
  for (const gone of [
    "0f9e8d7c",
    "2026-09-26",
    "Tandläkare",
    "Ada",
    "mår",
    "Ring mig",
    "4401",
    "998877",
  ])
    assert.ok(!json.includes(gone), `no ${gone}`);
});

test("a page without forms and an unterminated option", () => {
  const r = new Redactor();
  assert.deepEqual(extractForms("<p>Ingen</p>", r), []);
  const [f] = extractForms("<form><select name=s><option value=a>Sjuk", r);
  assert.deepEqual(f.fields[0].options, [{ value: "a", label: "Sjuk", selected: false }]);
});
