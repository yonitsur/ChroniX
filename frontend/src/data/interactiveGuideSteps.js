// Step definitions for the timeline-screen interactive guide (InteractiveGuide.jsx).
//
// Each step carries a stable `key` (used for i18n lookup under `tour.steps.<key>`),
// the DOM target to spotlight (an element id, or a function returning an element so
// we can pick whichever variant is currently visible), a preferred placement, and
// optional lifecycle hooks. Steps marked `optional` are silently skipped when their
// target is absent (e.g. the Filter button only exists once a timeline has 2+ groups).

// Helper to find the visible instance among multiple responsive elements
const getVisibleElement = (selector) => {
  const els = Array.from(document.querySelectorAll(selector));
  return (
    els.find((el) => {
      const r = el.getBoundingClientRect();
      return (r.width > 0 || r.height > 0) && window.getComputedStyle(el).display !== 'none';
    }) || els[0] || null
  );
};

// Target for the chat step: either the floating bubble or the open panel.
const chatTarget = () =>
  getVisibleElement('#guide-chat-bubble, [data-guide="chat-bubble"]') ||
  getVisibleElement('#guide-chat-panel, [data-guide="chat-panel"]');

// Target for the main menu / more actions trigger button
const moreActionsTarget = () =>
  getVisibleElement('#guide-more-actions, [data-guide="more-actions"]');

// Target for the Saved Timelines row in the actions menu
const savedTarget = () =>
  getVisibleElement('#guide-menu-saved, [data-guide="menu-saved"]');

// Open the actions menu so the Saved Timelines row can be highlighted.
const openMoreMenu = () => {
  const target = savedTarget();
  if (target && target.getBoundingClientRect().width > 0) return;

  // If mobile dock is collapsed, expand it first
  const expandBtn = document.querySelector(
    '#chronix-mobile-dock button[title*="Expand"], #chronix-mobile-dock button[aria-label*="Expand"], #chronix-mobile-dock button[title*="הרחב"], #chronix-mobile-dock button[aria-label*="הרחב"]'
  );
  if (expandBtn && expandBtn.offsetWidth > 0) {
    expandBtn.click();
  }

  const btn = moreActionsTarget();
  btn?.click();
};

// Close it again when leaving the step.
const closeMoreMenu = () => {
  const target = savedTarget();
  if (target && target.getBoundingClientRect().width > 0) {
    const btn = moreActionsTarget();
    btn?.click();
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
    step('welcome', { target: moreActionsTarget, placement: 'right', optional: true }),
    step('chat', { target: chatTarget, placement: 'left', optional: true }),
    step('filter', { target: 'guide-dock-filter', placement: 'right', optional: true }),
    step('explore', { target: 'guide-dock-explore', placement: 'right', optional: true }),
    step('saved', {
      target: savedTarget,
      placement: 'right',
      beforeShow: openMoreMenu,
      afterHide: closeMoreMenu,
    }),
  ];

  return allSteps;
}
