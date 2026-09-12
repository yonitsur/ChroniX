import React, { useState, useEffect } from 'react';
import { X, Key, CheckCircle, Eye, EyeOff, Save, ExternalLink, Zap, AlertTriangle, Trash2, Loader2, User } from 'lucide-react';
import { getApiKey, setApiKey } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

export default function SettingsModal({
  isOpen,
  onClose,
  quota,
  onRefreshQuota,
  initialTab = 'general'
}) {
  const { t, isRtl } = useLanguage();
  const { user, isGuest, deleteAccount } = useAuth();
  const [apiKey, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Account deletion confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isRegisteredUser = Boolean(user && !isGuest);
  const confirmWord = t('settings.deleteAccountConfirmWord') || 'DELETE';

  useEffect(() => {
    if (isOpen) {
      setKeyValue(getApiKey());
      setShowDeleteConfirm(false);
      setDeleteInputText('');
      setDeleteError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e) => {
    e.preventDefault();
    setApiKey(apiKey);
    setSavedSuccess(true);
    if (onRefreshQuota) onRefreshQuota();
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const handleClear = () => {
    setApiKey('');
    setKeyValue('');
  };

  const handleDeleteAccountSubmit = async () => {
    if (deleteInputText.trim().toLowerCase() !== confirmWord.toLowerCase()) {
      return;
    }
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      console.error('Account deletion error:', err);
      setDeleteError(err.message || t('settings.deleteAccountError'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-md max-h-[90vh] overflow-hidden shadow-panel flex flex-col ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-control bg-accent-soft text-accent border border-accent/40">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-ink">
                {t('settings.title')}
              </h3>
              <p className="text-xs text-ink-muted">
                {t('settings.subtitle')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-ink-subtle hover:text-ink p-1 rounded-control hover:bg-surface-hover transition-colors cursor-pointer"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6 space-y-4 text-sm text-ink overflow-y-auto">
          {/* Daily Quota / Server Mode Info Box */}
          <div className="p-3.5 bg-surface-sunken rounded-panel border border-line space-y-2 text-xs">
            <div className="flex items-center justify-between font-semibold text-ink">
              <span className="flex items-center gap-1.5 text-accent">
                <Zap className="w-4 h-4" />
                <span>{t('quota.modalTitle')}</span>
              </span>
              {quota?.is_admin ? (
                <span className="text-[11px] font-bold text-warning px-2 py-0.5 rounded-full bg-warning-soft border border-warning/40">
                  {t('quota.tierAdmin')}
                </span>
              ) : quota?.is_guest ? (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                  quota.remaining_paid > 0
                    ? 'text-accent bg-accent-soft border-accent/40'
                    : 'text-ink-subtle bg-surface-raised border-line'
                }`}>
                  {quota.remaining_paid > 0
                    ? `${quota.remaining_paid}/${quota.daily_paid_limit || 5}`
                    : t('quota.tierFree')}
                </span>
              ) : quota?.mode === 'free' ? (
                <span className="text-[11px] font-bold text-success px-2 py-0.5 rounded-full bg-success-soft border border-success/40">
                  {t('quota.badgeFreeMode')}
                </span>
              ) : quota?.daily_paid_limit === -1 ? (
                <span className="text-[11px] font-bold text-accent px-2 py-0.5 rounded-full bg-accent-soft border border-accent/40">
                  {t('quota.badgeUnlimited')}
                </span>
              ) : quota ? (
                <span className="text-[11px] font-bold text-accent px-2 py-0.5 rounded-full bg-accent-soft border border-accent/40">
                  {quota.remaining_paid > 0
                    ? `${quota.remaining_paid}/${quota.daily_paid_limit}`
                    : t('quota.tierFree')}
                </span>
              ) : null}
            </div>

            {/* If Guest: show detailed dual breakdown (Timelines & Chat) */}
            {quota?.is_guest ? (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-control bg-surface-raised border border-line flex flex-col gap-0.5 shadow-control">
                    <span className="text-ink-subtle text-[10px] font-medium">{t('quota.timelineQuotaTitle')}</span>
                    <span className="font-bold text-accent">
                      {quota.remaining_paid > 0 ? `${quota.remaining_paid} / ${quota.daily_paid_limit || 5}` : t('quota.tierFree')}
                    </span>
                  </div>
                  <div className="p-2 rounded-control bg-surface-raised border border-line flex flex-col gap-0.5 shadow-control">
                    <span className="text-ink-subtle text-[10px] font-medium">{t('quota.chatQuotaTitle')}</span>
                    <span className="font-bold text-accent">
                      {quota.guest_chat_remaining !== undefined && quota.guest_chat_remaining > 0
                        ? `${quota.guest_chat_remaining} / ${quota.guest_daily_chat_limit || 15}`
                        : quota.guest_chat_remaining !== undefined && quota.guest_chat_remaining === 0
                        ? t('quota.tierFree')
                        : `15 / 15`}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  {t('quota.guestModeDesc', {
                    timelines: quota?.daily_paid_limit || 5,
                    chats: quota?.guest_daily_chat_limit || 15
                  })}
                </p>
                <p className="text-[11px] text-ink-subtle leading-relaxed">
                  {t('quota.freeDesc')}
                </p>
              </div>
            ) : quota?.daily_paid_limit === -1 && !quota?.is_admin ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-ink-muted leading-relaxed font-medium">
                  {t('quota.registeredUnlimitedDesc')}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  {t('quota.premiumDesc')}
                </p>
                <p className="text-[11px] text-ink-subtle leading-relaxed">
                  {t('quota.freeDesc')}
                </p>
              </div>
            )}
            {!quota?.is_admin && !apiKey && (quota?.mode === 'free' || quota?.mode === 'limited') && (
              <p className="flex items-start gap-1.5 text-[11px] font-medium text-accent leading-relaxed pt-2 mt-1 border-t border-line">
                <Key className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{t('settings.byokHint')}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink mb-1.5">
              {t('settings.keyLabel')}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder={t('settings.keyPlaceholder')}
                className="w-full bg-surface-sunken border border-line rounded-control px-3 py-2.5 pr-10 text-ink outline-none focus:border-accent font-mono text-xs shadow-control"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-2.5 text-ink-subtle hover:text-ink cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-ink-subtle mt-1.5 leading-relaxed">
              {t('settings.keyNote')}
            </p>
          </div>

          <div className="text-xs">
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:text-accent-hover underline underline-offset-2"
            >
              <span>{t('settings.getFreeKey')}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Account Management & Danger Zone (Only for registered users) */}
          {isRegisteredUser && (
            <div className="pt-3 border-t border-line space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-ink-subtle" />
                  <span>{t('settings.accountSection')}</span>
                </span>
                <span className="text-[11px] text-ink-subtle truncate max-w-[200px]" title={user?.email}>
                  {user?.email}
                </span>
              </div>

              {/* Danger Zone Card */}
              <div className="p-3 bg-danger-soft border border-danger/30 rounded-panel space-y-2">
                <div className="flex items-center gap-1.5 text-danger font-semibold text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('settings.dangerZone')}</span>
                </div>
                <p className="text-[11px] text-danger leading-relaxed">
                  {t('settings.deleteAccountDesc')}
                </p>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-2 px-3 flex items-center justify-center gap-1.5 rounded-control bg-danger hover:bg-danger-hover text-danger-fg text-xs font-semibold transition-colors cursor-pointer shadow-control"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('settings.deleteAccountBtn')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Footer buttons */}
          <div className="pt-4 flex items-center justify-between border-t border-line">
            {apiKey ? (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-danger hover:underline cursor-pointer"
              >
                {t('settings.clearKey')}
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover font-medium transition-colors text-xs cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs shadow-control transition-all cursor-pointer active:scale-95"
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{t('settings.saved')}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{t('settings.saveKey')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Nested Modal for Confirming Account Deletion */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-150">
            <div
              className={`bg-surface-raised border border-danger/40 rounded-sheet w-full max-w-sm p-5 shadow-panel space-y-4 ${
                isRtl ? 'text-right' : 'text-left'
              }`}
              dir={isRtl ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center gap-2.5 text-danger">
                <div className="p-2 rounded-control bg-danger-soft text-danger border border-danger/30">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-ink">
                    {t('settings.deleteAccountConfirmTitle')}
                  </h4>
                  <p className="text-[11px] text-danger font-medium">
                    {user?.email}
                  </p>
                </div>
              </div>

              <p className="text-xs text-ink-muted leading-relaxed">
                {t('settings.deleteAccountConfirmText')}
              </p>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  {t('settings.deleteAccountTypeConfirm', { word: `"${confirmWord}"` })}
                </label>
                <input
                  type="text"
                  value={deleteInputText}
                  onChange={(e) => setDeleteInputText(e.target.value)}
                  placeholder={confirmWord}
                  disabled={isDeleting}
                  className="w-full bg-surface-sunken border border-danger/40 rounded-control px-3 py-2 text-xs text-ink outline-none focus:border-danger font-mono shadow-control"
                />
              </div>

              {deleteError && (
                <p className="text-xs text-danger font-medium">
                  {deleteError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteInputText('');
                    setDeleteError('');
                  }}
                  disabled={isDeleting}
                  className="px-3.5 py-1.5 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover text-xs font-medium transition-colors cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAccountSubmit}
                  disabled={deleteInputText.trim().toLowerCase() !== confirmWord.toLowerCase() || isDeleting}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-control bg-danger hover:bg-danger-hover disabled:opacity-40 disabled:cursor-not-allowed text-danger-fg font-semibold text-xs shadow-control transition-all cursor-pointer"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t('settings.deleteAccountProcessing')}</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('settings.deleteAccountBtn')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
