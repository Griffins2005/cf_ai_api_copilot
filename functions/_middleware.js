export const onRequest = async ({ request, next, env }) => {
  const response = await next();
  const url = new URL(request.url);
  const apiBase = env.CF_API_BASE;

  if (
    url.pathname.startsWith("/api/") ||
    !apiBase ||
    !(response.headers.get("content-type") ?? "").includes("text/html")
  ) {
    return response;
  }

  const safeBase = String(apiBase).replace(/"/g, '\\"');

  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(`<script>window.CF_API_BASE="${safeBase}";</script>`, {
          html: true
        });
      }
    })
    .transform(response);
};

