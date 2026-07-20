export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname.toLowerCase() === 'admin.regal.rentals') {
    return Response.redirect(`${url.origin}/admin/`, 302);
  }
  return context.next();
}
