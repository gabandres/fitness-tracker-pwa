// Benchmark analyzePhoto's Gemini call across config variants.
// Calls Gemini directly (not the CF) so we time the model, not cold starts.
import { readFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';

const SP = 'C:/Users/gabri/AppData/Local/Temp/claude/Z--macro-app/55c46fb8-fc9d-47af-94db-bb5ad6a6931d/scratchpad';
const apiKey = readFileSync(`${SP}/.gk`, 'utf8').trim();
const ai = new GoogleGenAI({ apiKey });

const IMAGES = ['food-Mofongo.jpg', 'food-Arroz_con_gandules.jpg'];

const ITEM_PROPS_FULL = {
  name: { type: 'string' },
  grams: { type: 'number' },
  state: { type: 'string', enum: ['cooked', 'raw'] },
  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  kcal: { type: 'number' },
  protein: { type: 'number' },
  carbs: { type: 'number' },
  fat: { type: 'number' },
};

const schema = ({ reasoning = true, fallback = true } = {}) => {
  const props = {};
  if (reasoning) props.reasoning = { type: 'string' };
  const ip = { ...ITEM_PROPS_FULL };
  if (!fallback) { delete ip.kcal; delete ip.protein; delete ip.carbs; delete ip.fat; }
  props.items = { type: 'array', items: { type: 'object', properties: ip, required: Object.keys(ip) } };
  props.description = { type: 'string' };
  props.confidence = { type: 'string', enum: ['low', 'medium', 'high'] };
  return { type: 'object', properties: props, required: Object.keys(props) };
};

const BASE = `Identify every distinct food in this meal photo and estimate the weight of each.
Your job is RECOGNITION and PORTION SIZE. A nutrition database supplies the calories and macros
from the food name and weight you provide.
For each item: "name" a short specific food name a nutrition database would carry; "grams" the
edible weight on the plate; "state" cooked or raw as SEEN; "confidence" low if unsure.
Sanity-check weights: a sauce/condiment/oil is almost never more than 60 g; a main dish portion
is 150-400 g; a whole plate rarely exceeds 900 g.`;

const REASONING_FULL = `
Reasoning requirement: before listing items, populate "reasoning" with a concise chain-of-thought
that identifies each item and justifies its weight from visual cues (plate diameter, utensil scale,
pile height, bowl fill). The weights must follow from that reasoning.`;
const REASONING_SHORT = `
Reasoning requirement: populate "reasoning" with AT MOST 30 WORDS naming the portion cues you used
(plate diameter, utensil scale, pile height, bowl fill). Be terse; it is an audit trail, not prose.`;
const FALLBACK_TEXT = `
Fallback macros: also give kcal/protein/carbs/fat per item, used ONLY for regional dishes a USDA
database will not carry (mofongo, tostones, pernil, pan sobao). For common foods they are ignored.`;

const VARIANTS = [
  { id: 'A baseline (today)', model: 'gemini-2.5-flash', think: undefined, reasoning: 'full', fallback: true },
  { id: 'B think=0', model: 'gemini-2.5-flash', think: 0, reasoning: 'full', fallback: true },
  { id: 'C think=0 short-reason', model: 'gemini-2.5-flash', think: 0, reasoning: 'short', fallback: true },
  { id: 'D think=0 no-reason', model: 'gemini-2.5-flash', think: 0, reasoning: 'none', fallback: true },
  { id: 'E think=0 short, no-fb', model: 'gemini-2.5-flash', think: 0, reasoning: 'short', fallback: false },
  { id: 'F lite think=0 short', model: 'gemini-2.5-flash-lite', think: 0, reasoning: 'short', fallback: true },
];

const imgs = {};
for (const f of IMAGES) imgs[f] = readFileSync(`${SP}/${f}.b64`, 'utf8');

const rows = [];
for (const v of VARIANTS) {
  const prompt =
    BASE +
    (v.reasoning === 'full' ? REASONING_FULL : v.reasoning === 'short' ? REASONING_SHORT : '') +
    (v.fallback ? FALLBACK_TEXT : '') +
    '\n\nReturn `description` and each item\'s `name` in English.';
  const cfg = {
    temperature: 0.2,
    responseMimeType: 'application/json',
    responseJsonSchema: schema({ reasoning: v.reasoning !== 'none', fallback: v.fallback }),
  };
  if (v.think !== undefined) cfg.thinkingConfig = { thinkingBudget: v.think };

  for (const f of IMAGES) {
    const t0 = Date.now();
    let out, err;
    try {
      out = await ai.models.generateContent({
        model: v.model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: imgs[f] } }, { text: prompt }] }],
        config: cfg,
      });
    } catch (e) { err = e; }
    const ms = Date.now() - t0;
    if (err) { rows.push({ v: v.id, f, ms, note: 'ERROR ' + String(err).slice(0, 90) }); continue; }
    const u = out.usageMetadata ?? {};
    let parsed = {};
    try { parsed = JSON.parse(out.text ?? '{}'); } catch { /* ignore */ }
    rows.push({
      v: v.id,
      f: f.replace('food-', '').replace('.jpg', ''),
      ms,
      thought: u.thoughtsTokenCount ?? 0,
      out: u.candidatesTokenCount ?? 0,
      inTok: u.promptTokenCount ?? 0,
      items: (parsed.items ?? []).length,
      names: (parsed.items ?? []).map((i) => `${i.name}/${i.grams}g`).join(', ').slice(0, 110),
    });
    await new Promise((r) => setTimeout(r, 1200));
  }
}

console.log('\nvariant                   photo               ms   think  out   in  items  detected');
for (const r of rows) {
  if (r.note) { console.log(`${r.v.padEnd(24)} ${String(r.f).padEnd(18)} ${String(r.ms).padStart(5)}  ${r.note}`); continue; }
  console.log(
    `${r.v.padEnd(24)} ${r.f.padEnd(18)} ${String(r.ms).padStart(5)} ${String(r.thought).padStart(6)} ${String(r.out).padStart(5)} ${String(r.inTok).padStart(5)} ${String(r.items).padStart(5)}  ${r.names}`,
  );
}
const byV = {};
for (const r of rows) if (!r.note) (byV[r.v] ??= []).push(r.ms);
console.log('\nmean ms per variant:');
for (const [k, arr] of Object.entries(byV)) console.log('  ' + k.padEnd(24) + Math.round(arr.reduce((a, b) => a + b, 0) / arr.length));
