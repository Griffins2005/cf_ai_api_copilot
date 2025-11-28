export const onRequest = async ({ request, next, env }) => {
  // API requests are simply forwarded
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return next();
  }

  // All other routes render the HTML shell for the SPA
  return new Response(await env.PAGES.fetch(new Request(request.url)).then((res) => res.text()), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
};

