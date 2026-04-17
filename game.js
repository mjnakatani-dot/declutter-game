// ── State ──────────────────────────────────────────────
const state = {
  apiKey: '',
  items: [],        // { name, category, description, advice, emoji }
  index: 0,
  kept: [],
  discarded: [],
};

// ── Screens ────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Toast ──────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Screen 1: API Key ──────────────────────────────────
document.getElementById('btn-api').addEventListener('click', () => {
  const val = document.getElementById('api-key').value.trim();
  if (!val.startsWith('sk-ant-')) { toast('APIキーが正しくありません'); return; }
  state.apiKey = val;
  showScreen('screen-upload');
});

// ── Screen 2: Upload ───────────────────────────────────
const fileInput  = document.getElementById('file-input');
const previewImg = document.getElementById('preview-img');
const uploadArea = document.getElementById('upload-area');
const btnAnalyze = document.getElementById('btn-analyze');

let imageBase64 = null;
let imageMediaType = 'image/jpeg';

fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);
    // 長辺を1280pxに制限して圧縮
    const MAX = 1280;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
      else       { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    imageBase64 = dataUrl.split(',')[1];
    imageMediaType = 'image/jpeg';
    previewImg.src = dataUrl;
    previewImg.classList.remove('hidden');
    uploadArea.style.display = 'none';
    btnAnalyze.classList.remove('hidden');
  };
  img.src = objectUrl;
});

btnAnalyze.addEventListener('click', analyzeImage);

// ── Screen 3: Analyze ──────────────────────────────────
async function analyzeImage() {
  if (!imageBase64) { toast('画像を選択してください'); return; }
  showScreen('screen-loading');

  const msgs = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: imageMediaType, data: imageBase64 },
        },
        {
          type: 'text',
          text: `この部屋の写真に写っているモノを日本語でリストアップしてください。
断捨離ゲームとして使用します。以下のJSONフォーマットのみで返してください（マークダウン不要）。

{
  "items": [
    {
      "name": "モノの名前（短く）",
      "category": "カテゴリ（家電/衣類/本/家具/雑貨/食器/その他）",
      "description": "そのモノについての一言（20字以内）",
      "advice": "断捨離アドバイス（30字以内）",
      "emoji": "そのモノに合う絵文字1文字"
    }
  ]
}

- アイテムは5〜15個認識してください
- 認識できないものは含めないでください
- フォーマット以外のテキストは一切不要です`,
        },
      ],
    },
  ];

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': state.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: msgs,
      }),
    });
  } catch (fetchErr) {
    console.error('fetch error:', fetchErr);
    toast('通信エラー: ' + (fetchErr.message || fetchErr.name || String(fetchErr)));
    showScreen('screen-upload');
    return;
  }

  try {
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error?.message || 'HTTP ' + res.status);
    }

    const data = await res.json();
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('APIレスポンスが不正です: ' + JSON.stringify(data).slice(0, 100));
    }
    const text = data.content[0].text.trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('JSON解析失敗: ' + text.slice(0, 80));
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.items || parsed.items.length === 0) {
      throw new Error('アイテムが見つかりませんでした');
    }

    state.items = parsed.items;
    state.index = 0;
    state.kept = [];
    state.discarded = [];
    startGame();
  } catch (err) {
    console.error('processing error:', err);
    toast('エラー: ' + (err.message || String(err)));
    showScreen('screen-upload');
  }
}

// ── Screen 4: Game ─────────────────────────────────────
function startGame() {
  showScreen('screen-game');
  updateCounters();
  renderCards();
  attachSwipe();
}

function updateCounters() {
  document.getElementById('count-discard').textContent = state.discarded.length;
  document.getElementById('count-keep').textContent    = state.kept.length;
  const total = state.items.length;
  const done  = state.discarded.length + state.kept.length;
  document.getElementById('progress-bar').style.width = (done / total * 100) + '%';
}

function renderCards() {
  const stack = document.getElementById('card-stack');
  stack.innerHTML = '';

  // Show top 3 cards (current + 2 behind)
  for (let i = Math.min(state.index + 2, state.items.length - 1); i >= state.index; i--) {
    const item = state.items[i];
    const card = buildCard(item, i === state.index);
    stack.appendChild(card);
  }
}

function buildCard(item, isTop) {
  const card = document.createElement('div');
  card.className = 'swipe-card';

  card.innerHTML = `
    <div class="card-image emoji-only">${item.emoji || '📦'}</div>
    <div class="card-body">
      <div class="card-category">${item.category}</div>
      <div class="card-name">${item.name}</div>
      <div class="card-desc">${item.description}</div>
      <div class="card-advice">💡 ${item.advice}</div>
    </div>
    <div class="swipe-label label-discard">捨てる 🗑</div>
    <div class="swipe-label label-keep">残す ✨</div>
  `;

  return card;
}

// ── Swipe Logic ────────────────────────────────────────
function attachSwipe() {
  document.getElementById('btn-discard').onclick = () => decide('discard');
  document.getElementById('btn-keep').onclick    = () => decide('keep');
  setupDrag();
}

