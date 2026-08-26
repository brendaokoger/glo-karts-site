/* ── Glo Karts Booking Wizard ─────────────────────────────────
   Multi-step booking experience.
   v1.0 — aug24e
   No external dependencies. Attaches on DOMContentLoaded.
──────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── Config ─────────────────────────────────────────────── */
  var PRICE      = 49.99;
  var MIN_RIDERS = 2;
  var MAX_RIDERS = 10;
  var BOOKED_DATES = ['2026-08-08', '2026-08-28', '2026-08-29', '2026-08-30']; /* ADMIN: add fully-booked dates here */
  var ALLOWED_DAYS = [0, 4, 5, 6];  /* Sun=0, Thu=4, Fri=5, Sat=6 — default for all tours */
  var LADIES_NIGHT_TOUR = 'R&B Ladies Night Tour'; /* exact data-tour value */
  var LADIES_NIGHT_DAYS = [4];       /* R&B Ladies Night: Thursdays only */
  var MONTHS_LONG  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

  /* ── State ──────────────────────────────────────────────── */
  var S = {
    step: 1,
    tour: '',
    date: '',
    time: '',
    riders: 2,
    contact: { first:'', last:'', phone:'', email:'', isRiding: true },
    riderList: [],
    sig: { printedName:'', dataUrl:'', ack: false, timestamp: '' },
    policiesAck: false,
    bookingId: '',
    calYear: 0, calMonth: 0
  };

  /* ── Helpers ────────────────────────────────────────────── */
  function pad(n) { return String(n).padStart(2, '0'); }
  function toYMD(d) { return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

  /* Returns today's date string (YYYY-MM-DD) in America/Chicago time.
     This is the business timezone. Never uses browser local time for
     determining what counts as "past". */
  function getTodayChicago() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  function fmtDate(ymd) {
    if (!ymd) return '—';
    var p = ymd.split('-');
    return MONTHS_LONG[parseInt(p[1],10)-1]+' '+parseInt(p[2],10)+', '+p[0];
  }
  function genId() {
    var chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ', h = '';
    for (var i=0; i<8; i++) h += chars[Math.floor(Math.random()*chars.length)];
    return 'GLO-'+h;
  }
  /* Returns allowed days for the currently selected tour */
  function allowedDays() {
    return (S.tour === LADIES_NIGHT_TOUR) ? LADIES_NIGHT_DAYS : ALLOWED_DAYS;
  }
  function isAllowedDay(dow) { return allowedDays().indexOf(dow) !== -1; }
  function isBooked(ymd)     { return BOOKED_DATES.indexOf(ymd) !== -1; }
  function el(id)            { return document.getElementById(id); }
  function qsa(sel, ctx)     { return (ctx||document).querySelectorAll(sel); }
  function esc(str)          { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ── Modal open/close ───────────────────────────────────── */
  var modal    = el('booking-modal');
  var backdrop = modal && modal.querySelector('.glo-modal-backdrop');
  var closeBtn = modal && modal.querySelector('.glo-modal-close');

  function openModal() {
    if (!modal) return;
    resetWizard();
    modal.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { modal.classList.add('visible'); });
    });
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove('visible');
    setTimeout(function () {
      modal.classList.remove('open');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }, 330);
  }

  ['btn-book-header','btn-book-mobile','btn-book-tour',
   'btn-book-sticky','btn-reserve','btn-check-avail',
   'btn-exp-1','btn-exp-2','btn-plan-event-cp'].forEach(function (id) {
    var e = el(id); if (e) e.addEventListener('click', openModal);
  });
  if (backdrop) backdrop.addEventListener('click', closeModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeModal();
  });

  /* ── Step navigation ────────────────────────────────────── */
  function goToStep(n) {
    S.step = n;
    qsa('.glo-wiz-step').forEach(function (panel) {
      panel.classList.toggle('active', +panel.getAttribute('data-step') === n);
    });
    /* Progress dots */
    qsa('.gwp-step').forEach(function (dot) {
      var dn = +dot.getAttribute('data-wstep');
      dot.classList.remove('active','done');
      if (dn < n) dot.classList.add('done');
      else if (dn === n) dot.classList.add('active');
    });
    qsa('.gwp-line').forEach(function (line, i) {
      line.classList.toggle('done', i < n - 1);
    });
    /* Nav buttons */
    var backBtn   = el('wiz-back');
    var nextBtn   = el('wiz-next');
    var submitBtn = el('wiz-submit');
    var wizNav    = el('wiz-nav');
    var wizProg   = el('wiz-progress');
    if (backBtn)   backBtn.style.display   = (n === 1 || n === 8) ? 'none' : '';
    if (nextBtn)   nextBtn.style.display   = (n >= 7  || n === 8) ? 'none' : '';
    if (submitBtn) submitBtn.style.display = (n === 7) ? '' : 'none';
    if (wizNav)    wizNav.style.display    = (n === 8) ? 'none' : '';
    if (wizProg)   wizProg.style.visibility = (n === 8) ? 'hidden' : 'visible';
    /* Step-specific init */
    if (n === 2) initCalendar();
    if (n === 3) updateRiderCount();
    if (n === 5) renderRiderCards();
    if (n === 6) initWaiverStep();
    if (n === 7) renderReview();
    /* Scroll to top */
    var card = modal && modal.querySelector('.glo-modal-card');
    if (card) card.scrollTop = 0;
  }

  function resetWizard() {
    var todayStr=getTodayChicago(), tp=todayStr.split('-');
    S.step=1; S.tour=''; S.date=''; S.time=''; S.riders=2;
    S.contact={ first:'', last:'', phone:'', email:'', isRiding:true };
    S.riderList=[]; S.sig={ printedName:'', dataUrl:'', ack:false, timestamp:'' };
    S.policiesAck=false; S.bookingId='';
    S.calYear=parseInt(tp[0],10); S.calMonth=parseInt(tp[1],10)-1;
    /* Clear inputs */
    ['wiz-first','wiz-last','wiz-phone','wiz-email','wiz-printed-name'].forEach(function(id){
      var inp=el(id); if(inp) inp.value='';
    });
    var ackCb=el('wiz-sig-ack'); if(ackCb) ackCb.checked=false;
    var polCb=el('wiz-policies-ack'); if(polCb) polCb.checked=false;
    var subErr=el('wiz-submit-error'); if(subErr) subErr.style.display='none';
    var sb=el('wiz-submit'); if(sb){ sb.disabled=false; sb.textContent='Submit Booking Request →'; }
    qsa('.gwt-card').forEach(function(c){ c.classList.remove('selected'); });
    qsa('.gwdt-time-chip').forEach(function(c){ c.classList.remove('selected'); });
    var ridBtns=qsa('.gwc-riding-btn');
    ridBtns.forEach(function(b){ b.classList.remove('active'); });
    if(ridBtns[0]) ridBtns[0].classList.add('active');
    clearSigCanvas();
    goToStep(1);
  }

  /* ── Validation ─────────────────────────────────────────── */
  function showErr(msg) { alert(msg); }
  function showStepErr(msg) {
    var err=el('wiz-submit-error');
    if(err){ err.textContent=msg; err.style.display='block'; }
  }

  function validateStep(n) {
    if (n===1) {
      if (!S.tour) { showErr('Please select a tour.'); return false; }
    }
    if (n===2) {
      if (!S.date) { showErr('Please select a date.'); return false; }
      if (!S.time) { showErr('Please select a time slot.'); return false; }
    }
    if (n===4) {
      var f=el('wiz-first'), l=el('wiz-last'), p=el('wiz-phone'), em=el('wiz-email');
      if (!f||!f.value.trim()){ f&&f.focus(); return false; }
      if (!l||!l.value.trim()){ l&&l.focus(); return false; }
      if (!p||!p.value.trim()){ p&&p.focus(); return false; }
      var digits=(p?p.value.replace(/\D/g,''):'');
      if (digits.length<10||digits.length>11){ showErr('Please enter a valid 10-digit US phone number.'); p&&p.focus(); return false; }
      if (!em||!em.value.trim()){ em&&em.focus(); return false; }
      S.contact.first=f.value.trim(); S.contact.last=l.value.trim();
      S.contact.phone=p.value.trim(); S.contact.email=em.value.trim();
    }
    if (n===5) {
      /* Save rider info from cards */
      var cards=qsa('.gwri-card',el('wiz-rider-cards'));
      var list=[];
      cards.forEach(function(card,i){
        var addLater=card.querySelector('.gwri-add-later');
        var isSkip=addLater&&addLater.checked;
        var fInp=card.querySelector('.gwri-first');
        var lInp=card.querySelector('.gwri-last');
        var eInp=card.querySelector('.gwri-email');
        var minorActive=card.querySelector('.gwri-minor-toggle.active[data-minor="yes"]');
        var gNameInp=card.querySelector('.gwri-guardian-name');
        var gRelInp=card.querySelector('.gwri-guardian-rel');
        var isContactSlot=(i===0 && S.contact.isRiding);
        list.push({
          first:       isContactSlot ? S.contact.first : ((fInp&&fInp.value.trim())||''),
          last:        isContactSlot ? S.contact.last  : ((lInp&&lInp.value.trim())||''),
          email:       isContactSlot ? S.contact.email : ((eInp&&eInp.value.trim())||''),
          isMinor:     !!minorActive,
          guardianName:(gNameInp&&gNameInp.value.trim())||'',
          guardianRel: (gRelInp&&gRelInp.value.trim())||'',
          waiverStatus:'PENDING',
          addLater:    isSkip||false
        });
      });
      S.riderList=list;
    }
    if (n===6) {
      var pName=el('wiz-printed-name');
      var ackCb=el('wiz-sig-ack');
      if (!pName||!pName.value.trim()){ showErr('Please enter your printed full name.'); pName&&pName.focus(); return false; }
      if (isCanvasBlank())            { showErr('Please draw your signature.'); return false; }
      if (!ackCb||!ackCb.checked)     { showErr('Please check the acknowledgment box.'); return false; }
      S.sig.printedName=pName.value.trim();
      S.sig.ack=true;
      S.sig.timestamp=new Date().toISOString();
      /* Mark primary + minors as COMPLETE */
      S.riderList.forEach(function(r,i){
        if ((i===0&&S.contact.isRiding)||r.isMinor) r.waiverStatus='COMPLETE';
      });
    }
    if (n===7) {
      var polCb=el('wiz-policies-ack');
      if (!polCb||!polCb.checked){ showStepErr('Please acknowledge the Ride Policies before submitting.'); return false; }
      S.policiesAck=true;
    }
    return true;
  }

  /* ── Step 1: Tour ───────────────────────────────────────── */
  qsa('.gwt-card').forEach(function(card){
    card.addEventListener('click', function(){
      qsa('.gwt-card').forEach(function(c){ c.classList.remove('selected'); });
      card.classList.add('selected');
      var newTour = card.getAttribute('data-tour');
      /* If switching tours, clear the selected date so an incompatible
         date (e.g. a Friday picked for Downtown) doesn't carry over
         when switching to R&B Ladies Night (Thursdays only). */
      if (newTour !== S.tour) { S.date = ''; }
      S.tour = newTour;
    });
  });

  /* ── Step 2: Calendar ───────────────────────────────────── */
  var calInited = false;
  function initCalendar() {
    renderCalendar();
    if (calInited) return;
    calInited = true;
    var prev=el('wiz-cal-prev'), next=el('wiz-cal-next');
    if (prev) prev.addEventListener('click', function(){
      if(S.calMonth===0){S.calMonth=11;S.calYear--;}else S.calMonth--;
      var tp=getTodayChicago().split('-'), ty=parseInt(tp[0],10), tm=parseInt(tp[1],10)-1;
      if(S.calYear<ty||(S.calYear===ty&&S.calMonth<tm)){
        S.calYear=ty; S.calMonth=tm;
      }
      renderCalendar();
    });
    if (next) next.addEventListener('click', function(){
      if(S.calMonth===11){S.calMonth=0;S.calYear++;}else S.calMonth++;
      renderCalendar();
    });
  }
  function renderCalendar() {
    var grid=el('wiz-cal-grid'), title=el('wiz-cal-title');
    if (!grid||!title) return;
    var yr=S.calYear, mo=S.calMonth;
    title.textContent=MONTHS_LONG[mo]+' '+yr;
    var todayStr=getTodayChicago(); /* always America/Chicago — rolls forward automatically */
    var firstDOW=new Date(yr,mo,1).getDay();
    var daysInMo=new Date(yr,mo+1,0).getDate();
    var html='';
    for(var i=0;i<firstDOW;i++) html+='<div class="gwdt-day gwdt-empty"></div>';
    for(var day=1;day<=daysInMo;day++){
      var d=new Date(yr,mo,day), ymd=toYMD(d), dow=d.getDay();
      var cls='gwdt-day', attr='', inner=String(day);
      if(ymd===todayStr) cls+=' gwdt-today';
      if(ymd===S.date)   cls+=' gwdt-sel';
      if(ymd<todayStr){ cls+=' gwdt-past'; }
      else if(!isAllowedDay(dow)){ cls+=' gwdt-closed'; }
      else if(isBooked(ymd)){
        /* Only show BOOKED on days that are allowed for the current tour */
        cls+=' gwdt-booked';
        inner='<span class="gwdt-day-num">'+day+'</span><span class="gwdt-booked-lbl">BOOKED</span>';
      }
      else{ cls+=' gwdt-avail'; attr='data-d="'+ymd+'" tabindex="0" role="button" aria-label="'+fmtDate(ymd)+'"'; }
      html+='<div class="'+cls+'" '+attr+'>'+inner+'</div>';
    }
    grid.innerHTML=html;
    /* Update availability note */
    var noteEl=el('gwdt-avail-note');
    if(noteEl){
      noteEl.textContent=(S.tour===LADIES_NIGHT_TOUR)
        ? 'Tours available Thursday only.'
        : 'Tours available Thursday – Sunday only.';
    }
    qsa('.gwdt-avail[data-d]',grid).forEach(function(cell){
      cell.addEventListener('click',function(){ pickDate(cell.getAttribute('data-d')); });
      cell.addEventListener('keydown',function(e){
        if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pickDate(cell.getAttribute('data-d')); }
      });
    });
  }
  function pickDate(ymd){ S.date=ymd; renderCalendar(); }

  qsa('.gwdt-time-chip').forEach(function(chip){
    chip.addEventListener('click',function(){
      qsa('.gwdt-time-chip').forEach(function(c){ c.classList.remove('selected'); });
      chip.classList.add('selected');
      S.time=chip.getAttribute('data-time');
    });
  });

  /* ── Step 3: Rider count ────────────────────────────────── */
  function updateRiderCount() {
    var cnt=el('wiz-rider-count'), tot=el('wiz-est-total');
    var dec=el('wiz-rider-dec'),   inc=el('wiz-rider-inc');
    if(cnt) cnt.textContent=S.riders;
    if(tot) tot.textContent='$'+(S.riders*PRICE).toFixed(2);
    if(dec) dec.disabled=(S.riders<=MIN_RIDERS);
    if(inc) inc.disabled=(S.riders>=MAX_RIDERS);
  }
  var decBtn=el('wiz-rider-dec'), incBtn=el('wiz-rider-inc');
  if(decBtn) decBtn.addEventListener('click',function(){ if(S.riders>MIN_RIDERS){S.riders--;updateRiderCount();} });
  if(incBtn) incBtn.addEventListener('click',function(){ if(S.riders<MAX_RIDERS){S.riders++;updateRiderCount();} });

  /* ── Step 4: Contact ────────────────────────────────────── */
  qsa('.gwc-riding-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      qsa('.gwc-riding-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      S.contact.isRiding=(btn.getAttribute('data-riding')==='yes');
    });
  });

  /* ── Step 5: Rider cards ────────────────────────────────── */
  function renderRiderCards() {
    var container=el('wiz-rider-cards');
    if (!container) return;
    var count=S.riders;
    while(S.riderList.length<count) S.riderList.push({first:'',last:'',email:'',isMinor:false,guardianName:'',guardianRel:'',waiverStatus:'PENDING',addLater:false});
    S.riderList=S.riderList.slice(0,count);
    var html='';
    for(var i=0;i<count;i++){
      var r=S.riderList[i];
      var isMe=(i===0&&S.contact.isRiding);
      var label='Rider '+(i+1);
      if(isMe) label='Rider 1 &mdash; '+esc(S.contact.first)+' '+esc(S.contact.last)+' <span class="gwri-you">(You)</span>';
      html+='<div class="gwri-card" data-idx="'+i+'">';
      html+='<div class="gwri-card-hd"><span class="gwri-card-num">'+label+'</span>';
      if (!isMe) {
        html+='<div class="gwri-type-toggle">';
        html+='<button class="gwri-minor-toggle'+(r.isMinor?'':' active')+'" data-minor="no" type="button">Adult</button>';
        html+='<button class="gwri-minor-toggle'+(r.isMinor?' active':'')+'" data-minor="yes" type="button">Minor</button>';
        html+='</div>';
      } else {
        html+='<span class="gwri-adult-badge">Adult Rider</span>';
      }
      html+='</div>'; /* /.gwri-card-hd */
      if (isMe) {
        html+='<div class="gwri-prefilled">';
        html+='<span>'+esc(S.contact.first)+' '+esc(S.contact.last)+'</span>';
        html+='<span class="gwri-prefill-note">Primary contact · Waiver signed</span>';
        html+='</div>';
      } else {
        html+='<label class="gwri-add-later-wrap"><input type="checkbox" class="gwri-add-later"'+(r.addLater?' checked':'')+'/><span class="gwri-add-later-lbl">Add info later</span></label>';
        html+='<div class="gwri-name-fields'+(r.addLater?' gwri-hidden':'')+'">';
        html+='<div class="gwc-row">';
        html+='<div class="gwc-group"><label>First Name</label><input type="text" class="gwri-first" value="'+esc(r.first)+'" placeholder="First name" /></div>';
        html+='<div class="gwc-group"><label>Last Name</label><input type="text" class="gwri-last" value="'+esc(r.last)+'" placeholder="Last name" /></div>';
        html+='</div>';
        html+='<div class="gwc-group"><label>Email <span class="gwc-optional">— Optional</span></label><input type="email" class="gwri-email" value="'+esc(r.email)+'" placeholder="rider@email.com" /></div>';
        html+='</div>'; /* /.gwri-name-fields */
        html+='<div class="gwri-guardian-section'+(r.isMinor?'':' gwri-hidden')+'">';
        html+='<p class="gwri-minor-label">Minor Rider — Guardian Information</p>';
        html+='<div class="gwc-row">';
        html+='<div class="gwc-group"><label>Guardian Full Name</label><input type="text" class="gwri-guardian-name" value="'+esc(r.guardianName)+'" placeholder="Guardian name" /></div>';
        html+='<div class="gwc-group"><label>Relationship</label><input type="text" class="gwri-guardian-rel" value="'+esc(r.guardianRel)+'" placeholder="e.g. Parent" /></div>';
        html+='</div>';
        html+='</div>'; /* /.gwri-guardian-section */
      }
      var wStatus=(isMe||r.isMinor)?'COMPLETE':'PENDING';
      html+='<div class="gwri-waiver-badge gwri-waiver-'+(wStatus==='COMPLETE'?'complete':'pending')+'">'+
            (wStatus==='COMPLETE'?'✓ Waiver Signed':'Waiver Pending')+'</div>';
      html+='</div>'; /* /.gwri-card */
    }
    container.innerHTML=html;
    /* Wire card interactions */
    qsa('.gwri-card',container).forEach(function(card){
      var idx=+card.getAttribute('data-idx');
      qsa('.gwri-minor-toggle',card).forEach(function(btn){
        btn.addEventListener('click',function(){
          qsa('.gwri-minor-toggle',card).forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          var isMin=(btn.getAttribute('data-minor')==='yes');
          if(S.riderList[idx]) S.riderList[idx].isMinor=isMin;
          var gs=card.querySelector('.gwri-guardian-section');
          if(gs) gs.classList.toggle('gwri-hidden',!isMin);
          /* Update badge */
          var badge=card.querySelector('.gwri-waiver-badge');
          if(badge){
            badge.className='gwri-waiver-badge gwri-waiver-pending';
            badge.textContent='Waiver Pending';
          }
        });
      });
      var addLater=card.querySelector('.gwri-add-later');
      if(addLater) addLater.addEventListener('change',function(){
        var nf=card.querySelector('.gwri-name-fields');
        if(nf) nf.classList.toggle('gwri-hidden',addLater.checked);
        if(S.riderList[idx]) S.riderList[idx].addLater=addLater.checked;
      });
    });
  }

  /* ── Step 6: Waiver + Signature ─────────────────────────── */
  var sigCanvas, sigCtx, sigDrawing=false, sigHasData=false;

  function initWaiverStep() {
    /* "Signing for" summary */
    var sfEl=el('gww-signing-for');
    if(sfEl){
      var html='<p class="gww-sf-label">You are signing for:</p><div class="gww-sf-list">';
      if(S.contact.isRiding){
        html+='<div class="gww-sf-item"><span class="gww-sf-badge gww-sf-adult">Adult</span>'+esc(S.contact.first)+' '+esc(S.contact.last)+' (You)</div>';
      }
      var otherAdults=0;
      S.riderList.forEach(function(r,i){
        if(r.isMinor){
          var n=(r.first&&r.last)?esc(r.first)+' '+esc(r.last):'Rider '+(i+1)+' (Minor)';
          html+='<div class="gww-sf-item"><span class="gww-sf-badge gww-sf-minor">Minor</span>'+n+'</div>';
        } else if(!(i===0&&S.contact.isRiding)){
          otherAdults++;
        }
      });
      if(otherAdults>0){
        html+='<div class="gww-sf-other">+ '+otherAdults+' other adult rider'+(otherAdults>1?'s':'')+' will receive their own waiver link after the booking is confirmed.</div>';
      }
      html+='</div>';
      sfEl.innerHTML=html;
    }
    /* Date */
    var dateEl=el('wiz-sig-date');
    if(dateEl){
      var d=new Date();
      dateEl.textContent=MONTHS_LONG[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
    }
    initSigCanvas();
  }

  function initSigCanvas() {
    sigCanvas=el('wiz-sig-canvas');
    if(!sigCanvas) return;
    sigCtx=sigCanvas.getContext('2d');
    function resize(){
      var rect=sigCanvas.getBoundingClientRect();
      sigCanvas.width=Math.round(rect.width);
      sigCanvas.height=Math.round(rect.height);
      sigCtx.strokeStyle='#ffffff';
      sigCtx.lineWidth=2.5;
      sigCtx.lineCap='round';
      sigCtx.lineJoin='round';
    }
    resize();
    sigDrawing=false; sigHasData=false; S.sig.dataUrl='';

    function xy(e){
      var r=sigCanvas.getBoundingClientRect();
      return e.touches
        ? {x:e.touches[0].clientX-r.left, y:e.touches[0].clientY-r.top}
        : {x:e.clientX-r.left, y:e.clientY-r.top};
    }
    function start(e){ e.preventDefault(); sigDrawing=true; sigHasData=true; var p=xy(e); sigCtx.beginPath(); sigCtx.moveTo(p.x,p.y); }
    function move(e) { if(!sigDrawing) return; e.preventDefault(); var p=xy(e); sigCtx.lineTo(p.x,p.y); sigCtx.stroke(); }
    function stop()  { if(!sigDrawing) return; sigDrawing=false; S.sig.dataUrl=sigCanvas.toDataURL('image/png'); }
    sigCanvas.addEventListener('mousedown', start);
    sigCanvas.addEventListener('mousemove', move);
    sigCanvas.addEventListener('mouseup',   stop);
    sigCanvas.addEventListener('mouseleave',stop);
    sigCanvas.addEventListener('touchstart',start,{passive:false});
    sigCanvas.addEventListener('touchmove', move, {passive:false});
    sigCanvas.addEventListener('touchend',  stop);
    var clearBtn=el('wiz-sig-clear');
    if(clearBtn) clearBtn.onclick=clearSigCanvas;
  }
  function clearSigCanvas(){ sigHasData=false; S.sig.dataUrl=''; if(sigCtx&&sigCanvas) sigCtx.clearRect(0,0,sigCanvas.width,sigCanvas.height); }
  function isCanvasBlank(){ return !sigHasData; }

  /* ── Step 7: Review ─────────────────────────────────────── */
  function renderReview(){
    var body=el('wiz-review-body');
    if(!body) return;
    var rRows='';
    S.riderList.forEach(function(r,i){
      var isMe=(i===0&&S.contact.isRiding);
      var name=isMe?(S.contact.first+' '+S.contact.last):((r.first&&r.last)?(r.first+' '+r.last):'Rider '+(i+1)+' — Info Pending');
      var done=(isMe||r.isMinor);
      rRows+='<div class="gwr-rider-row">';
      rRows+='<span>'+esc(name)+(r.isMinor?' <span class="gwr-minor-tag">Minor</span>':'')+'</span>';
      rRows+='<span class="'+(done?'gwr-waiver-ok':'gwr-waiver-pend')+'">'+(done?'✓ Waiver Complete':'○ Waiver Pending')+'</span>';
      rRows+='</div>';
    });
    body.innerHTML=
      '<div class="gwr-block">'+
      '<div class="gwr-block-hd"><span>YOUR GLO KARTS REQUEST</span><button class="gwr-edit-btn" data-goto="1" type="button">Edit</button></div>'+
      '<div class="gwr-row"><span class="gwr-k">Tour</span><span class="gwr-v">'+esc(S.tour)+'</span></div>'+
      '<div class="gwr-row"><span class="gwr-k">Date</span><span class="gwr-v">'+fmtDate(S.date)+'</span></div>'+
      '<div class="gwr-row"><span class="gwr-k">Time</span><span class="gwr-v">'+esc(S.time)+'</span></div>'+
      '<div class="gwr-row"><span class="gwr-k">Riders</span><span class="gwr-v">'+S.riders+'</span></div>'+
      '<div class="gwr-row"><span class="gwr-k">Est. Total</span><span class="gwr-v">$'+(S.riders*PRICE).toFixed(2)+'</span></div>'+
      '</div>'+
      '<div class="gwr-block">'+
      '<div class="gwr-block-hd"><span>PRIMARY CONTACT</span><button class="gwr-edit-btn" data-goto="4" type="button">Edit</button></div>'+
      '<div class="gwr-row"><span class="gwr-k">Name</span><span class="gwr-v">'+esc(S.contact.first+' '+S.contact.last)+'</span></div>'+
      '<div class="gwr-row"><span class="gwr-k">Phone</span><span class="gwr-v">'+esc(S.contact.phone)+'</span></div>'+
      '<div class="gwr-row"><span class="gwr-k">Email</span><span class="gwr-v">'+esc(S.contact.email)+'</span></div>'+
      '</div>'+
      '<div class="gwr-block">'+
      '<div class="gwr-block-hd"><span>RIDER WAIVERS</span><button class="gwr-edit-btn" data-goto="5" type="button">Edit</button></div>'+
      rRows+
      '</div>';
    qsa('.gwr-edit-btn',body).forEach(function(btn){
      btn.addEventListener('click',function(){ goToStep(+btn.getAttribute('data-goto')); });
    });
  }

  /* ── Submit ─────────────────────────────────────────────── */
  function submitBooking(){
    var sb=el('wiz-submit'), err=el('wiz-submit-error');
    if(sb){ sb.disabled=true; sb.textContent='Submitting…'; }
    if(err) err.style.display='none';
    S.bookingId=genId();
    fetch('/api/book',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        bookingId:  S.bookingId,
        tour:       S.tour,
        date:       S.date,
        time:       S.time,
        riderCount: S.riders,
        contact:    S.contact,
        riders:     S.riderList,
        signature:{
          printedName:    S.sig.printedName,
          timestamp:      S.sig.timestamp,
          ack:            S.sig.ack,
          waiverVersion: '1.0'
        }
      })
    })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if(data.ok){
        if(data.bookingId) S.bookingId=data.bookingId;
        renderConfirmation();
        goToStep(8);
      } else { throw new Error(data.error||'error'); }
    })
    .catch(function(e){
      console.error('[Glo Karts] booking error',e);
      if(sb){ sb.disabled=false; sb.textContent='Submit Booking Request →'; }
      if(err){ err.textContent='Something went wrong. Please try again or text Glo Karts at 630-329-0885.'; err.style.display='block'; }
    });
  }

  function renderConfirmation(){
    var cId=el('wiz-conf-id'), cDet=el('wiz-conf-details'), cWaiv=el('wiz-conf-waivers');
    if(cId) cId.textContent=S.bookingId;
    if(cDet){
      cDet.innerHTML=
        '<div class="gwr-row"><span class="gwr-k">Tour</span><span class="gwr-v">'+esc(S.tour)+'</span></div>'+
        '<div class="gwr-row"><span class="gwr-k">Preferred Date</span><span class="gwr-v">'+fmtDate(S.date)+'</span></div>'+
        '<div class="gwr-row"><span class="gwr-k">Preferred Time</span><span class="gwr-v">'+esc(S.time)+'</span></div>'+
        '<div class="gwr-row"><span class="gwr-k">Riders</span><span class="gwr-v">'+S.riders+'</span></div>'+
        '<div class="gwr-row"><span class="gwr-k">Contact</span><span class="gwr-v">'+esc(S.contact.first+' '+S.contact.last)+'</span></div>'+
        '<div class="gwr-row"><span class="gwr-k">Contact Phone</span><span class="gwr-v">'+esc(S.contact.phone)+'</span></div>';
    }
    if(cWaiv){
      var html='<p class="gwconf-waiv-title">Waiver Status</p>';
      S.riderList.forEach(function(r,i){
        var isMe=(i===0&&S.contact.isRiding);
        var name=isMe?(S.contact.first+' '+S.contact.last):((r.first&&r.last)?r.first+' '+r.last:'Rider '+(i+1));
        var done=isMe||r.isMinor;
        html+='<div class="gwconf-waiv-row"><span>'+esc(name)+'</span><span class="'+(done?'gwr-waiver-ok':'gwr-waiver-pend')+'">'+(done?'✓ Waiver Complete':'○ Waiver Pending')+'</span></div>';
      });
      html+='<p class="gwconf-waiv-note">All required participant waivers must be completed before the Glo Karts experience.</p>';
      cWaiv.innerHTML=html;
    }
  }

  /* ── Nav wiring ─────────────────────────────────────────── */
  var nextBtn=el('wiz-next'), backBtn=el('wiz-back'), subBtn=el('wiz-submit');
  if(nextBtn) nextBtn.addEventListener('click',function(){ if(validateStep(S.step)) goToStep(S.step+1); });
  if(backBtn) backBtn.addEventListener('click',function(){ if(S.step>1) goToStep(S.step-1); });
  if(subBtn)  subBtn.addEventListener('click', function(){ if(validateStep(7)) submitBooking(); });

  /* ── Init ──────────────────────────────────────────────── */
  goToStep(1);

})();
