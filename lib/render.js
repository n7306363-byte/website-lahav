'use strict';
/*
 * Tiny template engine + site data for the admin.
 *   render(templateHtml, content) -> index.html
 * Template syntax (see template.html):
 *   {{t:path}} text (escapes & < >)     {{a:path}} attribute (escapes & < > ")
 *   {{h:path}} raw                       {{j:path}} JSON for an inline <script>
 *   {{#each path as v}}…{{/each}}        {{#if path}}…{{else}}…{{/if}}
 *   specials inside loops: @i (0-based) @n (1-based) @first @last
 */

// layout of the three project stages (design coordinates) — not editable content
const PROJECT_LAYOUT = [
  { img: { x: 140, y: -40, w: 821, h: 931 }, box: { x: 961, padR: 0 } },
  { img: { x: 961, y: -40, w: 820, h: 930 }, box: { x: 132, padR: 24 } },
  { img: { x: 139, y: -40, w: 820, h: 931 }, box: { x: 961, padR: 0 } },
];
const TESTIMONIAL_WIDTHS = [388, 389, 389, 388];

function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escText(s).replace(/"/g, '&quot;'); }
function jsonForScript(v) {
  // keep the JSON safe inside an inline <script> (no "</script>", no raw line separators)
  return JSON.stringify(v)
    .replace(/</g, String.fromCharCode(92) + 'u003c')
    .split(String.fromCharCode(0x2028)).join(String.fromCharCode(92) + 'u2028')
    .split(String.fromCharCode(0x2029)).join(String.fromCharCode(92) + 'u2029');
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [10, 47, 35];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function derive(c) {
  const first = (c.projects && c.projects[0]) || {};
  const projects = (c.projects || []).map((p, i) => {
    const o = { title: p.title, text: p.paragraphs || [], photo: p.photo };
    if (p.photoMobile) o.photoMobile = p.photoMobile;
    if (p.thumbs && p.thumbs.length) o.thumbs = p.thumbs;
    if (p.pos) o.pos = p.pos;
    const L = PROJECT_LAYOUT[i] || PROJECT_LAYOUT[PROJECT_LAYOUT.length - 1];
    o.img = L.img;
    if (p.crop) o.crop = p.crop;
    o.box = L.box;
    return o;
  });
  return { projects, thumbs: first.thumbs || [], rgb: (c.services || []).map(s => hexToRgb(s.color)) };
}

function prepare(content) {
  const c = JSON.parse(JSON.stringify(content));
  (c.testimonials || []).forEach((t, i) => { t._w = TESTIMONIAL_WIDTHS[i] || 388; });
  c.derived = derive(c);
  return c;
}

// ---- parser: tokens -> tree
function parse(src) {
  const re = /\{\{([^}]*)\}\}/g;
  const root = { type: 'root', children: [] };
  const stack = [{ node: root, list: root.children }];
  const cur = () => stack[stack.length - 1];
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) cur().list.push({ type: 'text', value: src.slice(last, m.index) });
    last = re.lastIndex;
    const tok = m[1].trim();
    let mm;
    if ((mm = /^#each\s+(\S+)\s+as\s+(\S+)$/.exec(tok))) {
      const n = { type: 'each', path: mm[1], as: mm[2], children: [] };
      cur().list.push(n); stack.push({ node: n, list: n.children });
    } else if (tok === '/each') {
      if (cur().node.type !== 'each') throw new Error('unexpected {{/each}}');
      stack.pop();
    } else if ((mm = /^#if\s+(\S+)$/.exec(tok))) {
      const n = { type: 'if', path: mm[1], children: [], otherwise: [] };
      cur().list.push(n); stack.push({ node: n, list: n.children });
    } else if (tok === 'else') {
      const f = cur();
      if (f.node.type !== 'if') throw new Error('unexpected {{else}}');
      f.list = f.node.otherwise;
    } else if (tok === '/if') {
      if (cur().node.type !== 'if') throw new Error('unexpected {{/if}}');
      stack.pop();
    } else if ((mm = /^([taihj]):(\S+)$/.exec(tok))) {
      cur().list.push({ type: 'var', kind: mm[1], path: mm[2] });
    } else if (tok === '@i' || tok === '@n') {
      cur().list.push({ type: 'var', kind: 't', path: tok });
    } else {
      throw new Error('bad template tag: {{' + tok + '}}');
    }
  }
  if (last < src.length) cur().list.push({ type: 'text', value: src.slice(last) });
  if (stack.length !== 1) throw new Error('unclosed block in template');
  return root;
}

// ---- evaluation
function lookup(path, scope) {
  const parts = path.split('.');
  let v;
  if (Object.prototype.hasOwnProperty.call(scope.vars, parts[0])) v = scope.vars[parts[0]];
  else v = scope.root[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (v == null) return undefined;
    v = v[parts[i]];
  }
  return v;
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.length > 0;
  return !!v;
}
function evalNodes(nodes, scope, out) {
  for (const n of nodes) {
    if (n.type === 'text') { out.push(n.value); continue; }
    if (n.type === 'var') {
      const v = lookup(n.path, scope);
      if (v === undefined || v === null) { out.push(''); continue; }
      if (n.kind === 'j') out.push(jsonForScript(v));
      else if (n.kind === 'a') out.push(escAttr(v));
      else if (n.kind === 'h') out.push(String(v));
      else out.push(escText(v));
      continue;
    }
    if (n.type === 'if') {
      evalNodes(truthy(lookup(n.path, scope)) ? n.children : n.otherwise, scope, out);
      continue;
    }
    if (n.type === 'each') {
      const arr = lookup(n.path, scope) || [];
      arr.forEach((item, i) => {
        const vars = Object.assign({}, scope.vars);
        vars[n.as] = item; vars['@i'] = i; vars['@n'] = i + 1; vars['@first'] = i === 0; vars['@last'] = i === arr.length - 1;
        evalNodes(n.children, { root: scope.root, vars }, out);
      });
    }
  }
}

function render(template, content) {
  const tree = parse(template);
  const out = [];
  evalNodes(tree.children, { root: prepare(content), vars: {} }, out);
  return out.join('');
}

// ---- content validation used by the API (and the admin)
const IMG_RE = /^images\/[A-Za-z0-9_\-./]+\.(jpe?g|png|webp|svg)$/i;
function str(v, max, name) {
  if (typeof v !== 'string') throw new Error('שדה חסר או לא תקין: ' + name);
  if (v.length > max) throw new Error('הטקסט ארוך מדי בשדה: ' + name);
  return v;
}
function img(v, name) {
  if (typeof v !== 'string' || !IMG_RE.test(v) || v.includes('..')) throw new Error('נתיב תמונה לא תקין: ' + name);
  return v;
}
function pos(v, name) {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{1,3}% \d{1,3}%$/.test(v)) throw new Error('מיקום תמונה לא תקין: ' + name);
  return v;
}
function color(v, name) {
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error('צבע לא תקין: ' + name);
  return v.toLowerCase();
}

