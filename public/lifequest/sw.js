self.LIFEQUEST_BASE_PATH = "/lifequest";

function withBasePath(path) {
  if (!path || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (!path.startsWith("/")) {
    return path;
  }

  if (
    path === self.LIFEQUEST_BASE_PATH ||
    path.startsWith(`${self.LIFEQUEST_BASE_PATH}/`)
  ) {
    return path;
  }

  return `${self.LIFEQUEST_BASE_PATH}${path}`;
}

self.addEventListener("push", (event) => {
  const data = event.data
    ? event.data.json()
    : {
        title: "LifeQuest",
        body: "Bạn có mission cần kiểm tra hôm nay.",
        url: "/dashboard",
      };

  event.waitUntil(
    self.registration.showNotification(data.title || "LifeQuest", {
      body: data.body || "Bạn có mission cần kiểm tra hôm nay.",
      icon: withBasePath("/images/logo.png"),
      badge: withBasePath("/images/logo.png"),
      data: {
        url: withBasePath(data.url || "/dashboard"),
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    withBasePath(event.notification.data?.url || "/dashboard"),
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((item) => item.url === targetUrl);

      if (client) {
        return client.focus();
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
