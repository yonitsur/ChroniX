// Step definitions for the timeline-screen interactive guide (InteractiveGuide.jsx).
//
// Each step carries a stable `key` (used for i18n lookup under `tour.steps.<key>`),
// the DOM target to spotlight (an element id, or a function returning an element so
// we can pick whichever variant is currently visible), a preferred placement, and
// optional lifecycle hooks. Steps marked `optional` are silently skipped when their
// target is absent (e.g. the Filter button only exists once a timeline has 2+ groups).

// Target for the chat step: either the floating bubble or the open panel.
const chatTarget = () =>
  document.getElementById('guide-chat-bubble') || document.getElementById('guide-chat-panel');

// Open the top-bar "More actions" menu so the Saved Timelines row can be highlighted.
const openMoreMenu = () => {
  if (!document.getElementById('guide-menu-saved')) {
    document.getElementById('guide-more-actions')?.click();
  }
};

// Close it again when leaving the step.
const closeMoreMenu = () => {
  if (document.getElementById('guide-menu-saved')) {
    document.getElementById('guide-more-actions')?.click();
  }
};

/**
 * Build the ordered list of resolved guide steps.
 * Filters out steps that target controls not present or hidden in the current view.
 * @param {(path: string, params?: object) => string} t translation helper
 */
export function buildGuideSteps(t) {
  const step = (key, extra = {}) => ({
    key,
    title: t(`tour.steps.${key}.title`),
    body: t(`tour.steps.${key}.body`),
    ...extra,
  });

  const allSteps = [
    step('welcome', { target: 'guide-more-actions', placement: 'bottom', optional: true }),
    step('chat', { target: chatTarget, placement: 'left', optional: true }),
    step('filter', { target: 'guide-dock-filter', placement: 'right', optional: true }),
    step('explore', { target: 'guide-dock-explore', placement: 'right', optional: true }),
    step('saved', {
      target: 'guide-menu-saved',
      placement: 'bottom',
      beforeShow: openMoreMenu,
      afterHide: closeMoreMenu,
    }),
  ];

  return allSteps;
}
