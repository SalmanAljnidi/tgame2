/* Stick Hero (closer style) + Name + Difficulty + Quiz Save
   Controls:
   - Hold Pointer/Touch OR Space to grow stick
   - Release to rotate stick down
   On fail:
   - Show quiz (add/sub 0..10) with Arabic digits + visual dots
   - Correct => continue (score preserved)
   - Wrong/timeout => restart (score reset)
*/

(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  // HUD
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const levelEl = document.getElementById('level');
  const playerNameEl = document.getElementById('playerName');

  // Overlay cards
  const overlay = document.getElementById('overlay');
  const cardStart = document.getElementById('cardStart');
  const cardQuiz = document.getElementById('cardQuiz');
  const cardEnd  = document.getElementById('cardEnd');

  const nameInput = document.getElementById('nameInput');
  const btnPlay = document.getElementById('btnPlay');
  const btnAgain = document.getElementById('btnAgain');
  const btnRestart = document.getElementById('btnRestart');
  const btnSound = document.getElementById('btnSound');

  const quizTimeEl = document.getElementById('quizTime');
  const quizExprEl = document.getElementById('quizExpr');
  const quizVisualEl = document.getElementById('quizVisual');
  const quizChoicesEl = document.getElementById('quizChoices');
  const quizTitleEl = document.getElementById('quizTitle');
  const endTextEl = document.getElementById('endText');

  // ===== Utilities =====
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  function toArabic(n){
    const s = String(n);
    return s.replace(/[0-9]/g, d => arabicDigits[Number(d)]);
  }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function rand(min, max){ return Math.random() * (max - min) + min; }
  function randi(min, max){ return Math.floor(rand(min, max + 1)); }

  // ===== Canvas / DPR =====
  let W = 900, H = 520, DPR = 1;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.floor(rect.width * DPR);
    H = Math.floor(rect.height * DPR);
    canvas.width = W;
    canvas.height = H;
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ===== Audio (Synth) =====
  let audioOn = true;
  let audioUnlocked = false;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ac = AudioCtx ? new AudioCtx() : null;
  const master = ac ? ac.createGain() : null;
  if (master) { master.gain.value = 0.33; master.connect(ac.destination); }

  function unlockAudio(){
    if (!ac || audioUnlocked) return;
    ac.resume?.();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 1;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(master);
    o.start();
    o.stop(ac.currentTime + 0.02);
    audioUnlocked = true;
  }

  function beep({ freq=440, dur=0.08, type="sine", gain=0.12, bendTo=null }){
    if (!ac || !audioOn) return;
    unlockAudio();
    const t0 = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0);
    o.stop(t0 + dur);
  }

  const sfx = {
    growTick(){ beep({freq: 560, dur: 0.03, type:"square", gain:0.06, bendTo:650}); },
    drop(){ beep({freq: 240, dur: 0.10, type:"sawtooth", gain:0.10, bendTo:95}); },
    step(){ beep({freq: 420, dur: 0.05, type:"triangle", gain:0.10, bendTo:520}); },
    success(){ beep({freq: 680, dur: 0.07, type:"triangle", gain:0.14, bendTo:900}); },
    perfect(){ beep({freq: 980, dur: 0.10, type:"sine", gain:0.18, bendTo:1450}); beep({freq:1450, dur:0.08, type:"sine", gain:0.12}); },
    fail(){ beep({freq: 220, dur: 0.18, type:"square", gain:0.18, bendTo:70}); },
    click(){ beep({freq: 700, dur: 0.05, type:"sine", gain:0.10}); },
    correct(){ beep({freq: 820, dur: 0.10, type:"triangle", gain:0.16, bendTo:1220}); },
    wrong(){ beep({freq: 260, dur: 0.14, type:"square", gain:0.16, bendTo:120}); },
    tick(){ beep({freq: 900, dur: 0.03, type:"sine", gain:0.07}); }
  };

  btnSound.addEventListener('click', () => {
    audioOn = !audioOn;
    btnSound.textContent = audioOn ? '🔊' : '🔇';
    if (audioOn) sfx.click();
  });

  // ===== Persistent =====
  const bestKey = 'stickHeroBest_v2';
  const nameKey = 'stickHeroName_v2';
  let best = Number(localStorage.getItem(bestKey) || 0);
  let playerName = (localStorage.getItem(nameKey) || '').trim();

  bestEl.textContent = toArabic(best);
  playerNameEl.textContent = playerName ? playerName : '—';
  if (playerName) nameInput.value = playerName;

  // ===== World =====
  const groundY = () => Math.floor(H * 0.78);

  const State = {
    READY:'READY',
    GROWING:'GROWING',
    ROTATING:'ROTATING',
    WALKING:'WALKING',
    SHIFTING:'SHIFTING',
    FALLING:'FALLING',
    QUIZ:'QUIZ',
    GAMEOVER:'GAMEOVER'
  };

  let state = State.GAMEOVER;

  let score = 0;
  let level = 1;
  let camX = 0;

  const hero = {
    x: 0, y: 0,
    w: 28, h: 28,
    vx: 0, vy: 0
  };

  const stick = {
    x: 0, y: 0,
    len: 0, w: 6,
    angle: 0,
    rotateSpeed: 0.16
  };

  let platforms = []; // {x,w,perfectX,perfectW}

  function makePlatform(x, w){
    const perfectW = clamp(Math.floor(w * 0.18), 10, 18);
    const perfectX = x + (w/2) - (perfectW/2);
    return { x, w, perfectX, perfectW };
  }

  function calcLevel(){
    return Math.floor(score / 10) + 1;
  }

  function difficultyParams(){
    // level 1.. increases gaps + reduces widths
    const lv = calcLevel();
    const gapMin = Math.floor(W * clamp(0.10 + (lv-1)*0.01, 0.10, 0.20));
    const gapMax = Math.floor(W * clamp(0.34 + (lv-1)*0.015, 0.34, 0.52));

    const wMin = Math.floor(W * clamp(0.08 - (lv-1)*0.004, 0.045, 0.08));
    const wMax = Math.floor(W * clamp(0.26 - (lv-1)*0.007, 0.12, 0.26));

    const growSpeed = 0.58 * DPR; // px/ms
    const rotateSpeed = clamp(0.16 + (lv-1)*0.004, 0.16, 0.24);

    return { lv, gapMin, gapMax, wMin, wMax, growSpeed, rotateSpeed };
  }

  function spawnNextPlatform(){
    const last = platforms[platforms.length - 1];
    const d = difficultyParams();
    const gap = randi(d.gapMin, d.gapMax);
    const w = randi(d.wMin, d.wMax);
    const x = last.x + last.w + gap;
    platforms.push(makePlatform(x, w));
    if (platforms.length > 6) platforms.shift();
  }

  function setScore(v){
    score = v;
    level = calcLevel();
    scoreEl.textContent = toArabic(score);
    levelEl.textContent = toArabic(level);

    if (score > best){
      best = score;
      bestEl.textContent = toArabic(best);
      localStorage.setItem(bestKey, String(best));
    }
  }

  function resetRound(keepScore=false){
    if (!keepScore) setScore(0);
    camX = 0;

    const gY = groundY();
    platforms = [];
    // first platform
    platforms.push(makePlatform(80, randi(Math.floor(W*0.22), Math.floor(W*0.32))));
    // next
    spawnNextPlatform();

    hero.x = platforms[0].x + platforms[0].w - hero.w - 10;
    hero.y = gY - hero.h;
    hero.vx = 0;
    hero.vy = 0;

    stick.x = hero.x + hero.w;
    stick.y = gY;
    stick.len = 0;
    stick.angle = 0;

    state = State.READY;
  }

  function continueAfterQuiz(){
    // Put hero back to safe end of current platform, keep score + platforms same
    const gY = groundY();
    const p = platforms[0];
    hero.x = p.x + p.w - hero.w - 10;
    hero.y = gY - hero.h;
    hero.vx = 0;
    hero.vy = 0;

    stick.x = hero.x + hero.w;
    stick.y = gY;
    stick.len = 0;
    stick.angle = 0;

    state = State.READY;
  }

  // ===== Shift anim =====
  const shiftAnim = {
    active:false, t:0, dur:380, from:0, to:0, value:0, done:true,
    start(from, to, dur){
      this.active=true; this.t=0; this.dur=dur;
      this.from=from; this.to=to; this.value=from;
      this.done=false;
    },
    update(dt){
      if (!this.active || this.done) return;
      this.t += dt;
      const p = Math.min(1, this.t/this.dur);
      const eased = 1 - Math.pow(1-p, 3);
      this.value = this.from + (this.to - this.from) * eased;
      if (p >= 1){ this.done=true; this.active=false; }
    }
  };

  // ===== Landing check =====
  function checkLanding(){
    const p2 = platforms[1];
    const stickEnd = stick.x + stick.len;
    const ok = stickEnd >= p2.x && stickEnd <= (p2.x + p2.w);
    const perfect = stickEnd >= p2.perfectX && stickEnd <= (p2.perfectX + p2.perfectW);
    return { ok, perfect };
  }

  // ===== Input =====
  let holding = false;
  let growTickAcc = 0;

  function startHold(){
    if (state !== State.READY) return;
    unlockAudio();
    holding = true;
    state = State.GROWING;
    stick.len = 0;
    stick.angle = 0;
    growTickAcc = 0;
  }

  function endHold(){
    if (!holding) return;
    holding = false;
    if (state === State.GROWING){
      state = State.ROTATING;
      sfx.drop();
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (overlayVisible()) return;
    e.preventDefault();
    startHold();
  }, { passive:false });

  window.addEventListener('pointerup', () => endHold(), { passive:true });
  window.addEventListener('pointercancel', () => endHold(), { passive:true });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat){
      if (overlayVisible()) return;
      e.preventDefault();
      startHold();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space'){
      e.preventDefault();
      endHold();
    }
  });

  // ===== Overlay control =====
  function showOverlay(mode){
    overlay.classList.remove('hidden');
    cardStart.classList.add('hidden');
    cardQuiz.classList.add('hidden');
    cardEnd.classList.add('hidden');

    if (mode === 'start') cardStart.classList.remove('hidden');
    if (mode === 'quiz') cardQuiz.classList.remove('hidden');
    if (mode === 'end')  cardEnd.classList.remove('hidden');
  }
  function hideOverlay(){
    overlay.classList.add('hidden');
  }
  function overlayVisible(){
    return !overlay.classList.contains('hidden');
  }

  // ===== Start / Restart buttons =====
  btnPlay.addEventListener('click', () => {
    const n = (nameInput.value || '').trim();
    playerName = n ? n : 'لاعب';
    localStorage.setItem(nameKey, playerName);
    playerNameEl.textContent = playerName;
    hideOverlay();
    unlockAudio();
    setScore(0);
    resetRound(true);
    sfx.click();
  });

  btnAgain?.addEventListener('click', () => {
    hideOverlay();
    unlockAudio();
    setScore(0);
    resetRound(true);
    sfx.click();
  });

  btnRestart.addEventListener('click', () => {
    hideOverlay();
    unlockAudio();
    setScore(0);
    resetRound(true);
    sfx.click();
  });

  // ===== Quiz =====
  let quizTimer = null;
  let quizRemain = 30;
  let quizCorrect = null;
  let quizLocked = false;

  function stopQuizTimer(){
    if (quizTimer){ clearInterval(quizTimer); quizTimer = null; }
  }

  function renderDots(count, crossed=0){
    const wrap = document.createElement('div');
    wrap.className = 'dots';
    for (let i=0;i<count;i++){
      const d = document.createElement('span');
      d.className = 'dot' + (i < crossed ? ' cross' : '');
      wrap.appendChild(d);
    }
    return wrap;
  }

  function buildQuiz(){
    quizLocked = false;
    quizRemain = 30;
    quizTimeEl.textContent = toArabic(quizRemain);

    // Choose op
    const op = Math.random() < 0.5 ? '+' : '-';
    let a = randi(0,10);
    let b = randi(0,10);
    if (op === '-'){
      if (b > a) [a,b] = [b,a];
    }
    const ans = op === '+' ? (a + b) : (a - b);
    quizCorrect = ans;

    quizTitleEl.textContent = op === '+' ? 'سؤال جمع' : 'سؤال طرح';
    quizExprEl.textContent = `${toArabic(a)} ${op === '+' ? '＋' : '－'} ${toArabic(b)} = ؟`;

    // Visual
    quizVisualEl.innerHTML = '';
    if (op === '+'){
      const g1 = document.createElement('div'); g1.className = 'group';
      g1.appendChild(renderDots(a, 0));
      const plus = document.createElement('div'); plus.className = 'op'; plus.textContent = '＋';
      const g2 = document.createElement('div'); g2.className = 'group';
      g2.appendChild(renderDots(b, 0));
      quizVisualEl.appendChild(g1);
      quizVisualEl.appendChild(plus);
      quizVisualEl.appendChild(g2);
    } else {
      const g1 = document.createElement('div'); g1.className = 'group';
      // show a dots, first b crossed to indicate removed
      g1.appendChild(renderDots(a, b));
      const minus = document.createElement('div'); minus.className = 'op'; minus.textContent = '－';
      const g2 = document.createElement('div'); g2.className = 'group';
      g2.appendChild(renderDots(b, 0));
      quizVisualEl.appendChild(g1);
      quizVisualEl.appendChild(minus);
      quizVisualEl.appendChild(g2);
    }

    // Choices
    const choices = new Set([ans]);
    while (choices.size < 4){
      // plausible distractors around answer
      const delta = randi(-3, 3);
      let v = ans + delta;
      if (v === ans) v = ans + (Math.random()<0.5 ? 2 : -2);
      v = clamp(v, 0, 20);
      choices.add(v);
    }
    const arr = Array.from(choices);
    // shuffle
    for (let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    quizChoicesEl.innerHTML = '';
    arr.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'choiceBtn';
      btn.textContent = toArabic(v);
      btn.addEventListener('click', () => chooseAnswer(v), { once:true });
      quizChoicesEl.appendChild(btn);
    });

    stopQuizTimer();
    quizTimer = setInterval(() => {
      quizRemain -= 1;
      quizTimeEl.textContent = toArabic(quizRemain);
      if (quizRemain <= 5 && quizRemain > 0) sfx.tick();
      if (quizRemain <= 0){
        stopQuizTimer();
        handleQuizFail(true);
      }
    }, 1000);
  }

  function chooseAnswer(v){
    if (quizLocked) return;
    quizLocked = true;
    stopQuizTimer();

    if (v === quizCorrect){
      sfx.correct();
      // continue game
      hideOverlay();
      continueAfterQuiz();
    } else {
      handleQuizFail(false);
    }
  }

  function handleQuizFail(timeout){
    sfx.wrong();
    // Restart from zero (points lost)
    showOverlay('end');
    endTextEl.textContent = timeout
      ? `انتهى الوقت! نتيجتك: ${toArabic(score)}`
      : `إجابة خاطئة. نتيجتك: ${toArabic(score)}`;
    state = State.GAMEOVER;
  }

  function triggerQuiz(){
    state = State.QUIZ;
    showOverlay('quiz');
    buildQuiz();
  }

  // ===== Drawing (closer to Stick Hero feel) =====
  function drawBackground(){
    ctx.clearRect(0,0,W,H);

    // Vignette
    const v = ctx.createRadialGradient(W*0.5, H*0.25, W*0.1, W*0.5, H*0.4, W*0.85);
    v.addColorStop(0, 'rgba(255,255,255,0.10)');
    v.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = v;
    ctx.fillRect(0,0,W,H);

    // Distant hills
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, H*0.78);
    ctx.quadraticCurveTo(W*0.25, H*0.58, W*0.55, H*0.80);
    ctx.quadraticCurveTo(W*0.78, H*0.95, W, H*0.72);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // Clouds
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#fff';
    for (let i=0;i<7;i++){
      const x = ((i*W*0.22) - (camX*0.12)) % (W+260) - 130;
      const y = H*0.18 + (i%3)*38;
      blob(x, y, 44 + (i%3)*10);
    }
    ctx.globalAlpha = 1;
  }

  function blob(x,y,r){
    ctx.beginPath();
    ctx.ellipse(x, y, r*1.25, r*0.78, 0, 0, Math.PI*2);
    ctx.ellipse(x+r*0.7, y+6, r*1.05, r*0.68, 0, 0, Math.PI*2);
    ctx.ellipse(x-r*0.6, y+8, r*0.95, r*0.62, 0, 0, Math.PI*2);
    ctx.fill();
  }

  function drawPlatforms(){
    const gY = groundY();
    for (const p of platforms){
      const x = p.x - camX;
      // body
      ctx.fillStyle = '#0c0c0c';
      ctx.fillRect(x, gY, p.w, H - gY);

      // top edge highlight
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, gY, p.w, 5);

      // perfect zone mark
      ctx.fillStyle = '#ff3b3b';
      ctx.fillRect(p.perfectX - camX, gY - 7, p.perfectW, 7);
    }
  }

  function drawStick(){
    const gY = groundY();
    const x = stick.x - camX;
    const y = stick.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(stick.angle);

    // Stick body
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(-stick.w/2, -stick.len, stick.w, stick.len);

    // subtle light
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(-stick.w/2, -stick.len, stick.w, 4);

    ctx.restore();
  }

  function roundRect(x,y,w,h,r,fill){
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
    ctx.fill();
  }

  function drawHero(){
    const gY = groundY();
    const x = hero.x - camX;
    const y = hero.y;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + hero.w/2, gY + 6, hero.w*0.55, 6, 0, 0, Math.PI*2);
    ctx.fill();

    // body (black cube like)
    roundRect(x, y, hero.w, hero.h, 7, '#111');

    // tiny face stripe
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.fillRect(x + 6, y + 9, hero.w - 12, 6);

    // red headband
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(x + 5, y + 4, hero.w - 10, 3);
  }

  function drawHint(){
    if (state !== State.READY) return;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `${Math.floor(15*DPR)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('اضغط مطوّلًا (أو Space) لتطويل العصا', W/2, Math.floor(H*0.18));
    ctx.font = `${Math.floor(12*DPR)}px system-ui`;
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.fillText('كل ١٠ نقاط يزيد المستوى وتصبح أصعب', W/2, Math.floor(H*0.18) + 22*DPR);
  }

  // ===== Loop =====
  let last = performance.now();
  function tick(now){
    const dt = Math.min(32, now - last);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(tick);
  }

  function update(dt){
    if (overlayVisible() && state !== State.QUIZ) return; // pause when overlay is open (except quiz state)

    const gY = groundY();

    const d = difficultyParams();
    stick.rotateSpeed = d.rotateSpeed;

    if (state === State.GROWING){
      stick.len += d.growSpeed * dt;

      growTickAcc += dt;
      if (growTickAcc > 70){ sfx.growTick(); growTickAcc = 0; }
    }

    if (state === State.ROTATING){
      stick.angle += stick.rotateSpeed;
      if (stick.angle >= Math.PI/2){
        stick.angle = Math.PI/2;
        const res = checkLanding();
        if (res.ok){
          state = State.WALKING;
          hero.vx = 0.46 * DPR;
        } else {
          // trigger quiz instead of instant gameover
          sfx.fail();
          triggerQuiz();
        }
      }
    }

    if (state === State.WALKING){
      hero.x += hero.vx * dt;
      if (Math.random() < 0.10) sfx.step();

      const targetX = stick.x + stick.len - hero.w/2;
      if (hero.x >= targetX){
        hero.x = targetX;

        const res = checkLanding(); // should be ok here, but reuse
        if (res.perfect){
          setScore(score + 2);
          sfx.perfect();
        } else {
          setScore(score + 1);
          sfx.success();
        }

        state = State.SHIFTING;
        const p2 = platforms[1];
        const targetCam = p2.x - 80;
        shiftAnim.start(camX, targetCam, 380);
      }
    }

    if (state === State.SHIFTING){
      shiftAnim.update(dt);
      camX = shiftAnim.value;

      if (shiftAnim.done){
        // move forward: remove first platform
        platforms.shift();
        while (platforms.length < 2) spawnNextPlatform();
        spawnNextPlatform();

        const p = platforms[0];
        hero.x = p.x + p.w - hero.w - 10;
        hero.y = gY - hero.h;

        stick.x = hero.x + hero.w;
        stick.y = gY;
        stick.len = 0;
        stick.angle = 0;

        state = State.READY;
      }
    }

    // stay on ground
    hero.y = gY - hero.h;
  }

  function render(){
    drawBackground();
    drawPlatforms();
    drawStick();
    drawHero();
    drawHint();
  }

  // ===== Boot =====
  function openStart(){
    showOverlay('start');
    overlay.classList.remove('hidden');
    state = State.GAMEOVER;
  }

  // overlay initial state
  overlay.classList.remove('hidden');
  openStart();

  // allow audio unlock on first touch anywhere
  window.addEventListener('pointerdown', () => unlockAudio(), { passive:true });

  requestAnimationFrame(tick);
})();
