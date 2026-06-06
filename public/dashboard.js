// Auto-refresh the event detail page every 5 seconds if there are pending/in_flight deliveries
(function () {
  const hasPending = document.querySelector(".badge-pending, .badge-inflight");
  if (hasPending && window.location.pathname.includes("/events/")) {
    setTimeout(() => window.location.reload(), 5000);
  }
})();
