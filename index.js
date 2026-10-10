import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const MODEL_FALLBACKS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.6-flash"];

const TONE_PARAMETERS = {
  santai: { temperature: 0.9, topP: 0.95, topK: 40 },
  formal: { temperature: 0.3, topP: 0.8, topK: 20 },
};

const CITY_ALIASES = [
  ["labuan bajo", "Labuan Bajo"],
  ["raja ampat", "Raja Ampat"],
  ["yogyakarta", "Yogyakarta"],
  ["jogja", "Yogyakarta"],
  ["yogya", "Yogyakarta"],
  ["jakarta", "Jakarta"],
  ["bandung", "Bandung"],
  ["surabaya", "Surabaya"],
  ["denpasar", "Denpasar"],
  ["ubud", "Ubud"],
  ["bali", "Bali"],
  ["semarang", "Semarang"],
  ["medan", "Medan"],
  ["makassar", "Makassar"],
  ["malang", "Malang"],
  ["solo", "Solo"],
  ["surakarta", "Surakarta"],
  ["bogor", "Bogor"],
  ["lombok", "Lombok"],
  ["mataram", "Mataram"],
  ["manado", "Manado"],
  ["batam", "Batam"],
  ["padang", "Padang"],
  ["palembang", "Palembang"],
  ["balikpapan", "Balikpapan"],
  ["pontianak", "Pontianak"],
  ["banjarmasin", "Banjarmasin"],
  ["jayapura", "Jayapura"],
  ["ambon", "Ambon"],
  ["kupang", "Kupang"],
  ["cirebon", "Cirebon"],
  ["pangandaran", "Pangandaran"],
  ["belitung", "Belitung"],
  ["kuta", "Kuta"],
];

const PLACE_STOP_WORDS = new Set([
  "yang", "lebih", "hemat", "murah", "mahal", "santai", "formal",
  "indoor", "outdoor", "hujan", "panas", "kopi", "makan", "aku", "saya",
]);

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY belum diisi di file .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function clip(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function findAlias(text) {
  const source = text.toLowerCase();
  const sorted = [...CITY_ALIASES].sort((a, b) => b[0].length - a[0].length);
  for (const [alias, canonical] of sorted) {
    const pattern = new RegExp(`(^|[^a-z])${alias.replace(/\s+/g, "\\s+")}([^a-z]|$)`, "i");
    if (pattern.test(source)) return canonical;
  }
  return "";
}

function extractPlacePhrase(text) {
  const match = text.match(/\b(?:di|ke|dari)\s+([^,.!?]{2,40})/i);
  if (!match) return "";
  return match[1].trim();
}

function phraseLooksLikeCity(phrase) {
  const words = phrase.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  return words.every((word) => !PLACE_STOP_WORDS.has(word.toLowerCase()));
}

async function geocode(name) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", name);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "id");
  url.searchParams.set("format", "json");

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const place = data.results?.[0];
      if (!place || (place.country_code && place.country_code !== "ID")) return null;
      return place;
    } catch (error) {
      lastError = error;
    }
  }

  console.error("Geocoding gagal:", lastError?.message || lastError);
  return null;
}

function weatherLabel(code) {
  const labels = {
    0: "cerah",
    1: "cerah berawan",
    2: "berawan sebagian",
    3: "mendung",
    45: "berkabut",
    48: "berkabut",
    51: "gerimis",
    53: "gerimis",
    55: "gerimis lebat",
    61: "hujan ringan",
    63: "hujan",
    65: "hujan lebat",
    80: "hujan singkat",
    81: "hujan singkat",
    82: "hujan singkat lebat",
    95: "badai petir",
  };
  return labels[code] || "berubah-ubah";
}

async function fetchWeather(city) {
  try {
    const place = await geocode(city);
    if (!place) return null;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "1");

    let data = null;
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!data) {
      console.error("Prakiraan cuaca gagal:", lastError?.message || lastError);
      return null;
    }
    const code = data.current?.weather_code;
    const rainChance = data.daily?.precipitation_probability_max?.[0];
    const condition = weatherLabel(code);
    const rainy = (typeof rainChance === "number" && rainChance >= 50) || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(code);

    return {
      city: place.name || city,
      region: place.admin1 || "",
      temperature: Math.round(data.current?.temperature_2m),
      condition,
      rainChance: typeof rainChance === "number" ? rainChance : null,
      tempMin: Math.round(data.daily?.temperature_2m_min?.[0]),
      tempMax: Math.round(data.daily?.temperature_2m_max?.[0]),
      advice: rainy
        ? "Peluang hujan cukup tinggi. Utamakan aktivitas teduh atau indoor, terutama siang hari."
        : "Cuaca mendukung aktivitas luar ruangan, dengan jeda berteduh di siang hari.",
    };
  } catch (error) {
    console.error("Cuaca tidak tersedia:", error.message);
    return null;
  }
}

