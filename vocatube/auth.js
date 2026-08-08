(() => {
  function errorMessage(error) {
    const code = String(error?.code || error?.message || "").toLowerCase();
    if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Google sign-in was closed.";
    if (code.includes("popup-blocked")) return "Allow the Google sign-in popup and try again.";
    if (code.includes("unauthorized-domain")) return "Google sign-in is not configured for this domain.";
    if (code.includes("permission-denied")) return "Firestore permission denied.";
    return error?.message || "Google sign-in failed.";
  }

  function createController({ button, getVocabulary, setVocabulary, getWatchedVideos, setWatchedVideos, getWatchedActivity, setWatchedActivity, getAnkiVocabulary, setAnkiVocabulary, getAnkiCards, setAnkiCards, getAnkiActivity, setAnkiActivity, showToast }) {
    const state = { configured: false, busy: false, user: null, auth: null, db: null, provider: null };

    function updateUi() {
      button.disabled = state.busy || !state.configured;
      button.classList.toggle("connected", Boolean(state.user));
      button.textContent = state.busy
        ? (state.user ? "Signing out…" : "Opening…")
        : (state.user ? "Sign out" : (state.configured ? "Sign in" : "Sync unavailable"));
      const identity = state.user?.displayName || state.user?.email;
      button.title = identity ? `Signed in as ${identity}` : "Sign in with Google to sync vocabulary and watch history";
      button.setAttribute("aria-label", button.title);
    }

    function syncDocRef(name) {
      return state.db.collection("users").doc(state.user.uid).collection("sync").doc(name);
    }

    function vocabularyRef() {
      return syncDocRef("vocatubeVocabulary");
    }

    function watchedRef() {
      return syncDocRef("vocatubeWatched");
    }

    function ankiRef() {
      return syncDocRef("vocatubeAnki");
    }

    function ankiVocabularyRef() {
      return syncDocRef("vocatubeAnkiVocabulary");
    }

    function ankiActivityRef() {
      return syncDocRef("vocatubeAnkiActivity");
    }

    function normalize(items) {
      if (!Array.isArray(items)) return [];
      const unique = new Map();
      items.forEach(item => {
        if (!item || typeof item !== "object") return;
        const label = String(item.lemma || item.word || "").trim();
        if (!label) return;
        unique.set(label.toLocaleLowerCase("de"), { ...item, key: label.toLocaleLowerCase("de") });
      });
      return [...unique.values()];
    }

    function normalizeVideoIds(items) {
      return [...new Set((Array.isArray(items) ? items : []).filter(id => /^[\w-]{11}$/.test(id)))];
    }

    function normalizeAnkiCards(cards) {
      if (!cards || typeof cards !== "object" || Array.isArray(cards)) return {};
      return Object.fromEntries(Object.entries(cards).filter(([, value]) =>
        value?.card && Number.isFinite(Date.parse(value.card.due))
      ));
    }

    function normalizeWatchedActivity(activity) {
      if (!activity || typeof activity !== "object" || Array.isArray(activity)) return {};
      return Object.fromEntries(Object.entries(activity).filter(([videoId, event]) =>
        /^[\w-]{11}$/.test(videoId) && event && Number.isFinite(Date.parse(event.watchedAt))
      ));
    }

    function normalizeAnkiActivity(events) {
      if (!events || typeof events !== "object" || Array.isArray(events)) return {};
      return Object.fromEntries(Object.entries(events).filter(([, event]) =>
        event && Number.isFinite(Date.parse(event.reviewedAt))
      ));
    }

    function mergeAnkiCards(remote, local) {
      const merged = { ...normalizeAnkiCards(remote) };
      for (const [key, value] of Object.entries(normalizeAnkiCards(local))) {
        const remoteTime = Date.parse(merged[key]?.updatedAt || "");
        const localTime = Date.parse(value.updatedAt || "");
        if (!merged[key] || !Number.isFinite(remoteTime) || localTime >= remoteTime) merged[key] = value;
      }
      return merged;
    }

    async function syncFromCloud() {
      const [vocabularySnapshot, watchedSnapshot, ankiVocabularySnapshot, ankiSnapshot, ankiActivitySnapshot] = await Promise.all([
        vocabularyRef().get(),
        watchedRef().get(),
        ankiVocabularyRef().get(),
        ankiRef().get(),
        ankiActivityRef().get()
      ]);
      const remoteVocabulary = normalize(vocabularySnapshot.exists ? vocabularySnapshot.data()?.vocabulary : []);
      const remoteWatched = normalizeVideoIds(watchedSnapshot.exists ? watchedSnapshot.data()?.videoIds : []);
      const mergedWatched = normalizeVideoIds([...remoteWatched, ...getWatchedVideos()]);
      const mergedWatchedActivity = {
        ...normalizeWatchedActivity(watchedSnapshot.exists ? watchedSnapshot.data()?.activity : {}),
        ...normalizeWatchedActivity(getWatchedActivity())
      };
      const remoteAnkiVocabulary = normalize(ankiVocabularySnapshot.exists ? ankiVocabularySnapshot.data()?.vocabulary : []);
      const mergedAnkiVocabulary = normalize([...remoteAnkiVocabulary, ...getAnkiVocabulary()]);
      const permanentKeys = new Set(mergedAnkiVocabulary.map(item => String(item.lemma || item.word).toLocaleLowerCase("de")));
      const mergedVocabulary = normalize([...remoteVocabulary, ...getVocabulary()])
        .filter(item => !permanentKeys.has(String(item.lemma || item.word).toLocaleLowerCase("de")));
      const mergedAnki = mergeAnkiCards(ankiSnapshot.exists ? ankiSnapshot.data()?.cards : {}, getAnkiCards());
      const mergedAnkiActivity = {
        ...normalizeAnkiActivity(ankiActivitySnapshot.exists ? ankiActivitySnapshot.data()?.events : {}),
        ...normalizeAnkiActivity(getAnkiActivity())
      };
      setVocabulary(mergedVocabulary);
      setWatchedVideos(mergedWatched);
      setWatchedActivity(mergedWatchedActivity);
      setAnkiVocabulary(mergedAnkiVocabulary);
      setAnkiCards(mergedAnki);
      setAnkiActivity(mergedAnkiActivity);
      const updatedAt = new Date().toISOString();
      await Promise.all([
        vocabularyRef().set({ vocabulary: mergedVocabulary, updatedAt }),
        watchedRef().set({ videoIds: mergedWatched, activity: mergedWatchedActivity, updatedAt }),
        ankiVocabularyRef().set({ vocabulary: mergedAnkiVocabulary, updatedAt }),
        ankiRef().set({ cards: mergedAnki, updatedAt }),
        ankiActivityRef().set({ events: mergedAnkiActivity, updatedAt })
      ]);
      showToast(`Cloud synced · ${mergedWatched.length} watched · Anki updated`);
    }

    async function syncToCloud() {
      if (!state.user || !state.db) return false;
      try {
        await vocabularyRef().set({
          vocabulary: normalize(getVocabulary()),
          updatedAt: new Date().toISOString()
        });
        return true;
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
        return false;
      }
    }

    async function syncWatchedToCloud(videoId) {
      if (!state.user || !state.db) return false;
      try {
        const localVideoIds = normalizeVideoIds(getWatchedVideos());
        const localActivity = normalizeWatchedActivity(getWatchedActivity());
        await state.db.runTransaction(async transaction => {
          const snapshot = await transaction.get(watchedRef());
          const remoteVideoIds = normalizeVideoIds(snapshot.exists ? snapshot.data()?.videoIds : []);
          const remoteActivity = normalizeWatchedActivity(snapshot.exists ? snapshot.data()?.activity : {});
          transaction.set(watchedRef(), {
            videoIds: normalizeVideoIds([...remoteVideoIds, ...localVideoIds]),
            activity: { ...remoteActivity, ...localActivity },
            updatedAt: new Date().toISOString()
          });
        });
        return true;
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
        return false;
      }
    }

    async function syncAnkiVocabularyToCloud() {
      if (!state.user || !state.db) return false;
      try {
        await ankiVocabularyRef().set({
          vocabulary: normalize(getAnkiVocabulary()),
          updatedAt: new Date().toISOString()
        });
        return true;
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
        return false;
      }
    }

    async function syncAnkiActivityToCloud(changedId) {
      if (!state.user || !state.db) return false;
      try {
        const localEvents = normalizeAnkiActivity(getAnkiActivity());
        await state.db.runTransaction(async transaction => {
          const snapshot = await transaction.get(ankiActivityRef());
          const remoteEvents = normalizeAnkiActivity(snapshot.exists ? snapshot.data()?.events : {});
          let events;
          if (changedId) {
            events = { ...remoteEvents };
            if (localEvents[changedId]) events[changedId] = localEvents[changedId];
            else delete events[changedId];
          } else {
            events = { ...remoteEvents, ...localEvents };
          }
          transaction.set(ankiActivityRef(), { events, updatedAt: new Date().toISOString() });
        });
        return true;
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
        return false;
      }
    }

    async function syncAnkiToCloud(changedKey) {
      if (!state.user || !state.db) return false;
      try {
        const localCards = normalizeAnkiCards(getAnkiCards());
        await state.db.runTransaction(async transaction => {
          const snapshot = await transaction.get(ankiRef());
          const remoteCards = normalizeAnkiCards(snapshot.exists ? snapshot.data()?.cards : {});
          let cards;
          if (changedKey) {
            cards = { ...remoteCards };
            if (localCards[changedKey]) cards[changedKey] = localCards[changedKey];
            else delete cards[changedKey];
          } else {
            cards = mergeAnkiCards(remoteCards, localCards);
          }
          transaction.set(ankiRef(), { cards, updatedAt: new Date().toISOString() });
        });
        return true;
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
        return false;
      }
    }

    async function toggleSignIn() {
      if (!state.configured || state.busy) return;
      state.busy = true;
      updateUi();
      try {
        if (state.user) {
          await state.auth.signOut();
          showToast("Signed out. Local vocabulary and watch history remain saved.");
        } else {
          const result = await state.auth.signInWithPopup(state.provider);
          state.user = result.user;
          await syncFromCloud();
        }
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
      } finally {
        state.busy = false;
        updateUi();
      }
    }

    function initialize() {
      const config = window.VOCATUBE_GOOGLE_CONFIG?.firebaseConfig;
      if (!config?.apiKey || !config?.authDomain || !config?.projectId || !window.firebase?.auth || !window.firebase?.firestore) {
        updateUi();
        return;
      }
      try {
        const app = window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(config);
        state.auth = window.firebase.auth(app);
        state.db = window.firebase.firestore(app);
        state.provider = new window.firebase.auth.GoogleAuthProvider();
        state.provider.addScope("profile");
        state.provider.addScope("email");
        state.provider.setCustomParameters({ prompt: "select_account" });
        state.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
        state.configured = true;
        button.addEventListener("click", toggleSignIn);
        state.auth.onAuthStateChanged(async user => {
          const wasSignedIn = Boolean(state.user);
          state.user = user;
          updateUi();
          if (user && !wasSignedIn) {
            try { await syncFromCloud(); } catch (error) {
              console.error(error);
              showToast(errorMessage(error));
            }
          }
        });
      } catch (error) {
        console.error(error);
        showToast(errorMessage(error));
      }
      updateUi();
    }

    return { initialize, syncToCloud, syncWatchedToCloud, syncAnkiVocabularyToCloud, syncAnkiToCloud, syncAnkiActivityToCloud, isSignedIn: () => Boolean(state.user) };
  }

  window.VocaTubeAuth = { createController };
})();
