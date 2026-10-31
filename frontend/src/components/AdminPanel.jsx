import React, { useState, useEffect, useMemo } from 'react';
import { X, ShieldCheck, Loader2, Calendar, UserRound, LogIn, RefreshCw, Zap, ExternalLink, Trash2 } from './icons/ThemeIcons';
import { fetchAllTimelinesAdmin, fetchAdminUsers, fetchCommunityLedger, updateAdminCommunityLedger, getKofiWebhookUrl } from '../api';
import CommunityTransparencyCard from './CommunityTransparencyCard';
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
  const [ledger, setLedger] = useState(null);
  const [editSpent, setEditSpent] = useState('');
  const [editDonated, setEditDonated] = useState('');
  const [editDonationsCount, setEditDonationsCount] = useState('');
  const [savingLedger, setSavingLedger] = useState(false);
  const [ledgerSavedMsg, setLedgerSavedMsg] = useState('');

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
      const [tls, usrs, ldg] = await Promise.all([fetchAllTimelinesAdmin(), fetchAdminUsers(), fetchCommunityLedger()]);
      if (ldg) {
        setLedger(ldg);
        setEditSpent(String(ldg.spent_usd ?? 0));
        setEditDonated(String(ldg.donated_usd ?? 0));
        setEditDonationsCount(String(ldg.donations_count ?? 0));
      }
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
      className={`fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-5 bg-black/60 dark:bg-black/75 backdrop-blur-md transition-opacity duration-250 ease-out ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
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
            { id: 'community', label: 'Community Pool ($)' },
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
          ) : tab === 'community' ? (
            <div className="space-y-4" dir="ltr">
              <CommunityTransparencyCard initialLedger={ledger} />

              <div className="p-4 bg-surface-sunken border border-line rounded-panel space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="text-xs font-bold text-ink uppercase tracking-wide">
                    Update Community Ledger Totals
                  </h4>
                  <button
                    type="button"
                    disabled={savingLedger}
                    onClick={async () => {
                      setSavingLedger(true);
                      setLedgerSavedMsg('');
                      try {
                        const updated = await updateAdminCommunityLedger({ sync_from_activity_log: true });
                        setLedger(updated);
                        setEditSpent(String(updated.spent_usd ?? 0));
                        setEditDonated(String(updated.donated_usd ?? 0));
                        setEditDonationsCount(String(updated.donations_count ?? 0));
                        setLedgerSavedMsg('Synced historical AI spend from activity_log!');
                      } catch (err) {
                        setError(err.message || 'Failed to sync from activity log');
                      } finally {
                        setSavingLedger(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs font-medium bg-surface hover:bg-surface-hover text-ink border border-line transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${savingLedger ? 'animate-spin' : ''}`} />
                    <span>Sync Spend from DB Activity Log</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingLedger}
                    onClick={async () => {
                      setSavingLedger(true);
                      setLedgerSavedMsg('');
                      try {
                        const updated = await updateAdminCommunityLedger({ simulate_donation_usd: 3.0 });
                        setLedger(updated);
                        setEditSpent(String(updated.spent_usd ?? 0));
                        setEditDonated(String(updated.donated_usd ?? 0));
                        setEditDonationsCount(String(updated.donations_count ?? 0));
                        setLedgerSavedMsg('Simulated +$3.00 test donation! (Click Save Totals to reset back to 0)');
                      } catch (err) {
                        setError(err.message || 'Failed to simulate donation');
                      } finally {
                        setSavingLedger(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control text-xs font-medium bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 border border-rose-500/30 transition-colors cursor-pointer"
                  >
                    <span>Simulate Test Tip (+$3.00)</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      Total AI Spend ($ USD)
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={editSpent}
                      onChange={(e) => setEditSpent(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-control bg-surface border border-line text-xs font-mono text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      Total Donated ($ USD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editDonated}
                      onChange={(e) => setEditDonated(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-control bg-surface border border-line text-xs font-mono text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-muted mb-1">
                      Donations Count
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={editDonationsCount}
                      onChange={(e) => setEditDonationsCount(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-control bg-surface border border-line text-xs font-mono text-ink"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-success font-medium">
                    {ledgerSavedMsg}
                  </span>
                  <button
                    type="button"
                    disabled={savingLedger}
                    onClick={async () => {
                      setSavingLedger(true);
                      setLedgerSavedMsg('');
                      try {
                        const updated = await updateAdminCommunityLedger({
                          spent_usd: parseFloat(editSpent || '0'),
                          donated_usd: parseFloat(editDonated || '0'),
                          donations_count: parseInt(editDonationsCount || '0', 10),
                        });
                        setLedger(updated);
                        setEditSpent(String(updated.spent_usd ?? 0));
                        setEditDonated(String(updated.donated_usd ?? 0));
                        setEditDonationsCount(String(updated.donations_count ?? 0));
                        setLedgerSavedMsg('Totals saved successfully!');
                      } catch (err) {
                        setError(err.message || 'Failed to save totals');
                      } finally {
                        setSavingLedger(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-control text-xs font-semibold bg-accent hover:bg-accent-hover text-white transition-colors cursor-pointer"
                  >
                    <span>Save Totals</span>
                  </button>
                </div>
              </div>

              <div className="p-4 bg-surface-sunken border border-line rounded-panel space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">Ko-fi Automatic Webhook</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      ledger?.kofi_webhook_configured
                        ? 'bg-success-soft text-success border border-success/30'
                        : 'bg-warning-soft text-warning border border-warning/30'
                    }`}
                  >
                    {ledger?.kofi_webhook_configured ? 'Connected (KOFI_VERIFICATION_TOKEN set)' : 'Optional (Set KOFI_VERIFICATION_TOKEN)'}
                  </span>
                </div>
                <p className="text-ink-muted leading-relaxed">
                  To update donations automatically whenever someone supports on Ko-fi, paste this Webhook URL in{' '}
                  <a
                    href="https://ko-fi.com/manage/webhooks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Ko-fi Webhooks Settings
                  </a>{' '}
                  and set the Verification Token in your backend environment as <code className="font-mono text-ink">KOFI_VERIFICATION_TOKEN</code>:
                </p>
                <div className="p-2 rounded bg-surface border border-line font-mono text-[11px] text-ink select-all break-all">
                  {getKofiWebhookUrl()}
                </div>
                {typeof window !== 'undefined' && !window.location.origin.startsWith('https://') && (
                  <p className="text-[11px] text-warning font-medium leading-relaxed pt-1">
                    Note: Ko-fi&apos;s servers in the cloud cannot connect to localhost ({window.location.origin}). Use the public HTTPS URL above once deployed to production, or click &ldquo;Simulate Test Tip (+$3.00)&rdquo; above to test locally!
                  </p>
                )}
              </div>
            </div>
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
                      className={`group flex items-center justify-between p-3 bg-surface-sunken hover:bg-surface-hover border rounded-panel cursor-pointer transition-all duration-150 ${
                        item.isDeleted
                          ? 'border-danger/30 hover:border-danger/50 opacity-80'
                          : 'border-line hover:border-accent/40'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm text-ink group-hover:text-accent truncate transition-colors">
                            {item.title}
                          </h4>
                          {item.isDeleted && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-danger-soft text-danger border border-danger/30 shrink-0"
                              title={item.deletedAt ? `Deleted ${fmt(item.deletedAt)}` : 'Deleted'}
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                              <span>Deleted</span>
                            </span>
                          )}
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
                          {item.isDeleted && item.deletedAt && (
                            <span className="text-danger">Deleted {fmt(item.deletedAt)}</span>
                          )}
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
