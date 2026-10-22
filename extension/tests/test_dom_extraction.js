// test_dom_extraction.js - Automated DOM extraction tests for Job Copilot extension
const { getQuestionForTextarea, getFieldContext, isValidQuestionText } = require('../src/core/fields.ts');

class MockNode {
  constructor(tag, attrs = {}, text = "") {
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this._innerText = text;
    this.children = [];
    this.parentElement = null;
    this.previousElementSibling = null;
    this.nextElementSibling = null;
    this.classList = {
      contains: (c) => (this.attributes["class"] || "").split(/\s+/).includes(c)
    };
    this.dataset = {};
  }

  get innerText() {
    if (this._innerText) return this._innerText;
    return this.children.map(c => c.innerText).join(" ");
  }
  set innerText(v) { this._innerText = v; }

  get textContent() {
    return this.innerText;
  }

  getAttribute(k) { return this.attributes[k] || null; }
  setAttribute(k, v) { this.attributes[k] = v; }
  hasAttribute(k) { return k in this.attributes; }

  appendChild(child) {
    if (this.children.length > 0) {
      const last = this.children[this.children.length - 1];
      last.nextElementSibling = child;
      child.previousElementSibling = last;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentElement) return;
    const p = this.parentElement;
    const idx = p.children.indexOf(this);
    if (idx !== -1) {
      p.children.splice(idx, 1);
      if (this.previousElementSibling) this.previousElementSibling.nextElementSibling = this.nextElementSibling;
      if (this.nextElementSibling) this.nextElementSibling.previousElementSibling = this.previousElementSibling;
      this.parentElement = null;
    }
  }

  cloneNode(deep = true) {
    const clone = new MockNode(this.tagName.toLowerCase(), this.attributes, this._innerText);
    clone.dataset = { ...this.dataset };
    if (deep) {
      for (const ch of this.children) {
        clone.appendChild(ch.cloneNode(true));
      }
    }
    return clone;
  }

  compareDocumentPosition(other) {
    const all = [];
    function collect(n) {
      all.push(n);
      for (const c of n.children) collect(c);
    }
    let root = this;
    while (root.parentElement) root = root.parentElement;
    collect(root);
    const i1 = all.indexOf(this);
    const i2 = all.indexOf(other);
    if (i1 === -1 || i2 === -1) return 1;
    if (i2 > i1) return 4;
    return 2;
  }

  matches(sel) {
    const parts = sel.split(",").map(s => s.trim());
    for (const part of parts) {
      if (part.toLowerCase() === "textarea" && this.tagName === "TEXTAREA") return true;
      if (part.toLowerCase() === "input" && this.tagName === "INPUT") return true;
      if (part.toLowerCase() === "select" && this.tagName === "SELECT") return true;
      if (part.toLowerCase().startsWith("input:not([type=\"hidden\"])") && this.tagName === "INPUT" && this.getAttribute("type") !== "hidden") return true;
      if (part.startsWith(".") && this.classList.contains(part.slice(1))) return true;
      if (part.toLowerCase() === this.tagName.toLowerCase()) return true;
      if (part.includes("[class*=")) {
        const clsName = part.match(/\[class\*="([^"]+)"\]/)[1];
        if ((this.attributes["class"] || "").includes(clsName)) return true;
      }
    }
    return false;
  }

