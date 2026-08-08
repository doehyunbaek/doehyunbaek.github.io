const DEFAULT_PLAYLIST_ID = "PLs7zUO7VPyJ4yqjW6XecW42RMjTid_kKF";
const YOUTUBE_WORKER_URL = String(window.VOCATUBE_GOOGLE_CONFIG?.youtubeWorkerUrl || "").replace(/\/$/, "");
const apiUrl = path => `${YOUTUBE_WORKER_URL}${path}`;
let currentVideoId = "";
let currentVideo = null;
let transcriptRequest = 0;
let transcript = [];

let player;
let playerReady = false;
let currentIndex = -1;
let currentWordStart = -1;
let timer;
const list = document.getElementById("transcriptList");
const search = document.getElementById("searchInput");
const followToggle = document.getElementById("followToggle");
const toast = document.getElementById("toast");
const vocabList = document.getElementById("vocabList");
const vocabCount = document.getElementById("vocabCount");
const ankiStorageList = document.getElementById("ankiStorageList");
const ankiStorageCount = document.getElementById("ankiStorageCount");
const meaningOnlyToggle = document.getElementById("meaningOnlyToggle");
const transferToAnki = document.getElementById("transferToAnki");
const playlistList = document.getElementById("playlistList");
const playlistSourcesElement = document.getElementById("playlistSources");
const subscriptionSourcesElement = document.getElementById("subscriptionSources");
const playlistTab = document.getElementById("playlistTab");
const subscriptionsTab = document.getElementById("subscriptionsTab");
const shortsTab = document.getElementById("shortsTab");
const playlistView = document.getElementById("playlistView");
const subscriptionsView = document.getElementById("subscriptionsView");
const shortsView = document.getElementById("shortsView");
const watchedFilter = document.getElementById("watchedFilter");
const transcriptFilter = document.getElementById("transcriptFilter");
const watchMainTab = document.getElementById("watchMainTab");
const ankiMainTab = document.getElementById("ankiMainTab");
const heatmapMainTab = document.getElementById("heatmapMainTab");
const watchPage = document.getElementById("watchPage");
const ankiView = document.getElementById("ankiView");
const heatmapView = document.getElementById("heatmapView");
const ankiList = document.getElementById("ankiList");
const ankiStack = document.getElementById("ankiStack");
const ankiCurrentCard = document.getElementById("ankiCurrentCard");
const ankiNextCard = document.getElementById("ankiNextCard");
const ankiAnswer = document.getElementById("ankiAnswer");
const ankiRatingBadge = document.getElementById("ankiRatingBadge");
const fsrsScheduler = window.FSRS.fsrs({
  request_retention: .9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"]
});
const fsrsRatings = {
  again: window.FSRS.Rating.Again,
  hard: window.FSRS.Rating.Hard,
  good: window.FSRS.Rating.Good,
  easy: window.FSRS.Rating.Easy
};
let ankiCards = JSON.parse(localStorage.getItem("vocatube-anki-cards") || "{}");
let ankiActivity = JSON.parse(localStorage.getItem("vocatube-anki-activity") || "{}");
let selectedHeatmapDate = "";
let ankiUndoStack = [];
let ankiRevealed = false;
let ankiAnimating = false;
let ankiDrag = null;
let playlistSources = JSON.parse(localStorage.getItem("vocatube-playlists") || `[{"id":"${DEFAULT_PLAYLIST_ID}","title":"Deutsch lernen mit Video-Nachrichten"}]`);
let subscriptionSources = JSON.parse(localStorage.getItem("vocatube-subscriptions") || '[{"handle":"ARTEde","title":"ARTEde"}]');
let activePlaylistId = localStorage.getItem("vocatube-active-playlist") || "all";
let activeSubscriptionHandle = localStorage.getItem("vocatube-active-subscription") || "all";
let playlistVideos = [];
let subscriptionVideos = [];
let recommendedShorts = [];
let allDiscoveredShorts = [];
let shortsWithoutTranscripts = 0;
let watchedVideos = new Set(JSON.parse(localStorage.getItem("vocatube-watched") || "[]"));
let watchedActivity = JSON.parse(localStorage.getItem("vocatube-watched-activity") || "{}");
let hideWatched = localStorage.getItem("vocatube-hide-watched") === "true";
let transcriptsOnly = localStorage.getItem("vocatube-transcripts-only") !== "false";
const savedCollectionView = ["shorts", "subscriptions", "playlist"].includes(localStorage.getItem("vocatube-collection-view"))
  ? localStorage.getItem("vocatube-collection-view")
  : "shorts";
const savedMainView = ["anki", "heatmap"].includes(localStorage.getItem("vocatube-main-view"))
  ? localStorage.getItem("vocatube-main-view")
  : "watch";
let vocabulary = JSON.parse(localStorage.getItem("vocatube-vocabulary") || "[]");
let ankiVocabulary = JSON.parse(localStorage.getItem("vocatube-anki-vocabulary") || "[]");
let auth;

// Retire the previous one-pass review state; FSRS starts those cards due now.
localStorage.removeItem("vocatube-anki-reviews");

document.getElementById("lineCount").textContent = "Loading…";

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function vocabularyLabel(item) {
  const lemma = item.lemma || item.word;
  return item.article ? `${item.article} ${lemma}` : lemma;
}

function renderTranscript(query = "") {
  const term = query.trim().toLocaleLowerCase("de");
  if (!transcript.length) {
    list.innerHTML = `<div class="empty">Loading transcript…</div>`;
    return;
  }
  const filtered = transcript.map((item, index) => ({ ...item, index }))
    .filter(item => item.text.toLocaleLowerCase("de").includes(term));

  if (!filtered.length) {
    list.innerHTML = `<div class="empty">No matching words found.</div>`;
    document.getElementById("lineCount").textContent = "0 matches";
    return;
  }

  list.innerHTML = filtered.map(item => {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const words = (item.words || [{ start: item.start, text: item.text }]).map(word => {
      let text = escapeHTML(word.text);
      if (term) text = text.replace(new RegExp(`(${safe})`, "giu"), "<mark>$1</mark>");
      return `<span class="word" data-word-start="${word.start}">${text}</span>`;
    }).join(" ");
    return `<button class="segment${item.index === currentIndex ? " active" : ""}" data-index="${item.index}" data-start="${item.start}" type="button">
      <span class="time">${formatTime(item.start)}</span><span class="text">${words}</span>
    </button>`;
  }).join("");
  document.getElementById("lineCount").textContent = term ? `${filtered.length} matches` : `${transcript.length} segments`;
}

function seekTo(start) {
  if (playerReady) {
    player.seekTo(start, true);
    player.playVideo();
  }
}

function saveVocabulary({ sync = true } = {}) {
  localStorage.setItem("vocatube-vocabulary", JSON.stringify(vocabulary));
  renderVocabulary();
  if (sync) auth?.syncToCloud();
}

function saveAnkiVocabulary({ sync = true } = {}) {
  localStorage.setItem("vocatube-anki-vocabulary", JSON.stringify(ankiVocabulary));
  renderVocabulary();
  if (sync) auth?.syncAnkiVocabularyToCloud();
}

