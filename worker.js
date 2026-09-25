// cube.vaquum.fi only points at the explorer, which runs on the Origo host beside the cube.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    return Response.redirect(env.EXPLORER_URL + url.pathname + url.search, 302);
  },
};