async function resolveCity(text, currentCity) {
  const alias = findAlias(text);
  if (alias) return alias;

  const phrase = extractPlacePhrase(text);
  if (phrase && phraseLooksLikeCity(phrase)) {
    try {
      const place = await geocode(phrase);
      if (place?.name) return place.name;
    } catch (error) {
      console.error("Geocoding gagal:", error.message);
    }
  }

  return currentCity || "";
}

function normalizeConversation(conversation) {
  if (!Array.isArray(conversation)) return [];
  const contents = [];

  for (const message of conversation.slice(-20)) {
    const role = message?.role === "model" ? "model" : message?.role === "user" ? "user" : "";
    const text = clip(message?.text, 2000);
    if (!role || !text) continue;

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  while (contents[0]?.role === "model") contents.shift();
  return contents;
}

function taskKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function uniqueSlots(slots) {
  const seenPlaces = new Set();
  const seenActivities = new Set();
  return slots.filter((slot) => {
    const place = taskKey(slot.place);
    const activity = taskKey(slot.activity);
    if (!activity) return false;
    if ((place && seenPlaces.has(place)) || seenActivities.has(activity)) return false;
    if (place) seenPlaces.add(place);
    seenActivities.add(activity);
    return true;
  });
}

function buildInstruction(tone, profile, weather, name) {
  const style = tone === "formal"
    ? "Gunakan bahasa Indonesia formal, sopan, dan ringkas. Jangan memakai slang atau sapaan kasual."
    : "Gunakan bahasa Indonesia santai seperti teman perjalanan. Ringan dan jelas, tanpa berlebihan.";

  const weatherText = weather
    ? JSON.stringify(weather)
    : "tidak ada. Jangan mengarang suhu, hujan, atau kondisi langit.";
  const nameLine = name
    ? `Nama pengguna adalah ${name}. Sapa nama itu sekali di awal reply.`
    : "Pengguna belum memberi nama. Jangan mengarang nama.";

  return `Kamu adalah Teman Rencana, asisten wisata harian untuk kota di Indonesia.
${nameLine}
Tugasmu menyusun rekomendasi jalan-jalan 1 hari sesuai kota, budget, dan selera pengguna.
${style}
Contoh santai: "Gas, Bandung hari ini adem. Aku taruh ngopi dulu biar siang tidak kepanasan."
Contoh formal: "Baik, saya susun rencana di Bandung sesuai anggaran tersebut. Pagi cocok untuk berjalan kaki."
Ikuti gaya yang sedang aktif. Jangan mencampur keduanya.
Batasan:
- Jawab dalam Bahasa Indonesia.
- Tetap pada wisata, kuliner, dan aktivitas santai di Indonesia.
- Jika pengguna bertanya di luar itu, arahkan kembali ke rencana jalan-jalan.
- Jangan memberi nasihat medis, hukum, atau keuangan.
- Jangan mengarang data cuaca. Gunakan hanya data berikut: ${weatherText}
Profil yang sudah diingat: ${JSON.stringify(profile)}
Perbarui city, budget, dan preference dari percakapan. Gabungkan selera lama yang masih relevan, jangan dihapus.
Jika kota atau budget belum ada, itinerary harus null dan reply hanya menanyakan yang kurang.
Jika keduanya ada, buat itinerary 1 hari dengan tepat 3 slot: Pagi, Siang, dan Sore.
Aktivitas Pagi hanya untuk pagi, Siang hanya untuk siang, Sore hanya untuk sore. Jangan menaruh kata "sore" di slot Siang.
Setiap tempat dan setiap aktivitas harus unik. Jangan mengulang tugas yang sama di slot lain.
Total perkiraan biaya tidak boleh melebihi budget.
reply 2 sampai 4 kalimat dan tidak mengulang seluruh jadwal, karena jadwal tampil di kartu.
Balas hanya JSON valid tanpa markdown dengan bentuk:
{"reply":"...","profile":{"city":"...","budget":"...","preference":"..."},"itinerary":null}
atau itinerary berupa
{"title":"...","city":"...","summary":"...","estimatedCost":"Rp...","weatherNote":"...","slots":[{"time":"Pagi","activity":"...","place":"...","cost":"Rp..."},{"time":"Siang","activity":"...","place":"...","cost":"Rp..."},{"time":"Sore","activity":"...","place":"...","cost":"Rp..."}]}`;
}

function parseModelJson(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Respons Gemini bukan JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

function sanitizeItinerary(value, profile) {
  if (!value || typeof value !== "object" || !profile.city || !profile.budget) return null;
  const times = ["Pagi", "Siang", "Sore"];
  const slots = (Array.isArray(value.slots) ? value.slots : []).slice(0, 3).map((slot, index) => ({
    time: times[index],
    activity: clip(slot?.activity, 180),
    place: clip(slot?.place, 80),
    cost: clip(slot?.cost, 40),
  }));
  const unique = uniqueSlots(slots);

  if (!unique.length) return null;

  return {
    title: clip(value.title, 80) || `Sehari di ${profile.city}`,
    city: profile.city,
    summary: clip(value.summary, 280),
    estimatedCost: clip(value.estimatedCost, 40),
    weatherNote: clip(value.weatherNote, 180),
    slots: unique,
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateReply(contents, instruction, parameters) {
  const models = [MODEL, ...MODEL_FALLBACKS.filter((name) => name !== MODEL)];
  let lastError;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: instruction,
            temperature: parameters.temperature,
            topP: parameters.topP,
            topK: parameters.topK,
            maxOutputTokens: 1400,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        });
        return { text: response.text, model };
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error);
        const missing = /404|NOT_FOUND|no longer available/.test(message);
        const retryable = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(message);
        if (missing || !retryable || attempt === 2) break;
        await wait(800);
      }
    }
  }

  throw lastError;
}

