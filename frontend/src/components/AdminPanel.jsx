import React, { useState, useEffect, useMemo } from 'react';
import { X, ShieldCheck, Loader2, Calendar, UserRound, LogIn, RefreshCw, Zap, ExternalLink } from 'lucide-react';
import { fetchAllTimelinesAdmin, fetchAdminUsers } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { getQuotaPolicyText } from '../utils/quotaPolicy';
import useModalAnimation from '../hooks/useModalAnimation';

// Admin-only diagnostics panel (English-only by design - an internal/developer tool,
// not part of the translated end-user experience). The Quota Policy section is the
// one exception: it reuses the shared, localized quota-policy copy (i18n keys under
// `quota.*`) so admins reading it in any language see accurate, mode-specific text.
export default function AdminPanel({ isOpen, onClose, onSelectTimeline, quota }) {
  const { t } = useLanguage();
  const { user: currentAdminUser } = useAuth();
  const [tab, setTab] = useState('timelines'); // 'timelines' | 'logins' | 'policy'
  const [timelines, setTimelines] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { isRendered, isVisible, handleClose, dragHandleProps } = useModalAnimation(isOpen, onClose, { duration: 250 });

  const userMap = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      if (u.id) map.set(u.id, u);
    });
    return map;
  }, [users]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [tls, usrs] = await Promise.all([fetchAllTimelinesAdmin(), fetchAdminUsers()]);
      setTimelines(tls);
      setUsers(usrs);
    } catch (e) {
      setError(e.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isRendered) return null;

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '-');

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-surface-overlay border border-line rounded-t-3xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl w-full max-w-2xl overflow-hidden shadow-glass-lg flex flex-col max-h-[90vh] sm:max-h-[85vh] transition-all duration-250 ease-out pb-[max(0.75rem,env(safe-area-inset-bottom))] ${isVisible
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-0 sm:scale-95'
          }`}
      >
        {/* Mobile Drag Indicator */}
        <div
          className="sm:hidden flex justify-center pt-3 pb-1 bg-surface-raised/80 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
          {...dragHandleProps}
        >
          <div className="w-12 h-1.5 rounded-full bg-line-strong/60" />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-overlay/80 backdrop-blur-sm select-none"
          {...dragHandleProps}
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-control bg-warning-soft text-warning">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-ink">Admin Panel</h3>
              <p className="text-xs text-ink-muted">All saved timelines & registered logins</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={load}
              title="Refresh"
              className="p-1.5 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="p-1.5 rounded-control text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-line bg-surface-raised">
          {[
            { id: 'timelines', label: `Timelines (${timelines.length})` },
            { id: 'logins', label: `Users (${users.length})` },
            { id: 'policy', label: 'Quota Policy' }
          ].map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t-control border-b-2 transition-colors ${tab === tabDef.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink'
                }`}
            >
              {tabDef.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 text-sm">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-ink-muted gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
              <span className="text-xs">Loading...</span>
            </div>
          ) : error ? (
            <div className="py-8 text-center text-danger text-xs">{error}</div>
          ) : tab === 'policy' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-ink-subtle text-caption font-semibold uppercase tracking-wide">
                <Zap className="w-3.5 h-3.5 text-accent" />
                <span>{t('quota.adminPolicyTitle')}</span>
              </div>
              <div className="p-3 bg-surface-sunken border border-line rounded-panel space-y-1">
                <p className="text-xs font-semibold text-ink">
                  {t('quota.adminPolicyRegisteredLabel')}
                </p>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {quota
                    ? getQuotaPolicyText(t, 'registered', quota.api_key_mode, {
                      total: quota.registered_daily_limit,
                      admin: true
                    })
                    : '-'}
                </p>
              </div>
              <div className="p-3 bg-surface-sunken border border-line rounded-panel space-y-1">
                <p className="text-xs font-semibold text-ink">
                  {t('quota.adminPolicyGuestLabel')}
                </p>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {quota
                    ? getQuotaPolicyText(t, 'guest', quota.guest_api_key_mode, {
                      total: quota.guest_daily_limit,
                      admin: true
                    })
                    : '-'}
                </p>
              </div>
            </div>
          ) : tab === 'timelines' ? (
            timelines.length === 0 ? (
              <div className="py-12 text-center text-ink-subtle text-xs">No timelines found.</div>
            ) : (
              <div className="space-y-2">
                {timelines.map((item) => {
                  const owner = item.ownerId ? userMap.get(item.ownerId) : null;
                  const isMe = Boolean(currentAdminUser?.id && item.ownerId === currentAdminUser.id);
                  const isGuestOwner = Boolean(owner?.is_anonymous || (!owner && item.ownerId && item.ownerId.startsWith('anon')));
                  const ownerLabel = isMe
                    ? 'You (Admin)'
                    : owner
                      ? (owner.is_anonymous ? `Guest (${item.ownerId.slice(0, 6)})` : (owner.email || item.ownerId.slice(0, 8)))
                      : (item.ownerId ? (isGuestOwner ? `Guest (${item.ownerId.slice(0, 6)})` : item.ownerId.slice(0, 8)) : 'No Owner');

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        onSelectTimeline?.(item.id);
                        handleClose();
                      }}
                      className="group flex items-center justify-between p-3 bg-surface-sunken hover:bg-surface-hover border border-line hover:border-accent/40 rounded-panel cursor-pointer transition-all duration-150"
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm text-ink group-hover:text-accent truncate transition-colors">
                            {item.title}
                          </h4>
                          {item.isShared && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent/10 text-accent border border-accent/20 shrink-0">
                              Shared
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-caption text-ink-muted mt-1">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {item.articleCount} events
                          </span>
                          <span>Updated {fmt(item.updatedAt)}</span>
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface border border-line text-ink-subtle text-[11px]"
                            title={`Owner ID: ${item.ownerId || 'None'}`}
                          >
                            <UserRound className={`w-3 h-3 ${isMe ? 'text-success' : isGuestOwner ? 'text-warning' : 'text-accent'}`} />
                            <span className="truncate max-w-[140px] sm:max-w-[220px]">{ownerLabel}</span>
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTimeline?.(item.id);
                          handleClose();
                        }}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-control bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white transition-all cursor-pointer shadow-sm"
                        title="Open timeline"
                      >
                        <span>Open</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-ink-subtle text-xs">No users found.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-subtle border-b border-line">
                  <th className="py-2 pr-2 font-medium">User</th>
                  <th className="py-2 pr-2 font-medium">Type</th>
                  <th className="py-2 pr-2 font-medium">Signed up</th>
                  <th className="py-2 font-medium">Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-line">
                    <td className="py-2 pr-2 text-ink truncate max-w-[180px]">
                      {u.is_anonymous ? (
                        <span className="inline-flex items-center gap-1 text-ink-subtle">
                          <UserRound className="w-3 h-3" /> Guest
                        </span>
                      ) : (
                        u.email || '-'
                      )}
                    </td>
                    <td className="py-2 pr-2 text-ink-muted">
                      {u.is_anonymous ? 'Guest' : (u.providers || []).join(', ') || 'Email'}
                    </td>
                    <td className="py-2 pr-2 text-ink-muted">{fmt(u.created_at)}</td>
                    <td className="py-2 text-ink-muted flex items-center gap-1">
                      <LogIn className="w-3 h-3" /> {fmt(u.last_sign_in_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
