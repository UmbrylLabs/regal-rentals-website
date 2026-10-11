import { requireAdmin, protectMutation } from '../../_lib/auth.js';
import { json, safeErrorResponse, randomId } from '../../_lib/http.js';
import { ensureStorefrontTables } from '../../_lib/storefront.js';
import { PHOTO_MAX_BYTES, PHOTO_WIDTH, PHOTO_HEIGHT, photoUrl, isWebpImage, ensureProductPhotoTable, normalizePhotoId } from '../../_lib/product-photo.js';

export async function onRequestPost(context) {
  try {
    protectMutation(context.request);
    const user=await requireAdmin(context.env,context.request);
    const id=normalizePhotoId(new URL(context.request.url).searchParams.get('id'));
    if(!id) return json({ok:false,error:{code:'INVALID_PRODUCT',message:'Choose an inventory item before uploading a photo.'}},400);
    if(context.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/webp') {
      return json({ok:false,error:{code:'UNSUPPORTED_IMAGE',message:'The photo must be converted to WebP before upload.'}},415);
    }
    const length=Number(context.request.headers.get('content-length')||0);
    if(length>PHOTO_MAX_BYTES) return json({ok:false,error:{code:'IMAGE_TOO_LARGE',message:'Photo is too large after compression. Choose another photo.'}},413);
    const data=new Uint8Array(await context.request.arrayBuffer());
    if(data.byteLength<50 || data.byteLength>PHOTO_MAX_BYTES || !isWebpImage(data)) {
      return json({ok:false,error:{code:'INVALID_IMAGE',message:'Invalid or oversized image. Please upload a JPG, PNG, or WebP through the photo selector.'}},400);
    }
    const product=await context.env.DB.prepare('SELECT id FROM products WHERE id=?1').bind(id).first();
    if(!product)return json({ok:false,error:{code:'NOT_FOUND',message:'Save this inventory item first, then upload the photo.'}},404);
    await ensureStorefrontTables(context.env.DB);
    await ensureProductPhotoTable(context.env.DB);
    const now=Math.floor(Date.now()/1000),version=Date.now();
    const url=photoUrl(id,version);
    // Atomically replace the old image and publish its versioned URL.
    await context.env.DB.batch([
      context.env.DB.prepare(
        'INSERT INTO storefront_product_photos(product_id,image_data,image_bytes,updated_at) VALUES (?1,?2,?3,?4) '+
        'ON CONFLICT(product_id) DO UPDATE SET image_data=excluded.image_data,image_bytes=excluded.image_bytes,updated_at=excluded.updated_at'
      ).bind(id,data,data.length,now),
      context.env.DB.prepare(
        'INSERT INTO storefront_product_media(product_id,image_url,updated_at) VALUES (?1,?2,?3) '+
        'ON CONFLICT(product_id) DO UPDATE SET image_url=excluded.image_url,updated_at=excluded.updated_at'
      ).bind(id,url,now),
      context.env.DB.prepare(
        "INSERT INTO audit_log(id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at) "+
        "VALUES (?1,?2,'product.photo_upload','product',?3,?4,?5)"
      ).bind(randomId(),user.id,id,JSON.stringify({width:PHOTO_WIDTH,height:PHOTO_HEIGHT,bytes:data.length}),now)
    ]);
    return json({ok:true,imageUrl:url,width:PHOTO_WIDTH,height:PHOTO_HEIGHT,bytes:data.length});
  }catch(error){return safeErrorResponse(error);}
}
