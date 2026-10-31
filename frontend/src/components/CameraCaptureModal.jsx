import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, RotateCcw, Check, Upload, RefreshCw } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

export default function CameraCaptureModal({ isOpen, onClose, onCapture }) {
  const { t, isRtl } = useLanguage();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const [facingMode, setFacingMode] = useState('environment');
  const [isStarting, setIsStarting] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [capturedPhoto, setCapturedPhoto] = useState(null); // { file, previewUrl }

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (mode = facingMode) => {
      stopStream();
      setCameraError(null);
      setIsStarting(true);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(t('toolbar.cameraPermissionDenied'));
        setIsStarting(false);
        return;
      }

      try {
        let mediaStream;
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1536 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available video device
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setCameraError(t('toolbar.cameraPermissionDenied'));
      } finally {
        setIsStarting(false);
      }
    },
    [facingMode, stopStream, t]
  );

  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null);
      startCamera(facingMode);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, startCamera, stopStream]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    return () => {
      if (capturedPhoto?.previewUrl) {
        URL.revokeObjectURL(capturedPhoto.previewUrl);
      }
    };
  }, [capturedPhoto]);

  if (!isOpen) return null;

  const handleCaptureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    const maxDim = 1536;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const fileName = `camera-photo-${Date.now()}.jpg`;
        const file = new File([blob], fileName, { type: 'image/jpeg' });
        const previewUrl = URL.createObjectURL(blob);
        stopStream();
        setCapturedPhoto({ file, previewUrl });
      },
      'image/jpeg',
      0.88
    );
  };

  const handleRetake = () => {
    if (capturedPhoto?.previewUrl) {
      URL.revokeObjectURL(capturedPhoto.previewUrl);
    }
    setCapturedPhoto(null);
    startCamera(facingMode);
  };

  const handleConfirmPhoto = () => {
    if (!capturedPhoto?.file) return;
    onCapture?.(capturedPhoto.file);
    onClose?.();
  };

  const handleSwitchCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleFallbackFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      stopStream();
      onCapture?.(file);
      onClose?.();
    }
  };

  return createPortal(
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 dark:bg-black/80 backdrop-blur-md p-3 sm:p-5 animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative w-full max-w-lg rounded-2xl overflow-hidden shadow-glass-lg border border-line bg-surface-overlay text-ink flex flex-col ${
          isRtl ? 'text-right' : 'text-left'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line bg-surface-overlay select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-accent-soft text-accent border border-accent/30 shrink-0 shadow-2xs">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ink truncate">
                {t('toolbar.cameraModalTitle')}
              </h3>
              <p className="text-caption text-ink-muted truncate">
                {t('toolbar.cameraModalSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-control text-ink-subtle hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
            aria-label={t('common.close') || 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Framed Camera Viewport */}
        <div className="p-3 sm:p-4 bg-surface-sunken">
          <div className="relative bg-zinc-950 rounded-xl aspect-[4/3] w-full flex items-center justify-center overflow-hidden border border-line shadow-inner">
            {capturedPhoto ? (
              <img
                src={capturedPhoto.previewUrl}
                alt="Captured preview"
                className="w-full h-full object-contain"
              />
            ) : cameraError ? (
              <div className="flex flex-col items-center justify-center text-center px-6 py-8 gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-amber-400">
                  <Camera className="w-5 h-5" />
                </div>
                <p className="text-xs text-white/90 max-w-sm leading-relaxed">
                  {cameraError}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-accent hover:bg-accent-hover text-accent-fg shadow-sm transition-all cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('toolbar.cameraUploadFallbackBtn')}</span>
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Subtle Viewfinder Corner Guides */}
                <div className="pointer-events-none absolute inset-4 sm:inset-5">
                  <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-white/60 rounded-tl-md" />
                  <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-white/60 rounded-tr-md" />
                  <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-white/60 rounded-bl-md" />
                  <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-white/60 rounded-br-md" />
                </div>
                {isStarting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                    <span className="text-xs font-medium">{t('toolbar.cameraStarting')}</span>
                  </div>
                )}
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={handleFallbackFileChange}
            />
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-line bg-surface-overlay">
          {capturedPhoto ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('toolbar.cameraRetakeBtn')}</span>
              </button>
              <button
                type="button"
                onClick={handleConfirmPhoto}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold bg-accent hover:bg-accent-hover text-accent-fg shadow-control transition-all active:scale-95 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t('toolbar.cameraUsePhotoBtn')}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line transition-colors cursor-pointer"
                title={t('toolbar.uploadPhoto')}
              >
                <Upload className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span>{t('toolbar.uploadPhoto')}</span>
              </button>

              <button
                type="button"
                onClick={handleCaptureFrame}
                disabled={isStarting || Boolean(cameraError)}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-fg shadow-control transition-all active:scale-95 cursor-pointer disabled:cursor-not-allowed"
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span>{t('toolbar.cameraCaptureBtn')}</span>
              </button>

              <button
                type="button"
                onClick={handleSwitchCamera}
                disabled={isStarting || Boolean(cameraError)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-surface-raised hover:bg-surface-hover text-ink-muted hover:text-ink border border-line transition-colors cursor-pointer disabled:opacity-40"
                title={t('toolbar.cameraSwitchBtn')}
              >
                <RefreshCw className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                <span className="hidden sm:inline">{t('toolbar.cameraSwitchBtn')}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
