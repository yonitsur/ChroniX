import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ArrowUp, Square, Globe, Zap, Mic, MicOff, Camera, Upload, X } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { readGroundingPref, writeGroundingPref } from '../utils/groundingConfig';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import CameraCaptureModal from './CameraCaptureModal';

const MAX_PROMPT_PHOTOS = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export default function PromptBar({
  onGenerate,
  onStop,
  isLoading,
  activePrompt = '',
}) {
  const { t, isRtl, language } = useLanguage();
  const [prompt, setPrompt] = useState(activePrompt);
  const [prevActivePrompt, setPrevActivePrompt] = useState(activePrompt);
  // True while the current prompt text came (at least partly) from microphone dictation.
  const [isVoicePrompt, setIsVoicePrompt] = useState(false);
  const [grounding, setGrounding] = useState(readGroundingPref);
  const [attachedPhotos, setAttachedPhotos] = useState([]); // [{ id, file, previewUrl }]
  const [isPhotoMenuOpen, setIsPhotoMenuOpen] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [statusToast, setStatusToast] = useState(null);

  const isCompactViewport = () => typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight <= 520);
  const [isMobile, setIsMobile] = useState(isCompactViewport);
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);
  const photoMenuRef = useRef(null);

  const showToast = useCallback((msg) => {
    setStatusToast(msg);
  }, []);

  useEffect(() => {
    if (!statusToast) return undefined;
    const timer = setTimeout(() => setStatusToast(null), 4000);
    return () => clearTimeout(timer);
  }, [statusToast]);

  const { isListening, toggleListening, stopListening } = useSpeechRecognition({
    language,
    onTextChange: (nextText) => {
      setPrompt(nextText);
      if (nextText.trim()) setIsVoicePrompt(true);
    },
    onError: (errCode) => {
      if (errCode === 'not-supported') {
        showToast(t('toolbar.voiceNotSupported'));
      } else if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
        showToast(t('toolbar.voicePermissionDenied'));
      }
    },
  });

  // Close photo menu on outside click
  useEffect(() => {
    if (!isPhotoMenuOpen) return undefined;
    const handleOutside = (e) => {
      if (photoMenuRef.current && !photoMenuRef.current.contains(e.target)) {
        setIsPhotoMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isPhotoMenuOpen]);

  // Clean up object URLs on unmount
  const attachedPhotosRef = useRef(attachedPhotos);
  useEffect(() => {
    attachedPhotosRef.current = attachedPhotos;
  }, [attachedPhotos]);
  useEffect(() => {
    return () => {
      attachedPhotosRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const addPhotoFiles = useCallback(
    (fileList) => {
      const incoming = Array.from(fileList || []);
      if (!incoming.length) return;

      const validItems = [];
      let rejected = false;

      for (const file of incoming) {
        const mime = (file.type || '').toLowerCase();
        if (!ALLOWED_IMAGE_MIMES.has(mime) || file.size > MAX_PHOTO_BYTES) {
          rejected = true;
          continue;
        }
        validItems.push({
          id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }

      if (rejected) {
        showToast(t('chat.attachErrorRejected'));
      }

      if (validItems.length > 0) {
        setAttachedPhotos((prev) => {
          const combined = [...prev, ...validItems];
          if (combined.length > MAX_PROMPT_PHOTOS) {
            const overflow = combined.slice(MAX_PROMPT_PHOTOS);
            overflow.forEach((item) => {
              if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
            });
            return combined.slice(0, MAX_PROMPT_PHOTOS);
          }
          return combined;
        });
      }
    },
    [showToast, t]
  );

  const removePhoto = useCallback((id) => {
    setAttachedPhotos((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const hasPhotos = attachedPhotos.length > 0;
  const canSubmit = Boolean(prompt.trim() || hasPhotos);

  // Sync state if activePrompt prop changes (e.g. prompt guide, example prompt cards, history items, or new timeline)
  if (activePrompt !== prevActivePrompt) {
    setPrevActivePrompt(activePrompt);
    if (activePrompt !== prompt) {
      setPrompt(activePrompt);
      setIsVoicePrompt(false);
    }
  }

  // Auto-expand textarea height based on content
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const isMob = isCompactViewport();
    const minH = isMob ? 28 : 32;
    const maxH = isMob ? 165 : 210;
    const scrollH = el.scrollHeight;
    const nextH = Math.min(Math.max(scrollH, minH), maxH);
    el.style.height = `${nextH}px`;
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [prompt, adjustHeight]);

  useEffect(() => {
    const id = requestAnimationFrame(adjustHeight);
    return () => cancelAnimationFrame(id);
  }, [prompt, adjustHeight]);

  useEffect(() => {
    const handleResize = () => {
      const mob = isCompactViewport();
      setIsMobile((prev) => (prev !== mob ? mob : prev));
      adjustHeight();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight]);

  useEffect(() => {
    if (activePrompt && window.innerWidth >= 768 && !isLoading) {
      inputRef.current?.focus();
    }
  }, [activePrompt, isLoading]);

  const setGroundingValue = (next) => {
    if (isLoading || next === grounding) return;
    setGrounding(next);
    writeGroundingPref(next);
  };

  const toggleGrounding = () => {
    if (isLoading) return;
    setGroundingValue(!grounding);
  };

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    if (!canSubmit || isLoading) return;
    if (isListening) {
      stopListening();
    }
    const filesToSubmit = attachedPhotos.map((p) => p.file);
    onGenerate(prompt.trim(), grounding, filesToSubmit, isVoicePrompt && prompt.trim() ? 'voice' : 'typed');
    // Clean up previews after submitting
    attachedPhotos.forEach((p) => {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    });
    setAttachedPhotos([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape' && prompt) {
      e.preventDefault();
      setPrompt('');
      setIsVoicePrompt(false);
    }
  };

  const handlePaste = (e) => {
    if (isLoading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      addPhotoFiles(pastedFiles);
    }
  };

  const isPromptRtl = prompt
    ? /[\u0590-\u05FF\u0600-\u06FF]/.test(prompt)
    : isRtl;

  const minH = isMobile ? 28 : 32;

  return (
    <div className="relative w-full max-w-3xl mx-auto px-2 sm:px-4 z-40 transition-all">
      <form data-home-prompt onSubmit={handleSubmit} className="relative group w-full">
        {/* Delicate 2-tier floating dock container: full width for text on top, sleek action bar on bottom */}
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`prompt-dock-shell relative transition-all duration-200 flex flex-col rounded-2xl sm:rounded-3xl px-3 sm:px-4 pt-2.5 sm:pt-3 pb-2 sm:pb-2.5 gap-1.5 ${
            isLoading ? 'prompt-bar-shell-running' : !canSubmit ? 'prompt-bar-shell-idle' : ''
          }`}
        >
          {/* Attached Photo Thumbnails Strip */}
          {hasPhotos && (
            <div className="flex items-center gap-2 px-1 pt-0.5 pb-1 overflow-x-auto scrollbar-none">
              {attachedPhotos.map((item) => (
                <div
                  key={item.id}
                  className="relative group/thumb w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border border-line-strong shrink-0 bg-surface-sunken shadow-sm"
                >
                  <img
                    src={item.previewUrl}
                    alt={item.file.name || 'Attached photo'}
                    className="w-full h-full object-cover"
                  />
                  {!isLoading && (
                    <button
                      type="button"
                      onClick={() => removePhoto(item.id)}
                      title={t('toolbar.removePhoto')}
                      aria-label={t('toolbar.removePhoto')}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Top tier: 100% width dedicated exclusively to text input */}
          <textarea
            ref={inputRef}
            rows={1}
            dir={isPromptRtl ? 'rtl' : 'ltr'}
            value={prompt}
            readOnly={isLoading}
            onChange={(e) => {
              if (isLoading) return;
              setPrompt(e.target.value);
              if (!e.target.value.trim()) setIsVoicePrompt(false);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            maxLength={3000}
            title={prompt || undefined}
            placeholder={
              hasPhotos
                ? t('toolbar.inputPlaceholderWithPhoto')
                : t('toolbar.inputPlaceholder')
            }
            className={`w-full px-1 sm:px-1.5 py-0.5 bg-transparent text-ink placeholder:text-ink-subtle placeholder:truncate text-[14.5px] sm:text-base md:text-[17px] outline-none font-normal tracking-normal resize-none overflow-y-auto leading-relaxed scrollbar-none transition-colors prompt-bar-input ${
              isPromptRtl ? 'text-right' : 'text-left'
            } ${isLoading ? 'cursor-default select-text' : ''}`}
            style={{ minHeight: `${minH}px` }}
          />

          {/* Bottom tier: Sleek, airy action toolbar row */}
          <div className="w-full flex items-center justify-between pt-1.5 px-0.5 border-t border-line/40">
            {/* Start side: Grounding mode toggle (Mobile Smart Chip + Desktop Segmented Capsule) */}
            <div
              id="guide-home-grounding"
              data-guide="home-grounding"
              dir={isRtl ? 'rtl' : 'ltr'}
              className="shrink-0 select-none flex items-center"
            >
              {/* Mobile: Ultra-sleek Smart Chip */}
              <button
                type="button"
                onClick={toggleGrounding}
                disabled={isLoading}
                title={grounding ? t('toolbar.groundingVerifiedTip') : t('toolbar.groundingFastTip')}
                aria-label={t('toolbar.groundingToggle')}
                className={`sm:hidden inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-caption font-medium transition-all duration-200 cursor-pointer active:scale-95 border ${
                  grounding
                    ? 'bg-surface-active border-line-strong text-ink font-semibold'
                    : 'bg-surface-sunken/90 border-line/70 text-ink-muted hover:text-ink hover:bg-surface-hover/80'
                } disabled:opacity-50 disabled:cursor-default`}
              >
                {grounding ? (
                  <>
                    <Globe className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">{t('toolbar.groundingToggle')}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 shrink-0" />
                    <span className="whitespace-nowrap">{t('toolbar.groundingFast')}</span>
                  </>
                )}
              </button>

              {/* Desktop: Full Linear/Perplexity Segmented Capsule */}
              <div
                role="radiogroup"
                aria-label={t('toolbar.groundingToggle')}
                className="seg-track hidden sm:inline-flex items-center p-0.5 rounded-full gap-0.5"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!grounding}
                  disabled={isLoading}
                  onClick={() => setGroundingValue(false)}
                  title={t('toolbar.groundingFastTip')}
                  className={`seg-item inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption sm:text-xs font-medium whitespace-nowrap cursor-pointer ${
                    !grounding ? 'seg-item-active' : ''
                  } disabled:opacity-50 disabled:cursor-default`}
                >
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('toolbar.groundingFast')}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={grounding}
                  disabled={isLoading}
                  onClick={() => setGroundingValue(true)}
                  title={t('toolbar.groundingVerifiedTip')}
                  className={`seg-item inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption sm:text-xs font-medium whitespace-nowrap cursor-pointer ${
                    grounding ? 'seg-item-active' : ''
                  } disabled:opacity-50 disabled:cursor-default`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('toolbar.groundingToggle')}</span>
                </button>
              </div>
            </div>

            {/* End cluster: Multimodal input triggers (Camera & Voice) + Submit / Stop Action Button */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {/* Camera / Photo Prompt Button + Popover Menu */}
              <div ref={photoMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setIsPhotoMenuOpen((prev) => !prev)}
                  title={t('toolbar.photoPromptTooltip')}
                  aria-label={t('toolbar.photoPromptBtn')}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                    hasPhotos || isPhotoMenuOpen
                      ? 'bg-accent-soft text-accent border border-accent/30'
                      : 'text-ink-muted hover:text-ink hover:bg-surface-hover/80'
                  } disabled:opacity-50 disabled:cursor-default`}
                >
                  <Camera className="w-4 h-4 shrink-0" />
                </button>

                {isPhotoMenuOpen && (
                  <div
                    dir={isRtl ? 'rtl' : 'ltr'}
                    className={`absolute top-full mt-2 ${
                      isRtl ? 'left-0' : 'right-0'
                    } w-48 bg-surface-overlay rounded-xl border border-line shadow-pop p-1.5 z-[120] text-xs text-start animate-in fade-in zoom-in-95 duration-150`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsPhotoMenuOpen(false);
                        setIsCameraModalOpen(true);
                      }}
                      className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4 text-ink-subtle shrink-0" />
                      <span className="font-medium">{t('toolbar.takePhoto')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsPhotoMenuOpen(false);
                        photoInputRef.current?.click();
                      }}
                      className="w-full text-start px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 text-ink-muted hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-ink-subtle shrink-0" />
                      <span className="font-medium">{t('toolbar.uploadPhoto')}</span>
                    </button>
                  </div>
                )}

                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const selected = e.target.files;
                    if (selected?.length) {
                      addPhotoFiles(selected);
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              {/* Voice Input / Speech-to-Text Button */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => toggleListening(prompt)}
                title={isListening ? t('toolbar.voiceListening') : t('toolbar.voiceInputTooltip')}
                aria-label={isListening ? t('toolbar.voiceListening') : t('toolbar.voiceInput')}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  isListening
                    ? 'bg-red-500/15 text-red-500 ring-2 ring-red-500/40 animate-pulse'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-hover/80'
                } disabled:opacity-50 disabled:cursor-default`}
              >
                {isListening ? (
                  <MicOff className="w-4 h-4 shrink-0" />
                ) : (
                  <Mic className="w-4 h-4 shrink-0" />
                )}
              </button>

              {/* Submit / Stop Action Button */}
              <button
                type={isLoading ? 'button' : 'submit'}
                onClick={
                  isLoading
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onStop?.();
                      }
                    : undefined
                }
                disabled={!isLoading && !canSubmit}
                className={`prompt-submit-btn w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center font-medium rounded-full transition-[background-color,color,transform,opacity] duration-150 shrink-0 active:scale-95 ${
                  isLoading
                    ? 'bg-danger hover:bg-danger-hover text-danger-fg shadow-control cursor-pointer'
                    : canSubmit
                    ? 'bg-accent hover:bg-accent-hover text-accent-fg shadow-control cursor-pointer'
                    : 'bg-surface-hover text-ink-faint cursor-default'
                }`}
                title={isLoading ? t('toolbar.stopGenerateBtn') : t('toolbar.generateBtn')}
                aria-label={isLoading ? t('toolbar.stopGenerateBtn') : t('toolbar.generateBtn')}
              >
                {isLoading ? (
                  <Square className="w-3.5 h-3.5 fill-current shrink-0" />
                ) : (
                  <ArrowUp className="w-4 h-4 shrink-0" strokeWidth={2.2} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Status / error toast below prompt bar */}
        {statusToast && (
          <div className="mt-2 text-center">
            <span className="inline-block px-3.5 py-1.5 rounded-full text-xs font-medium bg-surface-overlay border border-line-strong text-ink shadow-md">
              {statusToast}
            </span>
          </div>
        )}
      </form>

      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={(file) => {
          addPhotoFiles([file]);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}
