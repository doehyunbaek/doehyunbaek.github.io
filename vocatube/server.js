import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT) || 8000;
const root = process.cwd();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

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
    const rawWords = [...paragraph[2].matchAll(/<s\b([^>]*)>([\s\S]*?)<\/s>/g)].map(match => ({
      offset: Number(match[1].match(/\bt="(\d+)"/)?.[1] || 0),
      text: decodeXml(match[2].replace(/<[^>]+>/g, "")).trim()
    })).filter(word => word.text);

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

  for (const word of words) {
    sentenceWords.push(word);
    if (/[.!?][”"'»)]*$/.test(word.text)) finishSentence();
  }
  finishSentence();
  return sentences;
}

async function fetchTranscript(videoId, preferredLanguage = "de") {
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

function sendJSON(response, status, value) {
  response.writeHead(status, { "Content-Type": mimeTypes[".json"], "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/transcript") {
      const videoId = url.searchParams.get("videoId");
      if (!/^[\w-]{11}$/.test(videoId || "")) return sendJSON(response, 400, { error: "Invalid video ID" });
      try {
        return sendJSON(response, 200, await fetchTranscript(videoId, url.searchParams.get("lang") || "de"));
      } catch (error) {
        console.error("Transcript fetch failed:", error.message);
        return sendJSON(response, 502, { error: error.message });
      }
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(root, requested));
    if (!filePath.startsWith(root)) return sendJSON(response, 403, { error: "Forbidden" });
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not found");
    const data = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, () => console.log(`VocaTube is running at http://localhost:${port}`));
