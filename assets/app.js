import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getDatabase, ref, set, get, child, push, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";

/* ----- CONFIG (как в проекте) ----- */
const firebaseConfig = {
  apiKey: "AIzaSyBr2nO_d8eNgbJ4ZA_lM-E4Q0zMQZZm8-U",
  authDomain: "santa-d25aa.firebaseapp.com",
  databaseURL: "https://santa-d25aa-default-rtdb.firebaseio.com",
  projectId: "santa-d25aa",
  storageBucket: "santa-d25aa.appspot.com",
  messagingSenderId: "171312122018",
  appId: "1:171312122018:web:98b8ed5f67716f91706ffb"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

try {
  await signInAnonymously(auth);
} catch (e) {
  showStatus(`Auth error: ${e.message}`, true);
  throw e;
}

/* ----- Helpers ----- */
const $ = s => document.querySelector(s);
const statusEl = $('#status');
function showStatus(t, isErr=false){ if(!statusEl) return; statusEl.textContent=t; statusEl.className='note'+(isErr?' error':''); setTimeout(()=>{statusEl.textContent='';statusEl.className='note';},2500); }
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n))).map(b=>b.toString(16).padStart(2,'0')).join('');
function parseLines(raw){
  return raw.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const [name, ...rest] = line.split('|');
    return { name:(name||'').trim(), address:(rest.join('|')||'').trim() };
  }).filter(x=>x.name);
}
function shuffle(a){ const r=a.slice(); for(let i=r.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [r[i],r[j]]=[r[j],r[i]];} return r; }
function assignPairs(people,{noSelf=true,maxTries=5000}={}){
  const names = people.map(p=>p.name);
  if(names.length<3) throw new Error('Нужно минимум 3 участника.');
  for(let t=0;t<maxTries;t++){
    const receivers = shuffle(names); let ok=true;
    for(let i=0;i<names.length;i++){ if(noSelf && names[i]===receivers[i]){ ok=false; break; } }
    if(ok){ const map={}; for(let i=0;i<names.length;i++){ map[names[i]]=receivers[i]; } return map; }
  }
  throw new Error('Не удалось распределить без самоназначений. Добавьте участников или снимите галочку.');
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

/* ----- Organizer ----- */
const linksBox = $('#links');
const copyHint = $('#copyhint');
$('#generate')?.addEventListener('click', async ()=>{
  try{
    linksBox.innerHTML=''; copyHint.textContent='';
    const people = parseLines($('#names').value);
    if(!people.length) throw new Error('Добавьте хотя бы 3 участника.');
    const uniq = new Set(people.map(p=>p.name));
    if(uniq.size!==people.length) throw new Error('Имена должны быть уникальны (добавьте фамилию/инициал).');

    const blind = $('#blind').checked;
    const noSelf = $('#noSelf').checked;

    const map = assignPairs(people,{noSelf});
    const gameId = rand(8);

    const roster = {};
    for(const p of people){ roster[p.name] = { address:p.address||'', receiveId: rand(10) }; }

    for(const giverName of Object.keys(map)){
      const receiverName = map[giverName];
      const sendToken = rand(12);

      try{
        await set(ref(db, `games/${gameId}/pairs/${sendToken}`), {
          giverName,
          giverReceiveId: roster[giverName].receiveId,
          receiverName,
          receiverAddress: roster[receiverName].address || '',
          receiverReceiveId: roster[receiverName].receiveId,
          createdAt: serverTimestamp()
        });
      } catch(e){
        showStatus(`DB write error: ${e.message}`, true);
        throw e;
      }

      const url = `${location.origin}${location.pathname}#game=${gameId}&send=${sendToken}&in=${roster[giverName].receiveId}`;
      const div = document.createElement('div');
      div.className='item';
      div.innerHTML = `
        <div><strong>Ссылка для ${giverName}</strong></div>
        <div class="row" style="margin-top:6px">
          <input type="text" value="${url}" readonly style="flex:1"/>
          <button class="btn" data-url="${url}">Копировать</button>
        </div>
        ${blind ? '<p class="note">Слепый режим: пара не раскрывается до открытия ссылки участником.</p>' : ''}
      `;
      const btn = div.querySelector('button');
      btn.addEventListener('click', async ()=>{
        await navigator.clipboard.writeText(btn.dataset.url);
        copyHint.textContent='Ссылка скопирована ✔'; setTimeout(()=>copyHint.textContent='',1500);
      });
      linksBox.appendChild(div);
    }

    await set(ref(db, `games/${gameId}/meta`), { blind, count: people.length, createdAt: serverTimestamp() });
    showStatus('Ссылки готовы. Разошлите участникам.');
  }catch(e){
    showStatus(e.message || String(e), true);
  }
});

/* ----- Participant ----- */
const prm = new URLSearchParams(location.hash.replace(/^#/, ''));
if(prm.get('game') && prm.get('send') && prm.get('in')){
  $('#organizer')?.classList.add('hide');
  $('#participant')?.classList.remove('hide');

  const gameId  = prm.get('game');
  const sendTok = prm.get('send');
  const myInbox = prm.get('in');

  const pairSnap = await get(child(ref(db), `games/${gameId}/pairs/${sendTok}`));
  const roleBox = $('#p_role'), title = $('#p_title');

  if(!pairSnap.exists()){
    roleBox.innerHTML = `<span class="error">Ссылка недействительна или игра удалена.</span>`;
  }else{
    const data = pairSnap.val();
    const giverName = data.giverName;
    const receiverName = data.receiverName;
    const receiverAddress = data.receiverAddress || '—';
    const receiverInbox = data.receiverReceiveId;

    title.textContent = `Привет, ${giverName}!`;
    roleBox.innerHTML = `
      <div><strong>${giverName}</strong>, ты даришь подарок: <strong>${receiverName}</strong></div>
      <div>Его адрес: <span class="kbd">${receiverAddress}</span></div>
    `;

    // send message
    $('#send_btn')?.addEventListener('click', async ()=>{
      try{
        const text = ($('#msg_text').value||'').trim();
        const file = $('#msg_file').files[0] || null;
        let imageUrl = '';
        if(file){
          const msgId = rand(10);
          const r = sRef(storage, `games/${gameId}/messages/${msgId}/${file.name}`);
          await uploadBytes(r, file);
          imageUrl = await getDownloadURL(r);
        }
        const newMsgRef = push(ref(db, `games/${gameId}/inbox/${receiverInbox}`));
        await set(newMsgRef, { from: data.giverReceiveId, text, imageUrl, ts: Date.now() });
        $('#msg_text').value=''; $('#msg_file').value='';
        $('#send_status').textContent='Отправлено!'; setTimeout(()=>$('#send_status').textContent='',1800);
      }catch(e){
        $('#send_status').textContent='Ошибка: '+e.message;
      }
    });

    // inbox for me
    const inboxRef = ref(db, `games/${gameId}/inbox/${myInbox}`);
    onValue(inboxRef, (snap)=>{
      const inbox = $('#inbox'); inbox.innerHTML='';
      const val = snap.val()||{};
      const items = Object.values(val).sort((a,b)=>(a.ts||0)-(b.ts||0));
      if(!items.length){ inbox.innerHTML = '<p class="note">Пока нет писем. Как только твой Санта отправит — они появятся здесь.</p>'; return; }
      items.forEach(m=>{
        const box = document.createElement('div'); box.className='msg';
        box.innerHTML = `
          ${m.text ? `<div>${escapeHtml(m.text)}</div>` : ''}
          ${m.imageUrl ? `<img src="${m.imageUrl}" alt="Изображение/подарок">` : ''}
        `;
        inbox.appendChild(box);
      });
    });
  }
}