function ankiKey(item) {
  return String(item?.key || item?.lemma || item?.word || "").toLocaleLowerCase("de");
}

function serializeFsrsCard(card) {
  return {
    ...card,
    due: new Date(card.due).toISOString(),
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null
  };
}

function fsrsCardFor(item) {
  const saved = ankiCards[ankiKey(item)]?.card;
  return saved || window.FSRS.createEmptyCard(new Date(0));
}

function saveAnkiCards({ syncKey } = {}) {
  localStorage.setItem("vocatube-anki-cards", JSON.stringify(ankiCards));
  if (syncKey) auth?.syncAnkiToCloud(syncKey);
}

function saveAnkiActivity({ changedId } = {}) {
  localStorage.setItem("vocatube-anki-activity", JSON.stringify(ankiActivity));
  renderHeatmap();
  if (changedId) auth?.syncAnkiActivityToCloud(changedId);
}

function pendingAnkiCards(now = new Date()) {
  return ankiVocabulary
    .filter(item => new Date(fsrsCardFor(item).due) <= now)
    .sort((a, b) => new Date(fsrsCardFor(a).due) - new Date(fsrsCardFor(b).due));
}

function nextAnkiDue() {
  return ankiVocabulary
    .map(item => new Date(fsrsCardFor(item).due))
    .filter(due => due > new Date())
    .sort((a, b) => a - b)[0];
}

function formatDueTime(date) {
  if (!date) return "";
  const ms = date - new Date();
  if (ms < 60 * 60 * 1000) return `in ${Math.max(1, Math.ceil(ms / 60000))} min`;
  if (ms < 24 * 60 * 60 * 1000) return `in ${Math.ceil(ms / 3600000)} hr`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderAnki() {
  ankiDrag = null;
  ankiCurrentCard.classList.remove("dragging");
  const pending = pendingAnkiCards();
  const current = pending[0];
  const next = pending[1];
  const scheduled = ankiVocabulary.filter(item => ankiCards[ankiKey(item)]?.card).length;
  document.getElementById("ankiTabCount").textContent = pending.length;
  document.getElementById("ankiCount").textContent = `${pending.length} due · ${ankiVocabulary.length - pending.length} later`;
  document.getElementById("ankiProgress").style.width = `${ankiVocabulary.length ? scheduled / ankiVocabulary.length * 100 : 0}%`;
  document.getElementById("ankiUndo").disabled = ankiUndoStack.length === 0;
  document.getElementById("ankiEmpty").hidden = Boolean(current);
  ankiStack.hidden = !current;
  document.getElementById("ankiActions").hidden = !current;
  ankiRevealed = false;
  ankiAnswer.hidden = true;
  ankiRatingBadge.hidden = true;
  ankiCurrentCard.style.transform = "";
  ankiCurrentCard.style.opacity = "";
  ankiNextCard.style.transform = "";
  ankiNextCard.style.opacity = "";
  if (!current) {
    const nextDue = nextAnkiDue();
    document.getElementById("ankiEmpty").textContent = ankiVocabulary.length
      ? `You're done for now.${nextDue ? ` Next review ${formatDueTime(nextDue)}.` : ""}`
      : "Save words from a transcript to create Anki cards.";
    return;
  }
  document.getElementById("ankiWord").textContent = vocabularyLabel(current);
  document.getElementById("ankiMeaning").textContent = current.meaning || "Meaning unavailable";
  document.getElementById("ankiSentence").textContent = current.sentence || "";
  document.getElementById("ankiSentence").hidden = !current.sentence;
  document.getElementById("ankiHint").textContent = "Tap to reveal answer";
  ankiCurrentCard.setAttribute("aria-label", `Study ${vocabularyLabel(current)}`);
  const preview = fsrsScheduler.repeat(fsrsCardFor(current), new Date());
  document.querySelectorAll("[data-anki-rating]").forEach(button => {
    const result = preview[fsrsRatings[button.dataset.ankiRating]];
    const dueLabel = result ? formatDueTime(new Date(result.card.due)) : "";
    button.title = dueLabel ? `Next review ${dueLabel}` : "";
    button.querySelector("small").textContent = dueLabel;
  });
  ankiNextCard.innerHTML = next
    ? `<span class="anki-card-label">UP NEXT</span><h2>${escapeHTML(vocabularyLabel(next))}</h2>`
    : `<span class="anki-card-label">LAST CARD</span><h2>Finish strong</h2>`;
}

function renderVocabularyItems(items, { removable = false } = {}) {
  return items.map((item, index) => {
    const lemma = item.lemma || item.word;
    const label = vocabularyLabel(item);
    const encountered = item.encounteredAs && item.encounteredAs.toLocaleLowerCase("de") !== lemma.toLocaleLowerCase("de")
      ? `<small class="encountered">← ${escapeHTML(item.encounteredAs)}</small>` : "";
    const meaning = item.meaning ? `<small class="meaning">${escapeHTML(item.meaning)}</small>` : "";
    return `<span class="vocab-item">
      <button class="vocab-word" type="button" data-start="${item.start}" title="${item.start != null ? `Jump to ${formatTime(item.start)}` : label}">${escapeHTML(label)}${meaning}${encountered}</button>
      <a class="dictionary-link" href="https://en.wiktionary.org/wiki/${encodeURIComponent(lemma)}#German" target="_blank" rel="noreferrer" title="Open English definition in Wiktionary">↗</a>
      ${removable ? `<button class="remove-word" type="button" data-anki-remove="${index}" aria-label="Remove ${escapeHTML(lemma)} from Anki">×</button>` : `<button class="remove-word" type="button" data-remove="${index}" aria-label="Remove ${escapeHTML(lemma)}">×</button>`}
    </span>`;
  }).join("");
}

function renderVocabulary() {
  vocabCount.textContent = `${vocabulary.length} ${vocabulary.length === 1 ? "word" : "words"}`;
  ankiStorageCount.textContent = `${ankiVocabulary.length} ${ankiVocabulary.length === 1 ? "word" : "words"}`;
  renderAnki();
  document.getElementById("clearVocab").hidden = vocabulary.length === 0;
  transferToAnki.disabled = !vocabulary.some(item => !meaningOnlyToggle.checked || item.meaning);
  vocabList.innerHTML = vocabulary.length
    ? renderVocabularyItems(vocabulary)
    : `<span class="vocab-empty">Click a transcript word to save it temporarily.</span>`;
  ankiStorageList.innerHTML = ankiVocabulary.length
    ? renderVocabularyItems(ankiVocabulary, { removable: true })
    : `<span class="vocab-empty">Move vocabulary here for scheduled review.</span>`;
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function heatmapWordLabel(key) {
  const item = [...ankiVocabulary, ...vocabulary].find(word => ankiKey(word) === key);
  return item ? vocabularyLabel(item) : key;
}

function heatmapVideoTitle(videoId, event) {
  if (event?.title) return event.title;
  const video = [...playlistVideos, ...subscriptionVideos, ...recommendedShorts]
    .find(item => item.videoId === videoId);
  return video?.title || `Video ${videoId}`;
}

function renderHeatmapDetails(dateKey) {
  selectedHeatmapDate = dateKey;
  const reviews = Object.values(ankiActivity).filter(event => event?.reviewedAt && localDateKey(event.reviewedAt) === dateKey);
  const videos = Object.entries(watchedActivity).filter(([, event]) => event?.watchedAt && localDateKey(event.watchedAt) === dateKey);
  const date = new Date(`${dateKey}T12:00:00`);
  document.getElementById("heatmapDetailsTitle").textContent = date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  document.getElementById("heatmapDetailsEmpty").textContent = reviews.length || videos.length
    ? `${reviews.length} ${reviews.length === 1 ? "review" : "reviews"} · ${videos.length} ${videos.length === 1 ? "video" : "videos"} watched`
    : "No activity recorded.";
  document.getElementById("heatmapDetailsList").innerHTML = [
    ...reviews.map(event => `<div class="heatmap-detail-item"><strong>${escapeHTML(heatmapWordLabel(event.key))}</strong><span>Anki · ${escapeHTML(event.rating || "reviewed")}</span></div>`),
    ...videos.map(([videoId, event]) => `<div class="heatmap-detail-item"><strong>${escapeHTML(heatmapVideoTitle(videoId, event))}</strong><span>Video watched</span></div>`)
  ].join("");
  document.querySelectorAll(".heatmap-day").forEach(day => day.classList.toggle("selected", day.dataset.date === dateKey));
}

function renderHeatmap() {
  const reviewCounts = {};
  const videoCounts = {};
  Object.values(ankiActivity).forEach(event => {
    if (!event?.reviewedAt) return;
    const key = localDateKey(event.reviewedAt);
    reviewCounts[key] = (reviewCounts[key] || 0) + 1;
  });
  Object.values(watchedActivity).forEach(event => {
    if (!event?.watchedAt) return;
    const key = localDateKey(event.watchedAt);
    videoCounts[key] = (videoCounts[key] || 0) + 1;
  });
  const counts = {};
  for (const key of new Set([...Object.keys(reviewCounts), ...Object.keys(videoCounts)])) {
    counts[key] = (reviewCounts[key] || 0) + (videoCounts[key] || 0);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - mondayOffset));
  const start = new Date(end);
  start.setDate(start.getDate() - 52 * 7 + 1);
  const days = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) days.push(new Date(date));
  const maximum = Math.max(1, ...Object.values(counts));
  document.getElementById("heatmapGrid").innerHTML = days.map(date => {
    const key = localDateKey(date);
    const count = counts[key] || 0;
    const reviews = reviewCounts[key] || 0;
    const videos = videoCounts[key] || 0;
    const level = count ? Math.min(4, Math.ceil(count / maximum * 4)) : 0;
    const label = `${date.toLocaleDateString()}: ${reviews} ${reviews === 1 ? "review" : "reviews"}, ${videos} ${videos === 1 ? "video" : "videos"} watched`;
    return `<button class="heatmap-day${key === selectedHeatmapDate ? " selected" : ""}" data-date="${key}" data-level="${level}" type="button" role="gridcell" aria-label="${label}" title="${label}"></button>`;
  }).join("");
  const months = [];
  days.forEach((date, index) => {
    if (date.getDate() <= 7 && !months.some(month => month.key === `${date.getFullYear()}-${date.getMonth()}`)) {
      months.push({ key: `${date.getFullYear()}-${date.getMonth()}`, label: date.toLocaleDateString(undefined, { month: "short" }), week: Math.floor(index / 7) });
    }
  });
  document.getElementById("heatmapMonths").innerHTML = months.map(month => `<span style="left:${month.week * 15}px">${month.label}</span>`).join("");
  const totalReviews = Object.values(reviewCounts).reduce((sum, count) => sum + count, 0);
  const totalVideos = Object.values(videoCounts).reduce((sum, count) => sum + count, 0);
  document.getElementById("heatmapSummary").textContent = `${totalReviews} reviews · ${totalVideos} videos watched · ${Object.keys(counts).length} active days`;
  if (selectedHeatmapDate) renderHeatmapDetails(selectedHeatmapDate);
}

