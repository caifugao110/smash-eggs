/**
 * smash-eggs · 音效引擎
 * 全部音效由 Web Audio API 实时合成，零外部资源、可离线运行。
 * 朗读使用浏览器内置 Speech Synthesis，自动优先挑选中文女声/儿童声。
 */

const Sound = (function () {
  let ctx = null;
  let bgmTimer = null;
  let bgmStep = 0;
  let settings = { soundOn: true, bgmOn: false, speechOn: true, style: 0, volume: 0.8 };

  const STYLES = [
    { name:'甜美童声', pitch:1.7,  rate:1.05, emoji:'🧒' },
    { name:'超级萌音', pitch:1.95, rate:1.15, emoji:'🐣' },
    { name:'温柔姐姐', pitch:1.35, rate:0.95, emoji:'👧' },
    { name:'自然朗读', pitch:1.0,  rate:0.9,  emoji:'👩' }
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

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    const vs = window.speechSynthesis.getVoices() || [];
    if (!vs.length) return null;
    const zh = vs.filter(v => /^(zh|cmn)/i.test(v.lang||'') || /chinese|普通话|中文/i.test(v.name||''));
    const pool = zh.length ? zh : vs;
    const girl = pool.filter(v => /huihui|yaoyao|xiaoxiao|xiaoyi|hanhan|tingting|晓|慧|瑶|怡|婷|女|female|child|kid/i.test(v.name||''));
    return girl[0] || pool.find(v => !/kangkang|male|男/i.test(v.name||'')) || pool[0] || null;
  }

  function isLatin(text) { return /^[A-Za-z][A-Za-z\s]*$/.test(text || ''); }

  function speak(text) {
    if (!settings.speechOn) return;
    try {
      const syn = window.speechSynthesis;
      syn.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const st = STYLES[settings.style] || STYLES[0];
      u.lang = isLatin(text) ? 'en-US' : 'zh-CN';
      u.rate = isLatin(text) ? Math.min(st.rate, 1) : st.rate;
      u.pitch = isLatin(text) ? 1.1 : st.pitch;
      u.volume = 1;
      const v = pickVoice();
      if (v && !isLatin(text)) u.voice = v;
      syn.speak(u);
    } catch (e) {}
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern || 25); } catch (e) {}
  }

  return {
    configure, unlock, fx, speak, startBgm, stopBgm, vibrate, pickVoice,
    STYLES,
    get settings() { return settings; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
