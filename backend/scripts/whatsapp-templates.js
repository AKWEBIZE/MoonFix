/**
 * WhatsApp Cloud API templates: show, check and submit them to Meta.
 *
 *   npm run wa:templates              show every template (text, category, sample values)
 *   npm run wa:templates -- --status  which templates Meta has approved / is reviewing / rejected
 *   npm run wa:templates -- --create  submit the missing ones to Meta for approval
 *
 * Needs in backend/.env (only for --status / --create):
 *   WA_CLOUD_TOKEN    permanent System User token with whatsapp_business_management permission
 *   WA_CLOUD_WABA_ID  WhatsApp Business Account ID (WhatsApp Manager > Account tools > ... or API Setup page)
 * Template texts live in src/waTemplates.js.
 */
import { renderTemplate, SAMPLE, TEMPLATE_LANG, templateValues, WA_TEMPLATES } from '../src/waTemplates.js';

const mode = process.argv.includes('--create') ? 'create' : process.argv.includes('--status') ? 'status' : 'show';
const version = process.env.WA_CLOUD_API_VERSION || 'v21.0';
const base = process.env.WA_CLOUD_API_BASE || 'https://graph.facebook.com';
const token = process.env.WA_CLOUD_TOKEN;
const waba = process.env.WA_CLOUD_WABA_ID;

const list = Object.entries(WA_TEMPLATES).map(([kind, def]) => ({
  kind, def, sample: templateValues(kind, SAMPLE.booking, SAMPLE.settings, SAMPLE.customText),
}));

if (mode === 'show') {
  for (const { kind, def, sample } of list) {
    console.log(`\n=== ${def.name}  (${def.category}, language "${TEMPLATE_LANG}")  - used for: ${kind}`);
    console.log(def.body);
    console.log('--- sample:');
    console.log(renderTemplate(def, sample));
  }
  console.log(`\n${list.length} templates. Use --status or --create with WA_CLOUD_TOKEN and WA_CLOUD_WABA_ID set.`);
  process.exit(0);
}

if (!token || !waba) {
  console.error('Set WA_CLOUD_TOKEN and WA_CLOUD_WABA_ID in backend/.env first.');
  process.exit(1);
}

async function graph(path, options = {}) {
  const res = await fetch(`${base}/${version}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    throw new Error(`${e.code ? `(#${e.code}) ` : ''}${e.error_user_msg || e.error_data?.details || e.message || res.status}`);
  }
  return data;
}

// What Meta already has (name + language)
const existing = new Map();
let next = `${waba}/message_templates?fields=name,language,status,category,rejected_reason&limit=100`;
while (next) {
  const page = await graph(next);
  for (const t of page.data || []) existing.set(`${t.name}|${t.language}`, t);
  next = page.paging?.next ? page.paging.next.replace(`${base}/${version}/`, '') : null;
}

let problems = 0;
for (const { def, sample } of list) {
  const have = existing.get(`${def.name}|${TEMPLATE_LANG}`);
  if (have) {
    const extra = have.status === 'REJECTED' ? `  reason: ${have.rejected_reason}` : have.category !== def.category ? `  (Meta set category ${have.category})` : '';
    console.log(`${have.status.padEnd(9)} ${def.name}${extra}`);
    if (have.status !== 'APPROVED') problems++;
    continue;
  }
  if (mode === 'status') {
    console.log(`MISSING   ${def.name}  (run with --create)`);
    problems++;
    continue;
  }
  try {
    const r = await graph(`${waba}/message_templates`, {
      method: 'POST',
      body: JSON.stringify({
        name: def.name,
        language: TEMPLATE_LANG,
        category: def.category,
        components: [{ type: 'BODY', text: def.body, example: { body_text: [sample] } }],
      }),
    });
    console.log(`${String(r.status || 'SUBMITTED').padEnd(9)} ${def.name}  (submitted)`);
    if (r.status !== 'APPROVED') problems++;
  } catch (e) {
    console.log(`ERROR     ${def.name}  ${e.message}`);
    problems++;
  }
}
console.log(problems
  ? '\nSome templates are not approved yet. Messages of those types will show as "failed" until they are; check again later with --status.'
  : '\nAll templates are approved.');