function showMainView(view) {
  localStorage.setItem("vocatube-main-view", view);
  const showAnki = view === "anki";
  const showHeatmap = view === "heatmap";
  const showWatch = !showAnki && !showHeatmap;
  if (!showWatch && playerReady) player.pauseVideo();
  watchPage.hidden = !showWatch;
  ankiView.hidden = !showAnki;
  heatmapView.hidden = !showHeatmap;
  watchMainTab.classList.toggle("active", showWatch);
  ankiMainTab.classList.toggle("active", showAnki);
  heatmapMainTab.classList.toggle("active", showHeatmap);
  watchMainTab.setAttribute("aria-selected", String(showWatch));
  ankiMainTab.setAttribute("aria-selected", String(showAnki));
  heatmapMainTab.setAttribute("aria-selected", String(showHeatmap));
  if (showHeatmap) renderHeatmap();
}

watchMainTab.addEventListener("click", () => showMainView("watch"));
ankiMainTab.addEventListener("click", () => showMainView("anki"));
heatmapMainTab.addEventListener("click", () => showMainView("heatmap"));
document.getElementById("heatmapGrid").addEventListener("click", event => {
  const day = event.target.closest(".heatmap-day");
  if (day) renderHeatmapDetails(day.dataset.date);
});
showMainView(savedMainView);

function revealAnkiAnswer() {
  if (!pendingAnkiCards().length || ankiAnimating) return;
  ankiRevealed = !ankiRevealed;
  ankiAnswer.hidden = !ankiRevealed;
  document.getElementById("ankiHint").textContent = ankiRevealed ? "Rate your recall" : "Tap to reveal answer";
}

function ankiRatingFromVector(dx, dy) {
  const xThreshold = Math.min(120, ankiCurrentCard.offsetWidth * .22);
  const yThreshold = Math.min(120, ankiCurrentCard.offsetHeight * .18);
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx <= -xThreshold) return "hard";
    if (dx >= xThreshold) return "good";
  } else {
    if (dy <= -yThreshold) return "easy";
    if (dy >= yThreshold) return "again";
  }
  return null;
}

function showAnkiRating(rating) {
  ankiRatingBadge.hidden = !rating;
  ankiRatingBadge.className = `anki-rating-badge${rating ? ` ${rating}` : ""}`;
  ankiRatingBadge.textContent = rating || "";
}

