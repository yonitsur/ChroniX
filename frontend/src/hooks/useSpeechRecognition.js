import { useState, useRef, useCallback, useEffect } from 'react';

const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

/**
 * Live speech-to-text hook powered by the browser Web Speech API.
 * Streams interim and final transcripts directly into the caller's text state
 * via `onTextChange`, preserving any text that was already in the input when
 * dictation started.
 */
export function useSpeechRecognition({ language = 'en', onTextChange, onError } = {}) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const prefixTextRef = useRef('');
  const onTextChangeRef = useRef(onTextChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const isSupported = Boolean(SpeechRecognitionImpl);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      recognitionRef.current = null;
      try {
        rec.stop();
      } catch {
        // Ignore if already stopped
      }
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(
    (initialText = '') => {
      if (!SpeechRecognitionImpl) {
        onErrorRef.current?.('not-supported');
        return false;
      }

      // Stop any existing session first
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
      }

      prefixTextRef.current = (initialText || '').trim();

      const recognition = new SpeechRecognitionImpl();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = String(language).toLowerCase().startsWith('he') ? 'he-IL' : 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        let sessionTranscript = '';
        for (let i = 0; i < event.results.length; i += 1) {
          sessionTranscript += event.results[i][0].transcript;
        }
        const cleaned = sessionTranscript.trim();
        const prefix = prefixTextRef.current;
        const combined = prefix && cleaned ? `${prefix} ${cleaned}` : prefix || cleaned;
        onTextChangeRef.current?.(combined);
      };

      recognition.onerror = (event) => {
        const errCode = event?.error || 'unknown';
        if (errCode !== 'aborted' && errCode !== 'no-speech') {
          onErrorRef.current?.(errCode);
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setIsListening(true);
        return true;
      } catch (err) {
        setIsListening(false);
        recognitionRef.current = null;
        onErrorRef.current?.(err?.message || 'start-failed');
        return false;
      }
    },
    [language]
  );

  const toggleListening = useCallback(
    (currentText = '') => {
      if (isListening) {
        stopListening();
      } else {
        startListening(currentText);
      }
    },
    [isListening, startListening, stopListening]
  );

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    startListening,
    stopListening,
    toggleListening,
  };
}
