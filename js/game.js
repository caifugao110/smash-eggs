/**
 * smash-eggs · 游戏主逻辑
 * 状态管理 / 关卡生成 / 触屏交互 / 自定义设置 / 学习报告 / 进度持久化
 */

(function () {
  'use strict';

  const STORE = 'smashEggs_v2';

  const DEFAULTS = {
    // 声音
    soundOn: true, bgmOn: false, speechOn: true, style: 0, voiceURI: '', volume: 0.8,
    // 难度
    eggCount: 0,        // 0 = 按关卡自动；否则 3~8
    targetCount: 0,     // 0 = 按关卡自动；否则 2~4
    mode: 'mixed',      // auto | mixed | find | listen | pinyin | picture | word | challenge
    // 显示
    showPinyin: true, showHint: true, autoSpeak: true, bigFont: false,
    theme: 'sunshine',  // sunshine | mint | ocean | candy | night
    // 反馈
    vibrate: true, confetti: true, wrongPenalty: false,
    // 统计
    stats: { totalSmash:0, totalRight:0, totalWrong:0, playSeconds:0, daily:{} },
    // 数据
    stars:{}, learned:[], customCards:[], last:null
  };

  let S = load();
  let state = {
    screen:'home', ci:0, li:0, level:null, idx:0,
    mistakes:0, answered:[], session:[], startedAt:0
  };
  let toastTimer = null;
  const app = document.getElementById('app');

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), JSON.parse(raw));
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function deepMerge(base, extra) {
    Object.keys(extra).forEach(k => {
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k]) deepMerge(base[k], extra[k]);
      else base[k] = extra[k];
    });
    return base;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
  function syncAudio() {
    Sound.configure({ soundOn:S.soundOn, bgmOn:S.bgmOn, speechOn:S.speechOn, style:S.style, voiceURI:S.voiceURI, volume:S.volume });
  }

  /* ---------- 工具 ---------- */
  function shuffle(a) {
    a = a.slice();
    for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); const t=a[i];a[i]=a[j];a[j]=t; }
    return a;
  }
  const lkey = (ci,li) => ci+'-'+li;
  function unlocked(ci,li) {
    if (ci===0 && li===0) return true;
    const prev = li>0 ? lkey(ci,li-1) : lkey(ci-1, LEVELS_PER_CHAPTER-1);
    return !!S.stars[prev];
  }
  function totalStars() { return Object.keys(S.stars).reduce((a,k)=>a+S.stars[k],0); }
  function doneCount() { return Object.keys(S.stars).length; }
  function allCards() {
    return CHAPTERS.reduce((acc,ch)=>acc.concat(ch.pool), []).concat(S.customCards||[]);
  }
  function findCard(text) { return allCards().find(c=>c.c===text) || {c:text,p:'',e:'🌟',w:text}; }
  function todayKey() { const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }

  function recordPlayTime() {
    if (state.screen!=='game' || !state.startedAt) return;
    const sec = Math.floor((Date.now()-state.startedAt)/1000);
    if (sec>0) { S.stats.playSeconds += sec; state.startedAt = Date.now(); }
  }

  function makeLevel(ci, li) {
    const ch = CHAPTERS[ci];
    const defEggs = [4,5,5,6,6,7][li] || 6;
    const defTargets = [2,2,2,2,3,3][li] || 2;
    const eggCount = S.eggCount || defEggs;
    const targetCount = Math.min(S.targetCount || defTargets, Math.min(eggCount-1, ch.pool.length));
    const targets = shuffle(ch.pool).slice(0, targetCount);
    const banned = new Set(targets.map(t=>t.c));
    const global = allCards();
    const distractors = shuffle(global.filter(g=>!banned.has(g.c))).slice(0, eggCount-targets.length);
    let mode = li % MODES.length;
    if (S.mode !== 'mixed' && S.mode !== 'auto') {
      const found = MODES.findIndex(m=>m.name===S.mode);
      if (found >= 0) mode = found;
    }
    return { ci, li, mode, eggs:shuffle(targets.concat(distractors)), targets };
  }

  /* ---------- 特效 ---------- */
  function confetti(el) {
    if (!S.confetti) return;
    const r = el.getBoundingClientRect();
    const cols = ['#FFC312','#FF6B81','#4DC9E8','#4ECDC4','#A29BFE','#FF8A3D'];
    for (let i=0;i<20;i++) {
      const d = document.createElement('div');
      d.className = 'confetti';
      d.style.left = (r.left+r.width/2)+'px';
      d.style.top = (r.top+r.height/2)+'px';
      d.style.background = cols[i%cols.length];
      d.style.setProperty('--dx',(Math.random()*260-130)+'px');
      d.style.setProperty('--dy',(-70-Math.random()*150)+'px');
      d.style.setProperty('--rot',(Math.random()*720-360)+'deg');
      document.body.appendChild(d);
      setTimeout(()=>d.remove(), 1100);
    }
  }
  function hammer(el) {
    const r = el.getBoundingClientRect();
    const h = document.createElement('div');
    h.className = 'hammer-fx'; h.textContent = '🔨';
    h.style.left = (r.left+r.width/2-38)+'px';
    h.style.top = (r.top-44)+'px';
    document.body.appendChild(h);
    setTimeout(()=>h.remove(), 470);
  }
  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>t.classList.remove('show'), 1500);
  }
  function buzz(p) { if (S.vibrate) Sound.vibrate(p); }

  /* ---------- 渲染 ---------- */
  function render(inner) { app.innerHTML = inner; }
  function head(title, back) {
    return '<div class="head"><button class="icon-btn" data-action="'+(back||'home')+'">🏠</button>'+
      '<h2>'+title+'</h2></div>';
  }

  function renderHome() {
    state.screen = 'home'; recordPlayTime();
    const last = S.last && unlocked(S.last[0], S.last[1]) ? S.last : null;
    render('<div class="screen home">'+
      '<div class="mascot">🐥</div>'+
      '<h1>砸金蛋 · 学汉字</h1>'+
      '<div class="sub">砸一砸，读一读，识字真好玩！</div>'+
      '<div class="stats">'+
        '<span class="pill">⭐ '+totalStars()+' / '+(TOTAL_LEVELS*3)+'</span>'+
        '<span class="pill">📖 认识 '+S.learned.length+' 个字</span>'+
        '<span class="pill">✅ 通关 '+doneCount()+' / '+TOTAL_LEVELS+'</span>'+
      '</div>'+
      '<div class="home-buttons">'+
        (last?'<button class="btn big" data-action="play" data-ci="'+last[0]+'" data-li="'+last[1]+'">▶ 继续闯关</button>':'')+
        '<button class="btn big '+(last?'blue':'')+'" data-action="map">🗺️ 关卡地图</button>'+
        '<div class="row">'+
          '<button class="btn ghost sm" data-action="collection">📚 我的字卡</button>'+
          '<button class="btn ghost sm" data-action="report">📊 学习报告</button>'+
          '<button class="btn ghost sm" data-action="settings">⚙️ 家长设置</button>'+
        '</div>'+
      '</div>'+
      '<p class="muted" style="margin-top:26px">'+CHAPTERS.length+' 章 · '+TOTAL_LEVELS+' 关 · '+allCards().length+' 个学习条目</p>'+
    '</div>');
  }

  function renderMap() {
    state.screen = 'map'; recordPlayTime();
    let html = head('🗺️ 关卡地图')+'<div class="chapters">';
    CHAPTERS.forEach((ch,ci)=>{
      html += '<div class="chapter" style="background:linear-gradient(145deg,'+ch.color+',rgba(0,0,0,.2))">'+
        '<div class="ch-icon">'+ch.icon+'</div><h3>第'+(ci+1)+'章 '+ch.name+'</h3><p>'+ch.desc+'</p><div class="levels">';
      for (let li=0;li<LEVELS_PER_CHAPTER;li++) {
        const k=lkey(ci,li), s=S.stars[k]||0, ok=unlocked(ci,li);
        html += '<button class="lv '+(ok?(s?'done':''):'lock')+'" '+
          (ok?'data-action="play" data-ci="'+ci+'" data-li="'+li+'"':'disabled')+'>'+
          (ok?(MODES[li] ? li+1 : li+1):'🔒')+
          (s?'<span class="mini-stars">'+'★'.repeat(s)+'</span>':'')+'</button>';
      }
      html += '</div></div>';
    });
    html += '</div>';
    render('<div class="screen">'+html+'</div>');
  }

  function promptHTML() {
    const lv=state.level, t=lv.targets[state.idx], m=MODES[lv.mode];
    let main='';
    if (lv.mode===0 || lv.mode===5) {
      main = '<div class="bigchar">'+t.c+'</div>'+(S.showPinyin?'<div class="pinyin">'+t.p+'</div>':'');
    } else if (lv.mode===1) {
      main = '<button class="speak" data-action="speak-again">🔊</button>'+(S.showPinyin?'<div class="pinyin">'+t.p+'</div>':'');
    } else if (lv.mode===2) {
      main = '<div class="bigchar" style="font-size:clamp(30px,6vw,48px)">'+t.p+'</div>'+
             '<div class="pinyin">听一听 · 找一找</div>';
    } else if (lv.mode===3) {
      main = '<div class="pic">'+t.e+'</div>'+(S.showPinyin?'<div class="pinyin">'+t.p+'</div>':'');
    } else {
      main = '<div class="bigchar" style="font-size:clamp(30px,6vw,48px)">'+t.w+'</div>'+
             (S.showPinyin?'<div class="pinyin">'+t.p+'</div>':'');
    }
    return '<div class="card prompt" id="promptCard"><div class="ask">'+m.ask(t)+'</div>'+main+
      (S.showHint?'<div class="muted">'+m.hint+' · 目标 '+(state.idx+1)+'/'+lv.targets.length+'</div>':'')+'</div>';
  }

  function renderGame() {
    state.screen='game';
    const ch=CHAPTERS[state.ci];
    let eggs='';
    state.level.eggs.forEach((item,i)=>{
      eggs += '<div class="egg" data-action="egg" data-idx="'+i+'" style="animation-delay:'+(i*.17)+'s">'+
        '<div class="egg-shell"></div>'+
        '<div class="egg-face"><b>'+item.c+'</b>'+(S.showPinyin?'<small>'+item.p+'</small>':'')+
        '<span>'+item.e+'</span></div></div>';
    });
    render('<div class="screen"><div class="game-head">'+
      '<button class="icon-btn" data-action="map">←</button>'+
      '<div class="title">'+ch.icon+' '+ch.name+' · 第'+(state.li+1)+'关</div>'+
      '<button class="icon-btn" data-action="sound">'+(S.soundOn?'🔊':'🔇')+'</button></div>'+
      '<div id="promptWrap">'+promptHTML()+'</div>'+
      '<div class="progress-track"><div class="progress-fill" id="pFill" style="width:0"></div></div>'+
      '<div class="egg-grid">'+eggs+'</div>'+
      '<div class="learn-bar" id="learnBar"><div class="l-emoji">🐣</div><div>'+
        '<div class="l-char">点一点金蛋</div><div class="l-word">砸开就能看到汉字朋友啦！</div></div></div>'+
      '<div class="tip">💡 不用着急，答错了也没关系，再试一次就好～</div></div>');
    if (S.autoSpeak) {
      const lv=state.level;
      setTimeout(()=>Sound.speak(lv.targets[state.idx].c), lv.mode===1?350:300);
    }
  }

  function showLearn(item, right) {
    const bar=document.getElementById('learnBar'); if(!bar) return;
    bar.innerHTML = '<div class="l-emoji">'+item.e+'</div><div><div class="l-char">'+item.c+
      (S.showPinyin?' <span class="l-py">'+item.p+'</span>':'')+'</div><div class="l-word">'+item.w+'</div></div>'+
      '<button class="l-speak" data-action="speak-word" data-c="'+item.c+'">🔊</button>';
    bar.style.boxShadow = right ? '0 0 0 4px #4ECDC4,0 6px 16px rgba(0,0,0,.1)' : '0 6px 16px rgba(0,0,0,.1)';
  }

  function smash(idx, el) {
    if (state.screen!=='game' || el.classList.contains('smashed')) return;
    const item = state.level.eggs[idx];
    Sound.fx.smash(); buzz(18); hammer(el); el.classList.add('smashed');
    S.stats.totalSmash++;
    const isTarget = state.level.targets.some(t=>t.c===item.c) && !state.answered.includes(item.c);
    setTimeout(()=>{
      if (isTarget) {
        state.answered.push(item.c);
        state.session.push(item);
        S.stats.totalRight++;
        if (!S.learned.includes(item.c)) S.learned.push(item.c);
        S.stats.daily[todayKey()] = (S.stats.daily[todayKey()]||0)+1;
        Sound.fx.right(); Sound.speak(item.c); confetti(el); buzz([15,40,15]);
        showLearn(item,true);
        state.idx++;
        const fill=document.getElementById('pFill');
        if (fill) fill.style.width = Math.round(state.idx/state.level.targets.length*100)+'%';
        if (state.idx>=state.level.targets.length) setTimeout(finishLevel,1100);
        else { document.getElementById('promptWrap').innerHTML=promptHTML();
               if(S.autoSpeak) setTimeout(()=>Sound.speak(state.level.targets[state.idx].c),250); }
        save();
      } else {
        state.mistakes++; S.stats.totalWrong++;
        if (!state.answered.includes(item.c)) el.classList.add('wrong');
        Sound.fx.wrong(); buzz([40,40,40]);
        showLearn(item,false);
        toast('这是「'+item.c+'」，再找找哦～');
        Sound.speak(item.c);
        if (S.wrongPenalty) el.classList.add('penalty');
        save();
      }
    }, 250);
  }

  function finishLevel() {
    Sound.fx.win(); confetti(document.querySelector('.result')||document.body);
    const stars = state.mistakes===0?3:(state.mistakes<=2?2:1);
    const k=lkey(state.ci,state.li);
    S.stars[k]=Math.max(S.stars[k]||0,stars);
    S.last=[state.ci,state.li];
    recordPlayTime(); save();
    state.screen='result';
    const hasNext = state.li<LEVELS_PER_CHAPTER-1 || state.ci<CHAPTERS.length-1;
    let cards='';
    state.session.forEach(it=>{
      cards += '<div class="res-card" data-action="speak-word" data-c="'+it.c+'"><b>'+it.c+'</b><small>'+it.p+'</small></div>';
    });
    render('<div class="screen result"><div class="mascot" style="font-size:80px">🎉</div>'+
      '<h2>太棒啦！过关咯！</h2>'+
      '<div class="big-stars">'+'★'.repeat(stars)+'<span style="opacity:.2">'+'★'.repeat(3-stars)+'</span></div>'+
      '<p style="font-size:18px;font-weight:700">这一关认识了这些汉字朋友（点一点可以听哦）</p>'+
      '<div class="cards">'+cards+'</div>'+
      '<div class="row">'+
        (hasNext?'<button class="btn big" data-action="next">下一关 ▶</button>':'<button class="btn big green" data-action="map">🏆 全部通关</button>')+
        '<button class="btn blue" data-action="replay">🔄 再玩一次</button>'+
        '<button class="btn ghost" data-action="map">🗺️ 关卡地图</button>'+
      '</div></div>');
  }

  function startLevel(ci,li) {
    Sound.unlock();
    if (!unlocked(ci,li)) { toast('先完成前面的关卡哦～'); return; }
    state.ci=ci; state.li=li; state.level=makeLevel(ci,li);
    state.idx=0; state.mistakes=0; state.answered=[]; state.session=[]; state.startedAt=Date.now();
    renderGame();
  }

  function renderCollection() {
    state.screen='collection'; recordPlayTime();
    let items='';
    if (!S.learned.length) items='<p class="muted" style="text-align:center;padding:30px">还没有字卡，快去砸金蛋收集吧！</p>';
    else S.learned.forEach(c=>{
      const o=findCard(c);
      items += '<div class="collect-item" data-action="speak-word" data-c="'+c+'"><b>'+c+'</b><small>'+o.p+'</small></div>';
    });
    render('<div class="screen">'+head('📚 我的字卡')+
      '<div class="row" style="margin-bottom:10px"><button class="btn ghost sm" data-action="read-all">🔊 连读全部</button>'+
      '<button class="btn ghost sm" data-action="collection-shuffle">🔀 顺序打乱</button></div>'+
      '<div class="collect-grid" id="collectGrid">'+items+'</div></div>');
  }

  function renderReport() {
    state.screen='report'; recordPlayTime();
    const st=S.stats;
    const right=st.totalRight, wrong=st.totalWrong, total=right+wrong;
    const rate = total ? Math.round(right/total*100) : 0;
    const mins = Math.floor(st.playSeconds/60);
    let chapHtml='';
    CHAPTERS.forEach((ch,ci)=>{
      let earned=0;
      for(let li=0;li<LEVELS_PER_CHAPTER;li++) earned+=S.stars[lkey(ci,li)]||0;
      const max=LEVELS_PER_CHAPTER*3;
      chapHtml += '<div class="report-row"><span>'+ch.icon+' '+ch.name+'</span>'+
        '<div class="report-bar"><div style="width:'+Math.round(earned/max*100)+'%"></div></div>'+
        '<b>'+earned+'/'+max+'</b></div>';
    });
    render('<div class="screen">'+head('📊 学习报告')+
      '<div class="report-cards">'+
        '<div class="report-card"><b>'+totalStars()+'</b><small>获得星星</small></div>'+
        '<div class="report-card"><b>'+S.learned.length+'</b><small>认识汉字</small></div>'+
        '<div class="report-card"><b>'+rate+'%</b><small>正确率</small></div>'+
        '<div class="report-card"><b>'+mins+'</b><small>游戏分钟</small></div>'+
      '</div>'+
      '<div class="card" style="padding:18px;margin-top:14px"><h3 style="margin:0 0 12px;color:#E47600">各章节掌握进度</h3>'+chapHtml+'</div>'+
      '<p class="muted" style="text-align:center;margin-top:14px">累计砸蛋 '+st.totalSmash+' 次 · 答对 '+right+' 次 · 答错 '+wrong+' 次</p>'+
    '</div>');
  }

  function toggleRow(key, label, emoji) {
    return '<div class="set-row"><span style="font-size:24px">'+emoji+'</span><span class="txt">'+label+'</span>'+
      '<button class="toggle '+(S[key]?'on':'')+'" data-action="toggle" data-key="'+key+'"></button></div>';
  }
  function choiceRow(label, emoji, options, key, action) {
    let btns='';
    options.forEach(o=>{
      btns += '<button class="chip '+(S[key]===o[0]?'on':'')+'" data-action="'+action+'" data-v="'+o[0]+'">'+o[1]+'</button>';
    });
    return '<div class="set-col"><div class="set-label">'+emoji+' '+label+'</div><div class="chips">'+btns+'</div></div>';
  }

  function voiceChips() {
    return Sound.STYLES.map(function(s, i){
      return '<button class="chip '+(S.style===i?'on':'')+'" data-action="set-style" data-v="'+i+'">'+s.emoji+' '+s.name+'</button>';
    }).join('');
  }
  function voiceOptions() {
    const list = Sound.listVoices();
    if (!list.length) return '<option value="">自动（优先童声）</option>';
    return '<option value="">自动（优先童声）</option>' + list.map(function(v){
      const child = /child|kid|童/i.test(v.name||'') ? ' 🧒' : '';
      return '<option value="'+v.voiceURI+'"'+(S.voiceURI===v.voiceURI?' selected':'')+'>'+(v.name||v.lang)+child+'</option>';
    }).join('');
  }

  function renderSettings() {
    state.screen='settings'; recordPlayTime();
    render('<div class="screen">'+head('⚙️ 家长设置')+
      '<div class="card" style="padding:16px;margin-bottom:14px">'+
        '<h3 style="margin:0 0 10px;color:#E47600">🔊 声音</h3>'+
        toggleRow('soundOn','游戏音效','🔊')+
        toggleRow('bgmOn','背景音乐','🎵')+
        toggleRow('speechOn','汉字朗读','🗣️')+
        toggleRow('autoSpeak','自动朗读','🔁')+
        '<div class="set-col"><div class="set-label">🎨 朗读音色</div><div class="chips">'+voiceChips()+'</div></div>'+
        '<div class="set-row"><span style="font-size:24px">🧒</span><span class="txt">系统童声</span>'+
          '<select data-action="set-voice" style="max-width:150px;border-radius:10px;border:2px solid #FFE0A3;padding:6px;font-family:inherit;font-size:13px">'+voiceOptions()+'</select>'+
          '<button class="icon-btn" data-action="try-voice" style="width:46px;height:46px;font-size:21px">🔊</button></div>'+
        '<p class="muted" style="margin:4px 0 10px;line-height:1.6">优先自动挑选系统里的儿童音色；若声音仍偏生硬，可在此切换其他音色，或改用 Edge 浏览器（自带更自然的在线童声）。</p>'+
        '<div class="set-row"><span style="font-size:24px">🎚️</span><span class="txt">音量</span>'+
          '<input type="range" min="0" max="100" value="'+Math.round(S.volume*100)+'" data-action="volume" style="width:140px"></div>'+
      '</div>'+
      '<div class="card" style="padding:16px;margin-bottom:14px">'+
        '<h3 style="margin:0 0 10px;color:#E47600">🎯 难度</h3>'+
        choiceRow('金蛋数量','🥚',[[0,'自动'],[3,'3 个'],[4,'4 个'],[5,'5 个'],[6,'6 个'],[7,'7 个'],[8,'8 个']],'eggCount','set-egg')+
        choiceRow('目标数量','🎯',[[0,'自动'],[2,'2 个'],[3,'3 个'],[4,'4 个']],'targetCount','set-target')+
        choiceRow('玩法模式','🎲',[['mixed','轮换'],['find','找字'],['listen','听音'],['pinyin','拼音'],['picture','看图'],['word','看词'],['challenge','挑战']],'mode','set-mode')+
        toggleRow('wrongPenalty','答错提示加强','⚠️')+
      '</div>'+
      '<div class="card" style="padding:16px;margin-bottom:14px">'+
        '<h3 style="margin:0 0 10px;color:#E47600">👀 显示与反馈</h3>'+
        toggleRow('showPinyin','显示拼音','🔤')+
        toggleRow('showHint','显示提示','💡')+
        toggleRow('bigFont','超大字体','🔠')+
        toggleRow('confetti','彩纸特效','🎊')+
        toggleRow('vibrate','震动反馈','📳')+
        choiceRow('主题颜色','🎨',[['sunshine','阳光'],['mint','薄荷'],['ocean','海洋'],['candy','糖果'],['night','夜空']],'theme','set-theme')+
      '</div>'+
      '<div class="card" style="padding:16px;margin-bottom:14px">'+
        '<h3 style="margin:0 0 10px;color:#E47600">📚 自定义字库</h3>'+
        '<p class="muted" style="line-height:1.7;margin:0 0 10px">添加你想教的汉字，格式：汉字,拼音,表情,例词（每行一个）。添加后会加入干扰项池并可在字卡中查看。</p>'+
        '<textarea id="customInput" rows="3" placeholder="例如：\r\n天的,tiān,☀️,天空" style="width:100%;border-radius:12px;border:2px solid #FFE0A3;padding:10px;font-family:inherit;font-size:14px"></textarea>'+
        '<div class="row" style="margin-top:8px;justify-content:flex-start">'+
          '<button class="btn sm green" data-action="add-cards">➕ 添加</button>'+
          '<button class="btn ghost sm" data-action="export-cards">📤 导出进度</button>'+
        '</div>'+
        (S.customCards.length?'<p class="muted">已自定义 '+S.customCards.length+' 条 · <span data-action="clear-cards" style="color:#D63031;cursor:pointer;text-decoration:underline">清空自定义字库</span></p>':'')+
      '</div>'+
      '<div class="about"><b>玩法说明</b><br>'+
        '· 共 '+CHAPTERS.length+' 章、'+TOTAL_LEVELS+' 关，每章 6 种玩法轮换。<br>'+
        '· 砸开金蛋找到目标字就会朗读并发星星；答错不扣分，可以一直试。<br>'+
        '· 星星解锁后续关卡，字卡自动收藏，点击即可重听。<br>'+
        '· 手机/平板可直接触屏操作，长按字卡可连续朗读。<br><br><b>小提示</b><br>'+
        '· 若听不到朗读，请在系统中安装中文语音包。<br>'+
        '· 所有进度只保存在本机浏览器，导出功能可备份。'+
      '</div>'+
      '<div style="text-align:center;margin-top:18px"><button class="btn ghost sm" data-action="reset">🗑️ 清空全部进度</button></div>'+
    '</div>');
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]'); if (!el) return;
    Sound.unlock();
    const a = el.dataset.action;
    if (a!=='egg' && a!=='toggle' && a!=='set-egg' && a!=='set-target' && a!=='set-mode' && a!=='set-theme') Sound.fx.click();
    switch (a) {
      case 'home': renderHome(); break;
      case 'map': renderMap(); break;
      case 'collection': renderCollection(); break;
      case 'report': renderReport(); break;
      case 'settings': renderSettings(); break;
      case 'play': startLevel(+el.dataset.ci, +el.dataset.li); break;
      case 'next': {
        let ci=state.ci, li=state.li+1;
        if (li>=LEVELS_PER_CHAPTER) { ci++; li=0; }
        if (ci<CHAPTERS.length) startLevel(ci,li); else renderMap();
        break;
      }
      case 'replay': startLevel(state.ci,state.li); break;
      case 'egg': smash(+el.dataset.idx, el); break;
      case 'speak-again': Sound.speak(state.level.targets[state.idx].c); break;
      case 'speak-word': Sound.speak(el.dataset.c); break;
      case 'sound':
        S.soundOn=!S.soundOn; syncAudio();
        el.textContent=S.soundOn?'🔊':'🔇';
        break;
      case 'toggle': {
        const k=el.dataset.key; S[k]=!S[k]; syncAudio();
        el.classList.toggle('on',S[k]);
        if (k==='bigFont') document.body.classList.toggle('big-font',S.bigFont);
        if (k==='bgmOn' && S.bgmOn) toast('音乐打开啦 🎵');
        if (k==='speechOn' && S.speechOn) Sound.speak('你好呀');
        if (k==='vibrate') buzz(30);
        save();
        break;
      }
      case 'set-style': {
        S.style=+el.dataset.v; syncAudio(); save(); renderSettings();
        Sound.speak('小宝贝，我们一起学汉字');
        break;
      }
      case 'try-voice': Sound.speak('小宝贝，我们一起学汉字'); break;
      case 'set-egg': S.eggCount=+el.dataset.v; save(); renderSettings(); break;
      case 'set-target': S.targetCount=+el.dataset.v; save(); renderSettings(); break;
      case 'set-mode': S.mode=el.dataset.v; save(); renderSettings(); break;
      case 'set-theme': S.theme=el.dataset.v; save(); applyTheme(); renderSettings(); break;
      case 'read-all': {
        const cards=S.learned.slice(0,20);
        let i=0;
        const next=()=>{ if(i<cards.length){ Sound.speak(cards[i]); i++; setTimeout(next,900); } };
        next();
        break;
      }
      case 'collection-shuffle': S.learned=shuffle(S.learned); save(); renderCollection(); break;
      case 'add-cards': {
        const ta=document.getElementById('customInput');
        if (!ta || !ta.value.trim()) { toast('请先输入内容'); break; }
        const lines=ta.value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
        let added=0;
        lines.forEach(line=>{
          const parts=line.split(/[,，]/).map(s=>s.trim());
          if (parts[0]) { S.customCards.push(C(parts[0],parts[1]||'',parts[2]||'🌟',parts[3]||parts[0])); added++; }
        });
        save(); renderSettings(); toast('已添加 '+added+' 条');
        break;
      }
      case 'clear-cards':
        if (confirm('确定清空自定义字库吗？')) { S.customCards=[]; save(); renderSettings(); }
        break;
      case 'export-cards': {
        const data=JSON.stringify(S,null,2);
        const blob=new Blob([data],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a2=document.createElement('a');
        a2.href=url; a2.download='smash-eggs-progress.json'; a2.click();
        URL.revokeObjectURL(url);
        toast('进度已导出');
        break;
      }
      case 'reset':
        if (confirm('确定清空所有星星、字卡和设置吗？此操作不能撤销。')) {
          S=JSON.parse(JSON.stringify(DEFAULTS));
          save(); syncAudio(); applyTheme(); renderHome(); toast('进度已清空');
        }
        break;
    }
  });

  document.addEventListener('input', function(e) {
    if (e.target.dataset.action==='volume') {
      S.volume=(+e.target.value)/100; syncAudio(); save();
    }
  });

  document.addEventListener('change', function(e) {
    if (e.target.dataset.action==='set-voice') {
      S.voiceURI=e.target.value; syncAudio(); save();
      Sound.speak('小宝贝，我们一起学汉字');
      toast(S.voiceURI?'已切换系统音色':'已改为自动挑选童声');
    }
  });

  /* 触屏：滑动切换关卡、长按朗读、触摸反馈 */
  let touchStart=null, longPressTimer=null, longPressEl=null;
  app.addEventListener('touchstart', function(e) {
    const t=e.changedTouches[0];
    touchStart={x:t.clientX,y:t.clientY,time:Date.now()};
    const egg=e.target.closest('.egg');
    if (egg) {
      longPressEl=egg;
      longPressTimer=setTimeout(()=>{
        const idx=+egg.dataset.idx;
        const item=state.level && state.level.eggs[idx];
        if (item && !egg.classList.contains('smashed')) {
          Sound.speak(item.c); buzz(35);
          egg.classList.add('longpressed');
          setTimeout(()=>egg.classList.remove('longpressed'),400);
        }
      },550);
    }
  }, {passive:true});

  app.addEventListener('touchend', function(e) {
    clearTimeout(longPressTimer);
    if (!touchStart) return;
    const t=e.changedTouches[0];
    const dx=t.clientX-touchStart.x, dy=t.clientY-touchStart.y;
    const dt=Date.now()-touchStart.time;
    if (Math.abs(dx)>80 && Math.abs(dx)>Math.abs(dy)*1.5 && state.screen==='game' && dt<600) {
      if (dx<0 && state.li<LEVELS_PER_CHAPTER-1) startLevel(state.ci,state.li+1);
      else if (dx>0 && state.li>0) startLevel(state.ci,state.li-1);
    }
    touchStart=null;
  }, {passive:true});
  app.addEventListener('touchcancel', function(){ clearTimeout(longPressTimer); touchStart=null; }, {passive:true});

  document.addEventListener('keydown', function(e) {
    if (e.key==='Escape' && state.screen==='game') renderMap();
  });
  document.addEventListener('visibilitychange', function(){ recordPlayTime(); });

  /* 主题 */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', S.theme||'sunshine');
    document.body.classList.toggle('big-font', !!S.bigFont);
  }

  /* 启动 */
  let lastVoiceCount = 0;
  if (window.speechSynthesis) {
    const onVoices = function() {
      const n = Sound.listVoices().length;
      if (n === lastVoiceCount) return;
      lastVoiceCount = n;
      if (state.screen==='settings') renderSettings();
    };
    window.speechSynthesis.onvoiceschanged = onVoices;
    setTimeout(onVoices, 300);
  }
  syncAudio(); applyTheme(); renderHome();
})();
