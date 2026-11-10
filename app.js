'use strict';
const D = window.HISTORY_DATA;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = arr => {const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const norm = s => s.toLowerCase().replace(/ё/g,'е').replace(/[.,;:«»"()]/g,'').replace(/\s+/g,' ').trim();
const dateSpan = s => {const years=String(s).match(/\d{3,4}/g);return years?[Math.min(...years.map(Number)),Math.max(...years.map(Number))]:null;};
const overlaps = (a,b) => {const x=dateSpan(a),y=dateSpan(b);return x&&y?x[0]<=y[1]&&y[0]<=x[1]:norm(a)===norm(b);};
const part = r => (r.section.match(/Часть (\d)/)||[])[1] || '1';
const modes=[['mix','Все вперемешку','✳'],['date','Дата → событие','↗'],['event','Событие → дата','↙'],['people','Личности','♙'],['terms','Термины','≡'],['laws','Законы и реформы','§'],['rebels','Восстания и итоги','⚑'],['order','Хронология','⇅']];
const lawRows=D.dates.filter(r=>/реформ|закон|указ|уложени|судебник|конституци|манифест|табел|правда|устав|декрет/i.test(r.b));
const yearRows=D.dates.filter(r=>/^\d{3,4}(?:\s*г\.)?$/.test(r.a)).map(r=>({...r,year:parseInt(r.a,10)}));
let bank=[];
function addRows(rows,mode,reverse=false){for(const r of rows) bank.push({id:mode+':'+r.id,mode,part:part(r),prompt:reverse?r.b:r.a,answer:reverse?r.a:r.b,source:r.section,row:r});}
addRows(D.dates,'date');addRows(D.dates,'event',true);addRows(D.people,'people',true);addRows(D.terms,'terms',true);addRows(lawRows,'laws',true);
for(const r of D.rebels)bank.push({id:'rebels:'+r.id,mode:'rebels',part:part(r),prompt:r.b+' · '+r.a,answer:r.outcome,source:r.section,row:r});
let saved={};try{saved=JSON.parse(localStorage.getItem('history-practice-v1'))||{};}catch{}
let progress={xp:0,attempts:0,correct:0,days:{},cards:{},...saved};
if(!progress.cards||typeof progress.cards!=='object')progress.cards={};if(!progress.days||typeof progress.days!=='object')progress.days={};
let storageAvailable=true;
function save(){try{localStorage.setItem('history-practice-v1',JSON.stringify(progress));}catch{storageAvailable=false;$('footer span:last-child').textContent='ПРОГРЕСС В ЭТОЙ СЕССИИ';}}
function today(){const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}
let mode='mix',period='all',view='train',reviewing=false,deck=[],index=0,answered=false,results=[],streak=0,roundXp=0,misses=[],orderItems=[],libraryLimit=30;
function allowed(q){return period==='all'||q.part===period;}
function due(){return Object.values(progress.cards).filter(c=>c.review&&c.due<=Date.now()&&c.q&&allowed(c.q));}
function poolFor(m=mode){return bank.filter(q=>allowed(q)&&(m==='mix'||q.mode===m));}
function updateStats(){
 $('#total-xp').textContent=progress.xp;$('#streak').textContent=streak;$('#correct-count').textContent=results.filter(Boolean).length;$('#wrong-count').textContent=results.filter(x=>!x).length;$('#round-xp').textContent='+'+roundXp;$('#error-count').textContent=due().length;
 const daily=progress.days[today()]||0;$('#daily-count').textContent=daily+' / 20';$('#daily-bar').style.width=Math.min(100,daily/20*100)+'%';$('#daily-caption').textContent=daily>=20?'Цель выполнена. Отличный ритм.':'20 ответов — ещё один шаг.';
}
const titles={mix:'История',date:'События',event:'Даты',people:'Личности',terms:'Понятия',laws:'Реформы',rebels:'Восстания',order:'Хронология'};
function renderTitle(){ $('#page-title').innerHTML=esc(view==='library'?'База знаний':reviewing?'Повторение':titles[mode])+'<span>.</span>'; }
function renderModes(){
 renderTitle();
 $('#modes').innerHTML=modes.map(([id,label,icon])=>{let n=id==='order'?yearRows.filter(allowedRow).length:poolFor(id).length;return `<button class="mode ${id===mode&&!reviewing?'active':''}" data-mode="${id}" aria-pressed="${id===mode&&!reviewing}"><span class="mode-icon" aria-hidden="true">${icon}</span><span>${label}</span><span class="mode-number">${n.toLocaleString('ru')}</span></button>`;}).join('');
 $('#review').classList.toggle('active',reviewing);
}
function allowedRow(r){return period==='all'||part(r)===period;}
function chronological(){
 const unique=new Map();for(const r of shuffle(yearRows.filter(allowedRow)))if(!unique.has(r.year))unique.set(r.year,r);
 const rows=[...unique.values()].slice(0,3);if(rows.length<3)return null;
 const ordered=[...rows].sort((a,b)=>a.year-b.year);
 return {id:'order:'+ordered.map(r=>r.id).join('-'),mode:'order',part:period,prompt:'Что было раньше?',answer:ordered.map(r=>r.b+' — '+r.a).join(' → '),items:rows,source:'Хронология · «Даты и события»'};
}
function priority(q){const c=progress.cards[q.id];return c?(c.review&&c.due<=Date.now()?0:c.due<=Date.now()?1:3):2;}
function prepare(q){
 if(q.mode==='order')return {...q};
 const equivalents=bank.filter(x=>x.mode===q.mode&&norm(x.prompt)===norm(q.prompt));
 const valid=new Set(equivalents.map(x=>norm(x.answer)));
 const safe = x => q.mode==='date'?!overlaps(x.prompt,q.prompt):['event','laws'].includes(q.mode)?!equivalents.some(v=>overlaps(x.answer,v.answer)):true;
 const candidates=shuffle(bank.filter(x=>safe(x)&&x.mode===q.mode&&x.part===q.part&&norm(x.prompt)!==norm(q.prompt)&&!valid.has(norm(x.answer))));
 const all=[...candidates,...shuffle(bank.filter(x=>safe(x)&&x.mode===q.mode&&norm(x.prompt)!==norm(q.prompt)&&!valid.has(norm(x.answer))))];
 const answers=[q.answer],seen=new Set([norm(q.answer)]);
 for(const x of all){if(!seen.has(norm(x.answer))){answers.push(x.answer);seen.add(norm(x.answer));}if(answers.length===4)break;}
 return {...q,options:shuffle(answers)};
}
function startRound(custom){
 results=[];index=0;streak=0;roundXp=0;misses=[];answered=false;
 if(custom)deck=shuffle(custom).slice(0,10).map(prepare);
 else if(reviewing)deck=shuffle(due()).map(c=>prepare(c.q)).slice(0,10);
 else if(mode==='order')deck=Array.from({length:10},chronological).filter(Boolean);
 else {let pool=shuffle(poolFor()).sort((a,b)=>priority(a)-priority(b));if(mode==='mix'){const groups=modes.slice(1).filter(x=>x[0]!=='order').map(([m])=>shuffle(pool.filter(q=>q.mode===m)).sort((a,b)=>priority(a)-priority(b)));pool=[];for(let i=0;i<2;i++)for(const g of shuffle(groups))if(g[i])pool.push(g[i]);}deck=pool.slice(0,10).map(prepare);if(mode==='mix'&&deck.length>=5){const q=chronological();if(q)deck[4]=q;}}
 renderModes();updateStats();renderCard();
}
const prompts={date:['ДАТА → СОБЫТИЕ','Что произошло в это время?'],event:['СОБЫТИЕ → ДАТА','Когда это произошло?'],people:['ИСТОРИЧЕСКИЕ ЛИЧНОСТИ','О ком идёт речь?'],terms:['ТЕРМИНЫ','Как называется это понятие?'],laws:['ЗАКОНЫ И РЕФОРМЫ','Когда произошло это изменение?'],rebels:['ВОССТАНИЯ И ИТОГИ','Чем закончилось это выступление?'],order:['ХРОНОЛОГИЯ','Расположите события от раннего к позднему.']};
function renderCard(){
 answered=false;
 $('#round-label').textContent=reviewing?'Повторение ошибок':modes.find(x=>x[0]===mode)[1];$('#round-index').textContent=String(Math.min(index+1,deck.length)).padStart(2,'0');$('.round-meta .muted').textContent='/ '+deck.length;
 $('#round-track').innerHTML=deck.map((_,i)=>`<i class="${i<results.length?(results[i]?'correct':'wrong'):i===index?'current':''}"></i>`).join('');
 if(!deck.length){$('#card').innerHTML=`<div class="result"><div class="eyebrow">${reviewing?'ПОВТОРЕНИЕ':'КАРТОЧКИ'}</div><h2>${reviewing?'На сегодня всё чисто.':'Нет карточек для этого периода.'}</h2><p>${reviewing?'Здесь появятся ошибки и карточки, которые пора повторить.':'Попробуйте другой период или формат.'}</p><button class="primary" id="back-practice">К тренировке ↗</button></div>`;return;}
 if(index>=deck.length){finish();return;}
 const q=deck[index], [label,hint]=prompts[q.mode];
 $('#card').innerHTML=`<div class="card-head"><span>${label}</span><span class="card-tag">${q.mode==='order'?'ПО ПОРЯДКУ':'ОДИН ОТВЕТ'}</span></div><div class="card-prompt"><h2 class="${q.mode==='date'&&q.prompt.length<18?'date':''}">${esc(q.prompt)}</h2><p>${hint}</p></div><div id="answer-area"></div><div class="card-actions" id="card-actions">${q.mode==='order'?'<button class="primary" id="check-order">Проверить порядок ↗</button>':''}<button id="skip" class="skip-button">Не знаю <span aria-hidden="true">↗</span></button></div><div id="feedback" aria-live="polite"></div>`;
 if(q.mode==='order'){orderItems=shuffle(q.items);renderOrder();}else $('#answer-area').innerHTML=`<div class="options ${q.options.some(x=>x.length>95)?'long':''}">${q.options.map((text,i)=>`<button class="option" data-answer="${i}"><span class="option-number">${i+1}</span><span>${esc(text)}</span></button>`).join('')}</div>`;
}
function renderOrder(){
 $('#answer-area').innerHTML=`<div class="order-list">${orderItems.map((r,i)=>`<div class="order-row"><span>0${i+1}</span><span>${esc(r.b)}</span><button data-move="${i},-1" aria-label="Поднять событие ${i+1}" ${i===0?'disabled':''}>↑</button><button data-move="${i},1" aria-label="Опустить событие ${i+1}" ${i===orderItems.length-1?'disabled':''}>↓</button></div>`).join('')}</div>`;
}
function answer(choice,skip=false){
 if(answered||!deck[index])return;
 const q=deck[index];answered=true;
 const correct=!skip&&(q.mode==='order'?orderItems.every((r,i,a)=>i===0||a[i-1].year<r.year):q.options[choice]===q.answer);
 results.push(correct);streak=correct?streak+1:0;const earned=correct?10+(streak%5===0?5:0):0;roundXp+=earned;progress.xp+=earned;progress.attempts++;if(correct)progress.correct++;progress.days[today()]=(progress.days[today()]||0)+1;
 const old=progress.cards[q.id]||{level:0,review:false};const level=correct?Math.min((old.level||0)+1,5):0;
 const {options,...storedQ}=q;progress.cards[q.id]={level,review:!correct||old.review,due:correct?Date.now()+[0,1,3,7,14,30][level]*86400000:Date.now(),q:storedQ};
 if(!correct)misses.push(q);save();updateStats();
 $('#card-actions').hidden=true;
 document.querySelectorAll('.option').forEach((b,i)=>{b.disabled=true;if(q.options[i]===q.answer){b.classList.add('correct');b.querySelector('.option-number').textContent='✓';}else if(i===choice&&!skip){b.classList.add('wrong');b.querySelector('.option-number').textContent='×';}});
 if(q.mode==='order')document.querySelectorAll('#answer-area button').forEach(b=>b.disabled=true);
 const explanation=q.mode==='order'?[...q.items].sort((a,b)=>a.year-b.year).map(r=>esc(r.a)+' — '+esc(r.b)).join('<br>'):q.mode==='date'?esc(q.prompt)+' — '+esc(q.answer):esc(q.answer);
 $('#feedback').className='feedback '+(correct?'':'bad');$('#feedback').innerHTML=`<div class="feedback-copy"><strong>${correct?'Верно. +'+earned+' XP':skip?'Запомним.':'Почти. Запомним ответ.'}</strong><p>${explanation}</p><p class="source">${esc(q.source)}</p></div><button class="primary" id="next">${index===deck.length-1?'Итоги раунда':'Дальше'} →</button>`;
 $('#round-track').children[index].className=correct?'correct':'wrong';$('#next').focus({preventScroll:true});
}
function finish(){
 answered=true;const correct=results.filter(Boolean).length;
 $('#card').innerHTML=`<div class="result"><div class="eyebrow">РАУНД ЗАВЕРШЁН / +${roundXp} XP</div><div class="result-score">${correct}<span> / ${deck.length}</span></div><h2>${correct===deck.length?'Всё на своих местах.':correct>=deck.length*.7?'История складывается.':'Ещё один раунд — и крепче.'}</h2><p>${misses.length?'Ошибок: '+misses.length+'. Закрепим их отдельным раундом.':'Все ответы верные. Можно переходить к следующей десятке.'}</p><div class="result-actions"><button class="primary" id="new-round">Ещё 10 карточек ↗</button>${misses.length?'<button class="secondary" id="retry">Повторить ошибки ↺</button>':''}</div></div>`;
}
function setView(next){view=next;$('#training').hidden=view!=='train';$('#library').hidden=view!=='library';renderTitle();$('.streak').hidden=view!=='train';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='library')renderLibrary();}
function libraryRows(){const rows=mode==='people'?D.people:mode==='terms'?D.terms:mode==='rebels'?D.rebels:mode==='laws'?lawRows:['date','event','order'].includes(mode)?D.dates:[...D.dates,...D.people,...D.terms,...D.rebels];const term=norm($('#search').value);return rows.filter(allowedRow).filter(r=>!term||norm([r.a,r.b,r.outcome||'',r.leader||''].join(' ')).includes(term));}
function renderLibrary(){const rows=libraryRows();$('#library-summary').textContent=`Найдено: ${rows.length.toLocaleString('ru')} · показано ${Math.min(libraryLimit,rows.length)}`;$('#library-list').innerHTML=rows.slice(0,libraryLimit).map(r=>`<article class="library-item"><strong>${esc(r.a)}</strong><div><p>${esc(r.b)}</p>${r.outcome?'<p>'+esc(r.outcome)+'</p>':''}${r.leader&&r.leader!=='—'?'<small>Руководители: '+esc(r.leader)+'</small>':''}<small>${esc(r.section)}</small></div></article>`).join('')||'<p>Ничего не найдено. Попробуйте другое слово.</p>';$('#load-more').hidden=libraryLimit>=rows.length;}
$('#modes').addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;mode=b.dataset.mode;reviewing=false;libraryLimit=30;startRound();if(view==='library')renderLibrary();});
$('#period').addEventListener('change',e=>{period=e.target.value;libraryLimit=30;startRound();if(view==='library')renderLibrary();});
$('#review').addEventListener('click',()=>{reviewing=true;setView('train');startRound();});
$('#card').addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.answer!==undefined)answer(Number(b.dataset.answer));else if(b.dataset.move){const [i,d]=b.dataset.move.split(',').map(Number);[orderItems[i],orderItems[i+d]]=[orderItems[i+d],orderItems[i]];renderOrder();}else if(b.id==='skip')answer(-1,true);else if(b.id==='check-order')answer(null);else if(b.id==='next'){index++;renderCard();}else if(b.id==='new-round'||b.id==='back-practice'){reviewing=false;startRound();}else if(b.id==='retry'){reviewing=true;startRound([...misses]);}});
$('.topnav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)setView(b.dataset.view);});
$('#search').addEventListener('input',()=>{libraryLimit=30;renderLibrary();});$('#load-more').addEventListener('click',()=>{libraryLimit+=30;renderLibrary();});
$('#about').addEventListener('click',()=>$('#about-dialog').showModal());$('.dialog-close').addEventListener('click',()=>$('#about-dialog').close());
$('#about-dialog').addEventListener('click',e=>{if(e.target===$('#about-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
window.addEventListener('keydown',e=>{if(view!=='train'||$('#about-dialog').open||['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;if(/^[1-4]$/.test(e.key)&&!answered&&deck[index]?.mode!=='order'){e.preventDefault();const n=Number(e.key)-1;if(deck[index]?.options[n])answer(n);}if(e.key==='Enter'&&document.activeElement.tagName!=='BUTTON'){if(answered&&index<deck.length){e.preventDefault();index++;renderCard();}else if(!answered&&deck[index]?.mode==='order'){e.preventDefault();answer(null);}}});
startRound();