function validate(input) {
  const c = {};
  const h = input.hero || {};
  c.hero = { sub: str(h.sub, 120, 'hero.sub'), title1: str(h.title1, 80, 'hero.title1'), title2: str(h.title2, 80, 'hero.title2'), text: str(h.text, 900, 'hero.text') };
  const s = input.story || {};
  if (!Array.isArray(s.paragraphs) || s.paragraphs.length < 1 || s.paragraphs.length > 8) throw new Error('פסקאות "הסיפור שלנו" לא תקינות');
  c.story = { label: str(s.label, 60, 'story.label'), title: str(s.title, 80, 'story.title'), paragraphs: s.paragraphs.map((p, i) => str(p, 1500, 'story.paragraphs.' + i)) };
  const ps = input.projectsSection || {};
  c.projectsSection = { label: str(ps.label, 60, 'projectsSection.label'), title: str(ps.title, 80, 'projectsSection.title'), more: str(ps.more, 80, 'projectsSection.more') };
  const v = input.vision || {};
  c.vision = { label: str(v.label, 60, 'vision.label'), title: str(v.title, 80, 'vision.title'), text: str(v.text, 600, 'vision.text') };
  const ss = input.servicesSection || {};
  c.servicesSection = { label: str(ss.label, 60, 'servicesSection.label'), title: str(ss.title, 80, 'servicesSection.title') };
  const ts = input.testimonialsSection || {};
  c.testimonialsSection = { label: str(ts.label, 60, 'testimonialsSection.label'), title: str(ts.title, 80, 'testimonialsSection.title') };

  if (!Array.isArray(input.projects) || input.projects.length !== 3) throw new Error('נדרשים בדיוק 3 פרוייקטים');
  c.projects = input.projects.map((p, i) => {
    if (!Array.isArray(p.paragraphs) || p.paragraphs.length < 1 || p.paragraphs.length > 3) throw new Error('פסקאות פרוייקט לא תקינות ' + (i + 1));
    const o = { title: str(p.title, 120, 'projects.' + i + '.title'), paragraphs: p.paragraphs.map((t, k) => str(t, 1500, 'projects.' + i + '.paragraphs.' + k)), photo: img(p.photo, 'projects.' + i + '.photo') };
    if (p.photoMobile) o.photoMobile = img(p.photoMobile, 'projects.' + i + '.photoMobile');
    if (Array.isArray(p.thumbs)) o.thumbs = p.thumbs.slice(0, 4).map((t, k) => img(t, 'projects.' + i + '.thumbs.' + k));
    const ps2 = pos(p.pos, 'projects.' + i + '.pos'); if (ps2) o.pos = ps2;
    if (p.crop && typeof p.crop === 'object') {
      const n = k => { const x = Number(p.crop[k]); if (!isFinite(x)) throw new Error('crop לא תקין'); return x; };
      o.crop = { l: n('l'), t: n('t'), w: n('w'), h: n('h') };
    }
    return o;
  });

  if (!Array.isArray(input.services) || input.services.length !== 3) throw new Error('נדרשות בדיוק 3 כרטיסיות שירות');
  c.services = input.services.map((x, i) => ({
    title: str(x.title, 120, 'services.' + i + '.title'),
    image: img(x.image, 'services.' + i + '.image'),
    imageMobile: img(x.imageMobile || x.image, 'services.' + i + '.imageMobile'),
    bg: img(x.bg, 'services.' + i + '.bg'),
    color: color(x.color, 'services.' + i + '.color'),
  }));

  if (!Array.isArray(input.testimonials) || input.testimonials.length !== 4) throw new Error('נדרשות בדיוק 4 המלצות');
  c.testimonials = input.testimonials.map((t, i) => {
    const o = { name: str(t.name, 60, 'testimonials.' + i + '.name'), text: str(t.text, 600, 'testimonials.' + i + '.text'), photo: img(t.photo, 'testimonials.' + i + '.photo') };
    const ps3 = pos(t.pos, 'testimonials.' + i + '.pos'); if (ps3) o.pos = ps3;
    if (t.legacy === true && i === 0) o.legacy = true;
    return o;
  });
  return c;
}

module.exports = { PROJECT_LAYOUT, TESTIMONIAL_WIDTHS, escText, escAttr, jsonForScript, hexToRgb, derive, prepare, parse, render, validate, IMG_RE };
