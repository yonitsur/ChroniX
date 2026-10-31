import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowUp,
  Square,
  Globe,
  Zap,
  Mic,
  MicOff,
  Camera,
  Paperclip,
  FileText,
  X,
  Sparkles,
} from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { isDefaultGroundingEnabled } from '../utils/groundingConfig';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { findMatchingTimelines, getApiKey } from '../api';
import {
  PROMPT_FILE_ACCEPT,
  formatFileSize,
  getPromptUploadLimits,
  validateIncomingPromptFiles,
} from '../utils/fileUploadValidation';
import CameraCaptureModal from './CameraCaptureModal';

export default function PromptBar({
  onGenerate,
  onStop,
  isLoading,
  activePrompt = '',
  onOpenExistingTimeline = null,
}) {
  const { t, isRtl, language } = useLanguage();
  const { isGuest } = useAuth();
  const [prompt, setPrompt] = useState(activePrompt);
  const [prevActivePrompt, setPrevActivePrompt] = useState(activePrompt);
  // True while the current prompt text came (at least partly) from microphone dictation.
  const [isVoicePrompt, setIsVoicePrompt] = useState(false);
  const [grounding, setGrounding] = useState(isDefaultGroundingEnabled);
  // [{ id, file, kind: 'image' | 'pdf' | 'text', badgeLabel, previewUrl }]
  const [attachedItems, setAttachedItems] = useState([]);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [statusToast, setStatusToast] = useState(null);
  const [matchingTimelines, setMatchingTimelines] = useState([]);
  const [hasCustomKey, setHasCustomKey] = useState(() => Boolean(getApiKey()?.trim()));

  const isCompactViewport = () => typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight <= 520);
  const [isMobile, setIsMobile] = useState(isCompactViewport);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const syncCustomKey = () => setHasCustomKey(Boolean(getApiKey()?.trim()));
    window.addEventListener('chronix-api-key-change', syncCustomKey);
    window.addEventListener('storage', syncCustomKey);
    return () => {
      window.removeEventListener('chronix-api-key-change', syncCustomKey);
      window.removeEventListener('storage', syncCustomKey);
    };
  }, []);

  const uploadLimits = useMemo(
    () => getPromptUploadLimits({ isGuest, hasCustomKey }),
    [isGuest, hasCustomKey]
  );

  const showToast = useCallback((msg) => {
    setStatusToast(msg);
  }, []);

  useEffect(() => {
    if (!statusToast) return undefined;
    const timer = setTimeout(() => setStatusToast(null), 4500);
    return () => clearTimeout(timer);
  }, [statusToast]);

  useEffect(() => {
    if (typeof onOpenExistingTimeline !== 'function' || isLoading || attachedItems.length > 0) {
      setMatchingTimelines([]);
      return undefined;
    }
    const clean = (prompt || '').trim();
    if (clean.length < 3) {
      setMatchingTimelines([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const matches = await findMatchingTimelines(clean, null, 2, controller.signal);
      if (!controller.signal.aborted) {
        setMatchingTimelines(Array.isArray(matches) ? matches : []);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [prompt, isLoading, attachedItems.length, onOpenExistingTimeline]);

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

  // Clean up object URLs on unmount
  const attachedItemsRef = useRef(attachedItems);
  useEffect(() => {
    attachedItemsRef.current = attachedItems;
  }, [attachedItems]);
  useEffect(() => {
    return () => {
      attachedItemsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const formatUploadError = useCallback(
    (err) => {
      if (!err) return null;
      switch (err.reason) {
        case 'empty':
          return t('toolbar.uploadErrorEmpty');
        case 'too_large':
          return t('toolbar.uploadErrorTooLarge', { maxMb: err.maxMb });
        case 'text_too_large':
          return t('toolbar.uploadErrorTextTooLarge', { maxKb: err.maxTextKb });
        case 'max_files':
          return t('toolbar.uploadErrorMaxFiles', { maxFiles: err.maxFiles });
        case 'total_size':
          return t('toolbar.uploadErrorTotalSize', { maxTotalMb: err.maxTotalMb });
        case 'unsupported':
        default:
          return t('toolbar.uploadErrorUnsupported');
      }
    },
    [t]
  );

  const addAttachments = useCallback(
    (fileList) => {
      const incoming = Array.from(fileList || []);
      if (!incoming.length) return;

      const { accepted, firstError } = validateIncomingPromptFiles(
        attachedItemsRef.current,
        incoming,
        uploadLimits
      );

      if (firstError) {
        showToast(formatUploadError(firstError));
      }

      if (accepted.length > 0) {
        const prepared = accepted.map(({ file, kind, badgeLabel }) => ({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          kind,
          badgeLabel,
          previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
        }));
        setAttachedItems((prev) => [...prev, ...prepared]);
      }
    },
    [uploadLimits, formatUploadError, showToast]
  );

  const removeAttachment = useCallback((id) => {
    setAttachedItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const hasAttachments = attachedItems.length > 0;
  const hasDocumentAttachments = useMemo(
    () => attachedItems.some((item) => item.kind !== 'image'),
    [attachedItems]
  );
  const hasImageAttachments = useMemo(
    () => attachedItems.some((item) => item.kind === 'image'),
    [attachedItems]
  );
  const canSubmit = Boolean(prompt.trim() || hasAttachments);

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
    const filesToSubmit = attachedItems.map((item) => item.file);
    onGenerate(prompt.trim(), grounding, filesToSubmit, isVoicePrompt && prompt.trim() ? 'voice' : 'typed');
    // Clean up previews after submitting
    attachedItems.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setAttachedItems([]);
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
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      addAttachments(pastedFiles);
    }
  };

  const hasDraggedFiles = (e) => {
    const types = e.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes('Files'));
  };

  const handleDragEnter = (e) => {
    if (isLoading || !hasDraggedFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (!isDraggingFiles) setIsDraggingFiles(true);
  };

  const handleDragOver = (e) => {
    if (isLoading || !hasDraggedFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingFiles) setIsDraggingFiles(true);
  };

  const handleDragLeave = (e) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (isLoading) return;
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) {
      addAttachments(dropped);
      inputRef.current?.focus();
    }
  };

  const isPromptRtl = prompt
    ? /[\u0590-\u05FF\u0600-\u06FF]/.test(prompt)
    : isRtl;

  const minH = isMobile ? 28 : 32;

  const placeholderText = hasAttachments
    ? hasDocumentAttachments
      ? t('toolbar.inputPlaceholderWithFiles')
      : t('toolbar.inputPlaceholderWithPhoto')
    : t('toolbar.inputPlaceholder');

  return (
    <div className="relative w-full max-w-3xl mx-auto px-2 sm:px-4 z-40 transition-all">
      <form data-home-prompt onSubmit={handleSubmit} className="relative group w-full">
        {/* Delicate 2-tier floating dock container: full width for text on top, sleek action bar on bottom */}
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`prompt-dock-shell relative transition-all duration-200 flex flex-col rounded-2xl sm:rounded-3xl px-3 sm:px-4 pt-2.5 sm:pt-3 pb-2 sm:pb-2.5 gap-1.5 ${
            isDraggingFiles
              ? 'ring-2 ring-accent/50 border-accent bg-accent-soft/15'
              : isLoading
              ? 'prompt-bar-shell-running'
              : !canSubmit
              ? 'prompt-bar-shell-idle'
              : ''
          }`}
        >
          {/* Drag-and-drop overlay indicator */}
          {isDraggingFiles && !isLoading && (
            <div className="pointer-events-none absolute inset-1.5 rounded-xl sm:rounded-2xl border-2 border-dashed border-accent/60 bg-surface-overlay/90 backdrop-blur-xs z-30 flex items-center justify-center px-4 text-center">
              <span className="inline-flex items-center gap-2 text-xs sm:text-body-sm font-semibold text-accent">
                <Paperclip className="w-4 h-4 shrink-0" />
                <span>{t('toolbar.dropFilesHint')}</span>
              </span>
            </div>
          )}

          {/* Attached Files & Photo Thumbnails Strip */}
          {hasAttachments && (
            <div className="flex items-center gap-2 px-1 pt-0.5 pb-1 overflow-x-auto scrollbar-none">
              {attachedItems.map((item) =>
                item.kind === 'image' && item.previewUrl ? (
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
                        onClick={() => removeAttachment(item.id)}
                        title={t('toolbar.removePhoto')}
                        aria-label={t('toolbar.removePhoto')}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    key={item.id}
                    className="relative h-14 sm:h-16 max-w-[200px] sm:max-w-[235px] rounded-xl border border-line-strong bg-surface-sunken/95 px-2.5 sm:px-3 flex items-center gap-2.5 shrink-0 shadow-sm"
                  >
                    <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-accent-soft text-accent border border-accent/25 flex flex-col items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 shrink-0" />
                    </div>
                    <div className="min-w-0 flex-1 pe-4">
                      <p
                        dir="auto"
                        className="text-xs font-semibold text-ink truncate leading-tight"
                        title={item.file.name}
                      >
                        {item.file.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-ink-subtle">
                        <span className="font-semibold uppercase tracking-wide text-accent">
                          {item.badgeLabel || 'DOC'}
                        </span>
                        <span>·</span>
                        <span dir="ltr">{formatFileSize(item.file.size)}</span>
                      </div>
                    </div>
                    {!isLoading && (
                      <button
                        type="button"
                        onClick={() => removeAttachment(item.id)}
                        title={t('toolbar.removeAttachment')}
                        aria-label={t('toolbar.removeAttachment')}
                        className="absolute top-1.5 end-1.5 w-5 h-5 rounded-full bg-surface-hover hover:bg-danger/15 text-ink-muted hover:text-danger flex items-center justify-center transition-colors active:scale-90 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )
              )}
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
            placeholder={placeholderText}
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

            {/* End cluster: Multimodal input triggers (Attach Files, Camera & Voice) + Submit / Stop Action Button */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {/* Attach Files Button (PDF, TXT, MD, Images) — mirrors TimelineChatPanel */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => fileInputRef.current?.click()}
                title={t('toolbar.attachFilesTooltip')}
                aria-label={t('toolbar.attachFilesBtn')}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 shrink-0 ${
                  hasDocumentAttachments
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-hover/80'
                } disabled:opacity-50 disabled:cursor-default`}
              >
                <Paperclip className="w-4 h-4 shrink-0" />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept={PROMPT_FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files;
                  if (selected?.length) {
                    addAttachments(selected);
                    inputRef.current?.focus();
                  }
                  e.target.value = '';
                }}
              />

              {/* Direct Camera Capture Button */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setIsCameraModalOpen(true)}
                title={t('toolbar.takePhotoTooltip')}
                aria-label={t('toolbar.takePhoto')}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 shrink-0 ${
                  hasImageAttachments || isCameraModalOpen
                    ? 'bg-accent-soft text-accent border border-accent/30'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-hover/80'
                } disabled:opacity-50 disabled:cursor-default`}
              >
                <Camera className="w-4 h-4 shrink-0" />
              </button>

              {/* Voice Input / Speech-to-Text Button */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => toggleListening(prompt)}
                title={isListening ? t('toolbar.voiceListening') : t('toolbar.voiceInputTooltip')}
                aria-label={isListening ? t('toolbar.voiceListening') : t('toolbar.voiceInput')}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 shrink-0 ${
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

        {/* Community Cache: Instant Existing Timeline Reuse Suggestion */}
        {!isLoading && matchingTimelines.length > 0 && typeof onOpenExistingTimeline === 'function' && (
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="mt-2.5 p-2.5 sm:px-3.5 sm:py-2.5 rounded-2xl bg-surface-raised/95 border border-accent/35 backdrop-blur-md shadow-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-start animate-in fade-in slide-in-from-top-1 duration-200"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent-soft text-accent border border-accent/25 shrink-0">
                <Sparkles className="w-3 h-3 shrink-0" />
                <span>{t('communityMatch.badge')}</span>
              </span>
              <span className="text-xs font-semibold text-ink truncate" title={matchingTimelines[0].title}>
                {matchingTimelines[0].title}
              </span>
              {matchingTimelines[0].articleCount > 0 && (
                <span className="text-caption text-ink-subtle shrink-0">
                  ({t('communityMatch.eventsCount', { count: matchingTimelines[0].articleCount })})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                type="button"
                onClick={() => onOpenExistingTimeline(matchingTimelines[0].id)}
                className="px-3 py-1 rounded-full bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
              >
                {t('communityMatch.instantLoadBtn')}
              </button>
            </div>
          </div>
        )}
      </form>

      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCapture={(file) => {
          addAttachments([file]);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}
