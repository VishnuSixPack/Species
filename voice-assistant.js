/* ==========================================================================
   PROJECT MANHATTAN — AI VOICE ASSISTANT
   voice-assistant.js
   --------------------------------------------------------------------------
   A self-contained, dependency-free voice assistant widget.

   INTEGRATION WITH YOUR EXISTING GROQ CALL
   -----------------------------------------
   This file does NOT call Groq directly. It calls a function you provide
   via `askAI` in the config. Point it at your existing Groq request
   function and nothing about your API logic needs to change.

       const assistant = new ManhattanVoiceAssistant({
         askAI: async (question, productData) => {
           // your existing function, e.g.:
           return await callGroqAPI(question, productData);
           // must return a plain string (the answer to speak/display)
         },
         getProductData: () => window.currentProductData // optional
       });
       assistant.init();

   If you don't pass `askAI`, the widget will:
     1. look for a few common global function names (see AUTO_DETECT_NAMES)
     2. otherwise POST to `/api/groq` as a placeholder (see _fallbackAskAI)
   Both are meant as convenience/dev fallbacks — see INTEGRATION-GUIDE.md.
   ========================================================================== */

(function (global) {
  'use strict';

  const STATE = {
    IDLE: 'idle',
    LISTENING: 'listening',
    THINKING: 'thinking',
    SPEAKING: 'speaking',
    ERROR: 'error',
  };

  // Common existing-function names we'll try before falling back to a
  // placeholder fetch. Purely a convenience for auto-wiring during dev.
  const AUTO_DETECT_NAMES = ['callGroqAPI', 'askGroq', 'groqRequest', 'sendToGroq'];

  const DEFAULT_CONFIG = {
    // --- integration points -------------------------------------------------
    askAI: null,              // async (question, productData) => string
    getProductData: null,     // () => object | null  (called fresh on every question)
    productData: null,        // static alternative to getProductData

    // --- speech ---------------------------------------------------------------
    lang: 'en-US',
    speechRate: 1.0,
    speechPitch: 1.0,
    preferredVoiceNames: ['Google US English', 'Samantha', 'Microsoft Aria Online (Natural)'],

    // --- behaviour --------------------------------------------------------------
    autoSpeak: true,          // speak AI responses aloud automatically
    showTextFallback: true,   // always show a typed-input option, not just on unsupported browsers
    greeting: 'Ask me anything about this product — allergens, sustainability, sourcing.',
    panelTitle: 'Manhattan Assistant',
    panelSubtitle: 'Voice-powered product Q&A',
    modalHeading: 'How can I help you today?',

    // --- prompt engineering -------------------------------------------------
    systemPromptBuilder: null, // (productData) => string, overrides buildSystemPrompt()

    // --- mount ---------------------------------------------------------------
    mountTo: null,     // defaults to document.body
    embedded: false,   // true = render inline, always-open, no fab/backdrop — for a dedicated full page
  };

  /**
   * Builds the reusable system prompt described in the spec:
   * answer strictly from product data, never invent facts, defer
   * medical questions to general info + "consult a professional".
   */
  function buildSystemPrompt(productData) {
    const hasProduct = productData && Object.keys(productData).length > 0;
    const productBlock = hasProduct
      ? `Here is the verified product data you must use:\n${JSON.stringify(productData, null, 2)}`
      : 'No product data is currently available for this page.';

    return [
      'You are an AI Product Assistant for Project Manhattan, a seafood supply-chain traceability platform.',
      'Answer the user\'s question using ONLY the supplied product information below.',
      'Never invent ingredients, certifications, nutritional values, vessel names, catch areas, or dates.',
      'If the answer cannot be determined from the product data, clearly say the information is not available — do not guess.',
      'If the user asks a medical or health question, you may give brief general information, but explicitly recommend consulting a healthcare professional for anything specific to them.',
      'Keep answers concise and conversational, suitable for being read aloud (2-4 sentences unless more detail is explicitly requested).',
      '',
      productBlock,
    ].join('\n');
  }

  /** Friendly copy for every error case the spec calls out. */
  const ERROR_MESSAGES = {
    micDenied: 'Microphone access was denied. Enable it in your browser settings to use voice input.',
    micNotFound: 'No microphone was found on this device. You can type your question instead.',
    insecureContext: 'Voice input needs a secure connection (https://) — it won\'t work opened as a file or over plain http. Try the text field below for now.',
    noSpeech: "I didn't catch that — try speaking again after tapping the mic.",
    network: 'Network issue while listening. Check your connection and try again.',
    aiFailure: "I couldn't reach the assistant just now. Please try again in a moment.",
    ttsUnavailable: 'Spoken responses aren\'t supported in this browser, but you can still read replies here.',
    unsupported: 'Voice input isn\'t supported in this browser. You can type your question below instead.',
    generic: 'Something went wrong. Please try again.',
  };

  class ManhattanVoiceAssistant {
    constructor(userConfig = {}) {
      this.config = Object.assign({}, DEFAULT_CONFIG, userConfig);
      this.state = STATE.IDLE;
      this.history = []; // { role: 'user' | 'ai', text, timestamp }
      this.isProcessing = false;

      this._recognition = null;
      this._waveformRAF = null;
      this._currentUtterance = null;
      this._voicesReady = false;
      this._panelOpen = false;
      this._finalTranscript = '';

      this._speechSupported = !!(global.SpeechRecognition || global.webkitSpeechRecognition);
      this._ttsSupported = 'speechSynthesis' in global;

      this._onVoicesChanged = this._onVoicesChanged.bind(this);
    }

    /** Build DOM, wire events, ready to use. Call once. */
    init() {
      this._buildDOM();
      this._bindEvents();
      this._applySupportFlags();

      if (this._ttsSupported) {
        // Voice list loads async in some browsers.
        global.speechSynthesis.addEventListener('voiceschanged', this._onVoicesChanged);
        this._onVoicesChanged();
      }

      this._setState(STATE.IDLE);

      if (this.config.embedded) {
        this.root.setAttribute('data-embedded', 'true');
        this._openPanel();
      }

      return this;
    }

    /** Remove all DOM, listeners, and stop any in-flight audio. Call on teardown. */
    destroy() {
      this._stopListening({ silent: true });
      this._stopSpeaking();
      if (this._ttsSupported) {
        global.speechSynthesis.removeEventListener('voiceschanged', this._onVoicesChanged);
      }
      if (this.root && this.root.parentNode) {
        this.root.parentNode.removeChild(this.root);
      }
    }

    // ------------------------------------------------------------------------
    // Public API for external triggers (e.g. a "Start talking" button or a
    // suggested-question chip elsewhere on the page)
    // ------------------------------------------------------------------------

    /** Opens the panel without starting the microphone. */
    open() {
      this._openPanel();
    }

    /** Opens the panel and submits `question` as if it were typed. */
    ask(question) {
      if (!question) {
        this.open();
        return;
      }
      this._openPanel();
      this._handleFinalQuestion(question);
    }

    /** Closes the panel and stops any in-progress listening/speaking. */
    close() {
      this._closePanel();
    }

    // ------------------------------------------------------------------------
    // DOM construction
    // ------------------------------------------------------------------------

    _buildDOM() {
      const root = document.createElement('div');
      root.className = 'mh-va-root';
      root.setAttribute('data-state', STATE.IDLE);
      root.setAttribute('data-panel-open', 'false');
      root.setAttribute('data-mic-supported', String(this._speechSupported));
      root.setAttribute('data-text-fallback', String(!!this.config.showTextFallback));

      root.innerHTML = `
        <div class="mh-va-page-glow" aria-hidden="true">
          <span class="mh-va-glow-edge mh-va-glow-top"></span>
          <span class="mh-va-glow-edge mh-va-glow-bottom"></span>
          <span class="mh-va-glow-edge mh-va-glow-left"></span>
          <span class="mh-va-glow-edge mh-va-glow-right"></span>
        </div>

        <div class="mh-va-backdrop" aria-hidden="true"></div>

        <section class="mh-va-panel" role="dialog" aria-label="${this._esc(this.config.panelTitle)}" aria-hidden="true">
          <header class="mh-va-panel-header">
            <div class="mh-va-panel-title-wrap">
              <div class="mh-va-modal-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                </svg>
              </div>
              <div class="mh-va-panel-title-text">
                <div class="mh-va-panel-title">${this._esc(this.config.panelTitle)}</div>
                <div class="mh-va-panel-subtitle">${this._esc(this.config.panelSubtitle)}</div>
              </div>
            </div>
            <button type="button" class="mh-va-close-btn" aria-label="Close assistant">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>

          <div class="mh-va-modal-heading">
            <div class="mh-va-modal-eyebrow">Ask anything</div>
            <h2>${this._esc(this.config.modalHeading)}</h2>
          </div>

          <div class="mh-va-messages" aria-live="polite" aria-atomic="false">
            <div class="mh-va-empty-state">
              ${this._esc(this.config.greeting)}
            </div>
          </div>

          <div class="mh-va-state-pills" role="status">
            <div class="mh-va-state-pill" data-pill="listening">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              Listening
            </div>
            <div class="mh-va-state-pill" data-pill="thinking">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
              Thinking
            </div>
            <div class="mh-va-state-pill" data-pill="speaking">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
              Speaking
            </div>
          </div>

          <div class="mh-va-mic-row">
            <canvas class="mh-va-modal-wave mh-va-modal-wave-left" width="180" height="46" aria-hidden="true"></canvas>
            <div class="mh-va-modal-mic-wrap">
              <span class="mh-va-sonar" aria-hidden="true"></span>
              <span class="mh-va-sonar" aria-hidden="true"></span>
              <span class="mh-va-sonar" aria-hidden="true"></span>
              <button type="button" class="mh-va-modal-mic" aria-label="Start talking">
                <svg class="mh-va-fab-icon mh-va-icon-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                <svg class="mh-va-fab-icon mh-va-icon-stop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
              </button>
            </div>
            <canvas class="mh-va-modal-wave mh-va-modal-wave-right" width="180" height="46" aria-hidden="true"></canvas>
          </div>

          <div class="mh-va-modal-helper">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span id="mh-va-modal-helper-text" aria-live="polite">Click the microphone to ask anything</span>
          </div>

          <div class="mh-va-text-fallback">
            <label class="mh-va-sr-only" for="mh-va-text-input">Type your question</label>
            <input class="mh-va-text-input" id="mh-va-text-input" type="text" placeholder="Or type your question instead…" autocomplete="off" />
            <button type="button" class="mh-va-text-send" aria-label="Send question" disabled>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>
            </button>
          </div>
        </section>

        <div class="mh-va-fab-wrap">
          <button type="button" class="mh-va-fab" aria-label="Open Manhattan Assistant" aria-haspopup="dialog" aria-expanded="false">
            <svg class="mh-va-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
        </div>

        <div class="mh-va-toast" role="status" aria-live="assertive"></div>
      `;

      const style = document.createElement('style');
      style.textContent = '.mh-va-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}';
      root.appendChild(style);

      (this.config.mountTo || document.body).appendChild(root);
      this.root = root;

      // cache refs
      this.$backdrop = root.querySelector('.mh-va-backdrop');
      this.$panel = root.querySelector('.mh-va-panel');
      this.$close = root.querySelector('.mh-va-close-btn');
      this.$fab = root.querySelector('.mh-va-fab');
      this.$modalMic = root.querySelector('.mh-va-modal-mic');
      this.$modalMicIconMic = this.$modalMic.querySelector('.mh-va-icon-mic');
      this.$modalMicIconStop = this.$modalMic.querySelector('.mh-va-icon-stop');
      this.$pills = {
        listening: root.querySelector('[data-pill="listening"]'),
        thinking: root.querySelector('[data-pill="thinking"]'),
        speaking: root.querySelector('[data-pill="speaking"]'),
      };
      this.$messages = root.querySelector('.mh-va-messages');
      this.$emptyState = root.querySelector('.mh-va-empty-state');
      this.$helperText = root.querySelector('#mh-va-modal-helper-text');
      this.$waveLeft = root.querySelector('.mh-va-modal-wave-left');
      this.$waveRight = root.querySelector('.mh-va-modal-wave-right');
      this.$waveLeftCtx = this.$waveLeft.getContext('2d');
      this.$waveRightCtx = this.$waveRight.getContext('2d');
      this.$textInput = root.querySelector('.mh-va-text-input');
      this.$textSend = root.querySelector('.mh-va-text-send');
      this.$toast = root.querySelector('.mh-va-toast');
    }

    _applySupportFlags() {
      this.root.setAttribute('data-mic-supported', String(this._speechSupported));
    }

    // ------------------------------------------------------------------------
    // Event wiring
    // ------------------------------------------------------------------------

    _bindEvents() {
      // Corner fab only launches the modal — the big mic button inside is
      // the actual talk control once it's open.
      this.$fab.addEventListener('click', () => {
        this._openPanel();
        if (!this._speechSupported) this.$textInput.focus();
      });
      this.$modalMic.addEventListener('click', () => this._onModalMicClick());
      this.$close.addEventListener('click', () => this._closePanel());
      this.$backdrop.addEventListener('click', () => this._closePanel());

      // Escape closes the panel (accessibility) — not applicable when embedded as a full page
      this.root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !this.config.embedded) this._closePanel();
      });

      // Typed fallback
      this.$textInput.addEventListener('input', () => {
        this.$textSend.disabled = this.$textInput.value.trim().length === 0;
      });
      this.$textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !this.$textSend.disabled) this._submitTypedQuestion();
      });
      this.$textSend.addEventListener('click', () => this._submitTypedQuestion());
    }

    _onModalMicClick() {
      if (!this._speechSupported) {
        this._showToast(ERROR_MESSAGES.unsupported);
        this.$textInput.focus();
        return;
      }

      if (this.state === STATE.SPEAKING) {
        // Spec #8: pressing mic while AI is speaking stops speech, allows recording again.
        this._stopSpeaking();
        this._setState(STATE.IDLE);
        return;
      }

      if (this.state === STATE.LISTENING) {
        this._stopListening();
        return;
      }

      if (this.state === STATE.THINKING) {
        return; // ignore taps while a request is in flight
      }

      this._startListening();
    }

    _openPanel() {
      this._panelOpen = true;
      this.root.setAttribute('data-panel-open', 'true');
      this.$panel.setAttribute('aria-hidden', 'false');
      this.$backdrop.setAttribute('aria-hidden', 'false');
      this.$fab.setAttribute('aria-expanded', 'true');

      if (!this._speechSupported && !this._unsupportedToastShown) {
        this._unsupportedToastShown = true;
        this._showToast(ERROR_MESSAGES.unsupported);
      }
    }

    _closePanel() {
      this._panelOpen = false;
      this.root.setAttribute('data-panel-open', 'false');
      this.$panel.setAttribute('aria-hidden', 'true');
      this.$backdrop.setAttribute('aria-hidden', 'true');
      this.$fab.setAttribute('aria-expanded', 'false');
      this._stopListening({ silent: true });
      this._stopSpeaking();
      this._setState(STATE.IDLE);
      this.$fab.focus();
    }

    _submitTypedQuestion() {
      const text = this.$textInput.value.trim();
      if (!text) return;
      this.$textInput.value = '';
      this.$textSend.disabled = true;
      this._openPanel();
      this._handleFinalQuestion(text);
    }

    // ------------------------------------------------------------------------
    // State machine
    // ------------------------------------------------------------------------

    _setState(next) {
      this.state = next;
      this.root.setAttribute('data-state', next);

      // Light up the matching pill, dim the rest.
      Object.entries(this.$pills).forEach(([key, el]) => {
        el.classList.toggle('mh-va-pill-active', key === next);
      });

      const helperLabels = {
        [STATE.IDLE]: 'Click the microphone to ask anything',
        [STATE.LISTENING]: 'Listening — speak now',
        [STATE.THINKING]: 'Thinking about your question…',
        [STATE.SPEAKING]: 'Speaking the answer…',
        [STATE.ERROR]: 'Something went wrong — try again',
      };
      this.$helperText.textContent = helperLabels[next] || '';

      const showStop = next === STATE.LISTENING;
      this.$modalMicIconMic.style.display = showStop ? 'none' : 'block';
      this.$modalMicIconStop.style.display = showStop ? 'block' : 'none';

      if (next === STATE.ERROR) {
        // Self-heal back to idle after the shake animation + a brief hold.
        clearTimeout(this._errorTimer);
        this._errorTimer = setTimeout(() => {
          if (this.state === STATE.ERROR) this._setState(STATE.IDLE);
        }, 2200);
      }
    }

    // ------------------------------------------------------------------------
    // Speech recognition (listening + live transcript + waveform)
    // ------------------------------------------------------------------------

    async _startListening() {
      if (!this._speechSupported) {
        this._showError('unsupported');
        return;
      }
      if (this.isProcessing) return;

      // SpeechRecognition needs a secure context (https://, or localhost) —
      // on plain http:// or a file:// page it fails immediately with no
      // permission prompt ever shown, which otherwise looks exactly like a
      // real denial. Catch that specific case with its own message.
      if (global.isSecureContext === false) {
        this._showError('insecureContext');
        return;
      }

      this._finalTranscript = '';
      this._showLiveBubble();

      // Note: we deliberately do NOT call getUserMedia() here. Recognition
      // requests and manages its own microphone access internally — asking
      // for the mic a second time via getUserMedia was starving recognition
      // of audio on some browser/OS combinations, causing it to report
      // "no speech" almost immediately even while the user was talking.
      // The waveform below is a synthetic animation for this reason, not an
      // audio-reactive one — see _startWaveform.
      this._startWaveform('listening');

      const SpeechRecognitionImpl = global.SpeechRecognition || global.webkitSpeechRecognition;
      const recognition = new SpeechRecognitionImpl();
      recognition.lang = this.config.lang;
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => this._handleRecognitionResult(event);
      recognition.onerror = (event) => this._handleRecognitionError(event);
      recognition.onend = () => this._handleRecognitionEnd();

      this._recognition = recognition;

      try {
        recognition.start();
      } catch (err) {
        // start() throws synchronously if called while already running, or
        // in some browsers if permission was previously blocked outright.
        this._recognition = null;
        this._stopWaveform();
        this._removeLiveBubble();
        this._showError('micDenied');
        return;
      }

      this._setState(STATE.LISTENING);
    }

    // ------------------------------------------------------------------------
    // Live transcript bubble — shows what the user is saying in real time,
    // right where their message will land in the conversation once it's
    // finalized. Far more visible than a single truncated helper line.
    // ------------------------------------------------------------------------

    _showLiveBubble() {
      if (this.$liveBubble) return;
      if (this.$emptyState) {
        this.$emptyState.remove();
        this.$emptyState = null;
      }

      const bubble = document.createElement('div');
      bubble.className = 'mh-va-live-bubble';
      bubble.innerHTML = `
        <span class="mh-va-live-bubble-dot" aria-hidden="true"></span>
        <span class="mh-va-live-bubble-text">Listening…</span>
      `;
      this.$messages.appendChild(bubble);
      this.$liveBubble = bubble;
      this.$liveBubbleText = bubble.querySelector('.mh-va-live-bubble-text');
      this._scrollToBottom();
    }

    _updateLiveBubble(text) {
      if (!this.$liveBubbleText) return;
      const trimmed = text.trim();
      this.$liveBubbleText.textContent = trimmed || 'Listening…';
      this.$liveBubbleText.classList.toggle('mh-va-live-has-text', !!trimmed);
      this._scrollToBottom();
    }

    _removeLiveBubble() {
      if (this.$liveBubble) {
        this.$liveBubble.remove();
        this.$liveBubble = null;
        this.$liveBubbleText = null;
      }
    }

    _handleRecognitionResult(event) {
      let interim = '';
      let final = this._finalTranscript;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcriptPiece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcriptPiece + ' ';
        } else {
          interim += transcriptPiece;
        }
      }

      this._finalTranscript = final;
      this._updateLiveBubble(final + interim);
    }

    _handleRecognitionError(event) {
      const map = {
        'not-allowed': 'micDenied',
        'permission-denied': 'micDenied',
        'no-speech': 'noSpeech',
        'network': 'network',
        'audio-capture': 'micNotFound',
        'service-not-allowed': 'micDenied',
      };
      const key = map[event.error] || 'generic';

      this._removeLiveBubble();
      this._stopListening({ silent: true });
      // Every failure gets a toast now, including no-speech — a silent
      // revert to idle looks indistinguishable from a bug. See it, know
      // what happened, try again.
      this._showError(key);
    }

    _handleRecognitionEnd() {
      this._stopWaveform();
      this._removeLiveBubble();

      const finalText = this._finalTranscript.trim();
      this._finalTranscript = '';

      if (this.state === STATE.LISTENING) {
        // Recognition ended on its own (silence) or via manual stop.
        if (finalText) {
          this._handleFinalQuestion(finalText);
        } else {
          this._setState(STATE.IDLE);
        }
      }
    }

    _stopListening(opts = {}) {
      if (this._recognition) {
        try { this._recognition.stop(); } catch (e) { /* already stopped */ }
        this._recognition = null;
      }
      this._stopWaveform();
      this._removeLiveBubble();
      if (!opts.silent && this.state === STATE.LISTENING) {
        this._setState(STATE.IDLE);
      }
    }

    // ------------------------------------------------------------------------
    // Waveform visualizer — a synthetic animated pulse, not audio-reactive.
    // (See the note in _startListening for why this isn't wired to real
    // microphone amplitude via getUserMedia/AnalyserNode.)
    // ------------------------------------------------------------------------

    _startWaveform(mode) {
      this._stopWaveform();

      const barCount = 14;
      const canvases = [
        { canvas: this.$waveLeft, ctx: this.$waveLeftCtx },
        { canvas: this.$waveRight, ctx: this.$waveRightCtx },
      ];

      const drawAll = (amplitudeFn) => {
        canvases.forEach(({ canvas, ctx }) => this._drawBars(ctx, canvas.width, canvas.height, barCount, amplitudeFn));
      };

      // Same synthetic pulse for both listening and speaking — a bit livelier
      // while listening, a bit steadier while speaking, but neither is tied
      // to real microphone amplitude (see the note above _startListening).
      const speed = mode === 'listening' ? 0.22 : 0.18;
      let t = 0;
      const draw = () => {
        t += speed;
        drawAll((i) => 0.35 + 0.45 * Math.abs(Math.sin(t + i * 0.6)));
        this._waveformRAF = requestAnimationFrame(draw);
      };
      draw();
    }

    _drawBars(ctx, w, h, barCount, amplitudeFn) {
      ctx.clearRect(0, 0, w, h);
      const gap = 3;
      const barWidth = (w - gap * (barCount - 1)) / barCount;
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#f6c453');
      gradient.addColorStop(1, '#c9962f');
      ctx.fillStyle = gradient;

      for (let i = 0; i < barCount; i++) {
        const amp = Math.max(0.06, amplitudeFn(i));
        const barH = amp * h;
        const x = i * (barWidth + gap);
        const y = (h - barH) / 2;
        this._roundRect(ctx, x, y, barWidth, barH, barWidth / 2);
        ctx.fill();
      }
    }

    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    _stopWaveform() {
      if (this._waveformRAF) {
        cancelAnimationFrame(this._waveformRAF);
        this._waveformRAF = null;
      }
      if (this.$waveLeftCtx) {
        this.$waveLeftCtx.clearRect(0, 0, this.$waveLeft.width, this.$waveLeft.height);
      }
      if (this.$waveRightCtx) {
        this.$waveRightCtx.clearRect(0, 0, this.$waveRight.width, this.$waveRight.height);
      }
    }

    // ------------------------------------------------------------------------
    // Sending the question to your Groq integration
    // ------------------------------------------------------------------------

    async _handleFinalQuestion(question) {
      if (!question || this.isProcessing) return;
      this.isProcessing = true;

      this.$helperText.textContent = '\u00A0';
      this._addMessage('user', question);
      this._setState(STATE.THINKING);
      this._showThinkingBubble(true);

      const productData = this._resolveProductData();

      try {
        const answer = await this._askAI(question, productData);
        this._showThinkingBubble(false);
        this._addMessage('ai', answer);

        if (this.config.autoSpeak) {
          this._speak(answer);
        } else {
          this._setState(STATE.IDLE);
        }
      } catch (err) {
        this._showThinkingBubble(false);
        console.error('[ManhattanVoiceAssistant] askAI failed:', err);
        this._showError('aiFailure');
      } finally {
        this.isProcessing = false;
      }
    }

    _resolveProductData() {
      if (typeof this.config.getProductData === 'function') {
        try { return this.config.getProductData() || null; } catch (e) { return null; }
      }
      return this.config.productData || null;
    }

    /** Payload shape matches the spec exactly: { question, product }. */
    _buildPayload(question, productData) {
      return { question, product: productData };
    }

    async _askAI(question, productData) {
      if (typeof this.config.askAI === 'function') {
        return await this.config.askAI(question, productData);
      }

      for (const name of AUTO_DETECT_NAMES) {
        if (typeof global[name] === 'function') {
          return await global[name](question, productData);
        }
      }

      return await this._fallbackAskAI(question, productData);
    }

    /** Placeholder network call — replace by passing `askAI` in the config. */
    async _fallbackAskAI(question, productData) {
      const systemPrompt = typeof this.config.systemPromptBuilder === 'function'
        ? this.config.systemPromptBuilder(productData)
        : buildSystemPrompt(productData);

      const response = await fetch('/api/groq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign(
          { system: systemPrompt },
          this._buildPayload(question, productData)
        )),
      });

      if (!response.ok) {
        throw new Error(`Groq placeholder endpoint returned ${response.status}`);
      }

      const data = await response.json();
      // Accept a couple of common shapes so the fallback is useful out of the box.
      return data.answer || data.response || data.text || JSON.stringify(data);
    }

    // ------------------------------------------------------------------------
    // Text-to-speech
    // ------------------------------------------------------------------------

    _onVoicesChanged() {
      this._voicesReady = true;
    }

    _pickVoice() {
      if (!this._ttsSupported) return null;
      const voices = global.speechSynthesis.getVoices();
      for (const name of this.config.preferredVoiceNames) {
        const match = voices.find((v) => v.name === name);
        if (match) return match;
      }
      return voices.find((v) => v.lang && v.lang.startsWith('en')) || voices[0] || null;
    }

    _speak(text) {
      if (!this._ttsSupported) {
        this._showError('ttsUnavailable');
        this._setState(STATE.IDLE);
        return;
      }

      this._stopSpeaking(); // cancel any previous utterance first

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.config.lang;
      utterance.rate = this.config.speechRate;
      utterance.pitch = this.config.speechPitch;
      const voice = this._pickVoice();
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        this._setState(STATE.SPEAKING);
        this._startWaveform('speaking');
      };
      utterance.onboundary = () => {
        // Word-boundary events give the waveform a natural "talking" pulse;
        // the animation loop already reacts to time, this just keeps it lively.
      };
      utterance.onend = () => {
        this._stopWaveform();
        this._currentUtterance = null;
        if (this.state === STATE.SPEAKING) this._setState(STATE.IDLE);
      };
      utterance.onerror = () => {
        this._stopWaveform();
        this._currentUtterance = null;
        this._showError('ttsUnavailable');
      };

      this._currentUtterance = utterance;
      global.speechSynthesis.speak(utterance);
    }

    _stopSpeaking() {
      if (this._ttsSupported && global.speechSynthesis.speaking) {
        global.speechSynthesis.cancel();
      }
      this._currentUtterance = null;
      this._stopWaveform();
    }

    // ------------------------------------------------------------------------
    // Conversation rendering
    // ------------------------------------------------------------------------

    _showThinkingBubble(show) {
      let el = this.$messages.querySelector('.mh-va-thinking-dots');
      if (show) {
        if (!el) {
          el = document.createElement('div');
          el.className = 'mh-va-thinking-dots';
          el.innerHTML = '<span></span><span></span><span></span>';
          this.$messages.appendChild(el);
        }
        this._scrollToBottom();
      } else if (el) {
        el.remove();
      }
    }

    _addMessage(role, text) {
      this.history.push({ role, text, timestamp: Date.now() });
      if (this.$emptyState) {
        this.$emptyState.remove();
        this.$emptyState = null;
      }

      const bubble = document.createElement('div');
      const roleClass = role === 'user' ? 'mh-va-msg-user' : role === 'error' ? 'mh-va-msg-error' : 'mh-va-msg-ai';
      bubble.className = `mh-va-msg ${roleClass}`;
      bubble.textContent = text;

      if (role !== 'error') {
        const meta = document.createElement('span');
        meta.className = 'mh-va-msg-meta';
        meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        bubble.appendChild(meta);
      }

      this.$messages.appendChild(bubble);
      this._scrollToBottom();
    }

    _scrollToBottom() {
      requestAnimationFrame(() => {
        this.$messages.scrollTop = this.$messages.scrollHeight;
      });
    }

    // ------------------------------------------------------------------------
    // Errors — always surfaced as a toast, never inside the modal frame,
    // so the pill/mic/waveform animation stays uninterrupted.
    // ------------------------------------------------------------------------

    _showError(key) {
      const message = ERROR_MESSAGES[key] || ERROR_MESSAGES.generic;
      this._showToast(message);
      this._setState(STATE.ERROR);
    }

    _showToast(message) {
      clearTimeout(this._toastTimer);

      this.$toast.textContent = message;
      this.$toast.classList.add('mh-va-toast-visible');

      this._toastTimer = setTimeout(() => {
        this.$toast.classList.remove('mh-va-toast-visible');
      }, 4200);
    }

    _esc(str) {
      const div = document.createElement('div');
      div.textContent = str == null ? '' : String(str);
      return div.innerHTML;
    }
  }

  // Expose helpers alongside the class for advanced/custom integrations.
  ManhattanVoiceAssistant.buildSystemPrompt = buildSystemPrompt;
  ManhattanVoiceAssistant.STATE = STATE;

  global.ManhattanVoiceAssistant = ManhattanVoiceAssistant;
})(window);