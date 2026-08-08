async function youtubeJSON(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": "Mozilla/5.0", ...options?.headers }
  });
  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  return response.json();
}

function decodeXml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function roundSeconds(value) {
  return Math.round(value * 1000) / 1000;
}

function parseSrv3Words(xml) {
  const words = [];
  for (const paragraph of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const paragraphStart = Number(paragraph[1].match(/\bt="(\d+)"/)?.[1] || 0);
    const paragraphDuration = Number(paragraph[1].match(/\bd="(\d+)"/)?.[1] || 0);
    let rawWords = [...paragraph[2].matchAll(/<s\b([^>]*)>([\s\S]*?)<\/s>/g)].map(match => ({
      offset: Number(match[1].match(/\bt="(\d+)"/)?.[1] || 0),
      text: decodeXml(match[2].replace(/<[^>]+>/g, "")).trim()
    })).filter(word => word.text);

    // Manually authored captions often contain plain paragraph text instead
    // of timed <s> nodes. Estimate word offsets across the cue in that case.
    if (!rawWords.length) {
      const tokens = decodeXml(paragraph[2].replace(/<[^>]+>/g, " "))
        .split(/\s+/).filter(Boolean);
      const interval = paragraphDuration / Math.max(tokens.length, 1);
      rawWords = tokens.map((text, index) => ({ offset: Math.round(index * interval), text }));
    }

    rawWords.forEach((word, index) => {
      const nextOffset = rawWords[index + 1]?.offset ?? paragraphDuration;
      words.push({
        start: roundSeconds((paragraphStart + word.offset) / 1000),
        duration: roundSeconds(Math.max(0, nextOffset - word.offset) / 1000),
        text: word.text
      });
    });
  }
  // Rolling ASR cues overlap, so a paragraph's duration is not a reliable
  // duration for its final word. The next absolute word start is more precise.
  words.forEach((word, index) => {
    const next = words[index + 1];
    if (next && next.start > word.start) word.duration = roundSeconds(next.start - word.start);
  });
  return words;
}

const germanMonths = new Set([
  "januar", "februar", "märz", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "dezember"
]);

const germanNonFinalAbbreviations = new Set([
  "bzw.", "ca.", "d.h.", "dr.", "etc.", "inkl.", "max.", "min.",
  "nr.", "prof.", "sog.", "u.a.", "u.s.w.", "usw.", "vgl.", "z.b."
]);

function nextSpokenWord(words, index) {
  return words.slice(index + 1).find(word => !/^\[[^\]]+\]$/.test(word.text.trim()));
}