  querySelectorAll(sel) {
    const res = [];
    const parts = sel.split(",").map(s => s.trim());
    function search(node) {
      for (const ch of node.children) {
        for (const p of parts) {
          if (ch.matches(p)) {
            res.push(ch);
            break;
          }
        }
        search(ch);
      }
    }
    search(this);
    return res;
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  closest(sel) {
    let curr = this;
    while (curr) {
      if (curr.matches(sel)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

global.Node = { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 };
global.CSS = { escape: (s) => s };
global.document = {
  querySelector: () => null,
  getElementById: () => null
};

console.log("Running DOM extraction tests...");

// Test 1: Dover Form Structure (4 textareas + 1 radio question at bottom)
const form = new MockNode("form");

// Q1 Card
const q1Card = form.appendChild(new MockNode("div", { class: "sc-card" }));
const q1Header = q1Card.appendChild(new MockNode("div", { class: "sc-header" }));
q1Header.appendChild(new MockNode("div", {}, "Tell me about the last time an AI coding tool (Claude Code, Codex, Copilot, etc.) generated code you rejected or had to fix. How did you catch the problem? *"));
const q1InputWrap = q1Card.appendChild(new MockNode("div", { class: "sc-input-wrap" }));
const ta1 = q1InputWrap.appendChild(new MockNode("textarea"));

// Q2 Card
const q2Card = form.appendChild(new MockNode("div", { class: "sc-card" }));
const q2Header = q2Card.appendChild(new MockNode("div", { class: "sc-header" }));
q2Header.appendChild(new MockNode("div", {}, "Tell me about a time you spotted a missing requirement or edge case BEFORE you started building. What was it, and what did you ask? *"));
const q2InputWrap = q2Card.appendChild(new MockNode("div", { class: "sc-input-wrap" }));
const ta2 = q2InputWrap.appendChild(new MockNode("textarea"));

// Q3 Card
const q3Card = form.appendChild(new MockNode("div", { class: "sc-card" }));
const q3Header = q3Card.appendChild(new MockNode("div", { class: "sc-header" }));
q3Header.appendChild(new MockNode("div", {}, "Walk me through the hardest bug you have root-caused. What did the logs or evidence first tell you, what did you rule out, and how did you confirm the fix? *"));
const q3InputWrap = q3Card.appendChild(new MockNode("div", { class: "sc-input-wrap" }));
const ta3 = q3InputWrap.appendChild(new MockNode("textarea"));

// Q4 Card
const q4Card = form.appendChild(new MockNode("div", { class: "sc-card" }));
const q4Header = q4Card.appendChild(new MockNode("div", { class: "sc-header" }));
q4Header.appendChild(new MockNode("div", {}, "Pick one feature you built across at least two layers of the stack (app, web, API, data, or infra): what was personally yours, what broke or nearly broke, and what did you change afterward? *"));
const q4InputWrap = q4Card.appendChild(new MockNode("div", { class: "sc-input-wrap" }));
const ta4 = q4InputWrap.appendChild(new MockNode("textarea"));

// Location radio question at bottom of form
const locCard = form.appendChild(new MockNode("div", { class: "sc-card" }));
const locLabel = locCard.appendChild(new MockNode("label", { class: "label" }, "This role is full-time and in-person at our Jayanagar, Bengaluru office. Can you work from the office? *"));
const radio1 = locCard.appendChild(new MockNode("input", { type: "radio", name: "loc", value: "yes" }));

// VERIFICATION:
const res1 = getQuestionForTextarea(ta1);
const res2 = getQuestionForTextarea(ta2);
const res3 = getQuestionForTextarea(ta3);
const res4 = getQuestionForTextarea(ta4);

if (!res1.includes("AI coding tool") || !res1.includes("How did you catch the problem?")) throw new Error("Q1 mismatch");
if (!res2.includes("missing requirement") || !res2.includes("what did you ask?")) throw new Error("Q2 mismatch");
if (!res3.includes("hardest bug") || !res3.includes("confirm the fix?")) throw new Error("Q3 mismatch");
if (!res4.includes("two layers") || !res4.includes("change afterward?")) throw new Error("Q4 mismatch");

if (res1.includes("Jayanagar") || res1.includes("Bengaluru")) throw new Error("Q1 leaked location!");
if (res2.includes("Jayanagar") || res2.includes("Bengaluru")) throw new Error("Q2 leaked location!");
if (res3.includes("Jayanagar") || res3.includes("Bengaluru")) throw new Error("Q3 leaked location!");
if (res4.includes("Jayanagar") || res4.includes("Bengaluru")) throw new Error("Q4 leaked location!");

console.log("PASSED Test 1: Dover form structure isolation verified!");

// Test 2: Boilerplate hints and counters
const cardHint = new MockNode("div", { class: "field-wrap" });
cardHint.appendChild(new MockNode("label", {}, "Tell me about a complex query you optimized"));
cardHint.appendChild(new MockNode("div", { class: "counter" }, "0 / 500 characters"));
const taHint = cardHint.appendChild(new MockNode("textarea"));
const resHint = getQuestionForTextarea(taHint);
if (resHint !== "Tell me about a complex query you optimized") throw new Error("Hint test failed: " + resHint);
console.log("PASSED Test 2: Boilerplate counter filtered!");

// Test 3: Sibling elements with header and description joined
const cardSib = new MockNode("div");
cardSib.appendChild(new MockNode("h4", {}, "System Architecture"));
cardSib.appendChild(new MockNode("p", {}, "Describe a distributed system you built and how it handled node failure."));
const taSib = cardSib.appendChild(new MockNode("textarea"));
const resSib = getQuestionForTextarea(taSib);
if (!resSib.includes("System Architecture") || !resSib.includes("handled node failure")) throw new Error("Sibling multi-element failed");
console.log("PASSED Test 3: Multi-element sibling joined properly!");

// Test 4: Flat list inside form (boundary test)
const flatForm = new MockNode("form");
flatForm.appendChild(new MockNode("label", {}, "Flat Question 1"));
const flatTa1 = flatForm.appendChild(new MockNode("textarea"));
flatForm.appendChild(new MockNode("label", {}, "Flat Question 2"));
const flatTa2 = flatForm.appendChild(new MockNode("textarea"));

const resFlat1 = getQuestionForTextarea(flatTa1);
const resFlat2 = getQuestionForTextarea(flatTa2);
if (resFlat1 !== "Flat Question 1") throw new Error("Flat 1 mismatch");
if (resFlat2 !== "Flat Question 2") throw new Error("Flat 2 mismatch");
console.log("PASSED Test 4: Flat form boundaries respected!");

console.log("\nALL DOM EXTRACTION TESTS PASSED SUCCESSFULLY!");
