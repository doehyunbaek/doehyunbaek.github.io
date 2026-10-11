'use strict';
const NS = 'http://www.w3.org/2000/svg';
const palette = {'Europe':'#345b70','CIS':'#518d64','Gulf / Israel / Turkey':'#d4a63e','North America':'#b6493e','Asia / Pacific':'#8865a1','Latam / Africa':'#d4834c'};
const featured = new Set(('Stuttgart|Porto|Split|Valencia|Prague|Madrid|Tallinn|Eindhoven|Vienna|Dusseldorf|Amsterdam|Zurich|Oslo|Geneva|Liverpool|Lisbon|Frankfurt|Riga|Bratislava|Warsaw|Helsinki|Copenhagen|Stockholm|Munich|Berlin|London|Paris|Brussels|Barcelona|Budapest|Athens|Turin|Milan|Naples|Manchester|Dublin|Lyon|Gdansk|Bucharest|Tirana|Limassol|Plovdiv|Varna|Bursa|Antalya|Istanbul|Abu Dhabi|Dubai|Doha|Muscat|Tel Aviv-Yafo|Haifa|Jeddah|Minsk|Moscow|Kaliningrad|Tbilisi|Yerevan|Baku|Astana|Tashkent|Lviv|Kyiv|Dnipropetrovsk|Yekaterinburg|Novosibirsk|Tokyo|Seoul|Singapore|Hong Kong|Taipei|Bangkok|Chiang Mai|Kuala Lumpur|Beijing|Shanghai|Sydney|Melbourne|Canberra|Brisbane|Auckland|Wellington|Islamabad|Hyderabad|Mumbai|Delhi|Dhaka|Jakarta|Manila|Cape Town|Johannesburg|Nairobi|Cairo|Tunis|Curitiba|Florianopolis|Buenos Aires|Montevideo|Santiago|Quito|Lima|Bogota|Mexico City|Monterrey|San Juan|San Jose|New York|Los Angeles|Chicago|Detroit|Miami|Boston|Seattle|San Francisco|San Diego|Portland|Denver|Dallas|Houston|Austin|Atlanta|Orlando|Cleveland|Las Vegas|Honolulu|Vancouver|Toronto|Calgary|Montreal|Ottawa').split('|'));
const svg = document.querySelector('#chart');
const tip = document.querySelector('#tooltip');
const active = new Set(Object.keys(palette));
let cities = [], query = '', allLabels = false, pinned = null;
let mode = 'selected';
const selectedNames = new Set('Stuttgart|Porto|Split|Valencia|Prague|Madrid|Tallinn|Eindhoven|Vienna|Dusseldorf|Amsterdam|Zurich|Oslo|Geneva|Frankfurt|Liverpool|Lisbon|Trieste|Bratislava|Riga|Plovdiv|Varna|Gdansk|Budapest|Athens|Turin|Lyon|Manchester|Dublin|Brussels|Paris|Milan|London|Berlin|Limassol|Antwerp|Barcelona|Bucharest|Belgrade|Tirana|Naples|Kaliningrad|N. Novgorod|Lviv|Tashkent|Yerevan|Minsk|Tbilisi|Baku|Chisinau|Moscow|St. Petersburg|Astana|Dnipro|Yekaterinburg|Bursa|Antalya|Abu Dhabi|Dubai|Jeddah|Tel Aviv|Haifa|Vancouver|Calgary|Orlando|Dallas|San Jose|Seattle|Cleveland|Miami|Washington DC|San Francisco|Houston|Las Vegas|Chicago|New York|Los Angeles|Detroit|Honolulu|Tokyo|Brisbane|Seoul|Sydney|Canberra|Melbourne|Singapore|Hong Kong|Islamabad|Chiang Mai|Guangzhou|Hyderabad|Curitiba|Florianopolis|Montevideo|Buenos Aires|Monterrey|Durban|Quito|Tunis|Santiago|San Juan'.split('|'));
const labelLeft = new Set('Prague|Eindhoven|Vienna|Dusseldorf|Oslo|Geneva|Liverpool|Athens|Brussels|Milan|Baku|Moscow|Astana|Antalya|Abu Dhabi|Tel Aviv|Vancouver|Calgary|Washington DC|San Francisco|Houston|New York|Sydney|Melbourne|Hong Kong|Curitiba|Montevideo|Quito|Tunis|San Juan'.split('|'));
const plot = {left:78, top:32, width:990, height:780};
const X = v => plot.left + (20 + v * 9.5);
const Y = v => plot.top + plot.height - 28 - v * 7.2;
const midX = X(50), midY = Y(50);
function element(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function add(tag, attrs, text, parent = svg) { const node = element(tag, attrs, text); parent.append(node); return node; }
function percentiles(key, target) {
  const sorted = [...cities].sort((a,b) => a[key] - b[key]);
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end][key] === sorted[i][key]) end++;
    const rank = ((i + end - 1) / 2) / (sorted.length - 1) * 100;
    for (let j = i; j < end; j++) sorted[j][target] = rank;
    i = end;
  }
}
function shortName(city) { return city.split(',')[0].replace(/ \(.*?\)/g,'').replace('Tel Aviv-Yafo','Tel Aviv').replace('Dnipropetrovsk','Dnipro').replace('Nizhny Novgorod','N. Novgorod').replace('Saint Petersburg','St. Petersburg').replace('Washington','Washington DC'); }
function visible(city) {
  const name = shortName(city.city);
  const selected = selectedNames.has(name) && (name !== 'San Jose' || city.country === 'United States') && (name !== 'London' || city.country === 'United Kingdom');
  return active.has(city.region) && (mode === 'all' || query || selected) && `${city.city} ${city.country}`.toLowerCase().includes(query);
}
function draw() {
  svg.querySelectorAll('.drawing').forEach(node => node.remove());
  const root = add('g', {class:'drawing', 'font-family':'Arial, Helvetica, sans-serif', fill:'#15232e'});
  const right = plot.left + plot.width, bottom = plot.top + plot.height;
  for (const [x,y,w,h,color] of [
    [plot.left,plot.top,midX-plot.left,midY-plot.top,'#d8e5c4'],
    [midX,plot.top,right-midX,midY-plot.top,'#d7e3ec'],
    [plot.left,midY,midX-plot.left,bottom-midY,'#ece5cf'],
    [midX,midY,right-midX,bottom-midY,'#edd3cc']
  ]) add('rect',{x,y,width:w,height:h,fill:color},undefined,root);
  for (let tick = 0; tick <= 100; tick += 10) {
    add('line',{x1:X(tick),y1:plot.top,x2:X(tick),y2:bottom,stroke:'#ffffff','stroke-opacity':'.3'},undefined,root);
    add('line',{x1:plot.left,y1:Y(tick),x2:right,y2:Y(tick),stroke:'#ffffff','stroke-opacity':'.3'},undefined,root);
    if (tick % 20 === 0) {
      add('text',{x:X(tick),y:bottom+22,'text-anchor':'middle','font-size':13},tick,root);
      add('text',{x:plot.left-12,y:Y(tick)+4,'text-anchor':'end','font-size':13},tick,root);
    }
  }
  add('path',{d:`M${plot.left},${plot.top}V${bottom}H${right}`,fill:'none',stroke:'#7b8375','stroke-width':1},undefined,root);
  add('path',{d:`M${midX},${plot.top}V${bottom}M${plot.left},${midY}H${right}`,fill:'none',stroke:'#899387','stroke-dasharray':'5 5'},undefined,root);
  const quadrants = [
    [plot.left+15,plot.top+27,'BEST VALUE','High quality, low cost','#496e3e','start'],
    [right-15,plot.top+27,'PREMIUM LIFE','Expensive, but worth it','#345b70','end'],
    [plot.left+15,bottom-17,'BUDGET LIVING','Cheap, but not as comfortable','#80754e','start'],
    [right-15,bottom-17,'BAD VALUE','High cost, low quality','#a04938','end']
  ];
  for (const [x,y,title,sub,color,anchor] of quadrants) {
    add('text',{x,y,fill:color,'font-weight':800,'font-size':19,'text-anchor':anchor},title,root);
    add('text',{x,y:y < 100 ? y+21 : y-23,fill:color,'font-size':13,'text-anchor':anchor,'opacity':'.8'},sub,root);
  }
  add('text',{x:(plot.left+right)/2,y:bottom+53,'text-anchor':'middle','font-size':17,'font-weight':700},'Cost of living, percentile · more expensive →',root);
  add('text',{transform:`translate(28 ${(plot.top+bottom)/2}) rotate(-90)`,'text-anchor':'middle','font-size':17,'font-weight':700},'Quality of life, percentile · better →',root);
  const marks = add('g',{},undefined,root);
  const labels = add('g',{},undefined,root);
  const shown = cities.filter(visible);
  // Keep editorial labels legible; all-labels mode deliberately reveals every city.
  const boxes = [
    [plot.left,plot.top,plot.left+220,plot.top+61],
    [right-235,plot.top,right,plot.top+61],
    [plot.left,bottom-61,plot.left+250,bottom],
    [right-235,bottom-61,right,bottom]
  ];
  for (const city of shown) {
    const x = X(city.costPercentile), y = Y(city.qualityPercentile);
    const highlighted = !!query || pinned === city;
    const dot = add('circle',{cx:x,cy:y,r:highlighted?11:mode === 'selected'?10:featured.has(shortName(city.city))?7:4.5,fill:palette[city.region],opacity:highlighted?1:.88,class:'city-dot',tabindex:0,'aria-label':`${city.city}, ${city.country}; cost percentile ${city.costPercentile.toFixed(1)}, quality of life percentile ${city.qualityPercentile.toFixed(1)}`},undefined,marks);
    add('title',{},`${city.city}, ${city.country}\nCost of living: ${city.cost} · Non-price quality: ${city.nonPriceQuality.toFixed(2)}`,dot);
    dot.addEventListener('pointerenter',() => { if (!pinned) showTip(city); });
    dot.addEventListener('pointerleave',() => { if (!pinned) tip.hidden = true; });
    dot.addEventListener('focus',() => { if (!pinned) showTip(city); });
    dot.addEventListener('blur',() => { if (!pinned) tip.hidden = true; });
    dot.addEventListener('click',event => { event.stopPropagation(); pinned = pinned === city ? null : city; if (pinned) showTip(city); else tip.hidden = true; });
    dot.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dot.dispatchEvent(new MouseEvent('click',{bubbles:true})); } });
  }
  const labelCities = shown.filter(c => mode === 'selected' || allLabels || query || featured.has(shortName(c.city))).sort((a,b) => b.qualityPercentile - a.qualityPercentile);
  for (const city of labelCities) {
    const x = X(city.costPercentile), y = Y(city.qualityPercentile), name = shortName(city.city);
    const width = name.length * (mode === 'selected' ? 8 : 6.2);
    const choices = [[x+12,y+4,'start'],[x-12,y+4,'end'],[x,y-13,'middle'],[x,y+22,'middle']];
    if (labelLeft.has(name)) [choices[0],choices[1]] = [choices[1],choices[0]];
    for (const [tx,ty,anchor] of choices) {
      const left = anchor === 'end' ? tx-width : anchor === 'middle' ? tx-width/2 : tx;
      const box = [left-2,ty-11,left+width+2,ty+3];
      if (!allLabels && !query && (box[0]<plot.left+3 || box[2]>right-3 || boxes.some(b => box[0]<b[2] && box[2]>b[0] && box[1]<b[3] && box[3]>b[1]))) continue;
      add('text',{x:tx,y:ty,'text-anchor':anchor,class:'city-label','font-size':mode === 'selected'?15:11,'font-weight':600,stroke:city.qualityPercentile>=50?(city.costPercentile>=50?'#d7e3ec':'#d8e5c4'):(city.costPercentile>=50?'#edd3cc':'#ece5cf'),'stroke-width':2,'paint-order':'stroke'},name,labels);
      boxes.push(box); break;
    }
  }
  document.querySelector('#summary').textContent = `${shown.length} of ${cities.length} cities shown · ranks use all ${cities.length}`;
}
function showTip(city) {
  tip.replaceChildren();
  const title = document.createElement('strong'); title.textContent = shortName(city.city); tip.append(title);
  const country = document.createElement('div'); country.className='country'; country.textContent=`${city.country} · ${city.region}`; tip.append(country);
  for (const [label,index,percentile] of [['Non-price quality',city.nonPriceQuality,city.qualityPercentile],['Cost of living',city.cost,city.costPercentile]]) {
    const row = document.createElement('div'); row.className='metric';
    const name = document.createElement('span'); name.textContent=label;
    const value = document.createElement('b'); value.textContent=`${percentile.toFixed(1)}th percentile`;
    row.append(name,value); tip.append(row);
    const note = document.createElement('div'); note.className='tip-note'; note.textContent=label === 'Non-price quality' ? `Derived score: ${index.toFixed(2)} (price terms excluded)` : `Raw Numbeo index: ${index}`; tip.append(note);
  }
  tip.hidden=false;
  const wrap = document.querySelector('.chart-wrap');
  const scale = wrap.clientWidth/1100;
  const px = X(city.costPercentile)*scale, py = Y(city.qualityPercentile)*scale;
  tip.style.left = `${Math.max(0,Math.min(px+14,wrap.clientWidth-tip.offsetWidth))}px`;
  tip.style.top = `${Math.max(0,Math.min(py+14,wrap.clientHeight-tip.offsetHeight))}px`;
}
function clearTip() { pinned=null; tip.hidden=true; }
for (const [region,color] of Object.entries(palette)) {
  const button=document.createElement('button'); button.type='button'; button.setAttribute('aria-pressed','true');
  const swatch=document.createElement('span'); swatch.className='swatch'; swatch.style.background=color;
  button.append(swatch,document.createTextNode(region));
  button.addEventListener('click',() => { active.has(region)?active.delete(region):active.add(region); button.setAttribute('aria-pressed',String(active.has(region))); clearTip(); draw(); });
  document.querySelector('#legend').append(button);
}
document.querySelector('#search').addEventListener('input',event => { query=event.target.value.trim().toLowerCase(); clearTip(); draw(); });
document.querySelector('#labels').addEventListener('change',event => { allLabels=event.target.checked; clearTip(); draw(); });
document.querySelector('#reset').addEventListener('click',() => {
  query=''; allLabels=false; clearTip(); Object.keys(palette).forEach(r => active.add(r));
  document.querySelector('#search').value=''; document.querySelector('#labels').checked=false;
  document.querySelectorAll('#legend button').forEach(b => b.setAttribute('aria-pressed','true')); draw();
});
svg.addEventListener('click',clearTip);
document.addEventListener('keydown',event => { if(event.key==='Escape') clearTip(); });
window.addEventListener('resize',() => { if(pinned) showTip(pinned); });
document.querySelector('#download').addEventListener('click',() => {
  const copy=svg.cloneNode(true); copy.setAttribute('xmlns',NS); copy.setAttribute('width','1100'); copy.setAttribute('height','890');
  const style=element('style',{},'.city-dot{stroke:#f7f4ec;stroke-width:1.5}.city-label{font-family:Arial,Helvetica,sans-serif;stroke-linejoin:round}'); copy.prepend(style);
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
  const link=document.createElement('a'); link.href=url; link.download='numbeo-city-value.svg'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
});
document.querySelector('#view').addEventListener('change',event => {
  mode=event.target.value; clearTip(); draw();
});
fetch('data.json').then(response => { if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => {
  cities=data.cities; percentiles('cost','costPercentile'); percentiles('nonPriceQuality','qualityPercentile');
  document.querySelector('#count').textContent=cities.length; document.querySelector('#edition').textContent=data.edition; draw();
}).catch(error => { document.querySelector('#summary').textContent='Could not load rankings. Please reload or serve this directory over HTTP.'; console.error(error); });
