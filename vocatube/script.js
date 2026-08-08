const VIDEO_ID = "L0RafOYa8X4";
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
let vocabulary = JSON.parse(localStorage.getItem("vocatube-vocabulary") || "[]");

document.getElementById("lineCount").textContent = "Loading…";

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
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
  } else {
    const frame = document.getElementById("player");
    frame.src = `https://www.youtube.com/embed/L0RafOYa8X4?autoplay=1&start=${Math.floor(start)}&playsinline=1&rel=0`;
  }
}

function saveVocabulary() {
  localStorage.setItem("vocatube-vocabulary", JSON.stringify(vocabulary));
  renderVocabulary();
}

function renderVocabulary() {
  vocabCount.textContent = `${vocabulary.length} ${vocabulary.length === 1 ? "word" : "words"}`;
  document.getElementById("clearVocab").hidden = vocabulary.length === 0;
  vocabList.innerHTML = vocabulary.length
    ? vocabulary.map((item, index) => {
        const lemma = item.lemma || item.word;
        const encountered = item.encounteredAs && item.encounteredAs.toLocaleLowerCase("de") !== lemma.toLocaleLowerCase("de")
          ? `<small class="encountered">← ${escapeHTML(item.encounteredAs)}</small>` : "";
        const meaning = item.meaning ? `<small class="meaning">${escapeHTML(item.meaning)}</small>` : "";
        return `<span class="vocab-item">
          <button class="vocab-word" type="button" data-start="${item.start}" title="Jump to ${formatTime(item.start)}">${escapeHTML(lemma)}${meaning}${encountered}</button>
          <a class="dictionary-link" href="https://en.wiktionary.org/wiki/${encodeURIComponent(lemma)}#German" target="_blank" rel="noreferrer" title="Open English definition in Wiktionary">↗</a>
          <button class="remove-word" type="button" data-remove="${index}" aria-label="Remove ${escapeHTML(lemma)}">×</button>
        </span>`;
      }).join("")
    : `<span class="vocab-empty">Click a transcript word to save it.</span>`;
}

async function lookupWiktionaryLemma(word) {
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
  const wikitext = data.parse?.wikitext?.["*"] || "";
  const lemma = wikitext.match(/\{\{Grundformverweis[^|}]*\|\s*([^|}\n]+)/i)?.[1]
    ?.replace(/\{\{[^}]+\}\}/g, "").trim();
  return lemma || word;
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
  let meaning = "";
  try {
    lemma = await lookupWiktionaryLemma(encounteredAs);
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
  vocabulary.push({
    key,
    lemma,
    word: lemma,
    encounteredAs,
    meaning,
    start: Number(wordElement.dataset.wordStart),
    sentence: segmentElement.querySelector(".text").textContent.trim()
  });
  saveVocabulary();
  showToast(encounteredAs.toLocaleLowerCase("de") === lemma.toLocaleLowerCase("de")
    ? `“${lemma}” added to vocabulary`
    : `“${encounteredAs}” normalized to “${lemma}”`);
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

document.getElementById("clearVocab").addEventListener("click", () => {
  vocabulary = [];
  saveVocabulary();
  showToast("Vocabulary cleared");
});

search.addEventListener("input", () => renderTranscript(search.value));
document.addEventListener("keydown", event => {
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
  link.download = "leipzig-airport-transcript.txt";
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
  player = new YT.Player("player", {
    events: {
      onReady: () => { playerReady = true; },
      onStateChange: event => {
        clearInterval(timer);
        if (event.data === YT.PlayerState.PLAYING) timer = setInterval(syncTranscript, 250);
      },
      onError: () => showToast("YouTube could not play this video. Try ‘Open on YouTube’.")
    }
  });
};

function syncTranscript() {
  if (!playerReady || search.value) return;
  const time = player.getCurrentTime();
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
  renderTranscript();
  const status = document.getElementById("transcriptStatus");
  try {
    const response = await fetch(`/api/transcript?videoId=${VIDEO_ID}&lang=de`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Transcript request failed");
    transcript = data.segments;
    document.querySelector(".transcript-head h2").innerHTML = `${escapeHTML(data.language)} <span>(${data.generated ? "Auto-generated" : "Original"})</span>`;
    status.innerHTML = "<i></i> Transcript ready";
    renderTranscript(search.value);
  } catch (error) {
    status.innerHTML = "<i></i> Transcript unavailable";
    list.innerHTML = `<div class="empty">Could not load the transcript dynamically.<br>${escapeHTML(error.message)}</div>`;
    document.getElementById("lineCount").textContent = "Unavailable";
  }
}

async function enrichSavedVocabulary() {
  const missing = vocabulary.filter(item => !item.meaning);
  if (!missing.length) return;
  await Promise.all(missing.map(async item => {
    try { item.meaning = await lookupEnglishMeaning(item.lemma || item.word); } catch { /* Keep saved word. */ }
  }));
  localStorage.setItem("vocatube-vocabulary", JSON.stringify(vocabulary));
  renderVocabulary();
}

renderVocabulary();
enrichSavedVocabulary();
loadTranscript();
