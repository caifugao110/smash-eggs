/**
 * smash-eggs · 音效与朗读引擎
 * 音效由 Web Audio API 实时合成；朗读优先播放本地服务器生成的真实神经网络童声，
 * 服务器不可用时自动回退到浏览器内置语音合成（保证纯静态打开仍可用）。
 */

const Sound = (function () {
  let ctx = null;
  let bgmTimer = null;
  let bgmStep = 0;
  let settings = {
    soundOn: true, bgmOn: false, speechOn: true, style: 0, voiceURI: '',
    volume: 0.8, serverSpeech: true, serverUrl: ''
  };
  let currentAudio = null;
  const prefetchPool = [];

  const CHILD_RE = /xiaoyou|yunxia|xiaoshuang|child|kid|童|宝宝|萌/i;

  const STYLES = [
    { name:'甜美女童', pitch:1.38, rate:1.0,  emoji:'👧', voice:/xiaoyou|xiaoshuang|child|girl|女童/i },
    { name:'元气男童', pitch:1.18, rate:1.02, emoji:'👦', voice:/yunxia|yunjian|yunye|child|boy|男童/i },
    { name:'软萌宝宝', pitch:1.52, rate:0.92, emoji:'🐣', voice:/xiaoyou|child|kid|童/i },
    { name:'温柔姐姐', pitch:1.1,  rate:0.95, emoji:'👩', voice:/xiaoxiao|xiaoyi|huihui|yaoyao|tingting|晓|慧|瑶|怡|婷|女/i },
    { name:'自然朗读', pitch:1.0,  rate:1.0,  emoji:'🎙️', voice:/xiaoxiao|natural|自然/i }
  ];

  const MELODY = [523,659,784,659,587,698,880,698,523,659,784,1047,880,784,659,587];

  function configure(next) {
    settings = Object.assign(settings, next);
    if (settings.bgmOn) startBgm(); else stopBgm();
  }

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function unlock() { ac(); }

  function beep(freq, dur, type, vol, delay) {
    delay = delay || 0;
    const c = ac();
    if (!c || !settings.soundOn) return;
    const o = c.createOscillator(), g = c.createGain();
    const t = c.currentTime + delay;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime((vol || 0.16) * settings.volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.16));
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + (dur || 0.16) + 0.03);
  }

  function noiseBurst(dur, vol) {
    const c = ac();
    if (!c || !settings.soundOn) return;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random()*2-1) * (1 - i/n);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1700;
    const g = c.createGain(); g.gain.value = vol * settings.volume;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  }

  const fx = {
    click:  () => beep(660, .06, 'sine', .09),
    smash:  () => { noiseBurst(.14, .28); beep(190, .14, 'triangle', .2); },
    right:  () => [523,659,784,1047].forEach((f,i) => beep(f, .18, 'sine', .15, i*.085)),
    wrong:  () => { beep(240, .14, 'sine', .11); beep(200, .18, 'sine', .09, .11); },
    star:   () => [880,1175,1568].forEach((f,i) => beep(f, .1, 'sine', .11, i*.055)),
    win:    () => [523,659,784,1047,784,1047,1319].forEach((f,i) => beep(f, .22, 'triangle', .15, i*.12)),
    popup:  () => { beep(880,.08,'sine',.1); beep(1175,.12,'sine',.09,.06); }
  };

  function startBgm() {
    stopBgm();
    if (!settings.bgmOn) return;
    bgmTimer = setInterval(function () {
      if (settings.bgmOn) beep(MELODY[bgmStep++ % MELODY.length], .26, 'sine', .04);
    }, 330);
  }
  function stopBgm() { if (bgmTimer) clearInterval(bgmTimer); bgmTimer = null; }

  function allVoices() {
    if (!window.speechSynthesis) return [];
    return window.speechSynthesis.getVoices() || [];
  }

  function listVoices() {
    const vs = allVoices().filter(v =>
      /^(zh|cmn)/i.test(v.lang || '') || /chinese|普通话|中文/i.test(v.name || ''));
    return vs.sort((a, b) => voiceRank(b) - voiceRank(a));
  }

  function voiceRank(v) {
    const n = v.name || '';
    return (CHILD_RE.test(n) ? 4 : 0)
      + (/(^|-)CN|Hans/i.test(v.lang || '') ? 2 : 0)
      + (/female|女|xiaoxiao|xiaoyi|huihui|yaoyao|tingting/i.test(n) ? 1 : 0);
  }

  function bestVoice(styleIdx) {
    const vs = listVoices();
    if (!vs.length) return null;
    const st = STYLES[styleIdx] || STYLES[0];
    let best = null, score = -1;
    vs.forEach(v => {
      const n = v.name || '';
      let s = 0;
      if (st.voice && st.voice.test(n)) s += 6;
      if (CHILD_RE.test(n)) s += 4;
      if (/female|女/i.test(n)) s += 1;
      if (s > score) { score = s; best = v; }
    });
    return best || vs[0];
  }

  function pickVoice() {
    if (settings.voiceURI) {
      const hit = allVoices().find(v => v.voiceURI === settings.voiceURI);
      if (hit) return hit;
    }
    return bestVoice(settings.style);
  }

  function isLatin(text) { return /^[A-Za-z][A-Za-z\s]*$/.test(text || ''); }

  /* ---------- 本地服务器童声 ---------- */
  function serverBase() {
    if (settings.serverUrl && String(settings.serverUrl).trim())
      return String(settings.serverUrl).trim().replace(/\/+$/, '');
    // 直接双击 index.html 打开时，默认找本机的童声服务器
    if (location.protocol === 'file:') return 'http://127.0.0.1:8000';
    return ''; // 通过服务器访问时，用同源地址
  }

  function speakUrl(text, style) {
    return serverBase() + '/api/speak?text=' + encodeURIComponent(text) + '&style=' + (style || 0);
  }

  // 预加载：进入关卡时把可能出现的文字提前请求并缓存，点开即读
  function prefetch(texts) {
    if (!settings.serverSpeech || !settings.speechOn) return;
    const base = serverBase();
    (texts || []).slice(0, 40).forEach(t => {
      if (!t) return;
      const a = new Audio(base + '/api/speak?text=' + encodeURIComponent(t) + '&style=' + (settings.style || 0));
      a.preload = 'auto';
      a.volume = 0; // 只触发缓存，不发声
      prefetchPool.push(a);
      if (prefetchPool.length > 120) prefetchPool.shift();
    });
  }

  function speakServer(text, style) {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
    const a = new Audio(speakUrl(text, style));
    currentAudio = a;
    a.onerror = function () {
      if (currentAudio === a) { currentAudio = null; speakBrowser(text, style); }
    };
    a.onended = function () { if (currentAudio === a) currentAudio = null; };
    try {
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {
        if (currentAudio === a) { currentAudio = null; speakBrowser(text, style); }
      });
    } catch (e) { speakBrowser(text, style); }
  }

  /* ---------- 浏览器内置语音（回退） ---------- */
  function speakBrowser(text, style) {
    const syn = window.speechSynthesis;
    if (!syn) return;
    let clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const latin = isLatin(clean);
    if (!latin) clean = clean.replace(/[，。、；：,.!?！？]+$/, '');
    const st = STYLES[style] || STYLES[0];
    try {
      syn.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = latin ? 'en-US' : 'zh-CN';
      u.rate = latin ? 1 : st.rate;
      u.pitch = latin ? 1 : st.pitch;
      u.volume = 1;
      const v = latin
        ? (allVoices().find(x => /^en/i.test(x.lang || '')) || null)
        : pickVoice();
      if (v) u.voice = v;
      syn.speak(u);
    } catch (e) {}
  }

  function speak(text) {
    if (!settings.speechOn) return;
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (settings.serverSpeech) speakServer(clean, settings.style);
    else speakBrowser(clean, settings.style);
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 25); } catch (e) {}
  }

  return {
    configure, unlock, fx, speak, prefetch, startBgm, stopBgm, vibrate,
    pickVoice, bestVoice, listVoices, STYLES, serverBase,
    get settings() { return settings; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
