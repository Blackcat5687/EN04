/**
 * scenario-generator.js — توليد نص الحوار الكامل عبر استدعاء نصي منفصل لـ Gemini
 * (ليس Live API) — يُستخدم قبل بدء أي جلسة صوتية
 */

const GEMINI_TEXT_MODEL = 'gemini-2.0-flash';
const GEMINI_TEXT_ENDPOINT = (model, apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

/**
 * يبني تعليمة (Prompt) لتوليد سيناريو مبني على كلمات
 * 70% كلمات اليوم الجديدة (إلزامية) / 30% كلمات مراجعة سابقة
 */
function buildWordsScenarioPrompt({ todayWords, reviewWords, totalSentences }) {
  const reviewCount = Math.max(0, Math.round(totalSentences * 0.3));
  const todayList = todayWords.map((w) => `${w.text} (${w.translation})`).join(', ');
  const reviewList = reviewWords.length
    ? reviewWords.map((w) => `${w.text} (${w.translation})`).join(', ')
    : 'none';

  return `You are creating a short scripted English dialogue for a language-learning app.

STRICT REQUIREMENTS:
- Total number of lines (sentences) in the dialogue must be exactly ${totalSentences}.
- The dialogue is between two roles only: "user" (the learner) and "ai" (the conversation partner).
- The FIRST line must always be spoken by "user".
- Roles must alternate naturally as a real conversation (user, ai, user, ai...), though minor natural variation is fine.
- The dialogue MUST prominently and naturally use ALL of these target words (this is the main focus, mandatory): ${todayList}.
- Additionally, try to naturally weave in some of these review words (secondary priority, do not force if awkward, use up to ${reviewCount} of them): ${reviewList}.
- Keep sentences short and natural, suitable for a spoken conversation practice (max ~12 words per line).
- Create a simple, coherent everyday scenario/context that makes sense for using these words together (you choose the setting).
- Do not include any words that are too advanced beyond the given vocabulary level.

Return ONLY valid JSON, no markdown code fences, no preamble, in exactly this format:
{
  "contextLabel": "short Arabic label describing the scenario, e.g. حوار عن التسوق",
  "lines": [
    { "speaker": "user", "text": "..." },
    { "speaker": "ai", "text": "..." }
  ]
}`;
}

/** يبني تعليمة لتوليد سيناريو سياق ثابت (لا يعتمد على كلمات) */
function buildFixedScenarioPrompt({ topicContext, totalSentences }) {
  return `You are creating a short scripted English dialogue for a language-learning app.

STRICT REQUIREMENTS:
- Total number of lines (sentences) in the dialogue must be exactly ${totalSentences}.
- The dialogue is between two roles only: "user" (the learner) and "ai" (the conversation partner).
- The FIRST line must always be spoken by "user".
- Roles must alternate naturally as a real conversation (user, ai, user, ai...), though minor natural variation is fine.
- Scenario context: ${topicContext}
- Keep sentences short, natural, and suitable for spoken practice (max ~12 words per line).
- Use common, everyday vocabulary appropriate for an intermediate English learner.

Return ONLY valid JSON, no markdown code fences, no preamble, in exactly this format:
{
  "contextLabel": "short Arabic label describing the scenario",
  "lines": [
    { "speaker": "user", "text": "..." },
    { "speaker": "ai", "text": "..." }
  ]
}`;
}

/** استدعاء Gemini النصي وتوليد نص الحوار */
async function callGeminiText(prompt, apiKey) {
  const response = await fetch(GEMINI_TEXT_ENDPOINT(GEMINI_TEXT_MODEL, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API error (${response.status}): ${errText || response.statusText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const cleaned = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('تعذّر تحليل استجابة النموذج كـ JSON صالح');
  }

  if (!parsed.lines || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
    throw new Error('استجابة النموذج لا تحتوي على حوار صالح');
  }
  if (parsed.lines[0].speaker !== 'user') {
    // إصلاح دفاعي: تأكد أن الجملة الأولى للمستخدم كما هو مطلوب صراحة
    const firstUserIdx = parsed.lines.findIndex((l) => l.speaker === 'user');
    if (firstUserIdx > 0) {
      const [line] = parsed.lines.splice(firstUserIdx, 1);
      parsed.lines.unshift(line);
    }
  }

  return parsed;
}

const ScenarioGenerator = {
  /**
   * يولّد سيناريو مبني على الكلمات (كلمات اليوم + كلمات مراجعة)
   */
  async generateWordsScenario({ apiKey, totalSentences, dailyWordGoal }) {
    const allWords = await window.DB.Words.getAll();
    const newWords = allWords.filter((w) => w.status === 'new');
    const todayWords = newWords.slice(0, dailyWordGoal);

    if (todayWords.length === 0) {
      throw new Error('لا توجد كلمات جديدة اليوم. أضف كلمات من صفحة الكلمات أولًا.');
    }

    const reviewWords = await window.DB.Words.getWordsForReview(Math.round(totalSentences * 0.3));

    const prompt = buildWordsScenarioPrompt({ todayWords, reviewWords, totalSentences });
    const generated = await callGeminiText(prompt, apiKey);

    const wordsUsed = [...todayWords, ...reviewWords].map((w) => w.id);

    const scenario = await window.DB.Scenarios.add({
      type: 'words',
      scriptLines: generated.lines,
      wordsUsed,
      contextLabel: generated.contextLabel || 'حوار كلمات اليوم',
    });

    return scenario;
  },

  /**
   * يولّد سيناريو سياق ثابت مستقل عن الكلمات
   */
  async generateFixedScenario({ apiKey, totalSentences, topicId }) {
    const topic = window.FIXED_SCENARIO_TOPICS.find((t) => t.id === topicId);
    if (!topic) throw new Error('سياق غير معروف');

    const prompt = buildFixedScenarioPrompt({ topicContext: topic.promptContext, totalSentences });
    const generated = await callGeminiText(prompt, apiKey);

    const scenario = await window.DB.Scenarios.add({
      type: 'fixed',
      scriptLines: generated.lines,
      wordsUsed: [],
      contextLabel: generated.contextLabel || topic.label,
    });

    return scenario;
  },
};

window.ScenarioGenerator = ScenarioGenerator;
