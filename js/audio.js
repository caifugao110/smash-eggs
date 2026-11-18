/**
 * smash-eggs · 音效引擎
 * 全部音效由 Web Audio API 实时合成，零外部资源、可离线运行。
 * 朗读使用浏览器内置 Speech Synthesis：自动优先挑选系统童声，并支持手动切换音色。
 */

const Sound = (function () {
  let ctx = null;
  let bgmTimer = null;
  let bgmStep = 0;
  let settings = { soundOn: true, bgmOn: false, speechOn: true, style: 0, voiceURI: '', volume: 0.8 };

  // 童声优先：命中系统里的儿童音色，再用适度变调兜底，避免过度升调产生的机械感
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

  // 可选音色列表：只列中文语音，童声排在最前
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

  function speak(text) {
    if (!settings.speechOn) return;
    const syn = window.speechSynthesis;
    if (!syn) return;
    let clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const latin = isLatin(clean);
    if (!latin) clean = clean.replace(/[，。、；：,.!?！？]+$/, '');
    const st = STYLES[settings.style] || STYLES[0];
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

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 25); } catch (e) {}
  }

  return {
    configure, unlock, fx, speak, startBgm, stopBgm, vibrate,
    pickVoice, bestVoice, listVoices,
    STYLES,
    get settings() { return settings; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
