/**
 * The capture probe's HTML tokenizer: round trips ordinary markup, keeps
 * raw element bodies apart, and survives the malformed input a real page
 * can contain (unclosed comments, stray quotes, a lone "<").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  escapeAttr,
  escapeText,
  serialize,
  tokenize,
} from "../../src/providers/schoolsoft/capture/html.js";

test("tokenize + serialize round-trip ordinary markup", () => {
  const html =
    '<!doctype html><?xml version="1.0"?><div id="a" class=\'b c\' hidden data-x=y>Hej <b>du</b></div><br/><img src="x.png" />';
  const tokens = tokenize(html);
  assert.deepEqual(tokens.slice(0, 3), [
    { kind: "doctype", text: "!doctype html" },
    { kind: "doctype", text: '?xml version="1.0"?' },
    {
      kind: "open",
      name: "div",
      attrs: [
        { name: "id", value: "a" },
        { name: "class", value: "b c" },
        { name: "hidden", value: null },
        { name: "data-x", value: "y" },
      ],
      selfClosing: false,
    },
  ]);
  assert.equal(
    serialize(tokens),
    '<!doctype html><?xml version="1.0"?><div id="a" class="b c" hidden data-x="y">Hej <b>du</b></div><br /><img src="x.png" />',
  );
});

test("raw elements keep their body as one token, up to the matching close tag", () => {
  const tokens = tokenize(
    '<script>if (a < b) x = "</div>";</script><style></style><title>T</title>',
  );
  assert.deepEqual(tokens[1], { kind: "raw", parent: "script", text: 'if (a < b) x = "</div>";' });
  assert.deepEqual(tokens[2], { kind: "close", name: "script" });
  // an empty raw body yields no raw token
  assert.deepEqual(tokens[4], { kind: "close", name: "style" });
  assert.deepEqual(tokens[6], { kind: "raw", parent: "title", text: "T" });
  // an unclosed raw element runs to the end
  assert.deepEqual(tokenize("<textarea>abc").at(-1), {
    kind: "raw",
    parent: "textarea",
    text: "abc",
  });
});

test("comments, including an unclosed one, and doctype without a closing bracket", () => {
  assert.deepEqual(tokenize("a<!-- x -->b"), [
    { kind: "text", text: "a" },
    { kind: "comment", text: " x " },
    { kind: "text", text: "b" },
  ]);
  assert.deepEqual(tokenize("<!-- open"), [{ kind: "comment", text: " open" }]);
  assert.deepEqual(tokenize("<!doctype"), [{ kind: "doctype", text: "!doctype" }]);
  assert.equal(serialize(tokenize("<!-- c -->")), "<!-- c -->");
});

test("malformed tags: lone '<', stray quotes and slashes, unterminated tags and values", () => {
  assert.deepEqual(tokenize("1 < 2"), [{ kind: "text", text: "1 < 2" }]);
  assert.deepEqual(tokenize("x<"), [{ kind: "text", text: "x<" }]);
  assert.deepEqual(tokenize('<a / "q" href=x>'), [
    {
      kind: "open",
      name: "a",
      attrs: [
        { name: "q", value: null },
        { name: "href", value: "x" },
      ],
      selfClosing: false,
    },
  ]);
  assert.deepEqual(tokenize("<input value"), [
    { kind: "open", name: "input", attrs: [{ name: "value", value: null }], selfClosing: false },
  ]);
  assert.deepEqual(tokenize('<a title="never closed'), [
    {
      kind: "open",
      name: "a",
      attrs: [{ name: "title", value: "never closed" }],
      selfClosing: false,
    },
  ]);
  assert.deepEqual(tokenize("<a href = 'x' >"), [
    { kind: "open", name: "a", attrs: [{ name: "href", value: "x" }], selfClosing: false },
  ]);
  assert.deepEqual(tokenize("</div x>"), [{ kind: "close", name: "div" }]);
});

test("entities decode in attribute values and on demand; escaping is the inverse", () => {
  const [open] = tokenize('<a title="&aring;&auml;&ouml; &amp; &#65;&#x42; &bogus; &#0;">');
  assert.deepEqual(open, {
    kind: "open",
    name: "a",
    attrs: [{ name: "title", value: "åäö & AB &bogus; &#0;" }],
    selfClosing: false,
  });
  assert.equal(decodeEntities("&nbsp;&Aring;&hellip;&#X41;"), " Å…A");
  assert.equal(escapeText("a<b>&c"), "a&lt;b&gt;&amp;c");
  assert.equal(escapeAttr('a"&'), "a&quot;&amp;");
});