function applyAnkiTransform(dx, dy) {
  const progress = Math.min(1, Math.hypot(dx, dy) / 180);
  ankiCurrentCard.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${dx * .045}deg)`;
  ankiCurrentCard.style.opacity = String(1 - progress * .12);
  ankiNextCard.style.transform = `translateY(${12 - progress * 8}px) scale(${.97 + progress * .03})`;
  ankiNextCard.style.opacity = String(.8 + progress * .2);
}

function rateAnki(rating, dx = 0, dy = 0) {
  const current = pendingAnkiCards()[0];
  if (!current || ankiAnimating) return;
  const vectors = { again: [0, 1], hard: [-1, 0], good: [1, 0], easy: [0, -1] };
  const [x, y] = vectors[rating];
  ankiAnimating = true;
  showAnkiRating(rating);
  ankiCurrentCard.style.transform = `translate3d(${x * innerWidth * 1.05 + dx * .2}px, ${y * innerHeight + dy * .2}px, 0) rotate(${x * 28}deg)`;
  ankiCurrentCard.style.opacity = "0";
  setTimeout(() => {
    const key = ankiKey(current);
    const previous = ankiCards[key] ? structuredClone(ankiCards[key]) : null;
    const reviewedAt = new Date();
    const result = fsrsScheduler.next(fsrsCardFor(current), reviewedAt, fsrsRatings[rating]);
    ankiCards[key] = {
      card: serializeFsrsCard(result.card),
      lastRating: rating,
      updatedAt: reviewedAt.toISOString()
    };
    const activityId = crypto.randomUUID?.() || `${reviewedAt.getTime()}-${Math.random().toString(36).slice(2)}`;
    ankiActivity[activityId] = { key, rating, reviewedAt: reviewedAt.toISOString() };
    ankiUndoStack.push({ key, previous, activityId });
    saveAnkiCards({ syncKey: key });
    saveAnkiActivity({ changedId: activityId });
    ankiAnimating = false;
    renderAnki();
  }, 220);
}

ankiCurrentCard.addEventListener("click", () => {
  if (!ankiDrag) revealAnkiAnswer();
});
ankiCurrentCard.addEventListener("pointerdown", event => {
  if (ankiAnimating || !pendingAnkiCards().length || event.button > 0) return;
  ankiDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, moved: false };
  ankiCurrentCard.setPointerCapture(event.pointerId);
  ankiCurrentCard.classList.add("dragging");
});
ankiCurrentCard.addEventListener("pointermove", event => {
  if (!ankiDrag || event.pointerId !== ankiDrag.id) return;
  ankiDrag.dx = event.clientX - ankiDrag.x;
  ankiDrag.dy = event.clientY - ankiDrag.y;
  ankiDrag.moved ||= Math.hypot(ankiDrag.dx, ankiDrag.dy) > 8;
  applyAnkiTransform(ankiDrag.dx, ankiDrag.dy);
  showAnkiRating(ankiRatingFromVector(ankiDrag.dx, ankiDrag.dy));
});
function finishAnkiDrag(event, cancelled = false) {
  if (!ankiDrag || event.pointerId !== ankiDrag.id) return;
  const drag = ankiDrag;
  const rating = cancelled ? null : ankiRatingFromVector(drag.dx, drag.dy);
  ankiDrag = drag.moved ? { moved: true } : null;
  ankiCurrentCard.classList.remove("dragging");
  if (rating) rateAnki(rating, drag.dx, drag.dy);
  else {
    applyAnkiTransform(0, 0);
    showAnkiRating(null);
    setTimeout(() => { ankiDrag = null; }, 0);
  }
}
ankiCurrentCard.addEventListener("pointerup", event => finishAnkiDrag(event));
ankiCurrentCard.addEventListener("pointercancel", event => finishAnkiDrag(event, true));
document.getElementById("ankiActions").addEventListener("click", event => {
  const button = event.target.closest("[data-anki-rating]");
  if (button) rateAnki(button.dataset.ankiRating);
});
document.getElementById("ankiUndo").addEventListener("click", () => {
  const entry = ankiUndoStack.pop();
  if (!entry) return showToast("Nothing to undo");
  if (entry.previous) ankiCards[entry.key] = entry.previous;
  else delete ankiCards[entry.key];
  if (entry.activityId) delete ankiActivity[entry.activityId];
  saveAnkiCards({ syncKey: entry.key });
  saveAnkiActivity({ changedId: entry.activityId });
  renderAnki();
});
document.getElementById("ankiReset").addEventListener("click", () => {
  const now = new Date().toISOString();
  ankiVocabulary.forEach(item => {
    const key = ankiKey(item);
    ankiCards[key] = { card: serializeFsrsCard(window.FSRS.createEmptyCard(now)), updatedAt: now };
  });
  ankiUndoStack = [];
  saveAnkiCards();
  auth?.syncAnkiToCloud();
  renderAnki();
});
document.addEventListener("keydown", event => {
  if (ankiView.hidden || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const ratings = { ArrowDown: "again", ArrowLeft: "hard", ArrowRight: "good", ArrowUp: "easy" };
  if (ratings[event.key]) {
    event.preventDefault();
    rateAnki(ratings[event.key]);
  } else if (event.code === "Space") {
    event.preventDefault();
    revealAnkiAnswer();
  }
});

async function fetchWiktionaryText(word) {
  const params = new URLSearchParams({
    action: "parse",
    page: word,
    prop: "wikitext",
    format: "json",
    origin: "*"
  });
  const response = await fetch(`https://de.wiktionary.org/w/api.php?${params}`);
  if (!response.ok) throw new Error(`Wiktionary returned ${response.status}`);
  const data = await response.json();
  return data.parse?.wikitext?.["*"] || "";
}

function primaryGermanEntry(wikitext) {
  const start = wikitext.search(/^==[^\n]*\{\{Sprache\|Deutsch\}\}[^\n]*==/mi);
  if (start < 0) return wikitext;
  const followingHeading = wikitext.slice(start + 3).search(/^==[^=]/m);
  return followingHeading < 0 ? wikitext.slice(start) : wikitext.slice(start, start + 3 + followingHeading);
}

function primaryGermanSense(wikitext) {
  const entry = primaryGermanEntry(wikitext);
  const firstHeading = entry.search(/^===[^=]/m);
  if (firstHeading < 0) return entry;
  const nextHeading = entry.slice(firstHeading + 4).search(/^===[^=]/m);
  return nextHeading < 0 ? entry.slice(firstHeading) : entry.slice(firstHeading, firstHeading + 4 + nextHeading);
}

function nounArticleFromWikitext(wikitext) {
  const entry = primaryGermanSense(wikitext);
  if (!/\{\{Wortart\|Substantiv\|Deutsch\}\}/i.test(entry)) return "";
  const gender = entry.match(/\|\s*Genus\s*=\s*([mfn])\b/i)?.[1]?.toLowerCase();
  return ({ m: "der", f: "die", n: "das" })[gender] || "";
}

