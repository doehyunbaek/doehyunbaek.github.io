// Unique units inherit the base unit's requirements and attributes unless overridden.
const uniqueUnits = [
['Fast Worker','India','Worker',0,3,60,''],
['Quechua','Inca','Warrior',2,1,15,'+100% vs archery; Combat I'],
['Jaguar','Aztec','Swordsman',5,1,35,'Woodsman I','Iron Working'],
['Praetorian','Rome','Swordsman',8,1,45,'No city attack bonus'],
['Vulture','Sumeria','Axeman',6,1,35,'+25% vs melee (instead of +50%)'],
['Dog Soldier','Native America','Axeman',4,1,35,'+100% vs melee (instead of +50%)','Bronze Working'],
['Phalanx','Greece','Axeman',5,1,35,'+100% defense vs chariots'],
['Impi','Zulu','Spearman',4,2,35,'Mobility'],
['Skirmisher','Mali','Archer',4,1,25,'1–2 first strikes (instead of 1)'],
['Bowman','Babylon','Archer',3,1,25,'+50% vs melee'],
['Holkan','Maya','Spearman',4,1,35,'Immune to first strikes','Hunting and Bronze Working'],
['War Chariot','Egypt','Chariot',5,2,25,'Immune to first strikes'],
['Immortal','Persia','Chariot',4,2,25,'+50% vs archery; receives defensive bonuses'],
['Numidian Cavalry','Carthage','Horse Archer',5,2,50,'+50% vs melee; Flanking I'],
['Keshik','Mongolia','Horse Archer',6,2,50,'Ignores terrain movement costs; 1 first strike; not immune to first strikes'],
['Cho-Ko-Nu','China','Crossbowman',6,1,60,'2 first strikes (instead of 1); collateral damage'],
['Samurai','Japan','Maceman',8,1,70,'2 first strikes; Drill I','Civil Service and Machinery; Iron'],
['Berserker','Vikings','Maceman',8,1,70,'Amphibious; +10% city attack'],
['Ballista Elephant','Khmer','War Elephant',8,1,60,'Targets mounted units first outside cities'],
['Hwacha','Korea','Catapult',5,1,50,'+50% vs melee'],
['Landsknecht','Holy Rome','Pikeman',6,1,60,'+100% vs melee'],
['Conquistador','Spain','Cuirassier',12,2,100,'+50% vs melee; receives defensive bonuses'],
['Cataphract','Byzantium','Knight',12,2,90,'Not immune to first strikes'],
['Camel Archer','Arabia','Knight',10,2,90,'15% withdrawal','Guilds and Horseback Riding'],
['Musketeer','France','Musketman',9,2,80,''],
['Janissary','Ottomans','Musketman',9,1,90,'+25% vs archery, melee and mounted'],
['Oromo Warrior','Ethiopia','Musketman',9,1,80,'Immune to first strikes; Drill I and II'],
['Redcoat','England','Rifleman',14,1,110,'+25% vs gunpowder'],
['Cossack','Russia','Cavalry',15,2,120,'+50% vs mounted'],
['Navy SEAL','America','Marine',24,1,160,'1–2 first strikes; March'],
['Panzer','Germany','Tank',28,2,180,'+50% vs armor'],
['East Indiaman','Netherlands','Galleon',6,4,80,'Carries 4 land units (instead of 3); can enter rival territory'],
['Carrack','Portugal','Caravel',3,3,60,'Carries 2 units of any land type (instead of 1 special unit)']
];
for (const [name,civ,base,strength,movement,hammers,extra,requirements] of uniqueUnits) {
 const unit=UNITS.find(u=>u[0]===base);
 UNITS.push([name,`${unit[1]} · ${civ}`,strength,movement,hammers,unit[5],requirements??unit[6],`Replaces ${base}. ${extra ? extra+'. ' : ''}Base attributes (except overrides above): ${unit[7]}`]);
}
let unitSort=0,unitDirection=1;
function renderUnits(){
 const query=$('#unitSearch').value.trim().toLowerCase();
 const rows=UNITS.filter(u=>u.join(' ').toLowerCase().includes(query)).slice().sort((a,b)=>{
  const x=a[unitSort],y=b[unitSort];
  return unitDirection*([2,3,4].includes(unitSort)?(x??-1)-(y??-1):String(x).localeCompare(String(y)));
 });
 $('#unitResults').textContent=`${rows.length} units`;
 $('#unitBody').innerHTML=rows.length?rows.map(u=>`<tr>${u.map((value,i)=>`<td${i>=2&&i<=4?' class="num"':''}>${esc(value===null?'Not buildable':String(value===0&&i===2?'—':value))}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="8" class="empty">No units match your search.</td></tr>';
}
$('#unitSearch').addEventListener('input',renderUnits);
for(const button of document.querySelectorAll('[data-unit-sort]'))button.addEventListener('click',()=>{
 const column=Number(button.dataset.unitSort);
 unitDirection=unitSort===column?-unitDirection:1;unitSort=column;
 for(const th of document.querySelectorAll('#unitsPanel th'))th.removeAttribute('aria-sort');
 button.closest('th').setAttribute('aria-sort',unitDirection===1?'ascending':'descending');renderUnits();
});
renderUnits();
