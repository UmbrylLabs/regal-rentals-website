import { ensureProductPhotoTable, normalizePhotoId } from '../../_lib/product-photo.js';

export async function onRequestGet(context) {
  const id=normalizePhotoId(new URL(context.request.url).searchParams.get('id'));
  if(!id) return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
  try {
    await ensureProductPhotoTable(context.env.DB);
    const row=await context.env.DB.prepare(
      'SELECT image_data,image_bytes FROM storefront_product_photos WHERE product_id=?1'
    ).bind(id).first();
    if(!row?.image_data)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
    const bytes=Uint8Array.from(row.image_data);
    if(bytes.length<20 || bytes.length>450000) return new Response('Not found',{status:404});
    return new Response(bytes,{
      status:200,
      headers:{
        'Content-Type':'image/webp',
        'Content-Length':String(bytes.length),
        'Cache-Control':'public,max-age=86400',
        'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy':'same-site'
      }
    });
  }catch(error){
    console.error('Product photo unavailable',String(error?.message||'error').slice(0,100));
    return new Response('Photo unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
