(() => {
  const params = new URLSearchParams(window.location.search);
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-track-kind]');
    if (!link) return;
    const payload = {
      kind: link.dataset.trackKind,
      postId: link.dataset.postId || null,
      designVersion: link.dataset.designVersion || null,
      referrer: document.referrer || null,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
    };
    navigator.sendBeacon('/events', JSON.stringify(payload));
  }, { capture: true });
})();