async function lookupWiktionaryInfo(word) {
  const originalText = await fetchWiktionaryText(word);
  const originalEntry = primaryGermanSense(originalText);
  const isInflected = /\{\{Wortart\|(?:Deklinierte Form|Konjugierte Form|Partizip I|Partizip II)\|Deutsch\}\}/i.test(originalEntry);
  let lemma = word;
  if (isInflected) {
    lemma = originalEntry.match(/\{\{Grundformverweis[^|}]*\|\s*([^|}\n]+)/i)?.[1]
      || originalEntry.match(/des Substantivs\s+'''\[\[([^\]|]+)/i)?.[1]
      || word;
    lemma = lemma.replace(/\{\{[^}]+\}\}/g, "").trim();
  }
  const lemmaText = lemma.toLocaleLowerCase("de") === word.toLocaleLowerCase("de")
    ? originalText
    : await fetchWiktionaryText(lemma);
  return { lemma, article: nounArticleFromWikitext(lemmaText) };
}

async function lookupEnglishMeaning(lemma) {
  const response = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(lemma)}`);
  if (!response.ok) throw new Error(`English Wiktionary returned ${response.status}`);
  const data = await response.json();
  const germanEntry = (data.de || []).find(entry => entry.definitions?.length);
  const definition = germanEntry?.definitions?.[0]?.definition;
  if (!definition) return "";
  const document = new DOMParser().parseFromString(definition, "text/html");
  return document.body.textContent.replace(/\s+/g, " ").trim();
}

async function addWordToVocabulary(wordElement, segmentElement) {
  if (wordElement.classList.contains("looking-up")) return;
  const encounteredAs = wordElement.textContent.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!encounteredAs) return;

  wordElement.classList.add("looking-up");
  showToast(`Looking up “${encounteredAs}”…`);
  let lemma = encounteredAs;
  let article = "";
  let meaning = "";
  try {
    ({ lemma, article } = await lookupWiktionaryInfo(encounteredAs));
  } catch {
    showToast("Could not normalize word—using original form");
  }
  try {
    meaning = await lookupEnglishMeaning(lemma);
  } catch {
    showToast("English meaning unavailable—saving word only");
  } finally {
    wordElement.classList.remove("looking-up");
  }

  const key = lemma.toLocaleLowerCase("de");
  if (vocabulary.some(item => (item.lemma || item.word).toLocaleLowerCase("de") === key)) {
    showToast(`“${lemma}” is already saved`);
    return;
  }
  vocabulary.unshift({
    key,
    lemma,
    word: lemma,
    encounteredAs,
    meaning,
    article,
    articleChecked: true,
    start: Number(wordElement.dataset.wordStart),
    sentence: segmentElement.querySelector(".text").textContent.trim()
  });
  saveVocabulary();
  const savedLabel = article ? `${article} ${lemma}` : lemma;
  showToast(encounteredAs.toLocaleLowerCase("de") === lemma.toLocaleLowerCase("de")
    ? `“${savedLabel}” added to vocabulary`
    : `“${encounteredAs}” normalized to “${savedLabel}”`);
}

list.addEventListener("click", event => {
  const word = event.target.closest(".word");
  const segment = event.target.closest(".segment");
  if (word && segment) {
    event.stopPropagation();
    addWordToVocabulary(word, segment);
  } else if (segment) {
    seekTo(Number(segment.dataset.start));
  }
});

vocabList.addEventListener("click", event => {
  const remove = event.target.closest("[data-remove]");
  const savedWord = event.target.closest(".vocab-word");
  if (remove) {
    vocabulary.splice(Number(remove.dataset.remove), 1);
    saveVocabulary();
  } else if (savedWord) {
    seekTo(Number(savedWord.dataset.start));
  }
});

ankiStorageList.addEventListener("click", event => {
  const remove = event.target.closest("[data-anki-remove]");
  if (!remove) return;
  const [removed] = ankiVocabulary.splice(Number(remove.dataset.ankiRemove), 1);
  if (removed) delete ankiCards[ankiKey(removed)];
  saveAnkiCards({ syncKey: removed && ankiKey(removed) });
  saveAnkiVocabulary();
});

meaningOnlyToggle.addEventListener("change", renderVocabulary);
transferToAnki.addEventListener("click", () => {
  const selected = vocabulary.filter(item => !meaningOnlyToggle.checked || item.meaning);
  if (!selected.length) return showToast("No matching vocabulary to move");
  const existing = new Map(ankiVocabulary.map(item => [ankiKey(item), item]));
  selected.forEach(item => existing.set(ankiKey(item), item));
  ankiVocabulary = [...existing.values()];
  const moved = new Set(selected.map(ankiKey));
  vocabulary = vocabulary.filter(item => !moved.has(ankiKey(item)));
  saveVocabulary();
  saveAnkiVocabulary();
  showToast(`${selected.length} ${selected.length === 1 ? "word" : "words"} moved to Anki`);
});

document.getElementById("clearVocab").addEventListener("click", () => {
  vocabulary = [];
  saveVocabulary();
  showToast("Vocabulary cleared");
});

search.addEventListener("input", () => renderTranscript(search.value));
document.addEventListener("keydown", event => {
  if (event.code === "Space" && list.contains(document.activeElement)) {
    event.preventDefault();
    if (!playerReady) return showToast("Select a video first");
    if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    search.focus();
  }
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

document.getElementById("copyButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(transcript.map(x => `${formatTime(x.start)}  ${x.text}`).join("\n"));
  showToast("Transcript copied");
});

document.getElementById("downloadButton").addEventListener("click", () => {
  const content = transcript.map(x => `${formatTime(x.start)}  ${x.text}`).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  link.download = `${currentVideoId}-transcript.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Download started");
});

document.getElementById("themeButton").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("vocatube-theme", document.body.classList.contains("dark") ? "dark" : "light");
});
if (localStorage.getItem("vocatube-theme") === "dark") document.body.classList.add("dark");

window.onYouTubeIframeAPIReady = function () {
  if (currentVideo && !playerReady) createPlayer(currentVideoId, true);
};

function createPlayer(videoId, autoplay) {
  player = new YT.Player("player", {
    videoId,
    playerVars: { autoplay: autoplay ? 1 : 0, playsinline: 1, rel: 0 },
    events: {
      onReady: event => {
        playerReady = true;
        if (autoplay) event.target.playVideo();
      },
      onStateChange: event => {
        clearInterval(timer);
        if (event.data === YT.PlayerState.PLAYING) timer = setInterval(syncTranscript, 250);
        if (event.data === YT.PlayerState.ENDED) markVideoWatched(currentVideoId);
      },
      onError: () => showToast("YouTube could not play this video. Try another video.")
    }
  });
}

function syncTranscript() {
  if (!playerReady) return;
  const time = player.getCurrentTime();
  const duration = player.getDuration();
  if (duration > 0 && time / duration >= .8) markVideoWatched(currentVideoId);
  if (search.value) return;
  const index = transcript.findLastIndex(item => time >= item.start);
  const words = transcript[index]?.words || [];
  const word = words[words.findLastIndex(item => time >= item.start)];
  const wordStart = word?.start ?? -1;
  if (index === currentIndex && wordStart === currentWordStart) return;
  const sentenceChanged = index !== currentIndex;
  currentIndex = index;
  currentWordStart = wordStart;
  document.querySelectorAll(".segment").forEach(el => el.classList.toggle("active", Number(el.dataset.index) === index));
  document.querySelectorAll(".word").forEach(el => el.classList.toggle("active-word", Number(el.dataset.wordStart) === wordStart));
  if (sentenceChanged && followToggle.checked) document.querySelector(`.segment[data-index="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadTranscript() {
  if (!currentVideoId) return;
  const requestId = ++transcriptRequest;
  transcript = [];
  currentIndex = -1;
  currentWordStart = -1;
  document.getElementById("lineCount").textContent = "Loading…";
  renderTranscript();
  try {
    const response = await fetch(apiUrl(`/api/transcript?videoId=${currentVideoId}&lang=de`));
    const data = await response.json();
    if (requestId !== transcriptRequest) return;
    if (!response.ok) throw new Error(data.error || "Transcript request failed");
    transcript = data.segments;
    document.querySelector(".transcript-head h2").innerHTML = `${escapeHTML(data.language)} <span>(${data.generated ? "Auto-generated" : "Original"})</span>`;
    renderTranscript(search.value);
  } catch (error) {
    if (requestId !== transcriptRequest) return;
    list.innerHTML = `<div class="empty">Could not load the transcript dynamically.<br>${escapeHTML(error.message)}</div>`;
    document.getElementById("lineCount").textContent = "Unavailable";
  }
}

function showView(view) {
  localStorage.setItem("vocatube-collection-view", view);
  const showPlaylist = view === "playlist";
  const showSubscriptions = view === "subscriptions";
  const showShorts = view === "shorts";
  playlistView.hidden = !showPlaylist;
  subscriptionsView.hidden = !showSubscriptions;
  shortsView.hidden = !showShorts;
  playlistTab.classList.toggle("active", showPlaylist);
  subscriptionsTab.classList.toggle("active", showSubscriptions);
  shortsTab.classList.toggle("active", showShorts);
  playlistTab.setAttribute("aria-selected", String(showPlaylist));
  subscriptionsTab.setAttribute("aria-selected", String(showSubscriptions));
  shortsTab.setAttribute("aria-selected", String(showShorts));
}

playlistTab.addEventListener("click", () => showView("playlist"));
subscriptionsTab.addEventListener("click", () => showView("subscriptions"));
shortsTab.addEventListener("click", () => showView("shorts"));
showView(savedCollectionView);

function visibleVideos(videos) {
  return hideWatched ? videos.filter(video => !watchedVideos.has(video.videoId)) : videos;
}

function updateWatchedFilterUi() {
  watchedFilter.setAttribute("aria-pressed", String(hideWatched));
  document.getElementById("watchedFilterLabel").textContent = hideWatched ? "Show watched" : "Hide watched";
  transcriptFilter.setAttribute("aria-pressed", String(transcriptsOnly));
  document.getElementById("transcriptFilterLabel").textContent = transcriptsOnly ? "Transcripts only" : "All transcripts";
}

function collectionCount(videos, noun = "videos") {
  const visible = visibleVideos(videos).length;
  const hidden = videos.length - visible;
  return `${visible} ${noun}${hidden ? ` · ${hidden} hidden` : ""}`;
}

function renderCollections() {
  if (playlistVideos.length) {
    renderVideoList(playlistList, playlistVideos);
    const visible = visibleVideos(playlistVideos).length;
    document.getElementById("playlistCount").textContent = collectionCount(playlistVideos);
  }
  if (subscriptionVideos.length) {
    renderVideoList(document.getElementById("subscriptionsList"), subscriptionVideos);
    document.getElementById("subscriptionsCount").textContent = collectionCount(subscriptionVideos, "recent videos");
  }
  if (recommendedShorts.length) {
    renderShorts();
    const visible = visibleVideos(recommendedShorts).length;
    const hidden = recommendedShorts.length - visible;
    document.getElementById("shortsTabCount").textContent = visible;
    document.getElementById("shortsCount").textContent = `${visible} with transcripts${hidden ? ` · ${hidden} hidden` : ""} · ${shortsWithoutTranscripts} filtered out`;
  }
}

function markVideoWatched(videoId) {
  if (!videoId || watchedVideos.has(videoId)) return;
  watchedVideos.add(videoId);
  watchedActivity[videoId] = {
    watchedAt: new Date().toISOString(),
    title: currentVideo?.title || "",
    channel: currentVideo?.channel || ""
  };
  localStorage.setItem("vocatube-watched", JSON.stringify([...watchedVideos]));
  localStorage.setItem("vocatube-watched-activity", JSON.stringify(watchedActivity));
  renderCollections();
  renderHeatmap();
  auth?.syncWatchedToCloud(videoId);
  showToast("Marked as watched");
}

watchedFilter.addEventListener("click", () => {
  hideWatched = !hideWatched;
  localStorage.setItem("vocatube-hide-watched", String(hideWatched));
  updateWatchedFilterUi();
  renderCollections();
});
transcriptFilter.addEventListener("click", () => {
  transcriptsOnly = !transcriptsOnly;
  localStorage.setItem("vocatube-transcripts-only", String(transcriptsOnly));
  recommendedShorts = transcriptsOnly ? allDiscoveredShorts.filter(short => short.hasTranscript) : allDiscoveredShorts;
  updateWatchedFilterUi();
  renderCollections();
});
updateWatchedFilterUi();

function renderVideoList(container, videos) {
  const filtered = visibleVideos(videos);
  container.innerHTML = filtered.length ? filtered.map((video, index) => `
    <button class="playlist-item${video.videoId === currentVideoId ? " active" : ""}${watchedVideos.has(video.videoId) ? " watched" : ""}" type="button" data-video-id="${video.videoId}">
      <span class="playlist-index">${index + 1}</span>
      <span class="playlist-thumb"><img src="${escapeHTML(video.thumbnail)}" alt="" loading="lazy"><span>${escapeHTML(video.duration)}</span></span>
      <span class="playlist-copy"><strong>${escapeHTML(video.title)}</strong><small>${escapeHTML(video.channel)}${video.publishedText ? ` · ${escapeHTML(video.publishedText)}` : ""}</small></span>
    </button>`).join("") : `<div class="playlist-empty">No unwatched videos in this view.</div>`;
}

function selectVideo(video, { autoplay = true } = {}) {
  if (!video || video.videoId === currentVideoId && currentVideo) return;
  currentVideo = video;
  currentVideoId = video.videoId;
  document.getElementById("videoEmpty").hidden = true;
  document.getElementById("videoInfo").hidden = false;
  document.getElementById("videoTitle").textContent = video.title;
  document.getElementById("videoDuration").textContent = video.duration || "Video";
  document.getElementById("player").title = video.title;
  document.querySelectorAll(".playlist-item").forEach(item => item.classList.toggle("active", item.dataset.videoId === video.videoId));
  if (playerReady) {
    if (autoplay) player.loadVideoById(video.videoId);
    else player.cueVideoById(video.videoId);
  } else if (window.YT?.Player) {
    createPlayer(video.videoId, autoplay);
  }
  loadTranscript();
}

function renderSourceSelectors() {
  playlistSourcesElement.innerHTML = [
    `<button class="source-button${activePlaylistId === "all" ? " active" : ""}" type="button" data-playlist-source="all">All</button>`,
    ...playlistSources.map(source => `<button class="source-button${activePlaylistId === source.id ? " active" : ""}" type="button" data-playlist-source="${escapeHTML(source.id)}">${escapeHTML(source.title || source.id)}</button>`)
  ].join("");
  subscriptionSourcesElement.innerHTML = [
    `<button class="source-button${activeSubscriptionHandle === "all" ? " active" : ""}" type="button" data-subscription-source="all">All</button>`,
    ...subscriptionSources.map(source => `<button class="source-button${activeSubscriptionHandle === source.handle ? " active" : ""}" type="button" data-subscription-source="${escapeHTML(source.handle)}">${escapeHTML(source.title || `@${source.handle}`)}</button>`)
  ].join("");
}

function uniqueVideos(videos) {
  return [...new Map(videos.map(video => [video.videoId, video])).values()];
}

function newestFirst(videos) {
  return videos.map((video, index) => ({ video, index })).sort((a, b) => {
    const aTime = Date.parse(a.video.publishedAt || "");
    const bTime = Date.parse(b.video.publishedAt || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(bTime) - Number.isFinite(aTime);
    const sourceOrder = (a.video.sourceIndex ?? a.index) - (b.video.sourceIndex ?? b.index);
    return sourceOrder || a.index - b.index;
  }).map(item => item.video);
}

async function fetchJSON(url) {
  const response = await fetch(apiUrl(url));
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "YouTube request failed");
  return data;
}

function playlistIdFromInput(input) {
  const value = input.trim();
  if (/^[\w-]{10,80}$/.test(value)) return value;
  try { return new URL(value).searchParams.get("list") || ""; } catch { return ""; }
}

function channelHandleFromInput(input) {
  const value = input.trim();
  const direct = value.match(/^@?([\w.-]{3,40})$/)?.[1];
  if (direct) return direct;
  try { return new URL(value).pathname.match(/^\/@([\w.-]{3,40})/)?.[1] || ""; } catch { return ""; }
}

let playlistLoadId = 0;
async function loadPlaylist() {
  const requestId = ++playlistLoadId;
  playlistVideos = [];
  playlistList.innerHTML = `<div class="playlist-empty">Loading ${activePlaylistId === "all" ? "all playlists" : "playlist"}…</div>`;
  const sources = activePlaylistId === "all"
    ? playlistSources
    : playlistSources.filter(source => source.id === activePlaylistId);
  try {
    const results = await Promise.allSettled(sources.map(async source => {
      const data = await fetchJSON(`/api/playlist?list=${encodeURIComponent(source.id)}`);
      source.title = data.title;
      return data.videos.map(video => ({ ...video, playlistId: source.id, playlistTitle: data.title }));
    }));
    if (requestId !== playlistLoadId) return;
    const successful = results.filter(result => result.status === "fulfilled");
    if (!successful.length) throw results[0]?.reason || new Error("No playlists available");
    playlistVideos = newestFirst(uniqueVideos(successful.flatMap(result => result.value)));
    localStorage.setItem("vocatube-playlists", JSON.stringify(playlistSources));
    renderSourceSelectors();
    renderCollections();
    loadShorts();
  } catch (error) {
    if (requestId !== playlistLoadId) return;
    playlistList.innerHTML = `<div class="playlist-empty">${escapeHTML(error.message)}</div>`;
  }
}

let subscriptionLoadId = 0;
async function loadSubscriptions() {
  const requestId = ++subscriptionLoadId;
  const container = document.getElementById("subscriptionsList");
  subscriptionVideos = [];
  container.innerHTML = `<div class="playlist-empty">Loading ${activeSubscriptionHandle === "all" ? "all subscriptions" : "channel videos"}…</div>`;
  const sources = activeSubscriptionHandle === "all"
    ? subscriptionSources
    : subscriptionSources.filter(source => source.handle === activeSubscriptionHandle);
  try {
    const results = await Promise.allSettled(sources.map(async source => {
      const data = await fetchJSON(`/api/channel?handle=${encodeURIComponent(source.handle)}`);
      source.title = data.title;
      source.avatar = data.avatar;
      return data.videos.map(video => ({ ...video, channelHandle: data.handle }));
    }));
    if (requestId !== subscriptionLoadId) return;
    const successful = results.filter(result => result.status === "fulfilled");
    if (!successful.length) throw results[0]?.reason || new Error("No subscriptions available");
    subscriptionVideos = newestFirst(uniqueVideos(successful.flatMap(result => result.value)));
    localStorage.setItem("vocatube-subscriptions", JSON.stringify(subscriptionSources));
    renderSourceSelectors();
    const selected = subscriptionSources.find(source => source.handle === activeSubscriptionHandle);
    document.getElementById("subscriptionAvatar").innerHTML = activeSubscriptionHandle === "all"
      ? "A"
      : (selected?.avatar ? `<img src="${escapeHTML(selected.avatar)}" alt="">` : escapeHTML(selected?.title?.charAt(0).toUpperCase() || "Y"));
    renderCollections();
    loadShorts();
  } catch (error) {
    if (requestId !== subscriptionLoadId) return;
    container.innerHTML = `<div class="playlist-empty">${escapeHTML(error.message)}</div>`;
  }
}

function renderShorts() {
  const container = document.getElementById("shortsList");
  const filtered = visibleVideos(recommendedShorts);
  container.innerHTML = filtered.length ? filtered.map(short => `
    <button class="short-card${watchedVideos.has(short.videoId) ? " watched" : ""}" type="button" data-video-id="${short.videoId}">
      <span class="short-thumb"><img src="${escapeHTML(short.thumbnail)}" alt="" loading="lazy"><span class="short-badge">Short</span></span>
      <strong>${escapeHTML(short.title)}</strong>
      <small>${escapeHTML(short.channel)}${short.views ? ` · ${escapeHTML(short.views)}` : ""}</small>
    </button>`).join("") : `<div class="playlist-empty">No unwatched Shorts in this view.</div>`;
}

let shortsLoadId = 0;
async function loadShorts() {
  const requestId = ++shortsLoadId;
  const container = document.getElementById("shortsList");
  recommendedShorts = [];
  container.innerHTML = `<div class="playlist-empty">Finding Shorts with transcripts…</div>`;
  const subscriptionHandles = (activeSubscriptionHandle === "all"
    ? subscriptionSources
    : subscriptionSources.filter(source => source.handle === activeSubscriptionHandle))
    .map(source => source.handle);
  const playlistHandles = playlistVideos.map(video => video.channelHandle).filter(Boolean);
  const handles = [...new Set([...subscriptionHandles, ...playlistHandles])];
  try {
    const results = await Promise.allSettled(handles.map(handle =>
      fetchJSON(`/api/shorts?handle=${encodeURIComponent(handle)}`)
    ));
    if (requestId !== shortsLoadId) return;
    const successful = results.filter(result => result.status === "fulfilled");
    if (!successful.length) throw results[0]?.reason || new Error("No Shorts available");
    allDiscoveredShorts = uniqueVideos(successful.flatMap(result => result.value.allShorts || result.value.shorts));
    recommendedShorts = transcriptsOnly ? allDiscoveredShorts.filter(short => short.hasTranscript) : allDiscoveredShorts;
    shortsWithoutTranscripts = allDiscoveredShorts.filter(short => !short.hasTranscript).length;
    renderCollections();
  } catch (error) {
    if (requestId !== shortsLoadId) return;
    document.getElementById("shortsCount").textContent = "Unavailable";
    container.innerHTML = `<div class="playlist-empty">${escapeHTML(error.message)}</div>`;
  }
}

playlistSourcesElement.addEventListener("click", event => {
  const button = event.target.closest("[data-playlist-source]");
  if (!button) return;
  activePlaylistId = button.dataset.playlistSource;
  localStorage.setItem("vocatube-active-playlist", activePlaylistId);
  renderSourceSelectors();
  loadPlaylist();
});
subscriptionSourcesElement.addEventListener("click", event => {
  const button = event.target.closest("[data-subscription-source]");
  if (!button) return;
  activeSubscriptionHandle = button.dataset.subscriptionSource;
  localStorage.setItem("vocatube-active-subscription", activeSubscriptionHandle);
  renderSourceSelectors();
  loadSubscriptions();
});
document.getElementById("addPlaylist").addEventListener("click", () => {
  const id = playlistIdFromInput(prompt("Paste a YouTube playlist URL or playlist ID:") || "");
  if (!id) return showToast("Invalid YouTube playlist URL");
  if (!playlistSources.some(source => source.id === id)) playlistSources.push({ id, title: id });
  activePlaylistId = id;
  localStorage.setItem("vocatube-playlists", JSON.stringify(playlistSources));
  localStorage.setItem("vocatube-active-playlist", id);
  renderSourceSelectors();
  loadPlaylist();
});
document.getElementById("addSubscription").addEventListener("click", () => {
  const handle = channelHandleFromInput(prompt("Paste a YouTube channel URL or @handle:") || "");
  if (!handle) return showToast("Use a YouTube @handle channel URL");
  if (!subscriptionSources.some(source => source.handle.toLowerCase() === handle.toLowerCase())) subscriptionSources.push({ handle, title: `@${handle}` });
  activeSubscriptionHandle = subscriptionSources.find(source => source.handle.toLowerCase() === handle.toLowerCase()).handle;
  localStorage.setItem("vocatube-subscriptions", JSON.stringify(subscriptionSources));
  localStorage.setItem("vocatube-active-subscription", activeSubscriptionHandle);
  renderSourceSelectors();
  loadSubscriptions();
});
playlistList.addEventListener("click", event => {
  const item = event.target.closest(".playlist-item");
  if (!item) return;
  selectVideo(playlistVideos.find(video => video.videoId === item.dataset.videoId));
  document.querySelector(".video-shell").scrollIntoView({ behavior: "smooth", block: "center" });
});
document.getElementById("subscriptionsList").addEventListener("click", event => {
  const item = event.target.closest(".playlist-item");
  if (!item) return;
  selectVideo(subscriptionVideos.find(video => video.videoId === item.dataset.videoId));
  document.querySelector(".video-shell").scrollIntoView({ behavior: "smooth", block: "center" });
});
document.getElementById("shortsList").addEventListener("click", event => {
  const card = event.target.closest(".short-card");
  if (!card) return;
  selectVideo(recommendedShorts.find(short => short.videoId === card.dataset.videoId));
  document.querySelector(".video-shell").scrollIntoView({ behavior: "smooth", block: "center" });
});

async function enrichSavedVocabulary() {
  const allItems = [...vocabulary, ...ankiVocabulary];
  const pending = allItems.filter(item => !item.meaning || !item.articleChecked || /(?:participle|form) of\b/i.test(item.meaning));
  if (!pending.length) return;

  // Keep these requests sequential to stay within Wiktionary's API limits.
  for (const item of pending) {
    const originalLemma = item.lemma || item.word;
    const originalKey = ankiKey(item);
    let lemmaChanged = false;
    try {
      const info = await lookupWiktionaryInfo(originalLemma);
      lemmaChanged = info.lemma.toLocaleLowerCase("de") !== originalLemma.toLocaleLowerCase("de");
      item.lemma = info.lemma;
      item.word = info.lemma;
      item.key = info.lemma.toLocaleLowerCase("de");
      item.article = info.article;
      item.articleChecked = true;
      if (lemmaChanged && ankiCards[originalKey] && !ankiCards[item.key]) {
        ankiCards[item.key] = ankiCards[originalKey];
        delete ankiCards[originalKey];
      }
    } catch { /* Retry normalization on a later load. */ }

    if (!item.meaning || lemmaChanged || /(?:participle|form) of\b/i.test(item.meaning)) {
      try { item.meaning = await lookupEnglishMeaning(item.lemma || item.word); } catch { /* Keep saved meaning. */ }
    }
  }

  const uniqueItems = items => [...new Map(items.map(item => [ankiKey(item), item])).values()];
  ankiVocabulary = uniqueItems(ankiVocabulary);
  const permanentKeys = new Set(ankiVocabulary.map(ankiKey));
  vocabulary = uniqueItems(vocabulary).filter(item => !permanentKeys.has(ankiKey(item)));
  localStorage.setItem("vocatube-vocabulary", JSON.stringify(vocabulary));
  localStorage.setItem("vocatube-anki-vocabulary", JSON.stringify(ankiVocabulary));
  saveAnkiCards();
  renderVocabulary();
  auth?.syncToCloud();
  auth?.syncAnkiVocabularyToCloud();
  auth?.syncAnkiToCloud();
}

renderVocabulary();
auth = window.VocaTubeAuth?.createController({
  button: document.getElementById("authButton"),
  getVocabulary: () => vocabulary,
  setVocabulary: items => {
    vocabulary = items;
    saveVocabulary({ sync: false });
  },
  getWatchedVideos: () => [...watchedVideos],
  setWatchedVideos: videoIds => {
    watchedVideos = new Set(videoIds);
    localStorage.setItem("vocatube-watched", JSON.stringify(videoIds));
    renderCollections();
  },
  getWatchedActivity: () => watchedActivity,
  setWatchedActivity: activity => {
    watchedActivity = activity;
    localStorage.setItem("vocatube-watched-activity", JSON.stringify(activity));
    renderHeatmap();
  },
  getAnkiVocabulary: () => ankiVocabulary,
  setAnkiVocabulary: items => {
    ankiVocabulary = items;
    saveAnkiVocabulary({ sync: false });
  },
  getAnkiCards: () => ankiCards,
  setAnkiCards: cards => {
    ankiCards = cards;
    saveAnkiCards();
    renderAnki();
  },
  getAnkiActivity: () => ankiActivity,
  setAnkiActivity: events => {
    ankiActivity = events;
    saveAnkiActivity();
  },
  showToast
});
auth?.initialize();
enrichSavedVocabulary();
list.innerHTML = `<div class="empty">Select a video to load its transcript.</div>`;
document.getElementById("lineCount").textContent = "No video selected";
renderSourceSelectors();
loadPlaylist();
loadSubscriptions();