function mergeProfile(previous, incoming, detectedCity) {
  const base = {
    city: clip(previous?.city, 80),
    budget: clip(previous?.budget, 80),
    preference: clip(previous?.preference, 160),
  };
  const next = {
    city: clip(incoming?.city, 80) || base.city,
    budget: clip(incoming?.budget, 80) || base.budget,
    preference: clip(incoming?.preference, 160) || base.preference,
  };
  if (detectedCity) next.city = clip(detectedCity, 80);
  return next;
}

app.post("/api/chat", async (req, res) => {
  try {
    const contents = normalizeConversation(req.body?.conversation);
    if (!contents.length) {
      return res.status(400).json({ error: "conversation harus berupa array pesan." });
    }

    const tone = req.body?.tone === "formal" ? "formal" : "santai";
    const parameters = TONE_PARAMETERS[tone];
    const latestUser = [...contents].reverse().find((item) => item.role === "user");
    const detectedCity = await resolveCity(latestUser?.parts?.[0]?.text || "", clip(req.body?.profile?.city, 80));
    const priorProfile = mergeProfile(req.body?.profile, {}, detectedCity);
    const weather = priorProfile.city ? await fetchWeather(priorProfile.city) : null;

    const name = clip(req.body?.name, 40);
    const generated = await generateReply(contents, buildInstruction(tone, priorProfile, weather, name), parameters);
    const parsed = parseModelJson(generated.text);
    const profile = mergeProfile(priorProfile, parsed.profile, detectedCity);
    const itinerary = sanitizeItinerary(parsed.itinerary, profile);
    if (itinerary && weather && !itinerary.weatherNote) {
      itinerary.weatherNote = `${weather.temperature}°C, ${weather.condition}`;
    }

    const reply = clip(parsed.reply, 2000);
    if (!reply) {
      return res.status(502).json({ error: "Gemini tidak mengembalikan balasan." });
    }

    return res.json({
      result: reply,
      profile,
      itinerary,
      weather,
      parameters,
      model: generated.model,
    });
  } catch (error) {
    console.error("Gagal menghasilkan balasan:", error.message || error);
    return res.status(500).json({ error: "Failed to get response from server." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Teman Rencana berjalan di http://localhost:${PORT}`);
});