function isSentenceBoundary(words, index) {
  const text = words[index].text.trim();
  if (/[!?][”"'»)]*$/.test(text)) return true;
  if (!/\.[”"'»)]*$/.test(text)) return false;

  const normalized = text.replace(/[”"'»)]+$/g, "").toLocaleLowerCase("de");
  const next = nextSpokenWord(words, index)?.text
    .replace(/^[„“”"'«»([]+|[.,!?;:„“”"'«»)\]]+$/g, "")
    .toLocaleLowerCase("de");

  // German ordinal dates use a period: "Am 30. Juni …". Caption cues can
  // occur between the ordinal and month, so look ahead to the next spoken word.
  if (/^\d+\.$/.test(normalized) && germanMonths.has(next)) return false;
  if (germanNonFinalAbbreviations.has(normalized)) return false;
  if (/^[a-zäöü]\.$/i.test(normalized) && next) return false;
  return true;
}

function groupWordsIntoSentences(words) {
  const sentences = [];
  let sentenceWords = [];
  const finishSentence = () => {
    if (!sentenceWords.length) return;
    const start = sentenceWords[0].start;
    const last = sentenceWords.at(-1);
    sentences.push({
      start,
      duration: roundSeconds(Math.max(0, last.start + last.duration - start)),
      text: sentenceWords.map(word => word.text).join(" "),
      words: sentenceWords
    });
    sentenceWords = [];
  };

  words.forEach((word, index) => {
    sentenceWords.push(word);
    if (isSentenceBoundary(words, index)) finishSentence();
  });
  finishSentence();
  return sentences;
}

function findObjects(value, key, results = []) {
  if (!value || typeof value !== "object") return results;
  if (value[key]) results.push(value[key]);
  for (const child of Object.values(value)) findObjects(child, key, results);
  return results;
}

function parseInitialData(html) {
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Could not find YouTube playlist data");
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf(";</script>", jsonStart);
  if (jsonEnd < 0) throw new Error("Could not parse YouTube playlist data");
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

function textContent(value) {
  return value?.content || value?.simpleText || value?.runs?.map(run => run.text).join("") || "";
}

function relativeDateToISOString(value) {
  const text = String(value || "").toLowerCase();
  const match = text.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return "";
  const amount = Number(match[1]);
  const multipliers = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30.44 * 24 * 60 * 60 * 1000,
    year: 365.25 * 24 * 60 * 60 * 1000
  };
  return new Date(Date.now() - amount * multipliers[match[2]]).toISOString();
}

function extractPlaylistVideos(data, seen) {
  return findObjects(data, "lockupViewModel").flatMap(lockup => {
    const videoId = lockup.contentId;
    const detail = lockup.metadata?.lockupMetadataViewModel;
    if (!/^[\w-]{11}$/.test(videoId || "") || !detail || seen.has(videoId)) return [];
    seen.add(videoId);
    const rows = detail.metadata?.contentMetadataViewModel?.metadataRows || [];
    const metadataTexts = rows.flatMap(row => row.metadataParts || []).map(part => textContent(part.text)).filter(Boolean);
    const channelText = rows[0]?.metadataParts?.[0]?.text;
    const channel = textContent(channelText);
    const channelPath = channelText?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.canonicalBaseUrl
      || channelText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
      || "";
    const channelHandle = channelPath.match(/^\/@([\w.-]+)/)?.[1] || "";
    const publishedText = metadataTexts.find(text => /\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago/i.test(text)) || "";
    const durationBadge = lockup.contentImage?.thumbnailViewModel?.overlays
      ?.flatMap(overlay => overlay.thumbnailBottomOverlayViewModel?.badges || [])
      .map(badge => badge.thumbnailBadgeViewModel?.text).find(Boolean) || "";
    const thumbnails = lockup.contentImage?.thumbnailViewModel?.image?.sources || [];
    return [{
      videoId,
      title: textContent(detail.title),
      channel,
      channelHandle,
      publishedText,
      publishedAt: relativeDateToISOString(publishedText),
      duration: durationBadge,
      thumbnail: thumbnails.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    }];
  });
}

function extractContinuationTokens(data) {
  return [
    ...findObjects(data, "continuationItemViewModel")
      .map(item => item.continuationCommand?.innertubeCommand?.continuationCommand?.token),
    ...findObjects(data, "continuationItemRenderer")
      .map(item => item.continuationEndpoint?.continuationCommand?.token)
  ].filter(Boolean);
}

export async function fetchPlaylist(playlistId) {
  const playlistResponse = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" }
  });
  if (!playlistResponse.ok) throw new Error(`YouTube playlist returned ${playlistResponse.status}`);
  const html = await playlistResponse.text();
  const data = parseInitialData(html);
  const metadata = data.metadata?.playlistMetadataRenderer || {};
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  const seenVideos = new Set();
  const seenTokens = new Set();
  const videos = extractPlaylistVideos(data, seenVideos);
  const tokenQueue = extractContinuationTokens(data);

  // YouTube sends playlist items in batches of 100. Follow every unseen browse
  // continuation; the page can also contain unrelated, empty continuations.
  while (apiKey && clientVersion && tokenQueue.length && seenTokens.size < 50) {
    const token = tokenQueue.shift();
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);
    const continuationData = await youtubeJSON(
      `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion } },
          continuation: token
        })
      }
    );
    videos.push(...extractPlaylistVideos(continuationData, seenVideos));
    tokenQueue.push(...extractContinuationTokens(continuationData));
  }

  if (!videos.length) throw new Error("This playlist has no available videos");
  return { playlistId, title: metadata.title || "YouTube playlist", description: metadata.description || "", videos };
}

export async function fetchChannelVideos(handle) {
  const channelResponse = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}/videos`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" }
  });
  if (!channelResponse.ok) throw new Error(`YouTube channel returned ${channelResponse.status}`);
  const data = parseInitialData(await channelResponse.text());
  const metadata = data.metadata?.channelMetadataRenderer || {};
  const videos = extractPlaylistVideos(data, new Set())
    .map((video, sourceIndex) => ({ ...video, channel: metadata.title || `@${handle}`, sourceIndex }));
  if (!videos.length) throw new Error("This channel has no available videos");
  return {
    handle,
    channelId: metadata.externalId || "",
    title: metadata.title || `@${handle}`,
    description: metadata.description || "",
    avatar: metadata.avatar?.thumbnails?.at(-1)?.url || "",
    videos
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function fetchChannelShorts(handle) {
  const channelResponse = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}/shorts`, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" }
  });
  if (!channelResponse.ok) throw new Error(`YouTube Shorts returned ${channelResponse.status}`);
  const html = await channelResponse.text();
  const data = parseInitialData(html);
  const metadata = data.metadata?.channelMetadataRenderer || {};
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  if (!apiKey) throw new Error("Could not discover YouTube's player API key");
  const seen = new Set();
  const candidates = findObjects(data, "shortsLockupViewModel").flatMap(short => {
    const endpoint = short.onTap?.innertubeCommand?.reelWatchEndpoint;
    const videoId = endpoint?.videoId;
    if (!/^[\w-]{11}$/.test(videoId || "") || seen.has(videoId)) return [];
    seen.add(videoId);
    const sources = short.thumbnailViewModel?.image?.sources || endpoint?.thumbnail?.thumbnails || [];
    return [{
      videoId,
      title: textContent(short.overlayMetadata?.primaryText) || short.accessibilityText || "YouTube Short",
      channel: metadata.title || `@${handle}`,
      channelHandle: handle,
      views: textContent(short.overlayMetadata?.secondaryText),
      duration: "Short",
      thumbnail: sources.at(-1)?.url || `https://i.ytimg.com/vi/${videoId}/frame0.jpg`,
      isShort: true
    }];
  });

  const checked = await mapWithConcurrency(candidates, 8, async short => {
    try {
      const playerData = await youtubeJSON(
        `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
            videoId: short.videoId
          })
        }
      );
      const tracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      return { ...short, transcriptLanguages: tracks.map(track => track.languageCode), hasTranscript: tracks.length > 0 };
    } catch (error) {
      console.warn(`Caption check failed for ${short.videoId}:`, error.message);
      return { ...short, transcriptLanguages: [], hasTranscript: false, transcriptCheckFailed: true };
    }
  });
  const shorts = checked.filter(short => short.hasTranscript);
  if (!checked.length) throw new Error("This channel has no available Shorts");
  return {
    handle,
    title: metadata.title || `@${handle}`,
    candidates: candidates.length,
    filteredOut: candidates.length - shorts.length,
    allShorts: checked,
    shorts
  };
}

export async function fetchTranscript(videoId, preferredLanguage = "de") {
  // This mirrors youtube-transcript-api's discovery flow: find the current
  // Innertube key, query player metadata, select a track, then fetch captions.
  const watchResponse = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!watchResponse.ok) throw new Error(`YouTube watch page returned ${watchResponse.status}`);
  const html = await watchResponse.text();
  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([\w-]+)"/)?.[1];
  if (!apiKey) throw new Error("Could not discover YouTube's player API key");

  const playerData = await youtubeJSON(
    `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
        videoId
      })
    }
  );

  if (playerData.playabilityStatus?.status !== "OK") {
    throw new Error(playerData.playabilityStatus?.reason || "Video is not playable");
  }

  const renderer = playerData.captions?.playerCaptionsTracklistRenderer;
  const tracks = renderer?.captionTracks || [];
  if (!tracks.length) throw new Error("This video has no transcript");
  const track = tracks.find(item => item.languageCode === preferredLanguage) || tracks[0];
  const captionUrl = new URL(track.baseUrl);
  captionUrl.searchParams.set("fmt", "srv3");
  const captionResponse = await fetch(captionUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!captionResponse.ok) throw new Error(`YouTube captions returned ${captionResponse.status}`);
  const captionXml = await captionResponse.text();
  const words = parseSrv3Words(captionXml);
  const segments = groupWordsIntoSentences(words);

  return {
    videoId,
    language: track.name?.simpleText || track.name?.runs?.map(run => run.text).join("") || track.languageCode,
    languageCode: track.languageCode,
    generated: track.kind === "asr",
    words,
    segments
  };
}