let drag = null;

function setupDrag() {
  const stack = document.getElementById('card-stack');
  stack.addEventListener('mousedown',  onDragStart);
  stack.addEventListener('touchstart', onDragStart, { passive: true });
}

function topCard() {
  return document.querySelector('#card-stack .swipe-card:last-child');
}

function onDragStart(e) {
  const card = topCard();
  if (!card) return;

  const touch = e.touches ? e.touches[0] : e;
  drag = { startX: touch.clientX, startY: touch.clientY, x: 0, card };

  document.addEventListener('mousemove',  onDragMove);
  document.addEventListener('touchmove',  onDragMove, { passive: true });
  document.addEventListener('mouseup',    onDragEnd);
  document.addEventListener('touchend',   onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  const touch = e.touches ? e.touches[0] : e;
  drag.x = touch.clientX - drag.startX;
  const rotate = drag.x * 0.08;
  drag.card.style.transform = `translateX(${drag.x}px) rotate(${rotate}deg)`;

  const ratio = Math.min(Math.abs(drag.x) / 100, 1);
  const labelD = drag.card.querySelector('.label-discard');
  const labelK = drag.card.querySelector('.label-keep');

  if (drag.x < 0) {
    labelD.style.opacity = ratio;
    labelK.style.opacity = 0;
    drag.card.classList.add('swiping-left');
    drag.card.classList.remove('swiping-right');
  } else {
    labelK.style.opacity = ratio;
    labelD.style.opacity = 0;
    drag.card.classList.add('swiping-right');
    drag.card.classList.remove('swiping-left');
  }
}

function onDragEnd() {
  document.removeEventListener('mousemove',  onDragMove);
  document.removeEventListener('touchmove',  onDragMove);
  document.removeEventListener('mouseup',    onDragEnd);
  document.removeEventListener('touchend',   onDragEnd);

  if (!drag) return;
  const threshold = window.innerWidth * 0.3;

  if (drag.x < -threshold) {
    decide('discard');
  } else if (drag.x > threshold) {
    decide('keep');
  } else {
    drag.card.style.transition = 'transform 0.3s ease';
    drag.card.style.transform  = '';
    drag.card.querySelector('.label-discard').style.opacity = 0;
    drag.card.querySelector('.label-keep').style.opacity    = 0;
    drag.card.classList.remove('swiping-left', 'swiping-right');
    setTimeout(() => { if (drag?.card) drag.card.style.transition = ''; }, 300);
  }
  drag = null;
}

function decide(action) {
  const item = state.items[state.index];
  if (!item) return;

  if (action === 'discard') state.discarded.push(item);
  else state.kept.push(item);

  // Animate top card out
  const card = topCard();
  if (card) {
    card.style.transition = 'none';
    card.classList.add(action === 'discard' ? 'fly-left' : 'fly-right');
    // Show correct label at full opacity
    const label = card.querySelector(action === 'discard' ? '.label-discard' : '.label-keep');
    if (label) label.style.opacity = '1';
  }

  state.index++;
  updateCounters();

  setTimeout(() => {
    if (state.index >= state.items.length) {
      showResult();
    } else {
      renderCards();
      setupDrag();
    }
  }, 320);
}

// ── Screen 5: Result ───────────────────────────────────
function showResult() {
  showScreen('screen-result');

  const total    = state.items.length;
  const discarded = state.discarded.length;
  const kept     = state.kept.length;
  const score    = Math.round((discarded / total) * 100);

  document.getElementById('res-discard').textContent = discarded;
  document.getElementById('res-keep').textContent    = kept;
  document.getElementById('res-score').textContent   = score;

  let emoji, title, msg;
  if (score >= 70) {
    emoji = '🏆'; title = '断捨離マスター！';
    msg = `${discarded}個のモノを手放しました。すっきりした空間が待っています！`;
  } else if (score >= 40) {
    emoji = '✨'; title = 'よくできました！';
    msg = `${discarded}個を手放すことができました。少しずつ前進しています。`;
  } else {
    emoji = '🌱'; title = 'はじめの一歩';
    msg = `${discarded}個を手放しました。まずは小さな一歩から始めましょう！`;
  }

  document.getElementById('result-emoji').textContent = emoji;
  document.getElementById('result-title').textContent  = title;
  document.getElementById('result-msg').textContent    = msg;

  const list = document.getElementById('discard-list');
  list.innerHTML = '';
  state.discarded.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.emoji || ''} ${item.name}`;
    list.appendChild(li);
  });

  document.getElementById('discard-list-wrap').style.display =
    state.discarded.length ? 'block' : 'none';
}

document.getElementById('btn-restart').addEventListener('click', () => {
  // Reset image
  imageBase64 = null;
  previewImg.classList.add('hidden');
  uploadArea.style.display = '';
  btnAnalyze.classList.add('hidden');
  document.getElementById('file-input').value = '';
  showScreen('screen-upload');
});
