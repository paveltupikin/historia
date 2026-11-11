'use strict';
const D = window.HISTORY_DATA;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = arr => {const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const norm = s => s.toLowerCase().replace(/ё/g,'е').replace(/[.,;:«»"()]/g,'').replace(/\s+/g,' ').trim();
const dateSpan = s => {const years=String(s).match(/\d{3,4}/g);return years?[Math.min(...years.map(Number)),Math.max(...years.map(Number))]:null;};
const overlaps = (a,b) => {const x=dateSpan(a),y=dateSpan(b);return x&&y?x[0]<=y[1]&&y[0]<=x[1]:norm(a)===norm(b);};
const part = r => (r.section.match(/Часть (\d)/)||[])[1] || '1';
// Порядковый номер параграфа: «Часть 2. § 14» → 2014. Нужен, чтобы подбирать неверные варианты из соседних тем.
const secIndex = s => {const m=String(s).match(/Часть (\d+)\. § (\d+)/);return m?Number(m[1])*1000+Number(m[2]):0;};

// ---------- Очистка базы для тренажёра (в «Базе знаний» остаётся всё) ----------
// Убираем отсылки («См.», «То же, что»), обрывки вместо определений и названия тем параграфов, которые не являются терминами.
const topicLike=/^(Идеи и формы|Города как центры|Объединительный процесс|Угасание деятельности|Начало (формирования|покорения)|Присоединение Среднего|Унификация русских|Попытка ограничения|Освободительная миссия|Политические и социальные права|Земельная собственность|Имущественное и социальное|Долги царского|Операции в Восточной|Бессрочная регулярная|Перепись и первая|Власть духовная|Внутренняя и внешняя торговля|Тверское и Московское|Паритет в стратегических|Мораторий на испытания|Воеводское управление|Денежная реформа Петра|Переписка Андрея|Уставы для армии|Монгольское войско|Святославичи|Реформа вечевого|Двуполярный и однополярный)/;
const isRealTerm = t => !/^(См\.|То же)/i.test(t.b) && t.b.length>=22 && !topicLike.test(t.a);
const quizTerms = D.terms.filter(isRealTerm);

// Маскируем в определении слова с тем же корнем, что и в термине: «Ассимиляция — процесс … ассимилируемый народ» → «… народ».
function maskTerm(text, term){
 const stems=norm(term).split(/[\s-]+/).filter(w=>w.length>=5).map(w=>w.slice(0,5));
 if(!stems.length)return text;
 return text.replace(/[А-Яа-яЁё][А-Яа-яЁё-]*/g, w=>stems.some(s=>norm(w).startsWith(s))?'…':w);
}

// ---------- Режимы ----------
const modes=[['mix','Все вперемешку','✳'],['date','Дата → событие','↗'],['event','Событие → дата','↙'],['people','Личности','♙'],['terms','Термины','≡'],['laws','Законы и реформы','§'],['rebels','Восстания и итоги','⚑'],['order','Хронология','⇅']];
const lawRows=D.dates.filter(r=>/реформ|закон|указ|уложени|судебник|конституци|манифест|табел|правда|устав|декрет/i.test(r.b));
const yearRows=D.dates.filter(r=>/^\d{3,4}(?:\s*г\.)?$/.test(r.a)).map(r=>({...r,year:parseInt(r.a,10)}));

let bank=[];
function addRows(rows,mode,reverse=false,mask=false){
 for(const r of rows){
  const prompt=reverse?r.b:r.a, answer=reverse?r.a:r.b;
  bank.push({id:mode+':'+r.id,mode,part:part(r),sec:secIndex(r.section),prompt:mask?maskTerm(prompt,answer):prompt,answer,source:r.section});
 }
}
addRows(D.dates,'date');
addRows(D.dates,'event',true);
addRows(D.people,'people',true,true);
addRows(quizTerms,'terms',true,true);
addRows(lawRows,'laws',true);
for(const r of D.rebels)bank.push({id:'rebels:'+r.id,mode:'rebels',part:part(r),sec:secIndex(r.section),prompt:r.b+' · '+r.a,answer:r.outcome,source:r.section});

// ---------- Прогресс ----------
let saved={};try{saved=JSON.parse(localStorage.getItem('history-practice-v1'))||{};}catch{}
let progress={xp:0,attempts:0,correct:0,days:{},cards:{},...saved};
if(!progress.cards||typeof progress.cards!=='object')progress.cards={};
if(!progress.days||typeof progress.days!=='object')progress.days={};
function save(){try{localStorage.setItem('history-practice-v1',JSON.stringify(progress));}catch{$('footer span:last-child').textContent='ПРОГРЕСС В ЭТОЙ СЕССИИ';}}
function today(){const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}

// ---------- Состояние сессии ----------
let mode='mix',period='all',view='train',reviewing=false;
let queue=[];          // карточки впереди; queue[0] — текущая
let recent=[];         // id последних показанных карточек, чтобы не повторяться
let results=[];        // true/false по порядку ответов в этой серии
let answered=false,streak=0,roundXp=0,misses=[],orderItems=[],libraryLimit=30,autoTimer=null;
const RECENT_LIMIT=80;

function allowed(q){return period==='all'||q.part===period;}
function allowedRow(r){return period==='all'||part(r)===period;}
function due(){return Object.values(progress.cards).filter(c=>c.review&&c.due<=Date.now()&&c.q&&allowed(c.q));}
function poolFor(m=mode){return bank.filter(q=>allowed(q)&&(m==='mix'||q.mode===m));}
function priority(q){const c=progress.cards[q.id];return c?(c.review&&c.due<=Date.now()?0:c.due<=Date.now()?1:3):2;}

// ---------- Подбор неверных вариантов ----------
// Форма ответа: в кавычках / с датой / длина — чтобы правильный вариант не выделялся внешне.
function shape(s){
 const str=String(s);
 const quoted=/[«»]/.test(str)?'q':'p';
 const words=str.split(/\s+/).length;
 const len=words<=1?'1':words<=3?'2':'3';
 const span=dateSpan(str);
 const dateKind=!span?'':/^\d{3,4}(\s*г\.)?$/.test(str.trim())?'y':/в\./.test(str)?'c':'r';
 return quoted+len+dateKind;
}
function yearOf(s){const sp=dateSpan(s);return sp?(sp[0]+sp[1])/2:null;}

function distractors(q){
 const equivalents=bank.filter(x=>x.mode===q.mode&&norm(x.prompt)===norm(q.prompt));
 const valid=new Set(equivalents.map(x=>norm(x.answer)));
 const safe=x=>q.mode==='date'?!overlaps(x.prompt,q.prompt):['event','laws'].includes(q.mode)?!equivalents.some(v=>overlaps(x.answer,v.answer)):true;
 const qSec=q.sec??secIndex(q.source), qShape=shape(q.answer), qYear=yearOf(q.answer);
 const scored=[];
 const seen=new Set([norm(q.answer)]);
 for(const x of bank){
  if(x.mode!==q.mode||norm(x.prompt)===norm(q.prompt)||!safe(x))continue;
  const key=norm(x.answer);if(valid.has(key)||seen.has(key))continue;
  seen.add(key);
  let score;
  if(['event','laws'].includes(q.mode)&&qYear!==null){
   // ответ — дата: берём даты из той же эпохи, в пределах нескольких десятилетий
   const y=yearOf(x.answer);
   score=y===null?400:Math.min(Math.abs(y-qYear),300)/4;
  }else{
   // ответ — текст: берём из того же или соседних параграфов
   const d=Math.abs((x.sec??secIndex(x.source))-qSec);
   score=d>=1000?60+d/100:d*3;
  }
  if(shape(x.answer)!==qShape)score+=6;
  score+=Math.random()*5;
  scored.push([score,x.answer]);
 }
 scored.sort((a,b)=>a[0]-b[0]);
 // из девяти самых близких случайно выбираем три — чтобы одни и те же варианты не повторялись
 return shuffle(scored.slice(0,9).map(x=>x[1])).slice(0,3);
}
function prepare(q){
 if(q.mode==='order')return {...q};
 const options=shuffle([q.answer,...distractors(q)]);
 return {...q,options};
}

function chronological(){
 const unique=new Map();for(const r of shuffle(yearRows.filter(allowedRow)))if(!unique.has(r.year))unique.set(r.year,r);
 const rows=[...unique.values()].slice(0,3);if(rows.length<3)return null;
 const ordered=[...rows].sort((a,b)=>a.year-b.year);
 return {id:'order:'+ordered.map(r=>r.id).join('-'),mode:'order',part:period,sec:0,prompt:'Что было раньше?',answer:ordered.map(r=>r.b+' — '+r.a).join(' → '),items:rows,source:'Хронология · «Даты и события»'};
}

// ---------- Бесконечная очередь ----------
function fresh(list){const r=new Set(recent);const f=list.filter(q=>!r.has(q.id));return f.length>=4?f:list;}
function nextBatch(){
 if(reviewing){
  const answeredIds=new Set(recent);
  return shuffle(due().map(c=>c.q).filter(q=>!answeredIds.has(q.id))).slice(0,10).map(prepare);
 }
 if(mode==='order')return Array.from({length:5},chronological).filter(Boolean);
 let pool=shuffle(fresh(poolFor())).sort((a,b)=>priority(a)-priority(b));
 if(mode==='mix'){
  const groups=modes.slice(1).filter(x=>x[0]!=='order').map(([m])=>pool.filter(q=>q.mode===m));
  pool=[];for(let i=0;i<2;i++)for(const g of shuffle(groups))if(g[i])pool.push(g[i]);
 }
 const batch=pool.slice(0,10).map(prepare);
 if(mode==='mix'&&batch.length>=5){const q=chronological();if(q)batch[4]=q;}
 return batch;
}
function refill(){
 let guard=0;
 while(queue.length<3&&guard++<3){const b=nextBatch();if(!b.length)break;queue.push(...b);}
}
function restart(){
 clearTimeout(autoTimer);
 queue=[];recent=[];results=[];streak=0;roundXp=0;misses=[];answered=false;
 refill();renderModes();updateStats();renderCard();
}
function advance(){
 clearTimeout(autoTimer);
 if(!queue.length)return;
 queue.shift();refill();renderCard();
}

// ---------- Отрисовка ----------
function updateStats(){
 $('#total-xp').textContent=progress.xp;$('#streak').textContent=streak;
 $('#correct-count').textContent=results.filter(Boolean).length;$('#wrong-count').textContent=results.filter(x=>!x).length;
 $('#round-xp').textContent='+'+roundXp;$('#error-count').textContent=due().length;
 const daily=progress.days[today()]||0;$('#daily-count').textContent=daily+' / 20';$('#daily-bar').style.width=Math.min(100,daily/20*100)+'%';
 $('#daily-caption').textContent=daily>=20?'Цель выполнена. Отличный ритм.':'20 ответов — ещё один шаг.';
}
const titles={mix:'История',date:'События',event:'Даты',people:'Личности',terms:'Понятия',laws:'Реформы',rebels:'Восстания',order:'Хронология'};
function renderTitle(){$('#page-title').innerHTML=esc(view==='library'?'База знаний':reviewing?'Повторение':titles[mode])+'<span>.</span>';}
function renderModes(){
 renderTitle();
 $('#modes').innerHTML=modes.map(([id,label,icon])=>{const n=id==='order'?yearRows.filter(allowedRow).length:poolFor(id).length;return `<button class="mode ${id===mode&&!reviewing?'active':''}" data-mode="${id}" aria-pressed="${id===mode&&!reviewing}"><span class="mode-icon" aria-hidden="true">${icon}</span><span>${label}</span><span class="mode-number">${n.toLocaleString('ru')}</span></button>`;}).join('');
 $('#review').classList.toggle('active',reviewing);
}
function renderTrack(){
 const last=results.slice(-10);
 $('#round-track').innerHTML=[...last.map(r=>`<i class="${r?'correct':'wrong'}"></i>`),...(queue.length?['<i class="current"></i>']:[]),...Array(Math.max(0,10-last.length)).fill('<i></i>')].join('');
}
const prompts={date:['ДАТА → СОБЫТИЕ','Что произошло в это время?'],event:['СОБЫТИЕ → ДАТА','Когда это произошло?'],people:['ИСТОРИЧЕСКИЕ ЛИЧНОСТИ','О ком идёт речь?'],terms:['ТЕРМИНЫ','Как называется это понятие?'],laws:['ЗАКОНЫ И РЕФОРМЫ','Когда произошло это изменение?'],rebels:['ВОССТАНИЯ И ИТОГИ','Чем закончилось это выступление?'],order:['ХРОНОЛОГИЯ','Расположите события от раннего к позднему.']};
function renderCard(){
 answered=false;
 $('#round-label').textContent=reviewing?'Повторение ошибок':modes.find(x=>x[0]===mode)[1];
 $('#round-index').textContent=String(results.length+(queue.length?1:0)).padStart(2,'0');
 $('.round-meta .muted').textContent=reviewing?'/ '+(results.length+queue.length):'/ ∞';
 renderTrack();
 if(!queue.length){
  const done=reviewing&&results.length;
  $('#card').innerHTML=`<div class="result"><div class="eyebrow">${reviewing?'ПОВТОРЕНИЕ':'КАРТОЧКИ'}</div>${done?`<div class="result-score">${results.filter(Boolean).length}<span> / ${results.length}</span></div>`:''}<h2>${reviewing?(done?'Ошибки разобраны.':'На сегодня всё чисто.'):'Нет карточек для этого периода.'}</h2><p>${reviewing?'Неверные ответы вернутся сюда через день, затем через 3, 7, 14 и 30 дней.':'Попробуйте другой период или формат.'}</p><button class="primary" id="back-practice">К тренировке ↗</button></div>`;
  return;
 }
 const q=queue[0], [label,hint]=prompts[q.mode];
 $('#card').innerHTML=`<div class="card-head"><span>${label}</span><span class="card-tag">${q.mode==='order'?'ПО ПОРЯДКУ':'ОДИН ОТВЕТ'}</span></div><div class="card-prompt"><h2 class="${q.mode==='date'&&q.prompt.length<18?'date':''}">${esc(q.prompt)}</h2><p>${hint}</p></div><div id="answer-area"></div><div class="card-actions" id="card-actions">${q.mode==='order'?'<button class="primary" id="check-order">Проверить порядок ↗</button>':''}<button id="skip" class="skip-button">Не знаю <span aria-hidden="true">↗</span></button></div><div id="feedback" aria-live="polite"></div>`;
 if(q.mode==='order'){orderItems=shuffle(q.items);renderOrder();}
 else $('#answer-area').innerHTML=`<div class="options ${q.options.some(x=>x.length>95)?'long':''}">${q.options.map((text,i)=>`<button class="option" data-answer="${i}"><span class="option-number">${i+1}</span><span>${esc(text)}</span></button>`).join('')}</div>`;
}
function renderOrder(){
 $('#answer-area').innerHTML=`<div class="order-list">${orderItems.map((r,i)=>`<div class="order-row"><span>0${i+1}</span><span>${esc(r.b)}</span><button data-move="${i},-1" aria-label="Поднять событие ${i+1}" ${i===0?'disabled':''}>↑</button><button data-move="${i},1" aria-label="Опустить событие ${i+1}" ${i===orderItems.length-1?'disabled':''}>↓</button></div>`).join('')}</div>`;
}

function answer(choice,skip=false){
 if(answered||!queue.length)return;
 const q=queue[0];answered=true;
 recent.push(q.id);if(recent.length>RECENT_LIMIT)recent.shift();
 const correct=!skip&&(q.mode==='order'?orderItems.every((r,i,a)=>i===0||a[i-1].year<r.year):q.options[choice]===q.answer);
 results.push(correct);streak=correct?streak+1:0;
 const earned=correct?10+(streak%5===0?5:0):0;
 roundXp+=earned;progress.xp+=earned;progress.attempts++;if(correct)progress.correct++;progress.days[today()]=(progress.days[today()]||0)+1;
 const old=progress.cards[q.id]||{level:0,review:false};const level=correct?Math.min((old.level||0)+1,5):0;
 const {options,items,...storedQ}=q;
 if(q.mode!=='order')progress.cards[q.id]={level,review:!correct||old.review,due:correct?Date.now()+[0,1,3,7,14,30][level]*86400000:Date.now(),q:storedQ};
 if(!correct)misses.push(q);
 save();updateStats();
 $('#card-actions').hidden=true;
 document.querySelectorAll('.option').forEach((b,i)=>{b.disabled=true;if(q.options[i]===q.answer){b.classList.add('correct');b.querySelector('.option-number').textContent='✓';}else if(i===choice&&!skip){b.classList.add('wrong');b.querySelector('.option-number').textContent='×';}});
 if(q.mode==='order')document.querySelectorAll('#answer-area button').forEach(b=>b.disabled=true);
 const explanation=q.mode==='order'?[...q.items].sort((a,b)=>a.year-b.year).map(r=>esc(r.a)+' — '+esc(r.b)).join('<br>'):q.mode==='date'?esc(q.prompt)+' — '+esc(q.answer):esc(q.answer);
 $('#feedback').className='feedback '+(correct?'':'bad');
 $('#feedback').innerHTML=`<div class="feedback-copy"><strong>${correct?'Верно. +'+earned+' XP':skip?'Запомним.':'Почти. Запомним ответ.'}</strong><p>${explanation}</p><p class="source">${esc(q.source)}</p></div><button class="primary" id="next">Дальше →</button>`;
 renderTrack();
 $('#next').focus({preventScroll:true});
 // верный ответ — карточка уходит сама; ошибка — ждём, пока прочитают
 if(correct&&q.mode!=='order')autoTimer=setTimeout(advance,900);
}

// ---------- База знаний ----------
function setView(next){view=next;$('#training').hidden=view!=='train';$('#library').hidden=view!=='library';renderTitle();$('.streak').hidden=view!=='train';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='library')renderLibrary();}
function libraryRows(){const rows=mode==='people'?D.people:mode==='terms'?D.terms:mode==='rebels'?D.rebels:mode==='laws'?lawRows:['date','event','order'].includes(mode)?D.dates:[...D.dates,...D.people,...D.terms,...D.rebels];const term=norm($('#search').value);return rows.filter(allowedRow).filter(r=>!term||norm([r.a,r.b,r.outcome||'',r.leader||''].join(' ')).includes(term));}
function renderLibrary(){const rows=libraryRows();$('#library-summary').textContent=`Найдено: ${rows.length.toLocaleString('ru')} · показано ${Math.min(libraryLimit,rows.length)}`;$('#library-list').innerHTML=rows.slice(0,libraryLimit).map(r=>`<article class="library-item"><strong>${esc(r.a)}</strong><div><p>${esc(r.b)}</p>${r.outcome?'<p>'+esc(r.outcome)+'</p>':''}${r.leader&&r.leader!=='—'?'<small>Руководители: '+esc(r.leader)+'</small>':''}<small>${esc(r.section)}</small></div></article>`).join('')||'<p>Ничего не найдено. Попробуйте другое слово.</p>';$('#load-more').hidden=libraryLimit>=rows.length;}

// ---------- События ----------
$('#modes').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;reviewing=false;libraryLimit=30;restart();if(view==='library')renderLibrary();});
$('#period').addEventListener('change',e=>{period=e.target.value;libraryLimit=30;restart();if(view==='library')renderLibrary();});
$('#review').addEventListener('click',()=>{reviewing=true;setView('train');restart();});
$('#card').addEventListener('click',e=>{
 const b=e.target.closest('button');
 if(!b){if(answered&&queue.length)advance();return;}
 if(b.disabled)return;
 if(b.dataset.answer!==undefined)answer(Number(b.dataset.answer));
 else if(b.dataset.move){const [i,d]=b.dataset.move.split(',').map(Number);[orderItems[i],orderItems[i+d]]=[orderItems[i+d],orderItems[i]];renderOrder();}
 else if(b.id==='skip')answer(-1,true);
 else if(b.id==='check-order')answer(null);
 else if(b.id==='next')advance();
 else if(b.id==='back-practice'){reviewing=false;restart();}
});
$('.topnav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)setView(b.dataset.view);});
$('#search').addEventListener('input',()=>{libraryLimit=30;renderLibrary();});
$('#load-more').addEventListener('click',()=>{libraryLimit+=30;renderLibrary();});
$('#about').addEventListener('click',()=>$('#about-dialog').showModal());
$('.dialog-close').addEventListener('click',()=>$('#about-dialog').close());
$('#about-dialog').addEventListener('click',e=>{if(e.target===$('#about-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
window.addEventListener('keydown',e=>{
 if(view!=='train'||$('#about-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
 const q=queue[0];
 if(/^[1-4]$/.test(e.key)&&!answered&&q&&q.mode!=='order'){e.preventDefault();const n=Number(e.key)-1;if(q.options[n])answer(n);}
 if((e.key==='Enter'||e.key===' ')&&document.activeElement.tagName!=='BUTTON'){
  if(answered&&queue.length){e.preventDefault();advance();}
  else if(!answered&&q&&q.mode==='order'){e.preventDefault();answer(null);}
 }
});
restart();
