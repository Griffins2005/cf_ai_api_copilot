export const onRequest = async ({ next, env }) => {
  const response = await next();
  const apiBase = env.CF_API_BASE;

  if (!apiBase) {
    return response;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  return new HTMLRewriter()
    .on("head", {
      element(element) {
        const safeBase = String(apiBase).replace(/"/g, '\\"');
        element.append(`<script>window.CF_API_BASE = "${safeBase}";</script>`, { html: true });
      }
    })
    .transform(response);
};

