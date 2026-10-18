import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.LUMIERE_DATA_DIR
  || (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'LumiereMenu')
    : join(homedir(), '.lumiere-menu'));
const dbPath = join(dataDir, 'perfumes.db');
if (!existsSync(dbPath)) { console.error('DB NOT FOUND: ' + dbPath); process.exit(1); }
const db = new DatabaseSync(dbPath);
const catalogPath = fileURLToPath(new URL('./catalog-m.txt', import.meta.url));
const lines = readFileSync(catalogPath, 'utf8').split(/\r?\n/).map(l => l.trim());
// --- parse entries ---
const entries = [];
let cur = null;
for (const t of lines) {
  const h = t.match(/^\[?M(\d{2})\]?\s+(.+)/);
  if (h) { if (cur) entries.push(cur); cur = { code: 'M' + h[1], rest: h[2], lines: [] }; continue; }
  if (cur && t) cur.lines.push(t);
}
if (cur) entries.push(cur);
console.log('parsed entries: ' + entries.length + ' [' + entries.map(e => e.code).join(',') + ']');
if (!entries.length) process.exit(2);
// --- mirror m01 conventions ---
const m01 = db.prepare("SELECT * FROM perfumes WHERE id='m01'").get();
let noteKind = 's', nameKey = 'name', iconKey = null;
const iconMap = {};
if (m01) {
  try {
    const n = JSON.parse(m01.notes);
    const t0 = n && n.top && n.top[0];
    if (t0 && typeof t0 === 'object') {
      noteKind = 'o';
      nameKey = Object.keys(t0).find(k => /name/i.test(k)) || 'name';
      iconKey = Object.keys(t0).find(k => /icon|image|img/i.test(k)) || null;
      for (const tier of ['top','middle','base']) for (const x of (n[tier]||[])) if (x && typeof x==='object') iconMap[x[nameKey]] = iconKey ? x[iconKey] : '';
    }
  } catch (e) {}
}
const genericIcon = iconMap[Object.keys(iconMap)[0]] || '';
const CM = {amber:'#B8860B',spicy:'#A0522D',citrus:'#FFD54F',woody:'#8B5A2B',wood:'#8B5A2B',fruity:'#FF8A65',aromatic:'#66BB6A',fresh:'#4FC3F7',marine:'#29B6F6',sea:'#29B6F6',smoky:'#6D4C41',smoke:'#6D4C41',musky:'#E6E0D4',musk:'#E6E0D4',sweet:'#F48FB1',warm:'#FFAB91',vanilla:'#F3E5AB',oud:'#4B3621',leather:'#5D4037',floral:'#F8BBD0',green:'#81C784',aquatic:'#4DD0E1',gourmand:'#D7A86E',powdery:'#E1BEE7',lavender:'#B39DDB',incense:'#9575CD',spice:'#A0522D',earthy:'#795548',balsamic:'#A1887F',herbal:'#9CCC65',salt:'#90CAF9',iris:'#CE93D8',sage:'#AED581',benzoin:'#D7B377',tonka:'#C49A6C',tobacco:'#8D6E63',rose:'#E91E63',jasmine:'#FDD835',patchouli:'#6B4E31',vetiver:'#7A6A53',cedar:'#B08968',sandal:'#C8A165',pepper:'#827717',ginger:'#FFB74D',cinnamon:'#D2691E',cardamom:'#C0CA33',mint:'#80CBC4',honey:'#F9A825',caramel:'#C68642',coffee:'#6F4E37',rum:'#A9746E',cognac:'#A0522D',fig:'#8D9E4E',plum:'#8E24AA',cherry:'#D32F2F',pineapple:'#FFD600',bergamot:'#FFE082',neroli:'#FFE0B2',ambroxan:'#D7CCA1',labdanum:'#A67B5B',moss:'#689F38',fougere:'#7CB342',chypre:'#8D6E63',suede:'#7A5C50',coconut:'#EFEBE0',cacao:'#5D4037',chocolate:'#5D4037',licorice:'#2B2B2B',anise:'#BDB76B',almond:'#E8C39E'};
function col(n){const s=String(n).toLowerCase();for(const k in CM){if(s.indexOf(k)>=0)return CM[k];}let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return 'hsl('+h+',45%,55%)';}
const VALS = [100,85,70,55,40,32,26];
const sec = (e, re) => { const i = e.lines.findIndex(l => re.test(l)); return i >= 0 ? (e.lines[i+1] || '') : ''; };
const list = s => String(s).split(/[,;]/).map(p => p.replace(/[-\u2022*\d.)\s]+$/, '').replace(/^[-\u2022*\d.)\s]+/, '').trim()).filter(Boolean);
const bottlesDir = fileURLToPath(new URL('../public/images/perfumes/', import.meta.url));
const bottles = ['lumier-blue.svg','lumier-green.svg','lumier-clear.svg','lumier-purple.svg','lumier-gold.svg'].filter(f => existsSync(join(bottlesDir, f)));
const summary = [];
try {
for (let k = 0; k < entries.length; k++) {
  const e = entries[k];
  const id = e.code.toLowerCase();
  if (id === 'm01' && db.prepare("SELECT id FROM perfumes WHERE id='m01'").get()) { summary.push('M01 | SKIPPED (existing record kept)'); continue; }
  const parts = e.rest.split(/\s+[-\u2013\u2014]\s+/);
  const name = (parts.length > 1 ? parts.slice(0, -1).join(' - ') : parts[0]).trim() || e.code;
  const house = parts.length > 1 ? parts[parts.length-1].trim() : 'Lumier';
  const accNames = list(sec(e, /^main\s*accords?\s*:?$/i) || sec(e, /^accords?\s*:?$/i));
  const accords = accNames.map((n, i) => ({ name: n, value: VALS[Math.min(i, VALS.length-1)], color: col(n) }));
  const top = list(sec(e, /^top\s*notes?\s*:?$/i));
  const mid = list(sec(e, /^(heart|middle)\s*notes?\s*:?$/i));
  const base = list(sec(e, /^base\s*notes?\s*:?$/i));
  const perf = sec(e, /^performance\s*profile\s*:?$/i);
  const grab = lb => { const m = perf.match(new RegExp(lb + '\\s*:\\s*([^|]+)', 'i')); return m ? m[1].trim() : ''; };
  const longevity = grab('longevity'), projection = grab('projection'), sillage = grab('sillage');
  const usage = sec(e, /^usage\s*&?\s*seasons?\s*:?$/i);
  const bt = usage.match(/best\s*time\s*:\s*([^|]+)/i);
  const btv = bt ? bt[1].toLowerCase() : '';
  const dn = (btv.indexOf('day') >= 0 && btv.indexOf('night') >= 0) ? 'Both' : btv.indexOf('night') >= 0 ? 'Night' : btv.indexOf('day') >= 0 ? 'Day' : 'Both';
  const sm = usage.match(/seasons?\s*:\s*([^|]+)/i);
  const seasons = sm ? list(sm[1]).map(s => /^fall$/i.test(s) ? 'Autumn' : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) : [];
  const mkNote = n => noteKind === 'o' ? (iconKey ? { [nameKey]: n, [iconKey]: iconMap[n] || genericIcon } : { [nameKey]: n }) : n;
  const vals = { id, code: e.code, name, brand: 'Lumier Perfume', price: 20000, gender: 'Male', category: 'Luxury Perfume', stockStatus: 'In Stock',
    description: name + ' by Lumier Perfume (inspired by ' + house + '). A ' + (accNames.slice(0,3).join(', ') || 'signature') + ' composition, best worn ' + dn.toLowerCase() + '.',
    rating: 4.5,
    mainImage: '/images/perfumes/' + bottles[k % bottles.length],
    miniImage: '/images/perfumes/' + bottles[k % bottles.length],
    galleryImages: '[]',
    accords: JSON.stringify(accords),
    fragranceProfile: JSON.stringify({ longevity: longevity || '8-10 hours', projection: projection || 'Strong', sillage: sillage || 'Enormous' }),
    dayNight: dn, seasons: JSON.stringify(seasons),
    notes: JSON.stringify({ top: top.map(mkNote), middle: mid.map(mkNote), base: base.map(mkNote) }) };
  const exists = db.prepare('SELECT id FROM perfumes WHERE id = ?').get(id);
  if (exists) db.prepare('UPDATE perfumes SET name=@name,code=@code,brand=@brand,price=@price,gender=@gender,category=@category,stockStatus=@stockStatus,description=@description,rating=@rating,mainImage=@mainImage,miniImage=@miniImage,galleryImages=@galleryImages,accords=@accords,fragranceProfile=@fragranceProfile,dayNight=@dayNight,seasons=@seasons,notes=@notes WHERE id=@id').run(vals);
  else db.prepare('INSERT INTO perfumes (id,name,code,brand,price,gender,category,stockStatus,description,rating,mainImage,miniImage,galleryImages,accords,fragranceProfile,dayNight,seasons,notes) VALUES (@id,@name,@code,@brand,@price,@gender,@category,@stockStatus,@description,@rating,@mainImage,@miniImage,@galleryImages,@accords,@fragranceProfile,@dayNight,@seasons,@notes)').run(vals);
  summary.push(e.code + ' | ' + name + ' | acc:' + accords.length + ' | ' + (longevity||'?') + '/' + (sillage||'?') + ' | ' + dn + ' | seasons:' + seasons.length + ' | notes:' + top.length + '/' + mid.length + '/' + base.length + ' | ' + (exists ? 'updated' : 'inserted'));
}
} catch (err) { console.error('ERROR: ' + err.message); process.exit(3); }
console.log(summary.join('\n'));
const total = db.prepare('SELECT COUNT(*) c FROM perfumes').get().c;
console.log('TOTAL in DB: ' + total);