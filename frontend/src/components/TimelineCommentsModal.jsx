import React, { useState, useEffect, useRef } from 'react';
import { X, MessageSquare, Send, Trash2, Loader2, User, Clock, AlertCircle } from 'lucide-react';
import { fetchTimelineComments, postTimelineComment, deleteTimelineComment } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

function formatRelativeTime(dateStr, language = 'en') {
  if (!dateStr) return '';
  try {
    const now = new Date();
    const past = new Date(dateStr);
    const diffMs = now - past;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return language === 'he' ? 'הרגע' : 'just now';
    if (diffMin < 60) return language === 'he' ? `לפני ${diffMin} דק'` : `${diffMin}m ago`;
    if (diffHour < 24) return language === 'he' ? `לפני ${diffHour} שעות` : `${diffHour}h ago`;
    if (diffDay < 30) return language === 'he' ? `לפני ${diffDay} ימים` : `${diffDay}d ago`;

    return past.toLocaleDateString();
  } catch {
    return '';
  }
}

export default function TimelineCommentsModal({
  isOpen,
  onClose,
  timeline,
  onCommentCountChange
}) {
  const { t, language, isRtl } = useLanguage();
  const { user, isGuest } = useAuth();

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [userName, setUserName] = useState('');
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const commentsEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Initialize author name from user profile or localStorage
  useEffect(() => {
    if (user && !isGuest) {
      const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '';
      setUserName(name);
    } else {
      const savedGuestName = localStorage.getItem('chronix_commenter_name') || '';
      setUserName(savedGuestName);
    }
  }, [user, isGuest, isOpen]);

  // Load comments when opened
  useEffect(() => {
    if (isOpen && timeline?.id) {
      loadComments(timeline.id);
    } else {
      setComments([]);
      setCommentText('');
      setError(null);
    }
  }, [isOpen, timeline?.id]);

  const loadComments = async (timelineId) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchTimelineComments(timelineId);
      setComments(list || []);
    } catch (err) {
      console.warn('Failed to load comments:', err);
      setError(t('comments.loadError') || 'Failed to load comments.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !timeline) return null;

  const handlePost = async (e) => {
    e?.preventDefault();
    const text = commentText.trim();
    if (!text || submitting) return;

    // Persist guest name
    if (isGuest && userName.trim()) {
      localStorage.setItem('chronix_commenter_name', userName.trim());
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await postTimelineComment(timeline.id, {
        content: text,
        userName: userName.trim() || (isGuest ? (t('comments.guestDefault') || 'Explorer') : '')
      });

      const updated = [created, ...comments];
      setComments(updated);
      setCommentText('');
      onCommentCountChange?.(timeline.id, updated.length);

      // Focus back on textarea
      textareaRef.current?.focus();
    } catch (err) {
      setError(err?.message || t('comments.postError') || 'Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId) => {
    if (deletingId === commentId) return;
    setDeletingId(commentId);
    try {
      await deleteTimelineComment(timeline.id, commentId);
      const updated = comments.filter((c) => c.id !== commentId);
      setComments(updated);
      onCommentCountChange?.(timeline.id, updated.length);
    } catch (err) {
      setError(t('comments.deleteError') || 'Failed to delete comment.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      handlePost();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`bg-surface-raised border border-line rounded-sheet w-full max-w-xl shadow-panel flex flex-col max-h-[90vh] sm:max-h-[85vh] overflow-hidden ${
          isRtl ? 'text-right' : 'text-left'
        }`}
        dir={isRtl ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 sm:px-6 sm:py-4 border-b border-line bg-surface-raised/95">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-control bg-accent-soft text-accent border border-accent/20 shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-base text-ink truncate leading-tight">
                {timeline.title || t('comments.timelineComments') || 'Timeline Discussion'}
              </h3>
              <p className="text-xs text-ink-muted flex items-center gap-1.5 mt-0.5">
                <span>{t('comments.title') || 'Community Comments'}</span>
                <span>•</span>
                <span className="font-semibold text-accent">
                  {comments.length}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-subtle hover:text-ink p-1.5 rounded-control hover:bg-surface-hover transition-colors cursor-pointer shrink-0 ms-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="px-4 py-2 bg-danger-soft border-b border-danger/30 text-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-danger hover:text-ink font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Comments Feed */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-ink-subtle gap-2.5">
              <Loader2 className="w-7 h-7 animate-spin text-accent" />
              <span className="text-xs font-medium">{t('comments.loading') || 'Loading discussion...'}</span>
            </div>
          ) : comments.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center text-center px-4">
              <div className="p-3 rounded-full bg-surface-sunken border border-line mb-3">
                <MessageSquare className="w-6 h-6 text-ink-subtle" />
              </div>
              <p className="text-sm font-semibold text-ink mb-1">
                {t('comments.noCommentsTitle') || 'No comments yet'}
              </p>
              <p className="text-xs text-ink-muted max-w-sm">
                {t('comments.noCommentsDesc') || 'Be the first to share your thoughts, historical context, or feedback on this timeline.'}
              </p>
            </div>
          ) : (
            comments.map((item) => {
              const isOwnComment = Boolean(user?.id && item.userId === user.id);
              const relativeTime = formatRelativeTime(item.createdAt, language);

              return (
                <div
                  key={item.id}
                  className="group relative flex gap-3 p-3.5 rounded-panel bg-surface-sunken/60 hover:bg-surface-sunken border border-line/70 transition-all duration-150"
                >
                  {/* User Avatar Initial */}
                  <div className="w-8 h-8 rounded-full bg-accent-soft border border-accent/30 text-accent flex items-center justify-center text-xs font-bold shrink-0 select-none">
                    {(item.userName || 'E')[0].toUpperCase()}
                  </div>

                  {/* Comment Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-xs text-ink">
                        {item.userName || t('comments.guestDefault') || 'Explorer'}
                      </span>
                      {isOwnComment && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/15 text-accent border border-accent/20">
                          {t('comments.youBadge') || 'You'}
                        </span>
                      )}
                      {relativeTime && (
                        <span className="text-[11px] text-ink-subtle flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{relativeTime}</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs sm:text-sm text-ink-muted leading-relaxed whitespace-pre-wrap break-words">
                      {item.content}
                    </p>
                  </div>

                  {/* Delete Own Comment */}
                  {isOwnComment && (
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      disabled={deletingId === item.id}
                      title={t('common.delete') || 'Delete comment'}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-control text-ink-subtle hover:text-danger hover:bg-danger-soft cursor-pointer self-start"
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              );
            })
          )}
          <div ref={commentsEndRef} />
        </div>

        {/* Composer Form */}
        <form onSubmit={handlePost} className="p-3 sm:p-4 bg-surface-sunken border-t border-line flex flex-col gap-2.5">
          {/* Guest Name input if anonymous */}
          {(!user || isGuest) && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 start-2.5 flex items-center pointer-events-none text-ink-subtle">
                  <User className="w-3.5 h-3.5" />
                </div>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder={t('comments.namePlaceholder') || 'Your name or nickname (optional)'}
                  maxLength={40}
                  className="w-full ps-8 pe-3 py-1.5 text-xs rounded-control bg-surface-raised border border-line text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
                />
              </div>
              <span className="text-[11px] text-ink-subtle shrink-0">
                {t('comments.guestNote') || 'Posting as Guest'}
              </span>
            </div>
          )}

          {/* Comment text area & send */}
          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('comments.inputPlaceholder') || 'Write a thoughtful comment... (Enter to post)'}
              maxLength={2000}
              className="flex-1 resize-none p-2.5 text-xs sm:text-sm rounded-control bg-surface-raised border border-line text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent shadow-control"
            />
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="h-10 px-4 rounded-control bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-xs inline-flex items-center gap-1.5 shadow-card transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default shrink-0 active:scale-95"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
                  <span className="hidden sm:inline">{t('comments.sendBtn') || 'Post'}</span>
                </>
              )}
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px] text-ink-subtle px-1">
            <span>{t('comments.tip') || 'Press Enter to post, Shift+Enter for new line'}</span>
            <span>{commentText.length}/2000</span>
          </div>
        </form>
      </div>
    </div>
  );
}
