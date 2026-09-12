import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Loader2, Calendar, UserRound, LogIn, RefreshCw } from 'lucide-react';
import { fetchAllTimelinesAdmin, fetchAdminUsers } from '../api';

// Admin-only diagnostics panel (English-only by design — an internal/developer tool,
// not part of the translated end-user experience).
export default function AdminPanel({ isOpen, onClose, onSelectTimeline }) {
  const [tab, setTab] = useState('timelines'); // 'timelines' | 'logins'
  const [timelines, setTimelines] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  if (!isOpen) return null;

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface-raised border border-line rounded-sheet w-full max-w-2xl overflow-hidden shadow-panel flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-surface-raised">
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
              className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-line bg-surface-raised">
          {[
            { id: 'timelines', label: `Timelines (${timelines.length})` },
            { id: 'logins', label: `Users (${users.length})` }
          ].map((tabDef) => (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t-control border-b-2 transition-colors ${
                tab === tabDef.id
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
          ) : tab === 'timelines' ? (
            timelines.length === 0 ? (
              <div className="py-12 text-center text-ink-subtle text-xs">No timelines found.</div>
            ) : (
              <div className="space-y-2">
                {timelines.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      onSelectTimeline?.(item.id);
                      onClose();
                    }}
                    className="group flex items-center justify-between p-3 bg-surface-sunken hover:bg-surface-hover border border-line rounded-panel cursor-pointer transition-colors"
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <h4 className="font-semibold text-sm text-ink group-hover:text-accent truncate">
                        {item.title}
                      </h4>
                      <div className="flex items-center gap-3 text-[11px] text-ink-muted mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {item.articleCount} events
                        </span>
                        <span>Updated {fmt(item.updatedAt)}</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-ink-subtle shrink-0" title={item.ownerId || ''}>
                      {item.ownerId ? item.ownerId.slice(0, 8) : '—'}
                    </span>
                  </div>
                ))}
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
                        u.email || '—'
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
