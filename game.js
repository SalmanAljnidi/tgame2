/* Stick Hero (Arabic) + Name + Levels + Rescue Quiz (0-10)
   Fixes:
   1) Slower stick growth
   2) Footer no longer overlays gameplay (layout: canvas area + footer)
   3) Hero has legs (taller sprite)
*/

(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const bestEl  = document.getElementById('best');
  const levelEl = document.getElementById('level');
  const playerNameEl = document.getElementById('playerName');

  const startOverlay = document.getElementById('startOverlay');
  const quizOverlay  = document.getElementById('quizOverlay');

  const nameInput = document.getElementById('nameInput');
  const btnPlay = document.getElementById('btnPlay');
  const btnRestart = document.getElementById('btnRestart');
  const btnSound = document.getElementById('btnSound');

  const quizTimerEl = document.getElementById('quizTimer');
  const quizTextEl  = document.getElementById('quizText');
  const reprBox     = document.getElementById('reprBox');
  const choicesBox  = document.getElementById('choicesBox');

  // ===== Helpers =====
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function rand(min, max){ return Math.random() * (max - min) + min; }
  function randi(min, max){ return Math.floor(rand(min, max + 1)); }

  // Arabic digits
  const arabicDigits = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  function toArabicNum(n){
    const s = String(n);
    let out = '';
    for (const ch of s) out += (ch >= '0' && ch <= '9') ? arabicDigits[ch.charCodeAt(0)-48] : ch;
    return out;
  }

  // ===== Canvas DPR =====
  let W=900, H=520, DPR=1;
  function resize(){
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.floor(rect.width * DPR);
    H = Math.floor(rect.height * DPR);
    canvas.width = W;
    canvas.height = H;
  }
  window.addEventListener('resize', resize, {passive:true});
  resize();

  const groundY = () => Math.floor(H * 0.80);

  // ===== Audio (synth, no files) =====
  let audioOn = true;
  let audioUnlocked = false;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ac = AudioCtx ? new AudioCtx() : null;
  const master = ac ? ac.createGain() : null;
  if (master){
    master.gain.value = 0.35;
    master.connect(ac.destination);
  }

  function unlockAudio(){
    if (!ac || audioUnlocked) return;
    ac.resume?.();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 1;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(master);
    o.start(); o.stop(ac.currentTime + 0.02);
    audioUnlocked = true;
  }

  function beep({freq=440, dur=0.08, type="sine", gain=0.14, bendTo=null}){
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
    o.start(t0); o.stop(t0 + dur);
  }

  const sfx = {
    growTick(){ beep({freq:560, dur:0.03, type:"square", gain:0.055, bendTo:690}); },
    drop(){     beep({freq:260, dur:0.10, type:"sawtooth", gain:0.11, bendTo:95}); },
    step(){     beep({freq:460, dur:0.05, type:"triangle", gain:0.10, bendTo:560}); },
    ok(){       beep({freq:700, dur:0.07, type:"triangle", gain:0.14}); },
    perfect(){  beep({freq:900, dur:0.10, type:"sine", gain:0.18, bendTo:1350}); beep({freq:1350, dur:0.08, type:"sine", gain:0.12}); },
    fail(){     beep({freq:220, dur:0.18, type:"square", gain:0.18, bendTo:70}); },
    quizOpen(){ beep({freq:620, dur:0.08, type:"sine", gain:0.14, bendTo:820}); },
    quizGood(){ beep({freq:880, dur:0.08, type:"sine", gain:0.16, bendTo:1200}); },
    quizBad(){  beep({freq:180, dur:0.16, type:"square", gain:0.16, bendTo:80}); },
    timeUp(){   beep({freq:200, dur:0.20, type:"sawtooth", gain:0.14, bendTo:60}); }
  };

  btnSound.addEventListener('click', () => {
    audioOn = !audioOn;
    btnSound.textContent = audioOn ? '🔊' : '🔇';
    if (audioOn) beep({freq:660, dur:0.06, type:'sine', gain:0.12});
  });

  // ===== Game State =====
  const State = {
    READY:'READY',
    GROWING:'GROWING',
    ROTATING:'ROTATING',
    WALKING:'WALKING',
    SHIFTING:'SHIFTING',
    QUIZ:'QUIZ',
  };

  let state = State.READY;
  let holding = false;

  // Player
  let playerName = '—';

  // Score/Level
  const bestKey = 'stickHeroBest_ar_v3';
  let best = Number(localStorage.getItem(bestKey) || 0);
  bestEl.textContent = toArabicNum(best);

  let score = 0;
  function getLevel(){ return Math.floor(score / 10) + 1; }
  function setScore(v){
    score = v;
    scoreEl.textContent = toArabicNum(score);
    levelEl.textContent = toArabicNum(getLevel());
    if (score > best){
      best = score;
      bestEl.textContent = toArabicNum(best);
      localStorage.setItem(bestKey, String(best));
    }
  }

  // Camera
  let camX = 0;

  // Hero (taller + legs)
  const hero = { x:0, y:0, w:24, h:34, vx:0 };

  // Stick
  const stick = { x:0, y:0, len:0, w:6, angle:0, rotateSpeed:0.16 };

  // Platforms
  let platforms = []; // [{x,w,perfectX,perfectW}]
  function makePlatform(x, w){
    const perfectW = Math.max(10, Math.min(18, Math.floor(w * 0.18)));
    const perfectX = x + (w/2) - (perfectW/2);
    return {x,w,perfectX,perfectW};
  }

  function difficultyParams(){
    const lvl = getLevel();
    const gapMin = Math.floor(W * (0.10 + (lvl-1)*0.010));
    const gapMax = Math.floor(W * (0.34 + (lvl-1)*0.018));
    const wMin   = Math.floor(W * clamp(0.09 - (lvl-1)*0.004, 0.05, 0.09));
    const wMax   = Math.floor(W * clamp(0.26 - (lvl-1)*0.008, 0.10, 0.26));

    // Slower growth
    const growSpeed = (0.28 + (lvl-1)*0.008) * DPR;
    const rotateSpeed = 0.15 + (lvl-1)*0.004;
    const walkSpeed = (0.46 + (lvl-1)*0.010) * DPR;
    return {gapMin, gapMax, wMin, wMax, growSpeed, rotateSpeed, walkSpeed};
  }

  function spawnNextPlatform(){
    const last = platforms[platforms.length-1];
    const d = difficultyParams();
    const gap = randi(d.gapMin, d.gapMax);
    const w = randi(d.wMin, d.wMax);
    const x = last.x + last.w + gap;
    platforms.push(makePlatform(x, w));
    if (platforms.length > 7) platforms.shift();
  }

  function resetWorld(keepScore=false){
    camX = 0;
    platforms = [];
    platforms.push(makePlatform(80, randi(Math.floor(W*0.23), Math.floor(W*0.32))));
    spawnNextPlatform();

    const gY = groundY();
    hero.x = platforms[0].x + platforms[0].w - hero.w - 10;
    hero.y = gY - hero.h;

    stick.x = hero.x + hero.w;
    stick.y = gY;
    stick.len = 0;
    stick.angle = 0;

    holding = false;
    state = State.READY;

    if (!keepScore) setScore(0);
    else {
      scoreEl.textContent = toArabicNum(score);
      levelEl.textContent = toArabicNum(getLevel());
    }
  }

  function nextPlatform(){ return platforms[1]; }

  function landingResult(){
    const p2 = nextPlatform();
    const stickEnd = stick.x + stick.len;
    const ok = stickEnd >= p2.x && stickEnd <= (p2.x + p2.w);
    const perfect = stickEnd >= p2.perfectX && stickEnd <= (p2.perfectX + p2.perfectW);
    return {ok, perfect, stickEnd};
  }

  // ===== Smooth shift =====
  const shiftAnim = {
    active:false, t:0, dur:420, from:0, to:0, value:0, done:true,
    start(from,to,dur){
      this.active=true; this.t=0; this.dur=dur; this.from=from; this.to=to;
      this.value=from; this.done=false;
    },
    update(dt){
      if (!this.active || this.done) return;
      this.t += dt;
      const p = Math.min(1, this.t/this.dur);
      const eased = 1 - Math.pow(1-p, 3);
      this.value = this.from + (this.to-this.from)*eased;
      if (p>=1){ this.done=true; this.active=false; }
    }
  };

  // ===== Input =====
  function startHold(){
    if (state !== State.READY) return;
    unlockAudio();
    holding = true;
    state = State.GROWING;
    stick.len = 0;
    stick.angle = 0;
  }
  function endHold(){
    if (!holding) return;
    holding = false;
    if (state === State.GROWING){
      state = State.ROTATING;
      sfx.drop();
    }
  }

  canvas.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    startHold();
  }, {passive:false});

  window.addEventListener('pointerup', ()=> endHold(), {passive:true});
  window.addEventListener('pointercancel', ()=> endHold(), {passive:true});

  window.addEventListener('keydown', (e)=>{
    if (e.code === 'Space' && !e.repeat){
      e.preventDefault();
      startHold();
    }
  });
  window.addEventListener('keyup', (e)=>{
    if (e.code === 'Space'){
      e.preventDefault();
      endHold();
    }
  });

  btnRestart.addEventListener('click', ()=>{
    hideQuiz();
    resetWorld(false);
  });

  btnPlay.addEventListener('click', ()=>{
    const n = (nameInput.value || '').trim();
    playerName = n ? n : 'لاعب';
    playerNameEl.textContent = playerName;
    startOverlay.classList.add('hidden');
    unlockAudio();
    resetWorld(false);
  });

  // ===== Quiz =====
  let quizInterval = null;
  let quizActive = false;

  function hideQuiz(){
    quizOverlay.classList.add('hidden');
    quizOverlay.setAttribute('aria-hidden', 'true');
    if (quizInterval) clearInterval(quizInterval);
    quizInterval = null;
    quizActive = false;
  }

  function showQuiz(onResolve){
    state = State.QUIZ;
    sfx.quizOpen();
    quizActive = true;

    const isAdd = Math.random() < 0.5;
    let a = randi(0,10);
    let b = randi(0,10);
    let op = isAdd ? '+' : '−';
    let ans;

    if (isAdd){
      while (a + b > 10){ a = randi(0,10); b = randi(0,10); }
      ans = a + b;
    } else {
      if (b > a){ const t=a; a=b; b=t; }
      ans = a - b;
    }

    const choices = new Set([ans]);
    while (choices.size < 4) choices.add(randi(0,10));
    const arr = Array.from(choices);
    for (let i=arr.length-1; i>0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    quizTextEl.textContent = `${toArabicNum(a)} ${op} ${toArabicNum(b)} = ؟`;
    quizTimerEl.textContent = toArabicNum(30);

    reprBox.innerHTML = '';
    if (isAdd){
      reprBox.appendChild(buildGroup(`العدد الأول: ${toArabicNum(a)}`, a, 0));
      reprBox.appendChild(opBadge('+'));
      reprBox.appendChild(buildGroup(`العدد الثاني: ${toArabicNum(b)}`, b, 0));
    } else {
      reprBox.appendChild(buildGroup(`العدد: ${toArabicNum(a)}`, a, b));
      reprBox.appendChild(opBadge('−'));
      reprBox.appendChild(buildGroup(`المطروح: ${toArabicNum(b)}`, b, 0));
    }

    choicesBox.innerHTML = '';
    arr.forEach(v=>{
      const btn = document.createElement('button');
      btn.className = 'choiceBtn';
      btn.textContent = toArabicNum(v);
      btn.addEventListener('click', ()=>{
        if (!quizActive) return;
        const ok = (v === ans);
        ok ? sfx.quizGood() : sfx.quizBad();
        hideQuiz();
        onResolve(ok);
      });
      choicesBox.appendChild(btn);
    });

    quizOverlay.classList.remove('hidden');
    quizOverlay.setAttribute('aria-hidden', 'false');

    let t = 30;
    quizInterval = setInterval(()=>{
      t -= 1;
      quizTimerEl.textContent = toArabicNum(Math.max(0,t));
      if (t <= 0){
        clearInterval(quizInterval);
        quizInterval = null;
        sfx.timeUp();
        hideQuiz();
        onResolve(false);
      }
    }, 1000);
  }

  function opBadge(ch){
    const d = document.createElement('div');
    d.className = 'opBadge';
    d.textContent = ch;
    return d;
  }

  function buildGroup(title, count, removedCount){
    const g = document.createElement('div');
    g.className = 'group';

    const t = document.createElement('div');
    t.className = 'groupTitle';
    t.textContent = title;

    const dots = document.createElement('div');
    dots.className = 'dots';
    for (let i=0; i<count; i++){
      const dot = document.createElement('div');
      dot.className = 'dot' + (i < removedCount ? ' removed' : '');
      dots.appendChild(dot);
    }

    g.appendChild(t);
    g.appendChild(dots);
    return g;
  }

  // ===== Rendering =====
  const colors = {
    platform: 'rgba(0,0,0,0.93)',
    platformEdge: 'rgba(255,255,255,0.08)',
    perfect: 'rgba(255,70,70,0.95)',
    stick: 'rgba(0,0,0,0.93)',
    hero: '#0b1220',
    visor: 'rgba(255,255,255,0.86)',
    band: 'rgba(255,70,70,0.95)',
    shadow: 'rgba(0,0,0,0.26)',
    text: 'rgba(255,255,255,0.92)',
  };

  function drawBackground(){
    ctx.clearRect(0,0,W,H);
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'rgba(0,0,0,0.06)');
    g.addColorStop(1,'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#fff';
    for (let i=0;i<7;i++){
      const x = (i*W*0.18 + (camX*0.16))%(W+220)-110;
      const y = H*0.18 + (i%3)*40;
      blob(x,y,46+(i%3)*10);
    }
    ctx.globalAlpha = 1;
  }
  function blob(x,y,r){
    ctx.beginPath();
    ctx.ellipse(x,y,r*1.2,r*0.8,0,0,Math.PI*2);
    ctx.ellipse(x+r*0.7,y+6,r*1.0,r*0.7,0,0,Math.PI*2);
    ctx.ellipse(x-r*0.6,y+8,r*0.9,r*0.6,0,0,Math.PI*2);
    ctx.fill();
  }

  function drawPlatforms(){
    const gY = groundY();
    for (const p of platforms){
      const x = p.x - camX;
      ctx.fillStyle = colors.platform;
      ctx.fillRect(x, gY, p.w, H-gY);

      ctx.fillStyle = colors.platformEdge;
      ctx.fillRect(x, gY, p.w, 5);

      ctx.fillStyle = colors.perfect;
      ctx.fillRect(p.perfectX - camX, gY - 7, p.perfectW, 7);
    }
  }

  function drawStick(){
    const x = stick.x - camX;
    const y = stick.y;

    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(stick.angle);

    ctx.fillStyle = colors.stick;
    ctx.fillRect(-stick.w/2, -stick.len, stick.w, stick.len);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
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

    ctx.fillStyle = colors.shadow;
    ctx.beginPath();
    ctx.ellipse(x + hero.w/2, gY + 6, hero.w*0.55, 6, 0, 0, Math.PI*2);
    ctx.fill();

    roundRect(x, y, hero.w, hero.h, 7, colors.hero);

    ctx.fillStyle = colors.visor;
    ctx.fillRect(x+5, y+9, hero.w-10, 6);

    ctx.fillStyle = colors.band;
    ctx.fillRect(x+4, y+5, hero.w-8, 3);

    // legs
    const legW = Math.floor(hero.w*0.28);
    const legH = 8;
    const gap = Math.floor(hero.w*0.14);
    const lx1 = x + Math.floor(hero.w*0.24);
    const lx2 = lx1 + legW + gap;
    const ly = y + hero.h;
    roundRect(lx1, ly-2, legW, legH, 3, colors.hero);
    roundRect(lx2, ly-2, legW, legH, 3, colors.hero);

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(lx1-1, ly+legH-3, legW+2, 3);
    ctx.fillRect(lx2-1, ly+legH-3, legW+2, 3);
  }

  function drawHint(){
    if (state === State.READY){
      ctx.fillStyle = colors.text;
      ctx.font = `${Math.floor(16*DPR)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('اضغط مطوّلًا (أو Space) لتطويل العصا', W/2, Math.floor(H*0.18));
    }
  }

  function drawCorner(){
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.floor(12*DPR)}px system-ui`;
    ctx.textAlign = 'left';
    ctx.fillText(`Level ${toArabicNum(getLevel())}`, Math.floor(14*DPR), Math.floor(22*DPR));
  }

  // ===== Loop =====
  let last = performance.now();
  let growTickAcc = 0;

  function update(dt){
    const d = difficultyParams();
    stick.rotateSpeed = d.rotateSpeed;

    if (state === State.GROWING){
      stick.len += d.growSpeed * dt;
      stick.len = Math.min(stick.len, H * 0.95);

      growTickAcc += dt;
      if (growTickAcc > 85){ sfx.growTick(); growTickAcc = 0; }
    }

    if (state === State.ROTATING){
      stick.angle += stick.rotateSpeed;
      if (stick.angle >= Math.PI/2){
        stick.angle = Math.PI/2;

        const res = landingResult();
        if (res.ok){
          state = State.WALKING;
          hero.vx = d.walkSpeed;
        } else {
          showQuiz((ok)=>{
            if (ok){
              const p2 = nextPlatform();
              const target = p2.x + p2.w/2;
              stick.len = Math.max(10, target - stick.x);
              state = State.WALKING;
              hero.vx = d.walkSpeed;
            } else {
              sfx.fail();
              resetWorld(false);
            }
          });
        }
      }
    }

    if (state === State.WALKING){
      hero.x += hero.vx * dt;
      if (Math.random() < 0.10) sfx.step();

      const endX = stick.x + stick.len - hero.w/2;
      if (hero.x >= endX){
        hero.x = endX;

        const res = landingResult();
        if (res.ok){
          if (res.perfect){ setScore(score + 2); sfx.perfect(); }
          else { setScore(score + 1); sfx.ok(); }

          state = State.SHIFTING;
          const p2 = nextPlatform();
          shiftAnim.start(camX, p2.x - 80, 420);
        } else {
          sfx.fail();
          resetWorld(false);
        }
      }
    }

    if (state === State.SHIFTING){
      shiftAnim.update(dt);
      camX = shiftAnim.value;

      if (shiftAnim.done){
        platforms.shift();
        while (platforms.length < 2) spawnNextPlatform();
        spawnNextPlatform();

        const gY = groundY();
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

    const gY = groundY();
    hero.y = gY - hero.h;
    stick.x = hero.x + hero.w;
    stick.y = gY;
  }

  function render(){
    drawBackground();
    drawPlatforms();
    drawStick();
    drawHero();
    drawHint();
    drawCorner();
  }

  function tick(now){
    const dt = Math.min(32, now - last);
    last = now;

    if (startOverlay.classList.contains('hidden')){
      if (state !== State.QUIZ) update(dt);
      render();
    } else {
      render();
    }

    requestAnimationFrame(tick);
  }

  // ===== Start =====
  startOverlay.classList.remove('hidden');
  playerNameEl.textContent = '—';
  setScore(0);

  nameInput.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') btnPlay.click();
  });

  window.addEventListener('pointerdown', ()=> unlockAudio(), {passive:true});
  window.addEventListener('keydown', ()=> unlockAudio(), {passive:true});

  resetWorld(false);
  requestAnimationFrame(tick);
})();