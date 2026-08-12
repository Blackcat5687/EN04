/**
 * gemini-live.js — التكامل مع Gemini Live API عبر WebSocket
 * تحكم يدوي كامل بالأدوار (بدون VAD تلقائي)، تفريغ صوتي للمدخل والمخرج،
 * طبقة تحقق (مقارنة نص الـ AI بالسيناريو المتوقع)، ومنطق تصحيح النطق.
 */

const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const MATCH_THRESHOLD = 0.5; // 50%
const MAX_RETRIES = 3;

function liveWsUrl(apiKey) {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
}

/** تنظيف نص وتقسيمه لكلمات للمقارنة */
function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** نسبة تطابق على مستوى الكلمة بين النص المتوقع والنص الفعلي */
function wordMatchPercent(expected, actual) {
  const expectedWords = normalizeWords(expected);
  const actualWords = new Set(normalizeWords(actual));
  if (expectedWords.length === 0) return 1;
  let matched = 0;
  for (const w of expectedWords) {
    if (actualWords.has(w)) matched += 1;
  }
  return matched / expectedWords.length;
}

/** تحويل Float32 PCM من الميكروفون إلى Int16 PCM ثم Base64 */
function floatTo16BitPCMBase64(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** تحويل Base64 PCM 16-bit قادم من السيرفر إلى AudioBuffer قابل للتشغيل */
function base64PCMToAudioBuffer(base64, audioCtx, sampleRate) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const sampleCount = len / 2;
  const audioBuffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    channel[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return audioBuffer;
}

/**
 * GeminiLiveSession — يدير جلسة صوتية حية واحدة مبنية على سيناريو مكتوب مسبقًا
 */
class GeminiLiveSession {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {Array<{speaker:string,text:string}>} opts.scriptLines
   * @param {string} opts.voiceStyle
   * @param {Object} opts.callbacks - onStateChange, onTranscriptLine, onDeviation, onError, onDone
   */
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.scriptLines = opts.scriptLines;
    this.voiceStyle = opts.voiceStyle || 'Zephyr';
    this.callbacks = opts.callbacks || {};

    this.ws = null;
    this.audioCtx = null;
    this.micStream = null;
    this.micSource = null;
    this.micProcessor = null;
    this.playbackQueueTime = 0;

    this.currentLineIndex = 0;
    this.retryCount = 0;
    this.setupComplete = false;
    this.awaitingUserSpeech = false;
    this.currentUserTranscriptBuffer = '';
    this.currentAiTranscriptBuffer = '';
    this.deviationLog = [];
    this.stopped = false;
  }

  _setState(state) {
    if (this.callbacks.onStateChange) this.callbacks.onStateChange(state);
  }

  async start() {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(liveWsUrl(this.apiKey));
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this._sendSetup();
        resolve();
      };
      this.ws.onerror = (err) => {
        reject(new Error('تعذّر الاتصال بـ Gemini Live API'));
      };
      this.ws.onmessage = (event) => this._handleServerMessage(event);
      this.ws.onclose = () => {
        this._setState('closed');
      };
    });
  }

  _sendSetup() {
    const setupMsg = {
      setup: {
        model: LIVE_MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceStyle } },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        historyConfig: {
          initialHistoryInClientContent: true,
        },
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: true },
        },
        systemInstruction: {
          parts: [
            {
              text:
                'You are role-playing a specific pre-written scripted dialogue with an English learner. ' +
                'Only speak your exact scripted lines when it is your turn. Do not improvise beyond the script ' +
                'unless explicitly asked by the app to give a short pronunciation correction hint.',
            },
          ],
        },
      },
    };
    this.ws.send(JSON.stringify(setupMsg));
  }

  /** يُرسل السيناريو الكامل كسياق أولي بعد اكتمال الإعداد */
  _sendInitialHistory() {
    const turns = this.scriptLines.map((line) => ({
      role: line.speaker === 'user' ? 'user' : 'model',
      parts: [{ text: line.text }],
    }));

    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns,
          turnComplete: true,
        },
      })
    );
  }

  _handleServerMessage(event) {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data));
    } catch (e) {
      return;
    }

    if (msg.setupComplete) {
      this.setupComplete = true;
      this._sendInitialHistory();
      // بعد إرسال السياق الأولي، ابدأ بأول جملة (المستخدم دائمًا أولًا)
      this._advanceScript();
      return;
    }

    if (msg.serverContent) {
      const sc = msg.serverContent;

      if (sc.outputTranscription && sc.outputTranscription.text) {
        this.currentAiTranscriptBuffer += sc.outputTranscription.text;
      }
      if (sc.inputTranscription && sc.inputTranscription.text) {
        this.currentUserTranscriptBuffer += sc.inputTranscription.text;
      }

      if (sc.modelTurn && sc.modelTurn.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData && part.inlineData.data) {
            this._playAudioChunk(part.inlineData.data);
          }
        }
      }

      if (sc.turnComplete) {
        this._onAiTurnComplete();
      }
    }
  }

  _playAudioChunk(base64Data) {
    try {
      const buffer = base64PCMToAudioBuffer(base64Data, this.audioCtx, OUTPUT_SAMPLE_RATE);
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);
      const now = this.audioCtx.currentTime;
      const startAt = Math.max(now, this.playbackQueueTime);
      source.start(startAt);
      this.playbackQueueTime = startAt + buffer.duration;
    } catch (e) {
      // تجاهل قطع صوتية تالفة بدون إيقاف الجلسة
    }
  }

  /** عندما ينتهي دور الـ AI، تحقّق من مطابقة النص المتوقع، ثم انتقل لدور المستخدم إن وجد */
  _onAiTurnComplete() {
    // حالة خاصة: كان هذا ردًا توضيحيًا لتصحيح النطق (خارج نص السيناريو) — أعد فتح دور المستخدم لنفس الجملة
    if (this._pendingRetryAfterHint) {
      this._pendingRetryAfterHint = false;
      this.currentAiTranscriptBuffer = '';
      this._setState('listening');
      this._startUserTurn();
      return;
    }

    const expectedLine = this.scriptLines[this.currentLineIndex];

    if (expectedLine && expectedLine.speaker === 'ai') {
      const expected = expectedLine.text;
      const actual = this.currentAiTranscriptBuffer.trim();
      const match = wordMatchPercent(expected, actual);

      if (this.callbacks.onTranscriptLine) {
        this.callbacks.onTranscriptLine({
          speaker: 'ai',
          expectedText: expected,
          actualText: actual,
          matchPercent: match,
        });
      }

      if (match < MATCH_THRESHOLD) {
        this.deviationLog.push({
          type: 'ai_deviation',
          expected,
          actual,
          matchPercent: match,
          timestamp: new Date().toISOString(),
        });
      }

      this.currentAiTranscriptBuffer = '';
      this.currentLineIndex += 1;
      this._advanceScript();
    } else {
      // اكتمل رد توضيحي وليس جملة سيناريو رسمية — انتظر دور المستخدم من جديد
      this.currentAiTranscriptBuffer = '';
    }
  }

  /** يقرر ما التالي بناءً على السيناريو: دور المستخدم (استمع) أو دور الـ AI (ينتظر رده تلقائيًا) */
  _advanceScript() {
    if (this.stopped) return;

    if (this.currentLineIndex >= this.scriptLines.length) {
      this._setState('completed');
      if (this.callbacks.onDone) this.callbacks.onDone();
      return;
    }

    const line = this.scriptLines[this.currentLineIndex];

    if (line.speaker === 'user') {
      this._setState('listening');
      this._startUserTurn();
    } else {
      // دور الـ AI: النموذج سيتحدث تلقائيًا بناءً على السياق المُرسَل، ننتظر رده
      this._setState('ai-speaking');
    }
  }

  /** بدء الاستماع لدور المستخدم عبر activityStart/activityEnd اليدوي */
  async _startUserTurn() {
    this.currentUserTranscriptBuffer = '';
    this.awaitingUserSpeech = true;

    if (!this.micStream) {
      await this._initMic();
    }

    this.ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
    this.micActive = true;

    if (this.callbacks.onListeningStarted) this.callbacks.onListeningStarted();
  }

  /** يُستدعى من الواجهة عندما يضغط المستخدم "انتهيت من الكلام" */
  finishUserTurn() {
    if (!this.awaitingUserSpeech) return;
    this.micActive = false;
    this.ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    this.awaitingUserSpeech = false;
    this._setState('thinking');
    this._evaluateUserSpeech();
  }

  /** بعد إنهاء دور المستخدم: قارن النص المُتعرَّف عليه بالمتوقع وقرر: تقدّم أم إعادة */
  _evaluateUserSpeech() {
    // ننتظر لحظة قصيرة لضمان وصول كل أجزاء التفريغ الصوتي المتأخرة
    setTimeout(() => {
      const expectedLine = this.scriptLines[this.currentLineIndex];
      const expected = expectedLine.text;
      const actual = this.currentUserTranscriptBuffer.trim();
      const match = wordMatchPercent(expected, actual);

      if (this.callbacks.onTranscriptLine) {
        this.callbacks.onTranscriptLine({
          speaker: 'user',
          expectedText: expected,
          actualText: actual,
          matchPercent: match,
        });
      }

      if (match >= MATCH_THRESHOLD) {
        this.retryCount = 0;
        this.currentLineIndex += 1;
        this._advanceScript();
      } else {
        this.retryCount += 1;
        if (this.retryCount >= MAX_RETRIES) {
          this.deviationLog.push({
            type: 'needs_review',
            expected,
            actual,
            matchPercent: match,
            timestamp: new Date().toISOString(),
          });
          if (this.callbacks.onNeedsReview) this.callbacks.onNeedsReview(expected);
          this.retryCount = 0;
          this.currentLineIndex += 1;
          this._advanceScript();
        } else {
          this._requestPronunciationHelp(expected, actual);
        }
      }
    }, 600);
  }

  /** يرسل تعليمة نصية خارج السيناريو تطلب من الـ AI توضيح الأخطاء بصوته */
  _requestPronunciationHelp(expected, actual) {
    this._setState('ai-correcting');
    const instruction =
      `(App instruction, not part of the script) The learner tried to say: "${expected}" ` +
      `but the transcription heard: "${actual}". Briefly and kindly, in a few words, point out ` +
      `which word(s) they likely mispronounced or missed, then ask them to try saying the sentence again.`;

    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: instruction }] }],
          turnComplete: true,
        },
      })
    );

    // عند وصول turnComplete التالي، سيعرف _onAiTurnComplete أن هذا كان تلميحًا توضيحيًا
    // (وليس جملة سيناريو رسمية) وسيعيد فتح دور المستخدم لنفس الجملة تلقائيًا
    this._pendingRetryAfterHint = true;
  }

  async _initMic() {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: INPUT_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
    this.micProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);

    this.micProcessor.onaudioprocess = (e) => {
      if (!this.micActive || this.stopped) return;
      const input = e.inputBuffer.getChannelData(0);
      const base64Audio = floatTo16BitPCMBase64(input);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: base64Audio, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
            },
          })
        );
      }
    };

    // نوصّل المعالج بعقدة كسب صامتة (gain=0) بدلاً من السماعات مباشرة لتفادي أي صدى للمايك،
    // مع الحفاظ على تفعيل ScriptProcessor (يتطلب اتصالًا بوجهة ما ليعمل في بعض المتصفحات)
    const silentGain = this.audioCtx.createGain();
    silentGain.gain.value = 0;
    this.micSource.connect(this.micProcessor);
    this.micProcessor.connect(silentGain);
    silentGain.connect(this.audioCtx.destination);
  }

  stop() {
    this.stopped = true;
    this.micActive = false;
    try {
      if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
      if (this.micProcessor) this.micProcessor.disconnect();
      if (this.micSource) this.micSource.disconnect();
      if (this.ws) this.ws.close();
      if (this.audioCtx) this.audioCtx.close();
    } catch (e) {
      /* تجاهل أخطاء التنظيف */
    }
  }

  getDeviationLog() {
    return this.deviationLog;
  }
}

window.GeminiLiveSession = GeminiLiveSession;
window.wordMatchPercent = wordMatchPercent;
